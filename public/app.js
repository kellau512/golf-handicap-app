const state = {
  allCourses: [],
  courses: [],
  selectedCourse: null,
  selectedTee: null,
  courseBrowseMode: false,
  selectedCourseDetailSource: "",
  courseIndexMeta: null,
  liveSearchTimer: null,
  liveSearchRequestId: 0,
  lastLiveSearchKey: ""
};

const RECENT_SETUP_KEY = "golfRecentSetup";

const els = {
  handicapInput: document.querySelector("#handicapInput"),
  courseSearch: document.querySelector("#courseSearch"),
  stateSelect: document.querySelector("#stateSelect"),
  searchBtn: document.querySelector("#searchBtn"),
  courseSelect: document.querySelector("#courseSelect"),
  courseDataMessage: document.querySelector("#courseDataMessage"),
  courseIndexStatus: document.querySelector("#courseIndexStatus"),
  teeSelect: document.querySelector("#teeSelect"),
  courseDetails: document.querySelector("#courseDetails"),
  ghinStatus: document.querySelector("#ghinStatus"),
  courseHandicap: document.querySelector("#courseHandicap"),
  targetScore: document.querySelector("#targetScore"),
  ratingSlope: document.querySelector("#ratingSlope"),
  totalPar: document.querySelector("#totalPar"),
  teeComparison: document.querySelector("#teeComparison"),
  courseFormula: document.querySelector("#courseFormula"),
  targetFormula: document.querySelector("#targetFormula"),
  strokeSummary: document.querySelector("#strokeSummary"),
  scorecardBody: document.querySelector("#scorecardBody")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function getRecentSetup() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_SETUP_KEY)) || {};
  } catch {
    return {};
  }
}

function saveRecentSetup() {
  if (!state.selectedCourse || !state.selectedTee) return;
  try {
    localStorage.setItem(RECENT_SETUP_KEY, JSON.stringify({
      state: els.stateSelect.value,
      courseId: state.selectedCourse.id,
      teeId: state.selectedTee.id,
      handicapIndex: els.handicapInput.value
    }));
  } catch {
    // Local storage is a convenience only; the calculator should still work without it.
  }
}

function matchesCourseQuery(course, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [course.name, course.city, course.state].some(value => String(value || "").toLowerCase().includes(normalized));
}

async function loadStateCourses({ applyRecent = false } = {}) {
  clearTimeout(state.liveSearchTimer);
  state.lastLiveSearchKey = "";
  els.courseSelect.innerHTML = "<option>Searching...</option>";
  els.courseSelect.disabled = true;
  els.teeSelect.disabled = true;
  els.courseDataMessage.textContent = "Searching available U.S. course data...";
  try {
    const params = new URLSearchParams({
      q: "",
      state: els.stateSelect.value
    });
    const payload = await api(`/api/courses?${params.toString()}`);
    state.allCourses = payload.courses || [];
    state.courseBrowseMode = payload.meta?.source === "browse";
    state.courseIndexMeta = payload.meta || null;
    els.courseDataMessage.textContent = payload.meta?.message || "";
    filterCourses({ applyRecent });
  } catch (error) {
    state.allCourses = [];
    state.courses = [];
    state.courseBrowseMode = false;
    state.courseIndexMeta = null;
    els.courseDataMessage.textContent = error.message;
    renderCourses();
  }
}

function filterCourses({ applyRecent = false } = {}) {
  clearTimeout(state.liveSearchTimer);
  state.courses = state.allCourses.filter(course => matchesCourseQuery(course, els.courseSearch.value));
  updateCourseFilterMessage();
  renderCourses({ applyRecent });
  scheduleLiveSearchFallback();
}

function updateCourseFilterMessage() {
  const query = els.courseSearch.value.trim();
  if (!query) {
    els.courseDataMessage.textContent = state.courseIndexMeta?.message || "";
    return;
  }
  const count = state.courses.length;
  els.courseDataMessage.textContent = count
    ? `Showing ${count} course${count === 1 ? "" : "s"} matching "${query}" from the daily index.`
    : `No indexed courses match "${query}" in ${els.stateSelect.value}. Checking live course data...`;
}

