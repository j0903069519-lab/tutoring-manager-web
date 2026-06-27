const DATA_FILES = {
  Lessons: "data/Lessons.json",
  StudentDefaults: "data/StudentDefaults.json",
  ExternalIncome: "data/ExternalIncome.json"
};

const CACHE_KEYS = {
  Lessons: "tutoring.lessons",
  StudentDefaults: "tutoring.studentDefaults",
  ExternalIncome: "tutoring.externalIncome"
};

const state = {
  lessons: [],
  studentDefaults: [],
  externalIncome: [],
  selectedMonth: "",
  activeView: "dashboardView",
  searchText: ""
};

const moneyFormatter = new Intl.NumberFormat("zh-Hant-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
});

const dateFormatter = new Intl.DateTimeFormat("zh-Hant-TW", {
  month: "numeric",
  day: "numeric",
  weekday: "long"
});

const shortDateFormatter = new Intl.DateTimeFormat("zh-Hant-TW", {
  month: "numeric",
  day: "numeric"
});

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadAllData();
  setInitialMonth();
  render();
});

function bindEvents() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.activeView = tab.dataset.view;
      render();
    });
  });

  document.getElementById("monthSelect").addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    render();
  });

  document.getElementById("lessonSearch").addEventListener("input", (event) => {
    state.searchText = event.target.value.trim();
    renderLessons();
  });

  document.getElementById("syncButton").addEventListener("click", async () => {
    await loadAllData({ preferNetwork: true });
    setInitialMonth(true);
    showStatus("已重新載入資料");
    render();
  });

  document.getElementById("jsonImport").addEventListener("change", importJSONFiles);
  document.getElementById("clearCacheButton").addEventListener("click", clearCachedData);
}

