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
const USER_FILE = path.join(DATA_DIR, "users.json");
const OPEN_GOLF_BASE_URL = "https://api.opengolfapi.org/v1";
const OPEN_GOLF_SEARCH_LIMIT = 10;

const sessions = new Map();

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

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(USER_FILE);
  } catch {
    await fs.writeFile(USER_FILE, JSON.stringify({ users: [] }, null, 2));
  }
}

async function readUsers() {
  await ensureDataFile();
  const raw = await fs.readFile(USER_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeUsers(data) {
  await fs.writeFile(USER_FILE, JSON.stringify(data, null, 2));
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  const next = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(next.hash, "hex"), Buffer.from(user.passwordHash, "hex"));
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    handicapIndex: user.handicapIndex ?? ""
  };
}

function getSessionUserId(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return sessions.get(token);
}

async function requireUser(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    json(res, 401, { error: "Not signed in" });
    return null;
  }
  const data = await readUsers();
  const user = data.users.find(item => item.id === userId);
  if (!user) {
    json(res, 401, { error: "Session user not found" });
    return null;
  }
  return { data, user };
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

async function fetchOpenGolf(pathname, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OPEN_GOLF_BASE_URL}${pathname}`, { signal: controller.signal });
    if (!response.ok) throw new Error(`OpenGolfAPI returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function sampleCourseMatches(query, stateFilter = "") {
  const normalized = query.toLowerCase();
  return sampleCourses.filter(course => {
    const matchesState = !stateFilter || course.state === stateFilter;
    const matchesText = [course.name, course.city, course.state].some(value => String(value || "").toLowerCase().includes(normalized));
    return matchesState && matchesText;
  });
}

async function hydrateOpenGolfCourse(summary) {
  try {
    const id = encodeURIComponent(summary.id);
    const [detail, tees] = await Promise.all([
      fetchOpenGolf(`/courses/${id}`),
      fetchOpenGolf(`/courses/${id}/tees`)
    ]);
    const course = normalizeCourse({ ...summary, ...detail }, tees);
    return course.tees.length ? course : null;
  } catch {
    return null;
  }
}

async function searchCourses(query, stateFilter = "") {
  if (!query || query.length < 2) {
    return {
      courses: stateFilter ? sampleCourses.filter(course => course.state === stateFilter) : sampleCourses,
      meta: {
        source: "sample",
        message: "Showing sample courses. Enter at least 2 characters to search live U.S. course data."
      }
    };
  }

  const samples = sampleCourseMatches(query, stateFilter);
  try {
    const data = await fetchOpenGolf(`/courses/search?q=${encodeURIComponent(query)}`);
    const list = Array.isArray(data) ? data : data.courses || data.results || [];
    const filteredList = stateFilter ? list.filter(course => course.state === stateFilter) : list;
    const candidates = filteredList.slice(0, OPEN_GOLF_SEARCH_LIMIT);
    const hydrated = (await Promise.all(candidates.map(hydrateOpenGolfCourse))).filter(Boolean);

    if (hydrated.length) {
      return {
        courses: hydrated,
        meta: {
          source: "live",
          liveCount: hydrated.length,
          searchedCount: filteredList.length,
          skippedCount: Math.max(filteredList.length - hydrated.length, 0),
          message: `Showing ${hydrated.length} live course${hydrated.length === 1 ? "" : "s"} with complete tee and scorecard data${stateFilter ? ` in ${stateFilter}` : ""}.`
        }
      };
    }

    return {
      courses: samples,
      meta: {
        source: samples.length ? "sample" : "empty",
        searchedCount: filteredList.length,
        skippedCount: filteredList.length,
        message: filteredList.length
          ? "Live matches were found, but none had both tee ratings and an 18-hole scorecard yet."
          : `No live U.S. course matches were found${stateFilter ? ` in ${stateFilter}` : ""}.`
      }
    };
  } catch (error) {
    return {
      courses: samples,
      meta: {
        source: samples.length ? "sample" : "error",
        message: samples.length
          ? "OpenGolfAPI is unavailable right now, so matching sample data is shown."
          : "OpenGolfAPI is unavailable right now and no matching sample data exists.",
        error: error.message
      }
    };
  }
}

async function getCourse(id) {
  const sample = sampleCourses.find(course => course.id === id);
  if (sample) return sample;
  try {
    const encodedId = encodeURIComponent(id);
    const [detail, tees] = await Promise.all([
      fetchOpenGolf(`/courses/${encodedId}`),
      fetchOpenGolf(`/courses/${encodedId}/tees`)
    ]);
    return normalizeCourse(detail, tees);
  } catch {
    return null;
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/register" && req.method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    const handicapIndex = body.handicapIndex === "" ? "" : Number(body.handicapIndex);

    if (!name || !email || password.length < 8) {
      json(res, 400, { error: "Name, email, and an 8+ character password are required." });
      return;
    }

    const data = await readUsers();
    if (data.users.some(user => user.email === email)) {
      json(res, 409, { error: "An account with that email already exists." });
      return;
    }

    const passwordParts = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      name,
      email,
      handicapIndex,
      salt: passwordParts.salt,
      passwordHash: passwordParts.hash,
      createdAt: new Date().toISOString()
    };
    data.users.push(user);
    await writeUsers(data);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    json(res, 201, { token, user: publicUser(user) });
    return;
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const data = await readUsers();
    const user = data.users.find(item => item.email === email);
    if (!user || !verifyPassword(password, user)) {
      json(res, 401, { error: "Invalid email or password." });
      return;
    }
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, user.id);
    json(res, 200, { token, user: publicUser(user) });
    return;
  }

  if (url.pathname === "/api/me" && req.method === "GET") {
    const session = await requireUser(req, res);
    if (!session) return;
    json(res, 200, { user: publicUser(session.user) });
    return;
  }

  if (url.pathname === "/api/me" && req.method === "PATCH") {
    const session = await requireUser(req, res);
    if (!session) return;
    const body = await readBody(req);
    if (body.name !== undefined) session.user.name = String(body.name).trim();
    if (body.handicapIndex !== undefined) session.user.handicapIndex = body.handicapIndex === "" ? "" : Number(body.handicapIndex);
    await writeUsers(session.data);
    json(res, 200, { user: publicUser(session.user) });
    return;
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    sessions.delete(token);
    json(res, 200, { ok: true });
    return;
  }

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
    res.writeHead(200, { "Content-Type": contentTypes[ext] || "application/octet-stream" });
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

ensureDataFile().then(() => {
  server.listen(PORT, HOST, () => {
    console.log(`Golf Handicap App running at http://${HOST}:${PORT}`);
  });
});