function mergeCourses(courses) {
  const byId = new Map(state.allCourses.map(course => [course.id, course]));
  for (const course of courses) {
    byId.set(course.id, {
      ...byId.get(course.id),
      ...course
    });
  }
  state.allCourses = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

function scheduleLiveSearchFallback() {
  const query = els.courseSearch.value.trim();
  if (state.courses.length || query.length < 3) return;
  const searchKey = `${els.stateSelect.value}|${query.toLowerCase()}`;
  if (searchKey === state.lastLiveSearchKey) return;
  state.liveSearchTimer = setTimeout(() => {
    liveSearchCourses({ preserveOnEmpty: true });
  }, 650);
}

async function liveSearchCourses({ preserveOnEmpty = false } = {}) {
  const query = els.courseSearch.value.trim();
  clearTimeout(state.liveSearchTimer);
  if (!query) {
    filterCourses();
    return;
  }
  const searchKey = `${els.stateSelect.value}|${query.toLowerCase()}`;
  state.lastLiveSearchKey = searchKey;
  const requestId = state.liveSearchRequestId + 1;
  state.liveSearchRequestId = requestId;
  els.courseSelect.innerHTML = "<option>Searching...</option>";
  els.courseSelect.disabled = true;
  els.teeSelect.disabled = true;
  els.courseDataMessage.textContent = `Checking live course data for "${query}"...`;
  try {
    const params = new URLSearchParams({
      q: query,
      state: els.stateSelect.value
    });
    const payload = await api(`/api/courses?${params.toString()}`);
    if (requestId !== state.liveSearchRequestId) return;
    const liveCourses = payload.courses || [];
    if (liveCourses.length) {
      mergeCourses(liveCourses);
      state.courses = liveCourses;
      state.courseBrowseMode = payload.meta?.source === "browse";
      els.courseDataMessage.textContent = payload.meta?.message || `Showing ${liveCourses.length} live result${liveCourses.length === 1 ? "" : "s"}.`;
      renderCourses();
      return;
    }
    if (preserveOnEmpty) {
      state.courses = state.allCourses.filter(course => matchesCourseQuery(course, els.courseSearch.value));
      updateCourseFilterMessage();
      renderCourses();
      return;
    }
    state.courses = [];
    els.courseDataMessage.textContent = payload.meta?.message || `No live matches found for "${query}".`;
    renderCourses();
  } catch (error) {
    if (requestId !== state.liveSearchRequestId) return;
    els.courseDataMessage.textContent = `Live search unavailable: ${error.message}`;
    filterCourses();
  }
}

function renderCourses({ applyRecent = false } = {}) {
  els.courseSelect.innerHTML = "";
  els.courseSelect.disabled = state.courses.length === 0;
  els.teeSelect.disabled = state.courses.length === 0;
  if (!state.courses.length) {
    const option = document.createElement("option");
    option.textContent = "No courses found";
    els.courseSelect.append(option);
    clearScorecard();
    return;
  }
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a course";
  els.courseSelect.append(placeholder);
  for (const course of state.courses) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = [course.name, course.city, course.state].filter(Boolean).join(" • ");
    els.courseSelect.append(option);
  }
  const recent = getRecentSetup();
  if (applyRecent && recent.state === els.stateSelect.value && state.courses.some(course => course.id === recent.courseId)) {
    if (recent.handicapIndex !== undefined) els.handicapInput.value = recent.handicapIndex;
    els.courseSelect.value = recent.courseId;
    selectCourse({ preferredTeeId: recent.teeId });
    return;
  }
  els.courseSelect.value = "";
  state.selectedCourse = null;
  state.selectedCourseDetailSource = "";
  clearPlayableDataOnly();
}

