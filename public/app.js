const state = {
  token: localStorage.getItem("golfToken") || "",
  user: null,
  pendingPreferredCourseId: "",
  pendingPreferredTeeId: "",
  courses: [],
  selectedCourse: null,
  selectedTee: null,
  courseBrowseMode: false
};

const els = {
  signedOut: document.querySelector("#signedOut"),
  signedIn: document.querySelector("#signedIn"),
  profileName: document.querySelector("#profileName"),
  authMessage: document.querySelector("#authMessage"),
  nameInput: document.querySelector("#nameInput"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  registerBtn: document.querySelector("#registerBtn"),
  loginBtn: document.querySelector("#loginBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  handicapInput: document.querySelector("#handicapInput"),
  courseSearch: document.querySelector("#courseSearch"),
  stateSelect: document.querySelector("#stateSelect"),
  searchBtn: document.querySelector("#searchBtn"),
  courseSelect: document.querySelector("#courseSelect"),
  courseDataMessage: document.querySelector("#courseDataMessage"),
  teeSelect: document.querySelector("#teeSelect"),
  courseDetails: document.querySelector("#courseDetails"),
  saveProfileBtn: document.querySelector("#saveProfileBtn"),
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

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function setMessage(message) {
  els.authMessage.textContent = message || "";
}

function renderAuth() {
  if (state.user) {
    els.signedOut.classList.add("hidden");
    els.signedIn.classList.remove("hidden");
    els.profileName.textContent = `${state.user.name} • HI ${state.user.handicapIndex || "not set"}`;
    if (state.user.handicapIndex !== "" && state.user.handicapIndex !== null) {
      els.handicapInput.value = state.user.handicapIndex;
    }
  } else {
    els.signedOut.classList.remove("hidden");
    els.signedIn.classList.add("hidden");
  }
}

async function register() {
  try {
    const payload = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        name: els.nameInput.value,
        email: els.emailInput.value,
        password: els.passwordInput.value,
        handicapIndex: els.handicapInput.value
      })
    });
    state.token = payload.token;
    state.user = payload.user;
    localStorage.setItem("golfToken", state.token);
    primePreferredSetup();
    setMessage("Account created.");
    renderAuth();
    calculate();
  } catch (error) {
    setMessage(error.message);
  }
}

async function login() {
  try {
    const payload = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: els.emailInput.value,
        password: els.passwordInput.value
      })
    });
    state.token = payload.token;
    state.user = payload.user;
    localStorage.setItem("golfToken", state.token);
    primePreferredSetup();
    setMessage("Signed in.");
    renderAuth();
    await searchCourses();
  } catch (error) {
    setMessage(error.message);
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    // Local logout still clears the browser session if the server token has expired.
  }
  state.token = "";
  state.user = null;
  localStorage.removeItem("golfToken");
  setMessage("Signed out.");
  renderAuth();
}

async function loadMe() {
  if (!state.token) return;
  try {
    const payload = await api("/api/me");
    state.user = payload.user;
    primePreferredSetup();
    renderAuth();
  } catch {
    state.token = "";
    localStorage.removeItem("golfToken");
  }
}

async function saveProfile() {
  if (!state.user) {
    setMessage("Create an account or log in to save your setup.");
    return;
  }
  try {
    const course = state.selectedCourse;
    const tee = state.selectedTee;
    const payload = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({
        handicapIndex: els.handicapInput.value,
        preferredCourseId: course?.id || "",
        preferredCourseName: course?.name || "",
        preferredCourseState: course?.state || "",
        preferredTeeId: tee?.id || "",
        preferredTeeName: tee?.name || ""
      })
    });
    state.user = payload.user;
    setMessage("Setup saved.");
    renderAuth();
  } catch (error) {
    setMessage(error.message);
  }
}

function primePreferredSetup() {
  if (!state.user) return;
  state.pendingPreferredCourseId = state.user.preferredCourseId || "";
  state.pendingPreferredTeeId = state.user.preferredTeeId || "";
  if (state.user.preferredCourseName) {
    els.courseSearch.value = state.user.preferredCourseName;
  }
  if (state.user.preferredCourseState) {
    els.stateSelect.value = state.user.preferredCourseState;
  }
}

function applyPreferredSetup() {
  if (state.pendingPreferredCourseId) {
    const course = state.courses.find(item => item.id === state.pendingPreferredCourseId);
    if (course) {
      els.courseSelect.value = course.id;
      state.pendingPreferredCourseId = "";
      return true;
    }
  }
  return false;
}

async function searchCourses() {
  els.courseSelect.innerHTML = "<option>Searching...</option>";
  els.courseSelect.disabled = true;
  els.teeSelect.disabled = true;
  els.courseDataMessage.textContent = "Searching live U.S. course data...";
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
  els.courseSelect.classList.toggle("course-browser", state.courseBrowseMode && state.courses.length > 1);
  if (state.courseBrowseMode && state.courses.length > 1) {
    els.courseSelect.size = Math.min(8, state.courses.length);
  } else {
    els.courseSelect.removeAttribute("size");
  }
  if (!state.courses.length) {
    const option = document.createElement("option");
    option.textContent = "No playable courses found";
    els.courseSelect.append(option);
    clearScorecard();
    return;
  }
  for (const course of state.courses) {
    const option = document.createElement("option");
    option.value = course.id;
    const source = course.source === "live" ? "Live" : "Sample";
    option.textContent = `${[course.name, course.city, course.state].filter(Boolean).join(" • ")} (${source})`;
    els.courseSelect.append(option);
  }
  const appliedPreference = applyPreferredSetup();
  if (state.courseBrowseMode && !appliedPreference) {
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
      els.courseDataMessage.textContent = `Course selected, but tee data could not be loaded: ${error.message}`;
      renderCourseDetails();
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
  if (state.pendingPreferredTeeId) {
    const tee = state.selectedCourse.tees.find(item => item.id === state.pendingPreferredTeeId);
    if (tee) {
      els.teeSelect.value = tee.id;
      state.pendingPreferredTeeId = "";
    }
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
    [course.holesCount ? `${course.holesCount} holes` : "", "Holes"]
  ].filter(([value]) => value);

  els.courseDetails.innerHTML = details.map(([value, label]) => `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
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
  els.courseSelect.removeAttribute("size");
  els.courseSelect.classList.remove("course-browser");
  clearPlayableDataOnly();
  els.scorecardBody.innerHTML = `
    <tr>
      <td colspan="5">Search for a course with complete tee ratings and an 18-hole scorecard.</td>
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
      <td colspan="5">Select a course with tee ratings to load the scorecard.</td>
    </tr>
  `;
}

async function loadGhinStatus() {
  const payload = await api("/api/ghin/status");
  els.ghinStatus.textContent = payload.message;
}

els.registerBtn.addEventListener("click", register);
els.loginBtn.addEventListener("click", login);
els.logoutBtn.addEventListener("click", logout);
els.saveProfileBtn.addEventListener("click", saveProfile);
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

Promise.all([loadMe(), loadGhinStatus()])
  .then(() => searchCourses())
  .then(() => renderAuth());
