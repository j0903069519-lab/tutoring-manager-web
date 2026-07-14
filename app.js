const DATA_FILES = {
  Lessons: "data/Lessons.json",
  StudentDefaults: "data/StudentDefaults.json",
  ExternalIncome: "data/ExternalIncome.json"
};

const TAIWAN_TIME_ZONE = "Asia/Taipei";
const ENCRYPTED_DATA_FILE = "data/encrypted-data.json";
const DATA_PASSWORD = "071314";
const INCOME_VIEW_PASSWORD = "0713";

const CACHE_KEYS = {
  Lessons: "tutoring.lessons",
  StudentDefaults: "tutoring.studentDefaults",
  ExternalIncome: "tutoring.externalIncome",
  IncomeUnlocked: "tutoring.incomeUnlocked"
};

const state = {
  lessons: [],
  studentDefaults: [],
  externalIncome: [],
  selectedMonth: "",
  activeView: "dashboardView",
  searchText: "",
  scheduleMode: "week",
  scheduleDate: todayInTaiwan(),
  dataLoaded: false,
  incomeUnlocked: localStorage.getItem(CACHE_KEYS.IncomeUnlocked) === "1"
};

const dateFormatter = new Intl.DateTimeFormat("zh-Hant-TW", {
  timeZone: TAIWAN_TIME_ZONE,
  month: "numeric",
  day: "numeric",
  weekday: "long"
});

const shortDateFormatter = new Intl.DateTimeFormat("zh-Hant-TW", {
  timeZone: TAIWAN_TIME_ZONE,
  month: "numeric",
  day: "numeric"
});

const weekdayFormatter = new Intl.DateTimeFormat("zh-Hant-TW", {
  timeZone: TAIWAN_TIME_ZONE,
  weekday: "short"
});

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await initializeApp();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const requestedView = tab.dataset.view;
      if (requestedView === "lessonsView" && !unlockIncomeView()) {
        return;
      }
      state.activeView = requestedView;
      render();
    });
  });

  document.getElementById("monthSelect").addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    render();
  });

  document.getElementById("lessonSearch")?.addEventListener("input", (event) => {
    state.searchText = event.target.value.trim();
    renderIncomeOverview();
  });

  document.querySelectorAll(".schedule-mode").forEach((button) => {
    button.addEventListener("click", () => {
      state.scheduleMode = button.dataset.mode;
      renderSchedule();
    });
  });

  document.getElementById("todayButton").addEventListener("click", () => {
    state.scheduleDate = todayInTaiwan();
    renderSchedule();
  });

  document.getElementById("previousPeriodButton").addEventListener("click", () => {
    moveSchedulePeriod(-1);
  });

  document.getElementById("nextPeriodButton").addEventListener("click", () => {
    moveSchedulePeriod(1);
  });

  document.getElementById("scheduleContent").addEventListener("click", (event) => {
    const dayButton = event.target.closest(".calendar-day");
    if (!dayButton) return;
    state.scheduleDate = parseDate(dayButton.dataset.date);
    state.scheduleMode = "day";
    renderSchedule();
  });

  document.getElementById("syncButton").addEventListener("click", async () => {
    await loadAllData({ preferNetwork: true });
    setInitialMonth();
    showStatus("已重新載入資料");
    render();
  });

  document.getElementById("jsonImport").addEventListener("change", importJSONFiles);
  document.getElementById("clearCacheButton").addEventListener("click", clearCachedData);
}

