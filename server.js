const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { URL } = require("node:url");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const OPEN_GOLF_BASE_URL = "https://api.opengolfapi.org/v1";
const OPEN_GOLF_SEARCH_LIMIT = 10;
const DEFAULT_BROWSE_STATE = "CA";
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

const courseCache = new Map();
const searchCache = new Map();
const snapshotRefreshes = new Map();

const sampleCourses = [
  {
    id: "sample-pebble",
    name: "Pebble Beach Golf Links",
    city: "Pebble Beach",
    state: "CA",
    tees: [
      {
        id: "blue",
        name: "Blue",
        gender: "M",
        rating: 73.7,
        slope: 143,
        holes: [
          { number: 1, par: 4, handicap: 8 },
          { number: 2, par: 5, handicap: 10 },
          { number: 3, par: 4, handicap: 16 },
          { number: 4, par: 4, handicap: 14 },
          { number: 5, par: 3, handicap: 18 },
          { number: 6, par: 5, handicap: 2 },
          { number: 7, par: 3, handicap: 12 },
          { number: 8, par: 4, handicap: 4 },
          { number: 9, par: 4, handicap: 6 },
          { number: 10, par: 4, handicap: 3 },
          { number: 11, par: 4, handicap: 7 },
          { number: 12, par: 3, handicap: 17 },
          { number: 13, par: 4, handicap: 9 },
          { number: 14, par: 5, handicap: 1 },
          { number: 15, par: 4, handicap: 13 },
          { number: 16, par: 4, handicap: 11 },
          { number: 17, par: 3, handicap: 15 },
          { number: 18, par: 5, handicap: 5 }
        ]
      }
    ]
  },
  {
    id: "sample-bethpage",
    name: "Bethpage State Park - Black Course",
    city: "Farmingdale",
    state: "NY",
    tees: [
      {
        id: "white",
        name: "White",
        gender: "M",
        rating: 74.0,
        slope: 144,
        holes: [
          { number: 1, par: 4, handicap: 5 },
          { number: 2, par: 4, handicap: 9 },
          { number: 3, par: 3, handicap: 17 },
          { number: 4, par: 5, handicap: 1 },
          { number: 5, par: 4, handicap: 3 },
          { number: 6, par: 4, handicap: 13 },
          { number: 7, par: 4, handicap: 11 },
          { number: 8, par: 3, handicap: 15 },
          { number: 9, par: 4, handicap: 7 },
          { number: 10, par: 4, handicap: 4 },
          { number: 11, par: 4, handicap: 12 },
          { number: 12, par: 4, handicap: 8 },
          { number: 13, par: 5, handicap: 2 },
          { number: 14, par: 3, handicap: 18 },
          { number: 15, par: 4, handicap: 10 },
          { number: 16, par: 4, handicap: 14 },
          { number: 17, par: 3, handicap: 16 },
          { number: 18, par: 4, handicap: 6 }
        ]
      }
    ]
  }
];

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function normalizeCourse(raw, teePayload = null) {
  const course = raw.course || raw;
  const id = String(course.id || course.course_id || course.slug || course.name || crypto.randomUUID());
  const name = course.name || course.course_name || course.club_name || "Unnamed Course";
  const city = course.city || course.location?.city || "";
  const state = course.state || course.location?.state || course.region || "";
  const address = course.address || course.location?.address || "";
  const courseType = course.course_type || course.type || "";
  const teeSets = teePayload?.tees || course.tees || course.tee_sets || course.teeBoxes || course.tee_boxes || [];
  const holesByTee = course.holes || course.scorecard || [];

  const tees = teeSets.map((tee, index) => {
    const teeHoles = tee.holes || tee.scorecard || holesByTee || [];
    return {
      id: String(tee.id || tee.tee_id || tee.name || index),
      name: tee.name || tee.tee_name || tee.tee_color || tee.color || `Tee ${index + 1}`,
      gender: tee.gender || tee.gender_code || "",
      rating: Number(tee.rating ?? tee.course_rating ?? tee.cr ?? 0),
      slope: Number(tee.slope ?? tee.slope_rating ?? 0),
      yardage: Number(tee.yardage ?? tee.total_yardage ?? 0),
      holes: normalizeHoles(teeHoles)
    };
  }).filter(tee => tee.rating && tee.slope && tee.holes.length === 18);

  return {
    id,
    name,
    city,
    state,
    address,
    courseType,
    holesCount: Number(course.holes_count || course.holesCount || tees[0]?.holes.length || 0),
    parTotal: Number(course.par_total || course.parTotal || 0),
    source: id.startsWith("sample-") ? "sample" : "live",
    tees
  };
}

