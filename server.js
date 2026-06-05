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
const COURSE_INDEX_FILE = path.join(DATA_DIR, "course-index.json");
const COURSE_INDEX_REFRESH_MS = 24 * 60 * 60 * 1000;

const courseCache = new Map();
const searchCache = new Map();
let courseIndexRefresh = null;
let openGolfBackoffUntil = 0;

const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"
];

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
  if (Date.now() < openGolfBackoffUntil) {
    throw new Error(`OpenGolfAPI rate limit is active until ${new Date(openGolfBackoffUntil).toISOString()}`);
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${OPEN_GOLF_BASE_URL}${pathname}`, { signal: controller.signal });
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 429) {
          try {
            const payload = JSON.parse(body);
            if (payload.resetAt) openGolfBackoffUntil = new Date(payload.resetAt).getTime();
          } catch {
            openGolfBackoffUntil = Date.now() + 60 * 60 * 1000;
          }
          throw new Error(`OpenGolfAPI daily rate limit exceeded${openGolfBackoffUntil ? ` until ${new Date(openGolfBackoffUntil).toISOString()}` : ""}`);
        }
        throw new Error(`OpenGolfAPI returned ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (String(error.message || "").includes("rate limit")) break;
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

function courseDetailPath(id) {
  return path.join(DATA_DIR, `course-detail-${encodeURIComponent(id)}.json`);
}

function isFreshSnapshot(snapshot) {
  if (!snapshot?.refreshedAt) return false;
  return Date.now() - new Date(snapshot.refreshedAt).getTime() < SNAPSHOT_TTL_MS;
}

async function readCourseDetail(id) {
  try {
    const raw = await fs.readFile(courseDetailPath(id), "utf8");
    const snapshot = JSON.parse(raw);
    return isFreshSnapshot(snapshot) ? snapshot.course : null;
  } catch {
    return null;
  }
}

async function writeCourseDetail(course) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(courseDetailPath(course.id), JSON.stringify({
    refreshedAt: new Date().toISOString(),
    course
  }, null, 2));
}

function isFreshCourseIndex(index) {
  if (!index?.refreshedAt) return false;
  return Date.now() - new Date(index.refreshedAt).getTime() < COURSE_INDEX_REFRESH_MS;
}