async function loadAllData({ preferNetwork = false } = {}) {
  try {
    const encryptedPayload = await tryLoadEncryptedPayload(DATA_PASSWORD, preferNetwork);
    if (encryptedPayload) {
      state.lessons = encryptedPayload.Lessons.map(normalizeLesson);
      state.studentDefaults = encryptedPayload.StudentDefaults;
      state.externalIncome = (encryptedPayload.ExternalIncome || []).map(normalizeExternalIncome);
      return;
    }

    const [lessons, studentDefaults, externalIncome] = await Promise.all([
      loadJSON("Lessons", preferNetwork),
      loadJSON("StudentDefaults", preferNetwork),
      loadJSON("ExternalIncome", preferNetwork)
    ]);

    state.lessons = lessons.map(normalizeLesson);
    state.studentDefaults = studentDefaults;
    state.externalIncome = externalIncome.map(normalizeExternalIncome);
  } catch (error) {
    showStatus(`讀取資料失敗：${error.message}`, true);
  }
}

async function tryLoadEncryptedPayload(password, preferNetwork) {
  try {
    return await loadEncryptedPayload(password, preferNetwork);
  } catch (error) {
    console.warn("Encrypted data unavailable, falling back to JSON/cache.", error);
    return null;
  }
}

async function loadEncryptedPayload(password, preferNetwork) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("瀏覽器不支援加密資料解密");
  }
  const url = preferNetwork ? `${ENCRYPTED_DATA_FILE}?v=${Date.now()}` : ENCRYPTED_DATA_FILE;
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`encrypted-data.json HTTP ${response.status}`);
  }

  const encrypted = await response.json();
  return decryptPayload(encrypted, password);
}

async function decryptPayload(encrypted, password) {
  const salt = base64ToBytes(encrypted.salt);
  const iv = base64ToBytes(encrypted.iv);
  const tag = base64ToBytes(encrypted.tag);
  const data = base64ToBytes(encrypted.data);
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: encrypted.iterations,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );
  const ciphertext = new Uint8Array(data.length + tag.length);
  ciphertext.set(data, 0);
  ciphertext.set(tag, data.length);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function initializeApp() {
  if (state.dataLoaded) return;
  await loadAllData();
  state.dataLoaded = true;
  setInitialMonth();
  render();
}

async function loadJSON(name, preferNetwork) {
  if (!preferNetwork) {
    const cached = localStorage.getItem(CACHE_KEYS[name]);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const response = await fetch(`${DATA_FILES[name]}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${name}.json HTTP ${response.status}`);
  }
  const data = await response.json();
  localStorage.setItem(CACHE_KEYS[name], JSON.stringify(data));
  return data;
}

function normalizeLesson(lesson) {
  return {
    ...lesson,
    dateObject: parseDate(lesson.date),
    startTime: lesson.startTime || defaultStartTime(lesson.timeSlot),
    grade: lesson.grade || "",
    paymentMethod: lesson.paymentMethod || ""
  };
}

function normalizeExternalIncome(income) {
  return {
    ...income,
    dateObject: parseDate(income.date)
  };
}

function parseDate(value) {
  if (!value) return new Date(0);
  if (value instanceof Date) return dateInTaiwan(value);
  const text = String(value);
  if (text.includes("T")) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return dateInTaiwan(parsed);
    }
  }
  const [year, month, day] = text.slice(0, 10).split("-").map(Number);
  if (year && month && day) {
    return new Date(year, month - 1, day);
  }
  return dateInTaiwan(new Date(value));
}

function defaultStartTime(timeSlot) {
  if (timeSlot === "早") return "09:00";
  if (timeSlot === "下午") return "14:00";
  if (timeSlot === "晚上") return "19:00";
  return timeSlot || "";
}

function setInitialMonth() {
  const months = getMonths();
  if (!months.length) return;
  const today = todayInTaiwan();
  const currentMonth = monthId(today.getFullYear(), today.getMonth() + 1);
  if (months.some((month) => month.id === currentMonth)) {
    state.selectedMonth = currentMonth;
    return;
  }
  state.selectedMonth = currentMonth;
}

