const state = {
  courses: [],
  selectedCourse: null,
  selectedTee: null,
  courseBrowseMode: false
};

const els = {
  handicapInput: document.querySelector("#handicapInput"),
  courseSearch: document.querySelector("#courseSearch"),
  stateSelect: document.querySelector("#stateSelect"),
  searchBtn: document.querySelector("#searchBtn"),
  courseSelect: document.querySelector("#courseSelect"),
  courseDataMessage: document.querySelector("#courseDataMessage"),
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

async function searchCourses() {
  els.courseSelect.innerHTML = "<option>Searching...</option>";
  els.courseSelect.disabled = true;
  els.teeSelect.disabled = true;
  els.courseDataMessage.textContent = "Searching available U.S. course data...";
  try {
    const params = new URLSearchParams({
      q: els.courseSearch.value.trim(),
      state: els.stateSelect.value
    });
    const payload = await api(`/api/courses?${params.toString()}`);
    state.courses = payload.courses || [];
    state.courseBrowseMode = payload.meta?.source === "browse";
    els.courseDataMessage.textContent = payload.meta?.message || "";
    renderCourses();
  } catch (error) {
    state.courses = [];
    state.courseBrowseMode = false;
    els.courseDataMessage.textContent = error.message;
    renderCourses();
  }
}

function renderCourses() {
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
  for (const course of state.courses) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = [course.name, course.city, course.state].filter(Boolean).join(" • ");
    els.courseSelect.append(option);
  }
  if (state.courseBrowseMode) {
    els.courseSelect.selectedIndex = -1;
    state.selectedCourse = null;
    clearPlayableDataOnly();
    return;
  }
  selectCourse();
}

async function selectCourse() {
  state.selectedCourse = state.courses.find(course => course.id === els.courseSelect.value) || state.courses[0] || null;
  if (state.selectedCourse && !state.selectedCourse.tees.length) {
    els.teeSelect.innerHTML = "<option>Loading tees...</option>";
    els.teeSelect.disabled = true;
    clearPlayableDataOnly();
    try {
      const payload = await api(`/api/courses/${encodeURIComponent(state.selectedCourse.id)}`);
      const hydratedCourse = payload.course;
      state.courses = state.courses.map(course => course.id === hydratedCourse.id ? hydratedCourse : course);
      state.selectedCourse = hydratedCourse;
      els.teeSelect.disabled = false;
    } catch (error) {
      renderCourseUnavailable(error.message);
      return;
    }
  }
  renderTees();
  renderCourseDetails();
}

function renderTees() {
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

function selectTee() {
  if (!state.selectedCourse) return;
  state.selectedTee = state.selectedCourse.tees.find(tee => tee.id === els.teeSelect.value) || state.selectedCourse.tees[0] || null;
  calculate();
  renderTeeComparison();
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

els.searchBtn.addEventListener("click", searchCourses);
els.stateSelect.addEventListener("change", searchCourses);
els.courseSelect.addEventListener("change", selectCourse);
els.teeSelect.addEventListener("change", selectTee);
els.handicapInput.addEventListener("input", () => {
  calculate();
  renderTeeComparison();
});
els.teeComparison.addEventListener("click", event => {
  const card = event.target.closest(".tee-card");
  if (!card) return;
  els.teeSelect.value = card.dataset.teeId;
  selectTee();
});
els.courseSearch.addEventListener("keydown", event => {
  if (event.key === "Enter") searchCourses();
});

Promise.all([loadGhinStatus(), searchCourses()]);