async function selectCourse({ preferredTeeId = "" } = {}) {
  state.selectedCourse = state.courses.find(course => course.id === els.courseSelect.value) || null;
  state.selectedCourseDetailSource = "";
  if (!state.selectedCourse) {
    clearPlayableDataOnly();
    return;
  }
  if (state.selectedCourse && !state.selectedCourse.tees.length) {
    els.teeSelect.innerHTML = "<option>Loading tees...</option>";
    els.teeSelect.disabled = true;
    renderTeeLoading();
    try {
      const payload = await api(`/api/courses/${encodeURIComponent(state.selectedCourse.id)}`);
      const hydratedCourse = payload.course;
      state.selectedCourseDetailSource = payload.meta?.source || "";
      state.courses = state.courses.map(course => course.id === hydratedCourse.id ? hydratedCourse : course);
      state.allCourses = state.allCourses.map(course => course.id === hydratedCourse.id ? hydratedCourse : course);
      state.selectedCourse = hydratedCourse;
      els.teeSelect.disabled = false;
    } catch (error) {
      renderCourseUnavailable(error.message);
      return;
    }
  }
  renderTees(preferredTeeId);
  renderCourseDetails();
}

function renderTees(preferredTeeId = "") {
  els.teeSelect.innerHTML = "";
  if (!state.selectedCourse || !state.selectedCourse.tees.length) {
    clearScorecard();
    return;
  }
  for (const tee of state.selectedCourse.tees) {
    const option = document.createElement("option");
    option.value = tee.id;
    const yardage = tee.yardage ? ` • ${tee.yardage} yds` : "";
    option.textContent = `${tee.name} ${tee.gender ? `(${tee.gender})` : ""} • ${tee.rating}/${tee.slope}${yardage}`;
    els.teeSelect.append(option);
  }
  if (preferredTeeId && state.selectedCourse.tees.some(tee => tee.id === preferredTeeId)) {
    els.teeSelect.value = preferredTeeId;
  }
  selectTee();
  renderTeeComparison();
}