function getMonths() {
  const monthMap = new Map();
  const today = todayInTaiwan();
  monthMap.set(monthId(today.getFullYear(), today.getMonth() + 1), {
    year: today.getFullYear(),
    month: today.getMonth() + 1
  });
  for (const lesson of state.lessons) {
    monthMap.set(monthId(lesson.year, lesson.month), { year: lesson.year, month: lesson.month });
  }
  return [...monthMap.values()]
    .sort((a, b) => b.year - a.year || b.month - a.month)
    .map((item) => ({
      ...item,
      id: monthId(item.year, item.month),
      title: `${item.year} / ${item.month}`
    }));
}

function monthId(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function selectedMonthParts() {
  const [year, month] = state.selectedMonth.split("-").map(Number);
  return { year, month };
}

function lessonsForSelectedMonth() {
  const { year, month } = selectedMonthParts();
  return state.lessons
    .filter((lesson) => lesson.year === year && lesson.month === month)
    .sort(compareLessons);
}

function externalIncomeForSelectedMonth() {
  const { year, month } = selectedMonthParts();
  return state.externalIncome
    .filter((income) => income.year === year && income.month === month)
    .sort((a, b) => a.dateObject - b.dateObject || `${a.category} ${a.title}`.localeCompare(`${b.category} ${b.title}`, "zh-Hant"));
}

function compareLessons(a, b) {
  const dateDiff = a.dateObject - b.dateObject;
  if (dateDiff !== 0) return dateDiff;
  return `${a.startTime} ${a.student}`.localeCompare(`${b.startTime} ${b.student}`, "zh-Hant");
}

function isSchoolCourse(lesson) {
  return lesson.sourceFile === "學校課表" || lesson.paymentMethod === "學校課程";
}

function render() {
  renderTabs();
  renderMonthSelect();
  renderDashboard();
  renderSchedule();
  renderIncomeOverview();
  renderSettings();
}

function renderTabs() {
  const titles = {
    dashboardView: "首頁",
    scheduleView: "課表",
    lessonsView: "近期收入概況",
    settingsView: "設定"
  };
  document.getElementById("pageTitle").textContent = titles[state.activeView] || "家教行事曆";
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === state.activeView);
  });
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === state.activeView);
  });
}

function renderMonthSelect() {
  const select = document.getElementById("monthSelect");
  const months = getMonths();
  select.innerHTML = months.map((month) => {
    const selected = month.id === state.selectedMonth ? "selected" : "";
    return `<option value="${month.id}" ${selected}>${month.title}</option>`;
  }).join("");
}

function renderDashboard() {
  const summary = getSummary();
  setText("lessonCount", String(summary.lessonCount));
  setText("lessonHours", hourText(summary.hours));
  renderLessonList("todayLessons", todayLessons(), "今天沒有課程");
  renderLessonList("upcomingLessons", upcomingLessons(), "沒有未來課程");
}

function renderSchedule() {
  document.querySelectorAll(".schedule-mode").forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === state.scheduleMode);
  });

  const range = scheduleRange();
  const lessons = state.lessons
    .filter((lesson) => lesson.dateObject >= range.start && lesson.dateObject < range.end)
    .sort(compareLessons);
  const totalHours = lessons.reduce((sum, lesson) => sum + numeric(lesson.hours), 0);
  const lessonDays = new Set(lessons.map((lesson) => dateKey(lesson.dateObject))).size;

  setText("scheduleTitle", range.title);
  setText("scheduleSubtitle", range.subtitle);
  document.getElementById("scheduleSummary").innerHTML = `
    <article><strong>${lessons.length}</strong><span>堂課</span></article>
    <article><strong>${hourText(totalHours)}</strong><span>總時數</span></article>
    <article><strong>${lessonDays}</strong><span>上課日</span></article>
  `;

  if (state.scheduleMode === "month") {
    renderMonthSchedule(range.start);
    return;
  }

  const container = document.getElementById("scheduleContent");
  if (!lessons.length) {
    container.innerHTML = emptyState(state.scheduleMode === "day" ? "這一天沒有課程" : "這一週沒有課程");
    return;
  }

  if (state.scheduleMode === "day") {
    container.innerHTML = `<div class="lesson-list">${lessons.map(scheduleLessonCard).join("")}</div>`;
    return;
  }

  container.innerHTML = weekDays(range.start).map((date) => {
    const dayLessons = lessons.filter((lesson) => isSameDay(lesson.dateObject, date));
    return `
      <section class="schedule-day">
        <h3>${dateFormatter.format(date)}</h3>
        ${dayLessons.length ? `<div class="lesson-list">${dayLessons.map(scheduleLessonCard).join("")}</div>` : emptyState("沒有課程")}
      </section>
    `;
  }).join("");
}