async function loadAllData({ preferNetwork = false } = {}) {
  try {
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
  if (value instanceof Date) return value;
  const normalized = String(value).slice(0, 10);
  const [year, month, day] = normalized.split("-").map(Number);
  if (year && month && day) {
    return new Date(year, month - 1, day);
  }
  return new Date(value);
}

function defaultStartTime(timeSlot) {
  if (timeSlot === "早") return "09:00";
  if (timeSlot === "下午") return "14:00";
  if (timeSlot === "晚上") return "19:00";
  return timeSlot || "";
}

function setInitialMonth(forceLatest = false) {
  const months = getMonths();
  if (!months.length) return;
  if (forceLatest || !state.selectedMonth || !months.some((month) => month.id === state.selectedMonth)) {
    state.selectedMonth = months[0].id;
  }
}

function getMonths() {
  const monthMap = new Map();
  for (const lesson of state.lessons) {
    monthMap.set(monthId(lesson.year, lesson.month), { year: lesson.year, month: lesson.month });
  }
  for (const income of state.externalIncome) {
    monthMap.set(monthId(income.year, income.month), { year: income.year, month: income.month });
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
  return state.externalIncome.filter((income) => income.year === year && income.month === month);
}

function compareLessons(a, b) {
  const dateDiff = a.dateObject - b.dateObject;
  if (dateDiff !== 0) return dateDiff;
  return `${a.startTime} ${a.student}`.localeCompare(`${b.startTime} ${b.student}`, "zh-Hant");
}

function render() {
  renderTabs();
  renderMonthSelect();
  renderDashboard();
  renderLessons();
  renderIncome();
  renderSettings();
}

function renderTabs() {
  const titles = {
    dashboardView: "首頁",
    lessonsView: "課程",
    incomeView: "收入",
    settingsView: "設定"
  };
  document.getElementById("pageTitle").textContent = titles[state.activeView] || "課伴";
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
  setText("totalIncome", money(summary.total));
  setText("lessonIncome", money(summary.lessonIncome));
  setText("externalIncome", money(summary.externalIncome));
  setText("lessonCount", String(summary.lessonCount));
  renderLessonList("todayLessons", todayLessons(), "今天沒有課程");
  renderLessonList("upcomingLessons", upcomingLessons(), "沒有未來課程");
}

function getSummary() {
  const lessons = lessonsForSelectedMonth();
  const externalIncome = externalIncomeForSelectedMonth();
  const lessonIncome = lessons.reduce((sum, lesson) => sum + numeric(lesson.amount), 0);
  const externalTotal = externalIncome.reduce((sum, income) => sum + numeric(income.amount), 0);
  const hours = lessons.reduce((sum, lesson) => sum + numeric(lesson.hours), 0);
  return {
    lessonCount: lessons.length,
    lessonIncome,
    externalIncome: externalTotal,
    total: lessonIncome + externalTotal,
    hours
  };
}

function todayLessons() {
  const now = new Date();
  return state.lessons
    .filter((lesson) => isSameDay(lesson.dateObject, now))
    .sort(compareLessons);
}

function upcomingLessons() {
  const start = startOfDay(new Date());
  return state.lessons
    .filter((lesson) => lesson.dateObject >= start)
    .sort(compareLessons)
    .slice(0, 5);
}

function renderLessons() {
  const container = document.getElementById("lessonsList");
  const search = state.searchText;
  const lessons = lessonsForSelectedMonth().filter((lesson) => {
    if (!search) return true;
    const haystack = [
      lesson.student,
      lesson.rawStudent,
      lesson.subject,
      lesson.grade,
      lesson.paymentStatus,
      lesson.rawEntry
    ].join(" ");
    return haystack.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  });

  if (!lessons.length) {
    container.innerHTML = emptyState("這個月份沒有符合的課程");
    return;
  }

  const groups = new Map();
  for (const lesson of lessons) {
    const key = lesson.dateObject.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(lesson);
  }

  container.innerHTML = [...groups.entries()].map(([, groupLessons]) => `
    <section class="date-group">
      <h2 class="date-heading">${dateFormatter.format(groupLessons[0].dateObject)}</h2>
      <div class="lesson-list">
        ${groupLessons.map(lessonCard).join("")}
      </div>
    </section>
  `).join("");
}

function renderIncome() {
  const summary = getSummary();
  setText("incomeTotal", money(summary.total));
  setText("incomeHours", hourText(summary.hours));
  setText("incomeLessons", money(summary.lessonIncome));
  setText("incomeExternal", money(summary.externalIncome));

  const grouped = new Map();
  for (const lesson of lessonsForSelectedMonth()) {
    const current = grouped.get(lesson.student) || { student: lesson.student, count: 0, hours: 0, amount: 0 };
    current.count += 1;
    current.hours += numeric(lesson.hours);
    current.amount += numeric(lesson.amount);
    grouped.set(lesson.student, current);
  }

  const rows = [...grouped.values()].sort((a, b) => b.amount - a.amount || a.student.localeCompare(b.student, "zh-Hant"));
  const container = document.getElementById("studentIncomeList");
  container.innerHTML = rows.length
    ? rows.map((row) => `
        <article class="income-row">
          <div>
            <strong>${escapeHTML(row.student)}</strong>
            <div class="lesson-meta">${row.count} 堂 · ${hourText(row.hours)}</div>
          </div>
          <strong>${money(row.amount)}</strong>
        </article>
      `).join("")
    : emptyState("這個月份沒有課程收入");
}

function renderSettings() {
  setText("settingsLessonCount", String(state.lessons.length));
  setText("settingsExternalCount", String(state.externalIncome.length));
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
  const meta = [
    subject,
    `${hourText(lesson.hours)} · ${money(lesson.amount)}`,
    lesson.paymentStatus
  ].filter(Boolean).map(escapeHTML).join("<br>");

  return `
    <article class="lesson-card">
      <div>
        <div class="lesson-time">${escapeHTML(lesson.startTime)}</div>
        <div class="lesson-weekday">${shortDateFormatter.format(lesson.dateObject)} 週${escapeHTML(lesson.weekday || "")}</div>
      </div>
      <div>
        <div class="lesson-title">${title}</div>
        <div class="lesson-meta">${meta}</div>
      </div>
    </article>
  `;
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
    setInitialMonth(true);
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
    throw new Error("ExternalIncome.json 缺少收入欄位");
  }
}

async function clearCachedData() {
  Object.values(CACHE_KEYS).forEach((key) => localStorage.removeItem(key));
  await loadAllData({ preferNetwork: true });
  setInitialMonth(true);
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
  return moneyFormatter.format(numeric(value));
}

function hourText(value) {
  return `${Math.round(numeric(value) * 10) / 10} 小時`;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