async function readCourseIndex() {
  try {
    const raw = await fs.readFile(COURSE_INDEX_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCourseIndex(index) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(COURSE_INDEX_FILE, JSON.stringify(index, null, 2));
}

function coursesFromIndex(index, state) {
  return sortCoursesByName(index?.states?.[state]?.courses || []);
}

function courseIndexHasData(index) {
  return Boolean(index?.states && Object.values(index.states).some(entry => entry?.courses?.length));
}

async function refreshCourseIndex({ force = false } = {}) {
  if (courseIndexRefresh) return courseIndexRefresh;

  courseIndexRefresh = (async () => {
    const previousIndex = await readCourseIndex();
    if (!force && isFreshCourseIndex(previousIndex) && courseIndexHasData(previousIndex)) {
      return previousIndex;
    }

    const states = previousIndex?.states ? { ...previousIndex.states } : {};
    let refreshedStates = 0;

    for (const state of STATE_CODES) {
      try {
        const data = await fetchOpenGolf(`/courses/state/${encodeURIComponent(state)}`);
        const list = Array.isArray(data) ? data : data.courses || data.results || [];
        const courses = sortCoursesByName(list.map(normalizeCourseSummary));
        states[state] = {
          refreshedAt: new Date().toISOString(),
          searchedCount: data.count || list.length,
          courses
        };
        refreshedStates += 1;
      } catch (error) {
        if (String(error.message || "").includes("rate limit")) throw error;
        states[state] = states[state] || {
          refreshedAt: null,
          searchedCount: 0,
          courses: []
        };
      }
    }

    const totalCourses = Object.values(states).reduce((sum, entry) => sum + (entry?.courses?.length || 0), 0);
    const index = {
      refreshedAt: new Date().toISOString(),
      refreshedStates,
      totalCourses,
      states
    };
    if (courseIndexHasData(previousIndex) && totalCourses < previousIndex.totalCourses) {
      return previousIndex;
    }
    await writeCourseIndex(index);
    return index;
  })().finally(() => {
    courseIndexRefresh = null;
  });

  return courseIndexRefresh;
}

function refreshCourseIndexInBackground() {
  refreshCourseIndex().catch(error => {
    console.warn(`Course index refresh failed: ${error.message}`);
  });
}

async function getCourseIndex() {
  const index = await readCourseIndex();
  if (isFreshCourseIndex(index) && courseIndexHasData(index)) return { index, status: "fresh" };
  if (courseIndexHasData(index)) {
    refreshCourseIndexInBackground();
    return { index, status: "stale" };
  }
  return { index: await refreshCourseIndex(), status: "refreshed" };
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
    if (playableCourse) await writeCourseDetail(playableCourse);
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
      const { index, status } = await getCourseIndex();
      const courses = coursesFromIndex(index, browseState);
      const stateIndex = index.states?.[browseState] || {};
      payload = {
        courses,
        meta: {
          source: "browse",
          indexStatus: status,
          refreshedAt: stateIndex.refreshedAt || index.refreshedAt,
          searchedCount: stateIndex.searchedCount || courses.length,
          message: courses.length
            ? `Browsing ${courses.length} course${courses.length === 1 ? "" : "s"} in ${browseState} from the daily course index.`
            : `No courses were found in ${browseState}.`
        }
      };
    } catch (error) {
      payload = {
        courses: [],
        meta: {
          source: "error",
          message: `Course index is unavailable and OpenGolfAPI could not refresh course data right now.`,
          error: error.message
        }
      };
      return payload;
    }
    searchCache.set(cacheKey, { cachedAt: Date.now(), payload });
    return payload;
  }

  const normalizedQuery = query.toLowerCase();
  const browseIndex = await readCourseIndex();
  const indexCourses = browseState ? coursesFromIndex(browseIndex, browseState) : STATE_CODES.flatMap(state => coursesFromIndex(browseIndex, state));
  const indexMatches = indexCourses.filter(course => {
    return [course.name, course.city, course.state].some(value => String(value || "").toLowerCase().includes(normalizedQuery));
  });
  if (indexMatches.length) {
    payload = {
      courses: sortCoursesByName(indexMatches),
      meta: {
        source: "browse",
        indexStatus: isFreshCourseIndex(browseIndex) ? "fresh" : "stale",
        refreshedAt: browseIndex.refreshedAt,
        searchedCount: indexCourses.length,
        message: `Showing ${indexMatches.length} saved course${indexMatches.length === 1 ? "" : "s"} in ${browseState} from the daily course index.`
      }
    };
    if (!isFreshCourseIndex(browseIndex)) refreshCourseIndexInBackground();
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
  if (sample) return { course: sample, source: "sample" };
  if (courseCache.has(id)) return { course: courseCache.get(id), source: "memory" };
  const cachedDetail = await readCourseDetail(id);
  if (cachedDetail) return { course: cachedDetail, source: "cache" };
  try {
    const encodedId = encodeURIComponent(id);
    const [detail, tees] = await Promise.all([
      fetchOpenGolf(`/courses/${encodedId}`),
      fetchOpenGolf(`/courses/${encodedId}/tees`)
    ]);
    const course = normalizeCourse(detail, tees);
    courseCache.set(id, course.tees.length ? course : null);
    if (!course.tees.length) return null;
    await writeCourseDetail(course);
    return { course, source: "live" };
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
    const result = await getCourse(id);
    if (!result?.course) {
      json(res, 404, { error: "Tee ratings and scorecard data are not available for this course yet." });
      return;
    }
    json(res, 200, { course: result.course, meta: { source: result.source } });
    return;
  }

  if (url.pathname === "/api/ghin/status" && req.method === "GET") {
    json(res, 200, {
      available: false,
      message: "GHIN does not publish a broadly available public developer API. Approved partner access is required before official Handicap Index sync can be enabled."
    });
    return;
  }

  if (url.pathname === "/api/course-index/status" && req.method === "GET") {
    const index = await readCourseIndex();
    json(res, 200, {
      available: courseIndexHasData(index),
      fresh: isFreshCourseIndex(index),
      refreshedAt: index?.refreshedAt || null,
      refreshedStates: index?.refreshedStates || 0,
      totalCourses: index?.totalCourses || 0,
      openGolfBackoffUntil: openGolfBackoffUntil ? new Date(openGolfBackoffUntil).toISOString() : null
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

function scheduleCourseIndexRefresh() {
  refreshCourseIndexInBackground();
  setInterval(refreshCourseIndexInBackground, COURSE_INDEX_REFRESH_MS);
}

if (process.argv.includes("--refresh-course-index")) {
  refreshCourseIndex({ force: true })
    .then(index => {
      console.log(`Course index refreshed: ${index.totalCourses || 0} courses across ${index.refreshedStates || 0} states.`);
    })
    .catch(error => {
      console.error(`Course index refresh failed: ${error.message}`);
      process.exitCode = 1;
    });
} else {
  server.listen(PORT, HOST, () => {
    console.log(`Golf Handicap App running at http://${HOST}:${PORT}`);
    scheduleCourseIndexRefresh();
  });
}