function renderCourseDetails() {
  const course = state.selectedCourse;
  if (!course) {
    els.courseDetails.innerHTML = "";
    return;
  }
  const details = [
    [course.courseType, "Type"],
    [course.address, "Address"],
    [course.holesCount ? `${course.holesCount} holes` : "", "Holes"],
    [formatDetailSource(state.selectedCourseDetailSource), "Tee Data"],
    [course.availabilityMessage, "Availability"]
  ].filter(([value]) => value);

  els.courseDetails.innerHTML = details.map(([value, label]) => `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderCourseUnavailable(message) {
  if (state.selectedCourse) {
    state.selectedCourse = {
      ...state.selectedCourse,
      availabilityMessage: message
    };
  }
  state.selectedTee = null;
  els.courseDataMessage.textContent = message;
  els.teeSelect.innerHTML = "<option>Tee data unavailable</option>";
  els.teeSelect.disabled = true;
  els.courseHandicap.textContent = "--";
  els.targetScore.textContent = "--";
  els.ratingSlope.textContent = "--";
  els.totalPar.textContent = "--";
  els.courseFormula.textContent = "--";
  els.targetFormula.textContent = "--";
  els.strokeSummary.textContent = "--";
  els.teeComparison.innerHTML = "";
  renderCourseDetails();
  els.scorecardBody.innerHTML = `
    <tr>
      <td colspan="5">This course is in the daily index, but tee ratings and scorecard data are not available yet.</td>
    </tr>
  `;
}

function formatDetailSource(source) {
  if (source === "cache") return "Loaded from local cache";
  if (source === "memory") return "Loaded from this session";
  if (source === "live") return "Loaded live and cached";
  if (source === "sample") return "Sample course data";
  return "";
}

function renderTeeLoading() {
  state.selectedTee = null;
  els.courseHandicap.textContent = "--";
  els.targetScore.textContent = "--";
  els.ratingSlope.textContent = "--";
  els.totalPar.textContent = "--";
  els.courseFormula.textContent = "--";
  els.targetFormula.textContent = "--";
  els.strokeSummary.textContent = "--";
  els.teeComparison.innerHTML = "";
  renderCourseDetails();
  els.scorecardBody.innerHTML = `
    <tr>
      <td colspan="5">Loading tee ratings and scorecard data for this course...</td>
    </tr>
  `;
}

function selectTee() {
  if (!state.selectedCourse) return;
  state.selectedTee = state.selectedCourse.tees.find(tee => tee.id === els.teeSelect.value) || state.selectedCourse.tees[0] || null;
  calculate();
  renderTeeComparison();
  saveRecentSetup();
}

function strokesForHole(courseHandicap, allocation) {
  const sign = courseHandicap < 0 ? -1 : 1;
  const abs = Math.abs(courseHandicap);
  const base = Math.floor(abs / 18);
  const extra = abs % 18 >= allocation ? 1 : 0;
  return sign * (base + extra);
}

function formatNumber(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.0$/, "");
}

function formatSigned(value) {
  return value >= 0 ? `+ ${formatNumber(value)}` : `- ${formatNumber(Math.abs(value))}`;
}

function summarizeStrokes(courseHandicap) {
  if (courseHandicap === 0) return "No extra strokes allocated.";
  const abs = Math.abs(courseHandicap);
  const base = Math.floor(abs / 18);
  const extra = abs % 18;
  const direction = courseHandicap > 0 ? "Receive" : "Give back";
  if (!base) return `${direction} 1 stroke on holes ranked 1-${extra}.`;
  const baseText = `${direction} ${base} stroke${base === 1 ? "" : "s"} on every hole`;
  const extraText = extra ? `, plus 1 more on holes ranked 1-${extra}` : "";
  return `${baseText}${extraText}.`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function calculateTeeResult(tee, handicapIndex) {
  const totalPar = tee.holes.reduce((sum, hole) => sum + hole.par, 0);
  const slopeAdjustment = handicapIndex * (tee.slope / 113);
  const ratingAdjustment = tee.rating - totalPar;
  const rawCourseHandicap = slopeAdjustment + ratingAdjustment;
  const courseHandicap = Math.round(rawCourseHandicap);
  const rawTargetScore = tee.rating + courseHandicap;
  const targetScore = Math.round(rawTargetScore);

  return {
    totalPar,
    slopeAdjustment,
    ratingAdjustment,
    rawCourseHandicap,
    courseHandicap,
    rawTargetScore,
    targetScore
  };
}

function renderTeeComparison() {
  const course = state.selectedCourse;
  const handicapIndex = Number(els.handicapInput.value);
  if (!course || Number.isNaN(handicapIndex) || !course.tees.length) {
    els.teeComparison.innerHTML = "";
    return;
  }

  els.teeComparison.innerHTML = course.tees.map(tee => {
    const result = calculateTeeResult(tee, handicapIndex);
    const selectedClass = state.selectedTee?.id === tee.id ? " selected" : "";
    const yardage = tee.yardage ? `${tee.yardage} yds` : "Yardage n/a";
    return `
      <button class="tee-card${selectedClass}" type="button" data-tee-id="${escapeHtml(tee.id)}">
        <span>${escapeHtml(tee.name)}${tee.gender ? ` (${escapeHtml(tee.gender)})` : ""}</span>
        <strong>${result.courseHandicap} CH / ${result.targetScore} target</strong>
        <small>${formatNumber(tee.rating)} rating • ${tee.slope} slope • ${escapeHtml(yardage)}</small>
      </button>
    `;
  }).join("");
}

function appendScorecardSummary(label, holes, courseHandicap) {
  const parTotal = holes.reduce((sum, hole) => sum + hole.par, 0);
  const strokeTotal = holes.reduce((sum, hole) => sum + strokesForHole(courseHandicap, hole.handicap), 0);
  const targetTotal = parTotal + strokeTotal;
  const row = document.createElement("tr");
  row.className = "summary-row";
  row.innerHTML = `
    <td>${label}</td>
    <td>${parTotal}</td>
    <td>--</td>
    <td>${strokeTotal > 0 ? `+${strokeTotal}` : strokeTotal}</td>
    <td>${targetTotal}</td>
  `;
  els.scorecardBody.append(row);
}

function calculate() {
  const tee = state.selectedTee;
  const handicapIndex = Number(els.handicapInput.value);
  if (!tee || Number.isNaN(handicapIndex)) return;

  const result = calculateTeeResult(tee, handicapIndex);

  els.courseHandicap.textContent = String(result.courseHandicap);
  els.targetScore.textContent = String(result.targetScore);
  els.ratingSlope.textContent = `${tee.rating} / ${tee.slope}`;
  els.totalPar.textContent = String(result.totalPar);
  els.courseFormula.textContent = `${formatNumber(handicapIndex)} × ${tee.slope} / 113 ${formatSigned(result.ratingAdjustment)} = ${formatNumber(result.rawCourseHandicap)} → ${result.courseHandicap}`;
  els.targetFormula.textContent = `${formatNumber(tee.rating)} + ${result.courseHandicap} = ${formatNumber(result.rawTargetScore)} → ${result.targetScore}`;
  els.strokeSummary.textContent = summarizeStrokes(result.courseHandicap);
  renderTeeComparison();

  els.scorecardBody.innerHTML = "";
  for (const hole of tee.holes) {
    const strokes = strokesForHole(result.courseHandicap, hole.handicap);
    const target = hole.par + strokes;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${hole.number}</td>
      <td>${hole.par}</td>
      <td>${hole.handicap}</td>
      <td><span class="stroke-pill">${strokes > 0 ? `+${strokes}` : strokes}</span></td>
      <td>${target}</td>
    `;
    els.scorecardBody.append(row);
    if (hole.number === 9) {
      appendScorecardSummary("Out", tee.holes.slice(0, 9), result.courseHandicap);
    }
    if (hole.number === 18) {
      appendScorecardSummary("In", tee.holes.slice(9, 18), result.courseHandicap);
      appendScorecardSummary("Total", tee.holes, result.courseHandicap);
    }
  }
}