function scheduleRange() {
  const date = state.scheduleDate;
  if (state.scheduleMode === "day") {
    const start = startOfDay(date);
    const end = addDays(start, 1);
    return {
      start,
      end,
      title: dateFormatter.format(start),
      subtitle: "日課表"
    };
  }

  if (state.scheduleMode === "month") {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    return {
      start,
      end,
      title: `${date.getFullYear()} / ${date.getMonth() + 1}`,
      subtitle: "月課表"
    };
  }

  const start = startOfWeek(date);
  const end = addDays(start, 7);
  return {
    start,
    end,
    title: `${shortDateFormatter.format(start)} - ${shortDateFormatter.format(addDays(end, -1))}`,
    subtitle: "週課表"
  };
}

function moveSchedulePeriod(direction) {
  if (state.scheduleMode === "day") {
    state.scheduleDate = addDays(state.scheduleDate, direction);
  } else if (state.scheduleMode === "month") {
    state.scheduleDate = new Date(state.scheduleDate.getFullYear(), state.scheduleDate.getMonth() + direction, 1);
  } else {
    state.scheduleDate = addDays(state.scheduleDate, direction * 7);
  }
  renderSchedule();
}

function renderMonthSchedule(monthStart) {
  const calendarStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
  const container = document.getElementById("scheduleContent");
  container.innerHTML = `
    <div class="calendar-grid calendar-weekdays">
      ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div>${day}</div>`).join("")}
    </div>
    <div class="calendar-grid">
      ${days.map((date) => monthDayCell(date, monthStart)).join("")}
    </div>
  `;
}

function monthDayCell(date, monthStart) {
  const lessons = state.lessons.filter((lesson) => isSameDay(lesson.dateObject, date)).sort(compareLessons);
  const isOutside = date.getMonth() !== monthStart.getMonth();
  const isToday = isSameDay(date, todayInTaiwan());
  const firstLesson = lessons[0];
  return `
    <button class="calendar-day ${isOutside ? "outside" : ""} ${isToday ? "today" : ""}" type="button" data-date="${dateKey(date)}">
      <span>${date.getDate()}</span>
      ${lessons.length ? `<strong>${lessons.length} 堂</strong>` : ""}
      ${firstLesson ? `<small>${escapeHTML(firstLesson.startTime)} ${escapeHTML(firstLesson.student)}</small>` : ""}
    </button>
  `;
}

function scheduleLessonCard(lesson) {
  const title = escapeHTML(lesson.student || "未命名");
  const subject = [lesson.subject, lesson.grade].filter(Boolean).join(" · ");
  const location = lesson.location ? `上課地點：${lesson.location}` : "上課地點：未填";
  const meta = [
    subject,
    hourText(lesson.hours),
    location
  ].filter(Boolean).map(escapeHTML).join("<br>");

  return `
    <article class="lesson-card schedule-card">
      <div>
        <div class="lesson-time">${escapeHTML(lesson.startTime)}</div>
        <div class="lesson-weekday">${lessonDateLabel(lesson.dateObject)}</div>
      </div>
      <div>
        <div class="lesson-title">${title}</div>
        <div class="lesson-meta">${meta}</div>
      </div>
    </article>
  `;
}

function getSummary() {
  const lessons = lessonsForSelectedMonth().filter((lesson) => !isSchoolCourse(lesson));
  const hours = lessons.reduce((sum, lesson) => sum + numeric(lesson.hours), 0);
  return {
    lessonCount: lessons.length,
    hours
  };
}

function todayLessons() {
  const now = todayInTaiwan();
  return state.lessons
    .filter((lesson) => isSameDay(lesson.dateObject, now))
    .sort(compareLessons);
}

function upcomingLessons() {
  const start = todayInTaiwan();
  return state.lessons
    .filter((lesson) => lesson.dateObject >= start)
    .sort(compareLessons)
    .slice(0, 5);
}

function renderIncomeOverview() {
  const container = document.getElementById("incomeOverview");
  if (!container) return;

  if (!state.incomeUnlocked) {
    container.innerHTML = emptyState("請點下方「近期收入」並輸入密碼查看。");
    return;
  }

  const lessons = lessonsForSelectedMonth().filter((lesson) => !isSchoolCourse(lesson));
  const externalIncome = externalIncomeForSelectedMonth();
  const lessonIncome = lessons.reduce((sum, lesson) => sum + numeric(lesson.amount), 0);
  const externalTotal = externalIncome.reduce((sum, income) => sum + numeric(income.amount), 0);
  const hours = lessons.reduce((sum, lesson) => sum + numeric(lesson.hours), 0);
  const studentRows = studentIncomeRows(lessons);

  container.innerHTML = `
    <div class="metric-grid">
      <article class="metric metric-total">
        <span>本月總收入</span>
        <strong>${money(lessonIncome + externalTotal)}</strong>
      </article>
      <article class="metric">
        <span>家教收入</span>
        <strong>${money(lessonIncome)}</strong>
      </article>
      <article class="metric">
        <span>外務收入</span>
        <strong>${money(externalTotal)}</strong>
      </article>
      <article class="metric">
        <span>家教時數</span>
        <strong>${hourText(hours)}</strong>
      </article>
    </div>

    <section class="panel">
      <div class="section-heading">
        <h2>學生收入</h2>
      </div>
      <div class="income-list">
        ${studentRows.length ? studentRows.map(studentIncomeCard).join("") : emptyState("這個月份沒有家教收入")}
      </div>
    </section>

    <section class="panel">
      <div class="section-heading">
        <h2>外務收入</h2>
      </div>
      <div class="income-list">
        ${externalIncome.length ? externalIncome.map(externalIncomeCard).join("") : emptyState("這個月份沒有外務收入")}
      </div>
    </section>
  `;
}

function renderSettings() {
  setText("settingsLessonCount", String(state.lessons.length));
  setText("settingsPreferenceCount", String(state.studentDefaults.length));
}

function renderLessonList(id, lessons, emptyText) {
  const container = document.getElementById(id);
  container.innerHTML = lessons.length
    ? lessons.map(lessonCard).join("")
    : emptyState(emptyText);
}

function lessonCard(lesson) {
  const title = escapeHTML(lesson.student || "未命名");
  const subject = [lesson.subject, lesson.grade].filter(Boolean).join(" · ");
  const location = lesson.location ? `上課地點：${lesson.location}` : "上課地點：未填";
  const meta = [
    subject,
    hourText(lesson.hours),
    location
  ].filter(Boolean).map(escapeHTML).join("<br>");

  return `
    <article class="lesson-card">
      <div>
        <div class="lesson-time">${escapeHTML(lesson.startTime)}</div>
        <div class="lesson-weekday">${lessonDateLabel(lesson.dateObject)}</div>
      </div>
      <div>
        <div class="lesson-title">${title}</div>
        <div class="lesson-meta">${meta}</div>
      </div>
    </article>
  `;
}

function studentIncomeRows(lessons) {
  const rows = new Map();
  for (const lesson of lessons) {
    const name = lesson.student || "未命名";
    const row = rows.get(name) || { student: name, amount: 0, hours: 0, count: 0 };
    row.amount += numeric(lesson.amount);
    row.hours += numeric(lesson.hours);
    row.count += 1;
    rows.set(name, row);
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount || a.student.localeCompare(b.student, "zh-Hant"));
}

function studentIncomeCard(row) {
  return `
    <article class="income-row">
      <div>
        <strong>${escapeHTML(row.student)}</strong>
        <span>${row.count} 堂 · ${hourText(row.hours)}</span>
      </div>
      <strong>${money(row.amount)}</strong>
    </article>
  `;
}

function externalIncomeCard(income) {
  const title = income.title || income.category || "外務收入";
  const subtitle = [income.category, shortDateFormatter.format(income.dateObject)].filter(Boolean).join(" · ");
  return `
    <article class="income-row">
      <div>
        <strong>${escapeHTML(title)}</strong>
        <span>${escapeHTML(subtitle)}</span>
      </div>
      <strong>${money(income.amount)}</strong>
    </article>
  `;
}

function unlockIncomeView() {
  if (state.incomeUnlocked) return true;
  const input = prompt("請輸入近期收入概況密碼");
  if (input === INCOME_VIEW_PASSWORD) {
    state.incomeUnlocked = true;
    localStorage.setItem(CACHE_KEYS.IncomeUnlocked, "1");
    return true;
  }
  if (input !== null) {
    showStatus("密碼錯誤", true);
  }
  return false;
}

async function importJSONFiles(event) {
  const files = [...event.target.files];
  if (!files.length) return;

  try {
    for (const file of files) {
      const name = file.name.replace(/\.json$/i, "");
      if (!CACHE_KEYS[name]) continue;
      const text = await file.text();
      const parsed = JSON.parse(text);
      validateImportedData(name, parsed);
      localStorage.setItem(CACHE_KEYS[name], JSON.stringify(parsed));
    }
    await loadAllData();
    setInitialMonth();
    showStatus("已匯入並更新資料");
    render();
  } catch (error) {
    showStatus(`匯入失敗：${error.message}`, true);
  } finally {
    event.target.value = "";
  }
}

function validateImportedData(name, data) {
  if (!Array.isArray(data)) {
    throw new Error(`${name}.json 格式必須是陣列`);
  }
  if (name === "Lessons" && data.some((item) => !item.lessonID || !item.date)) {
    throw new Error("Lessons.json 缺少課程欄位");
  }
  if (name === "ExternalIncome" && data.some((item) => !item.incomeID || !item.date)) {
    throw new Error("ExternalIncome.json 缺少必要欄位");
  }
}

async function clearCachedData() {
  Object.values(CACHE_KEYS).forEach((key) => localStorage.removeItem(key));
  await loadAllData({ preferNetwork: true });
  setInitialMonth();
  showStatus("已清除快取並重新載入內建資料");
  render();
}

function showStatus(message, isError = false) {
  const banner = document.getElementById("statusBanner");
  banner.textContent = message;
  banner.classList.toggle("error", isError);
  banner.hidden = false;
}

function emptyState(text) {
  return `<div class="empty-state">${escapeHTML(text)}</div>`;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function money(value) {
  return `$${Math.round(numeric(value)).toLocaleString("zh-Hant-TW")}`;
}

function hourText(value) {
  return `${Math.round(numeric(value) * 10) / 10} 小時`;
}

function lessonDateLabel(date) {
  return `${shortDateFormatter.format(date)} ${weekdayFormatter.format(date)}`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function todayInTaiwan() {
  return dateInTaiwan(new Date());
}

function dateInTaiwan(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIWAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Number(values.year), Number(values.month) - 1, Number(values.day));
}

function startOfWeek(date) {
  const start = startOfDay(date);
  const day = start.getDay() || 7;
  return addDays(start, 1 - day);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function weekDays(start) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
