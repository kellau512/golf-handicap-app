const state = {
  token: localStorage.getItem("golfToken") || "",
  user: null,
  courses: [],
  selectedCourse: null,
  selectedTee: null
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
  searchBtn: document.querySelector("#searchBtn"),
  courseSelect: document.querySelector("#courseSelect"),
  teeSelect: document.querySelector("#teeSelect"),
  saveProfileBtn: document.querySelector("#saveProfileBtn"),
  ghinStatus: document.querySelector("#ghinStatus"),
  courseHandicap: document.querySelector("#courseHandicap"),
  targetScore: document.querySelector("#targetScore"),
  ratingSlope: document.querySelector("#ratingSlope"),
  totalPar: document.querySelector("#totalPar"),
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
    setMessage("Signed in.");
    renderAuth();
    calculate();
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
    renderAuth();
  } catch {
    state.token = "";
    localStorage.removeItem("golfToken");
  }
}

async function saveProfile() {
  if (!state.user) {
    setMessage("Create an account or log in to save your handicap.");
    return;
  }
  try {
    const payload = await api("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ handicapIndex: els.handicapInput.value })
    });
    state.user = payload.user;
    setMessage("Handicap saved.");
    renderAuth();
  } catch (error) {
    setMessage(error.message);
  }
}

async function searchCourses() {
  els.courseSelect.innerHTML = "<option>Searching...</option>";
  const payload = await api(`/api/courses?q=${encodeURIComponent(els.courseSearch.value.trim())}`);
  state.courses = payload.courses;
  renderCourses();
}

function renderCourses() {
  els.courseSelect.innerHTML = "";
  for (const course of state.courses) {
    const option = document.createElement("option");
    option.value = course.id;
    option.textContent = [course.name, course.city, course.state].filter(Boolean).join(" • ");
    els.courseSelect.append(option);
  }
  selectCourse();
}

function selectCourse() {
  state.selectedCourse = state.courses.find(course => course.id === els.courseSelect.value) || state.courses[0] || null;
  renderTees();
}

function renderTees() {
  els.teeSelect.innerHTML = "";
  if (!state.selectedCourse) return;
  for (const tee of state.selectedCourse.tees) {
    const option = document.createElement("option");
    option.value = tee.id;
    option.textContent = `${tee.name} ${tee.gender ? `(${tee.gender})` : ""} • ${tee.rating}/${tee.slope}`;
    els.teeSelect.append(option);
  }
  selectTee();
}

function selectTee() {
  if (!state.selectedCourse) return;
  state.selectedTee = state.selectedCourse.tees.find(tee => tee.id === els.teeSelect.value) || state.selectedCourse.tees[0] || null;
  calculate();
}

function strokesForHole(courseHandicap, allocation) {
  const sign = courseHandicap < 0 ? -1 : 1;
  const abs = Math.abs(courseHandicap);
  const base = Math.floor(abs / 18);
  const extra = abs % 18 >= allocation ? 1 : 0;
  return sign * (base + extra);
}

function calculate() {
  const tee = state.selectedTee;
  const handicapIndex = Number(els.handicapInput.value);
  if (!tee || Number.isNaN(handicapIndex)) return;

  const totalPar = tee.holes.reduce((sum, hole) => sum + hole.par, 0);
  const courseHandicap = Math.round(handicapIndex * (tee.slope / 113) + (tee.rating - totalPar));
  const targetScore = Math.round(tee.rating + courseHandicap);

  els.courseHandicap.textContent = String(courseHandicap);
  els.targetScore.textContent = String(targetScore);
  els.ratingSlope.textContent = `${tee.rating} / ${tee.slope}`;
  els.totalPar.textContent = String(totalPar);

  els.scorecardBody.innerHTML = "";
  for (const hole of tee.holes) {
    const strokes = strokesForHole(courseHandicap, hole.handicap);
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
  }
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
els.courseSelect.addEventListener("change", selectCourse);
els.teeSelect.addEventListener("change", selectTee);
els.handicapInput.addEventListener("input", calculate);
els.courseSearch.addEventListener("keydown", event => {
  if (event.key === "Enter") searchCourses();
});

Promise.all([loadMe(), searchCourses(), loadGhinStatus()]).then(() => renderAuth());