function clearScorecard() {
  state.selectedCourse = null;
  state.selectedTee = null;
  state.courseBrowseMode = false;
  clearPlayableDataOnly();
  els.scorecardBody.innerHTML = `
    <tr>
      <td colspan="5">Search for a course, then select it to load tee ratings and scorecard data.</td>
    </tr>
  `;
}

function clearPlayableDataOnly() {
  state.selectedTee = null;
  els.teeSelect.innerHTML = "<option>No tees available</option>";
  els.courseHandicap.textContent = "--";
  els.targetScore.textContent = "--";
  els.ratingSlope.textContent = "--";
  els.totalPar.textContent = "--";
  els.courseFormula.textContent = "--";
  els.targetFormula.textContent = "--";
  els.strokeSummary.textContent = "--";
  els.teeComparison.innerHTML = "";
  els.courseDetails.innerHTML = "";
  els.scorecardBody.innerHTML = `
    <tr>
      <td colspan="5">Select a course to load tee ratings and scorecard data.</td>
    </tr>
  `;
}

async function loadGhinStatus() {
  const payload = await api("/api/ghin/status");
  els.ghinStatus.textContent = payload.message;
}

function formatDateTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

async function loadCourseIndexStatus() {
  if (!els.courseIndexStatus) return;
  try {
    const payload = await api("/api/course-index/status");
    if (payload.available) {
      const freshness = payload.fresh ? "fresh" : "stale";
      els.courseIndexStatus.textContent = `Daily index ${freshness} • ${payload.totalCourses} courses • refreshed ${formatDateTime(payload.refreshedAt)}`;
    } else {
      els.courseIndexStatus.textContent = "Daily course index is not available yet.";
    }
  } catch (error) {
    els.courseIndexStatus.textContent = `Daily course index status unavailable: ${error.message}`;
  }
}

els.searchBtn.addEventListener("click", liveSearchCourses);
els.stateSelect.addEventListener("change", () => loadStateCourses());
els.courseSelect.addEventListener("change", selectCourse);
els.teeSelect.addEventListener("change", selectTee);
els.handicapInput.addEventListener("input", () => {
  calculate();
  renderTeeComparison();
  saveRecentSetup();
});
els.teeComparison.addEventListener("click", event => {
  const card = event.target.closest(".tee-card");
  if (!card) return;
  els.teeSelect.value = card.dataset.teeId;
  selectTee();
});
els.courseSearch.addEventListener("keydown", event => {
  if (event.key === "Enter") liveSearchCourses();
});
els.courseSearch.addEventListener("input", () => filterCourses());

Promise.all([loadGhinStatus(), loadCourseIndexStatus(), loadStateCourses({ applyRecent: true })]);