function normalizeHoles(holes) {
  if (!Array.isArray(holes)) return [];
  return holes.map((hole, index) => ({
    number: Number(hole.number || hole.hole || hole.hole_number || index + 1),
    par: Number(hole.par || 4),
    handicap: Number(hole.handicap || hole.handicap_index || hole.stroke_index || hole.allocation || hole.hcp || index + 1)
  })).filter(hole => hole.number && hole.par && hole.handicap);
}

function normalizeCourseSummary(raw) {
  const course = raw.course || raw;
  const id = String(course.id || course.course_id || course.slug || course.name || crypto.randomUUID());
  return {
    id,
    name: course.name || course.course_name || course.club_name || "Unnamed Course",
    city: course.city || course.location?.city || "",
    state: course.state || course.location?.state || course.region || "",
    address: course.address || course.location?.address || "",
    courseType: course.course_type || course.type || "",
    holesCount: Number(course.holes_count || course.holesCount || 0),
    parTotal: Number(course.par_total || course.parTotal || 0),
    source: id.startsWith("sample-") ? "sample" : "live",
    tees: []
  };
}

async function fetchOpenGolf(pathname, timeoutMs = 8000, retries = 1) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${OPEN_GOLF_BASE_URL}${pathname}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`OpenGolfAPI returned ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function sampleCourseMatches(query, stateFilter = "") {
  const normalized = query.toLowerCase();
  return sampleCourses.filter(course => {
    const matchesState = !stateFilter || course.state === stateFilter;
    const matchesText = [course.name, course.city, course.state].some(value => String(value || "").toLowerCase().includes(normalized));
    return matchesState && matchesText;
  });
}

function sortCoursesByName(courses) {
  return [...courses].sort((a, b) => {
    const nameCompare = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (nameCompare) return nameCompare;
    return `${a.city || ""} ${a.state || ""}`.localeCompare(`${b.city || ""} ${b.state || ""}`, undefined, { sensitivity: "base" });
  });
}

function snapshotPath(state) {
  return path.join(DATA_DIR, `course-snapshot-${state}.json`);
}

function isFreshSnapshot(snapshot) {
  if (!snapshot?.refreshedAt) return false;
  return Date.now() - new Date(snapshot.refreshedAt).getTime() < SNAPSHOT_TTL_MS;
}

async function readCourseSnapshot(state) {
  try {
    const raw = await fs.readFile(snapshotPath(state), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCourseSnapshot(snapshot) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(snapshotPath(snapshot.state), JSON.stringify(snapshot, null, 2));
}

async function hydrateCourseSummaries(candidates, batchSize = 10) {
  const courses = [];
  for (let index = 0; index < candidates.length; index += batchSize) {
    const batch = candidates.slice(index, index + batchSize);
    const hydrated = await Promise.all(batch.map(hydrateOpenGolfCourse));
    courses.push(...hydrated.filter(Boolean));
  }
  return sortCoursesByName(courses);
}

async function refreshCourseSnapshot(state) {
  if (snapshotRefreshes.has(state)) return snapshotRefreshes.get(state);

  const refresh = (async () => {
    const previousSnapshot = await readCourseSnapshot(state);
    const data = await fetchOpenGolf(`/courses/state/${encodeURIComponent(state)}`);
    const list = Array.isArray(data) ? data : data.courses || data.results || [];
    const candidates = list.map(normalizeCourseSummary);
    const courses = await hydrateCourseSummaries(candidates);
    if (previousSnapshot?.courses?.length && courses.length < previousSnapshot.courses.length) {
      return previousSnapshot;
    }
    const snapshot = {
      state,
      refreshedAt: new Date().toISOString(),
      searchedCount: data.count || list.length,
      courses
    };
    await writeCourseSnapshot(snapshot);
    return snapshot;
  })().finally(() => snapshotRefreshes.delete(state));

  snapshotRefreshes.set(state, refresh);
  return refresh;
}

function refreshCourseSnapshotInBackground(state) {
  refreshCourseSnapshot(state).catch(error => {
    console.warn(`Course snapshot refresh failed for ${state}: ${error.message}`);
  });
}

async function getBrowseSnapshot(state) {
  const snapshot = await readCourseSnapshot(state);
  if (isFreshSnapshot(snapshot)) return { snapshot, status: "fresh" };
  if (snapshot?.courses?.length) {
    refreshCourseSnapshotInBackground(state);
    return { snapshot, status: "stale" };
  }
  return { snapshot: await refreshCourseSnapshot(state), status: "refreshed" };
}

async function hydrateOpenGolfCourse(summary) {
  if (courseCache.has(summary.id)) return courseCache.get(summary.id);
  try {
    const id = encodeURIComponent(summary.id);
    const [detail, tees] = await Promise.all([
      fetchOpenGolf(`/courses/${id}`, 12000),
      fetchOpenGolf(`/courses/${id}/tees`, 12000)
    ]);
    const course = normalizeCourse({ ...summary, ...detail }, tees);
    const playableCourse = course.tees.length ? course : null;
    courseCache.set(summary.id, playableCourse);
    return playableCourse;
  } catch {
    return null;
  }
}

async function searchCourses(query, stateFilter = "") {
  const browseState = stateFilter || DEFAULT_BROWSE_STATE;
  const cacheKey = `${query.toLowerCase()}|${browseState}`;
  const cachedSearch = searchCache.get(cacheKey);
  if (cachedSearch && Date.now() - cachedSearch.cachedAt < SEARCH_CACHE_TTL_MS) {
    return cachedSearch.payload;
  }

  let payload;
  if (!query || query.length < 2) {
    try {
      const { snapshot, status } = await getBrowseSnapshot(browseState);
      const courses = sortCoursesByName(snapshot.courses || []);
      payload = {
        courses,
        meta: {
          source: "browse",
          snapshotStatus: status,
          refreshedAt: snapshot.refreshedAt,
          searchedCount: snapshot.searchedCount || courses.length,
          message: courses.length
            ? `Browsing ${courses.length} course${courses.length === 1 ? "" : "s"} with tee and scorecard data in ${browseState}.`
            : `No courses with tee and scorecard data were found in ${browseState}.`
        }
      };
    } catch (error) {
      payload = {
        courses: [],
        meta: {
          source: "error",
          message: `Course snapshot is unavailable and OpenGolfAPI could not refresh ${browseState} course data right now.`,
          error: error.message
        }
      };
      return payload;
    }
    searchCache.set(cacheKey, { cachedAt: Date.now(), payload });
    return payload;
  }

  const normalizedQuery = query.toLowerCase();
  const browseSnapshot = await readCourseSnapshot(browseState);
  const snapshotMatches = browseSnapshot?.courses?.filter(course => {
    return [course.name, course.city, course.state].some(value => String(value || "").toLowerCase().includes(normalizedQuery));
  }) || [];
  if (snapshotMatches.length) {
    payload = {
      courses: sortCoursesByName(snapshotMatches),
      meta: {
        source: "browse",
        snapshotStatus: isFreshSnapshot(browseSnapshot) ? "fresh" : "stale",
        refreshedAt: browseSnapshot.refreshedAt,
        searchedCount: browseSnapshot.searchedCount || browseSnapshot.courses.length,
        message: `Showing ${snapshotMatches.length} saved course${snapshotMatches.length === 1 ? "" : "s"} with tee and scorecard data in ${browseState}.`
      }
    };
    if (!isFreshSnapshot(browseSnapshot)) refreshCourseSnapshotInBackground(browseState);
    searchCache.set(cacheKey, { cachedAt: Date.now(), payload });
    return payload;
  }

  const samples = sampleCourseMatches(query, stateFilter);
  try {
    const data = await fetchOpenGolf(`/courses/search?q=${encodeURIComponent(query)}`);
    const list = Array.isArray(data) ? data : data.courses || data.results || [];
    const filteredList = stateFilter ? list.filter(course => course.state === stateFilter) : list;
    const candidates = filteredList.slice(0, OPEN_GOLF_SEARCH_LIMIT);
    const hydrated = await hydrateCourseSummaries(candidates);

    if (hydrated.length) {
      payload = {
        courses: hydrated,
        meta: {
          source: "live",
          liveCount: hydrated.length,
          searchedCount: filteredList.length,
          skippedCount: Math.max(filteredList.length - hydrated.length, 0),
          message: `Showing ${hydrated.length} course${hydrated.length === 1 ? "" : "s"} with tee and scorecard data${stateFilter ? ` in ${stateFilter}` : ""}.`
        }
      };
      searchCache.set(cacheKey, { cachedAt: Date.now(), payload });
      return payload;
    }

    payload = {
      courses: [],
      meta: {
        source: "empty",
        searchedCount: filteredList.length,
        skippedCount: filteredList.length,
        message: filteredList.length
          ? "Matches were found, but none had both tee ratings and an 18-hole scorecard yet."
          : `No U.S. course matches were found${stateFilter ? ` in ${stateFilter}` : ""}.`
      }
    };
  } catch (error) {
    payload = {
      courses: sortCoursesByName(samples),
      meta: {
        source: samples.length ? "sample" : "error",
        message: samples.length
          ? "OpenGolfAPI is unavailable right now, so matching sample data is shown."
          : "OpenGolfAPI is unavailable right now and no matching sample data exists.",
        error: error.message
      }
    };
    return payload;
  }
  searchCache.set(cacheKey, { cachedAt: Date.now(), payload });
  return payload;
}

async function getCourse(id) {
  const sample = sampleCourses.find(course => course.id === id);
  if (sample) return sample;
  if (courseCache.has(id)) return courseCache.get(id);
  const snapshot = await readCourseSnapshot(DEFAULT_BROWSE_STATE);
  const snapshottedCourse = snapshot?.courses?.find(course => course.id === id);
  if (snapshottedCourse) {
    courseCache.set(id, snapshottedCourse);
    return snapshottedCourse;
  }
  try {
    const encodedId = encodeURIComponent(id);
    const [detail, tees] = await Promise.all([
      fetchOpenGolf(`/courses/${encodedId}`),
      fetchOpenGolf(`/courses/${encodedId}/tees`)
    ]);
    const course = normalizeCourse(detail, tees);
    courseCache.set(id, course.tees.length ? course : null);
    return course.tees.length ? course : null;
  } catch {
    return null;
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/courses" && req.method === "GET") {
    const query = url.searchParams.get("q") || "";
    const stateFilter = (url.searchParams.get("state") || "").trim().toUpperCase();
    json(res, 200, await searchCourses(query, stateFilter));
    return;
  }

  if (url.pathname.startsWith("/api/courses/") && req.method === "GET") {
    const id = decodeURIComponent(url.pathname.replace("/api/courses/", ""));
    const course = await getCourse(id);
    if (!course) {
      json(res, 404, { error: "Course not found." });
      return;
    }
    json(res, 200, { course });
    return;
  }

  if (url.pathname === "/api/ghin/status" && req.method === "GET") {
    json(res, 200, {
      available: false,
      message: "GHIN does not publish a broadly available public developer API. Approved partner access is required before official Handicap Index sync can be enabled."
    });
    return;
  }

  json(res, 404, { error: "Not found" });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const contentTypes = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0"
    });
    res.end(file);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    json(res, 500, { error: error.message || "Server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Golf Handicap App running at http://${HOST}:${PORT}`);
});
