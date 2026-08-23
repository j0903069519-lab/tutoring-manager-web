const DATABASE_FILE = "data/CourseAssistantDatabase.json";
const VISIBLE_MONTH_RANGE = { before: 3, after: 3 };

const TAIWAN_TIME_ZONE = "Asia/Taipei";
const ENCRYPTED_DATA_FILE = "data/encrypted-data.json";
const DATA_PASSWORD = "071314";
const INCOME_VIEW_PASSWORD = "0713";

const CACHE_KEYS = {
  Database: "tutoring.courseAssistantDatabase",
  IncomeUnlocked: "tutoring.incomeUnlocked",
  WeekLayout: "tutoring.weekLayout",
  WeekLayoutDefaultVersion: "tutoring.weekLayoutDefaultVersion"
};

const WEEK_LAYOUT_DEFAULT_VERSION = "20260823-vertical";
if (localStorage.getItem(CACHE_KEYS.WeekLayoutDefaultVersion) !== WEEK_LAYOUT_DEFAULT_VERSION) {
  localStorage.setItem(CACHE_KEYS.WeekLayout, "vertical");
  localStorage.setItem(CACHE_KEYS.WeekLayoutDefaultVersion, WEEK_LAYOUT_DEFAULT_VERSION);
}

const state = {
  lessons: [],
  studentDefaults: [],
  externalIncome: [],
  selectedMonth: "",
  activeView: "dashboardView",
  searchText: "",
  scheduleMode: "week",
  weekLayout: localStorage.getItem(CACHE_KEYS.WeekLayout) || "vertical",
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

  document.querySelectorAll(".week-layout-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.weekLayout = button.dataset.weekLayout;
      localStorage.setItem(CACHE_KEYS.WeekLayout, state.weekLayout);
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
    const dayButton = event.target.closest(".calendar-day, .week-day-header[data-date], .mobile-day-header[data-date], .mobile-horizontal-day-label[data-date]");
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
    const encryptedDatabase = databaseFromPayload(encryptedPayload);
    if (encryptedDatabase) {
      applyDatabase(encryptedDatabase);
      return;
    }

    applyDatabase(await loadDatabase(preferNetwork));
  } catch (error) {
    showStatus(`讀取資料失敗：${error.message}`, true);
  }
}

async function tryLoadEncryptedPayload(password, preferNetwork) {
  try {
    return await loadEncryptedPayload(password, preferNetwork);
  } catch (error) {
    console.warn("Encrypted data unavailable, falling back to database JSON/cache.", error);
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

async function loadDatabase(preferNetwork) {
  if (!preferNetwork) {
    const cached = localStorage.getItem(CACHE_KEYS.Database);
    if (cached) {
      return JSON.parse(cached);
    }
  }

  const response = await fetch(`${DATABASE_FILE}?v=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`CourseAssistantDatabase.json HTTP ${response.status}`);
  }
  const data = await response.json();
  validateDatabase(data);
  localStorage.setItem(CACHE_KEYS.Database, JSON.stringify(data));
  return data;
}

function databaseFromPayload(payload) {
  if (!payload) return null;
  if (payload.CourseAssistantDatabase) return payload.CourseAssistantDatabase;
  if (payload.schemaVersion && Array.isArray(payload.lessons)) return payload;
  return null;
}

function applyDatabase(database) {
  validateDatabase(database);
  const categoryNames = new Map((database.categoryDefinitions || []).map((category) => [category.id, category.name]));
  const visibleLessons = (database.lessons || []).filter((lesson) => isVisibleMonth(lesson.localDate));
  const visibleExternalIncome = (database.externalIncomes || []).filter((income) => isVisibleMonth(income.localDate));

  state.lessons = visibleLessons.map((lesson) => normalizeDatabaseLesson(lesson, categoryNames));
  state.studentDefaults = (database.students || []).map(normalizeDatabaseStudent);
  state.externalIncome = visibleExternalIncome.map((income) => normalizeDatabaseExternalIncome(income, categoryNames));
}

function validateDatabase(data) {
  if (!data || !Array.isArray(data.lessons) || !Array.isArray(data.students) || !Array.isArray(data.externalIncomes)) {
    throw new Error("CourseAssistantDatabase.json 缺少新版資料庫欄位");
  }
}

function normalizeDatabaseLesson(lesson, categoryNames) {
  const date = parseDate(lesson.localDate);
  const categoryName = categoryNames.get(lesson.category) || lesson.category || "";
  const durationMinutes = numeric(lesson.durationMinutes);
  return {
    ...lesson,
    lessonID: lesson.id,
    date: lesson.localDate,
    dateObject: date,
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    student: lesson.studentNameSnapshot || lesson.studentID || "",
    rawStudent: lesson.studentID || "",
    startTime: lesson.startTime || "",
    timeSlot: lesson.startTime || "",
    hours: durationMinutes > 0 ? durationMinutes / 60 : 0,
    grade: lesson.grade || "",
    subject: lesson.subject || categoryName,
    location: lesson.location || "",
    amount: numeric(lesson.amount),
    hourlyRate: numeric(lesson.hourlyRate),
    paymentMethod: lesson.category === "schoolCourse" ? "學校課程" : billingModeLabel(lesson.billingMode),
    sourceFile: categoryName || lesson.source || "",
    categoryName,
    paymentStatus: lesson.paymentStatus || "",
    status: lesson.status || ""
  };
}

function normalizeDatabaseStudent(student) {
  return {
    ...student,
    student: student.name || "",
    subject: student.defaultSubject || "",
    grade: student.defaultGrade || "",
    location: student.defaultLocation || "",
    hours: numeric(student.defaultDurationMinutes) / 60,
    hourlyRate: numeric(student.defaultHourlyRate),
    paymentMethod: billingModeLabel(student.defaultBillingMode)
  };
}

function normalizeDatabaseExternalIncome(income, categoryNames) {
  const date = parseDate(income.localDate);
  const categoryName = categoryNames.get(income.category) || income.category || "";
  return {
    ...income,
    incomeID: income.id,
    date: income.localDate,
    dateObject: date,
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    title: income.title || categoryName || "外務收入",
    category: categoryName,
    amount: numeric(income.amount)
  };
}

function billingModeLabel(value) {
  switch (value) {
    case "perLesson": return "每堂付款";
    case "monthly": return "月付款";
    case "hourly": return "鐘點";
    case "free": return "不計費";
    case "other": return "其他";
    default: return "";
  }
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

function isVisibleMonth(value) {
  const date = parseDate(value);
  const today = todayInTaiwan();
  const start = new Date(today.getFullYear(), today.getMonth() - VISIBLE_MONTH_RANGE.before, 1);
  const end = new Date(today.getFullYear(), today.getMonth() + VISIBLE_MONTH_RANGE.after + 1, 1);
  return date >= start && date < end;
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
  return lesson.category === "schoolCourse" || lesson.categoryName === "學校課程" || lesson.paymentMethod === "學校課程";
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
  document.querySelectorAll(".week-layout-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.weekLayout === state.weekLayout);
  });
  document.getElementById("weekLayoutToggle").hidden = state.scheduleMode !== "week";
  document.getElementById("scheduleView").classList.toggle("compact-week", state.scheduleMode === "week" && isNarrowViewport());

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

  renderWeekTimeline(range.start, lessons);
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
    <div class="month-board">
      <div class="calendar-grid calendar-weekdays">
        ${["一", "二", "三", "四", "五", "六", "日"].map((day) => `<div>${day}</div>`).join("")}
      </div>
      <div class="calendar-grid">
        ${days.map((date) => monthDayCell(date, monthStart)).join("")}
      </div>
    </div>
  `;
}

function renderWeekTimeline(weekStart, lessons) {
  const container = document.getElementById("scheduleContent");
  const days = weekDays(weekStart);
  if (isNarrowViewport()) {
    if (state.weekLayout === "vertical") {
      renderMobileWeekBoard(days, lessons);
    } else {
      renderMobileHorizontalWeekBoard(days, lessons);
    }
    return;
  }

  const metrics = weekTimelineMetrics(lessons);
  const timelineHeight = Math.round(metrics.totalMinutes * metrics.pixelsPerMinute);
  const hourMarkers = timelineHourMarkers(metrics);

  container.innerHTML = `
    <div class="week-timeline-scroll" aria-label="橫式週課表">
      <div class="week-timeline" style="--timeline-height: ${timelineHeight}px;">
        <div class="week-time-axis">
          <div class="week-day-header time-header">時間</div>
          <div class="week-time-body">
            ${hourMarkers.map((minute) => `
              <div class="week-time-label" style="top: ${weekTimelineTop(minute, metrics)}px;">${String(Math.floor(minute / 60)).padStart(2, "0")}</div>
            `).join("")}
          </div>
        </div>
        <div class="week-days-grid">
          ${days.map((date) => weekTimelineDay(date, lessons.filter((lesson) => isSameDay(lesson.dateObject, date)), metrics)).join("")}
        </div>
      </div>
    </div>
  `;
}

function isNarrowViewport() {
  return window.matchMedia?.("(max-width: 720px)").matches ?? true;
}

function renderMobileWeekBoard(days, lessons) {
  const container = document.getElementById("scheduleContent");
  const metrics = mobileVerticalWeekMetrics(lessons);
  const timelineHeight = Math.round(metrics.totalMinutes * metrics.pixelsPerMinute);
  const hourMarkers = timelineHourMarkers(metrics);
  container.innerHTML = `
    <div class="mobile-week-board" aria-label="手機週課表" style="--timeline-height: ${timelineHeight}px;">
      <div class="mobile-week-axis">
        <div class="mobile-axis-header"></div>
        <div class="mobile-axis-body">
          ${hourMarkers.map((minute) => `
            <div class="mobile-axis-label" style="top: ${weekTimelineTop(minute, metrics)}px;">${String(Math.floor(minute / 60)).padStart(2, "0")}</div>
          `).join("")}
        </div>
      </div>
      ${days.map((date) => mobileWeekDay(date, lessons.filter((lesson) => isSameDay(lesson.dateObject, date)), metrics, hourMarkers)).join("")}
    </div>
  `;
}

function renderMobileHorizontalWeekBoard(days, lessons) {
  const container = document.getElementById("scheduleContent");
  const metrics = horizontalWeekMetrics(lessons);
  const hourMarkers = timelineHourMarkers(metrics);
  container.innerHTML = `
    <div class="mobile-horizontal-week" aria-label="手機橫式週課表" style="--timeline-width: ${metrics.timelineWidth}px;">
      <div class="mobile-horizontal-corner"></div>
      <div class="mobile-horizontal-time">
        ${hourMarkers.map((minute) => `
          <span style="left: ${horizontalWeekLeft(minute, metrics)}px;">${String(Math.floor(minute / 60)).padStart(2, "0")}</span>
        `).join("")}
      </div>
      ${days.map((date) => mobileHorizontalDay(date, lessons.filter((lesson) => isSameDay(lesson.dateObject, date)), metrics, hourMarkers)).join("")}
    </div>
  `;
}

function mobileVerticalWeekMetrics(lessons) {
  const base = weekTimelineMetrics(lessons);
  return {
    ...base,
    pixelsPerMinute: 0.31
  };
}

function mobileHorizontalDay(date, dayLessons, metrics, hourMarkers) {
  const isToday = isSameDay(date, todayInTaiwan());
  const placements = horizontalWeekPlacements(dayLessons, metrics);
  const laneCount = Math.max(1, ...placements.map((placement) => placement.lane + 1));
  const rowHeight = 46 + (laneCount - 1) * 32;
  return `
    <button class="mobile-horizontal-day-label ${isToday ? "today" : ""}" type="button" data-date="${dateKey(date)}" style="height: ${rowHeight}px;">
      <span>${weekdayFormatter.format(date)}</span>
      <strong>${date.getDate()}</strong>
    </button>
    <div class="mobile-horizontal-day-body" style="height: ${rowHeight}px;">
      ${hourMarkers.map((minute) => `
        <div class="mobile-horizontal-line" style="left: ${horizontalWeekLeft(minute, metrics)}px;"></div>
      `).join("")}
      ${placements.map((placement) => mobileHorizontalLessonBlock(placement)).join("")}
    </div>
  `;
}

function mobileHorizontalLessonBlock(placement) {
  const lesson = placement.lesson;
  return `
    <article class="mobile-horizontal-lesson" style="left: ${placement.left}px; width: ${placement.width}px; top: ${placement.top}px;">
      <strong>${escapeHTML(lesson.startTime)}</strong>
      <span>${escapeHTML(lesson.student || "未命名")}</span>
    </article>
  `;
}

function horizontalWeekMetrics(lessons) {
  const base = weekTimelineMetrics(lessons);
  return {
    ...base,
    pixelsPerMinute: 0.31,
    timelineWidth: Math.round(base.totalMinutes * 0.31)
  };
}

function horizontalWeekLeft(minute, metrics) {
  return Math.round((minute - metrics.startMinute) * metrics.pixelsPerMinute);
}

function horizontalWeekPlacements(lessons, metrics) {
  const intervals = lessons
    .map((lesson) => {
      const start = timeToMinutes(lesson.startTime);
      if (start === null) return null;
      return {
        lesson,
        start,
        end: start + Math.max(45, lessonDurationMinutes(lesson)),
        lane: 0
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || String(a.lesson.student).localeCompare(String(b.lesson.student), "zh-Hant"));

  const laneEnds = [];
  intervals.forEach((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else {
      laneEnds[lane] = item.end;
    }
    item.lane = lane;
  });

  return intervals.map((item) => ({
    lesson: item.lesson,
    lane: item.lane,
    left: horizontalWeekLeft(item.start, metrics),
    width: Math.max(34, Math.round((item.end - item.start) * metrics.pixelsPerMinute)),
    top: 7 + item.lane * 32
  }));
}

function mobileWeekDay(date, dayLessons, metrics, hourMarkers) {
  const isToday = isSameDay(date, todayInTaiwan());
  const placements = weekTimelinePlacements(dayLessons, metrics);
  return `
    <section class="mobile-day-column ${isToday ? "today" : ""}">
      <button class="mobile-day-header" type="button" data-date="${dateKey(date)}">
        <span>${weekdayFormatter.format(date)}</span>
        <strong>${date.getDate()}</strong>
      </button>
      <div class="mobile-day-body">
        ${hourMarkers.map((minute) => `
          <div class="mobile-hour-line" style="top: ${weekTimelineTop(minute, metrics)}px;">
            <span>${String(Math.floor(minute / 60)).padStart(2, "0")}</span>
          </div>
        `).join("")}
        ${placements.map((placement) => mobileWeekLessonBlock(placement)).join("")}
      </div>
    </section>
  `;
}

function mobileWeekLessonBlock(placement) {
  const lesson = placement.lesson;
  return `
    <article class="mobile-lesson-block" style="top: ${placement.top}px; height: ${placement.height}px; left: ${placement.left}%; width: ${placement.width}%;">
      <strong>${escapeHTML(lesson.startTime)}</strong>
      <span>${escapeHTML(lesson.student || "未命名")}</span>
    </article>
  `;
}

function weekTimelineDay(date, dayLessons, metrics) {
  const isToday = isSameDay(date, todayInTaiwan());
  const placements = weekTimelinePlacements(dayLessons, metrics);
  return `
    <section class="week-day-column ${isToday ? "today" : ""}">
      <button class="week-day-header" type="button" data-date="${dateKey(date)}">
        <span>${weekdayFormatter.format(date)}</span>
        <strong>${shortDateFormatter.format(date)}</strong>
      </button>
      <div class="week-day-body">
        ${timelineHourMarkers(metrics).map((minute) => `
          <div class="week-hour-line" style="top: ${weekTimelineTop(minute, metrics)}px;"></div>
        `).join("")}
        ${placements.map((placement) => weekTimelineLessonBlock(placement)).join("")}
      </div>
    </section>
  `;
}

function weekTimelineLessonBlock(placement) {
  const lesson = placement.lesson;
  return `
    <article class="week-lesson-block" style="top: ${placement.top}px; height: ${placement.height}px; left: ${placement.left}%; width: ${placement.width}%;">
      <strong>${escapeHTML(lesson.startTime)}</strong>
      <span>${escapeHTML(lesson.student || "未命名")}</span>
    </article>
  `;
}

function weekTimelineMetrics(lessons) {
  const startMinute = Math.min(8 * 60, ...lessons.map((lesson) => timeToMinutes(lesson.startTime)).filter((minute) => minute !== null));
  const latestEnd = Math.max(
    22 * 60 + 30,
    ...lessons.map((lesson) => {
      const start = timeToMinutes(lesson.startTime);
      return start === null ? 0 : start + lessonDurationMinutes(lesson);
    })
  );
  const endMinute = Math.max(startMinute + 60, latestEnd);
  return {
    startMinute,
    endMinute,
    totalMinutes: endMinute - startMinute,
    pixelsPerMinute: 0.72,
    minimumBlockMinutes: 45
  };
}

function timelineHourMarkers(metrics) {
  const firstHour = Math.ceil(metrics.startMinute / 60);
  const lastHour = Math.floor(metrics.endMinute / 60);
  return Array.from({ length: lastHour - firstHour + 1 }, (_, index) => (firstHour + index) * 60);
}

function weekTimelineTop(minute, metrics) {
  return Math.round((minute - metrics.startMinute) * metrics.pixelsPerMinute);
}

function weekTimelinePlacements(lessons, metrics) {
  const intervals = lessons
    .map((lesson) => {
      const start = timeToMinutes(lesson.startTime);
      if (start === null) return null;
      const duration = Math.max(metrics.minimumBlockMinutes, lessonDurationMinutes(lesson));
      return {
        lesson,
        start,
        end: start + duration,
        column: 0,
        columnCount: 1
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || String(a.lesson.student).localeCompare(String(b.lesson.student), "zh-Hant"));

  const groups = [];
  let currentGroup = [];
  let currentEnd = -Infinity;
  intervals.forEach((item) => {
    if (!currentGroup.length || item.start < currentEnd) {
      currentGroup.push(item);
      currentEnd = Math.max(currentEnd, item.end);
      return;
    }
    groups.push(currentGroup);
    currentGroup = [item];
    currentEnd = item.end;
  });
  if (currentGroup.length) groups.push(currentGroup);

  groups.forEach((group) => {
    const columnEnds = [];
    group.forEach((item) => {
      let column = columnEnds.findIndex((end) => end <= item.start);
      if (column === -1) {
        column = columnEnds.length;
        columnEnds.push(item.end);
      } else {
        columnEnds[column] = item.end;
      }
      item.column = column;
    });
    const columnCount = Math.max(1, columnEnds.length);
    group.forEach((item) => {
      item.columnCount = columnCount;
    });
  });

  return intervals.map((item) => {
    const gutter = 2;
    const width = 100 / item.columnCount;
    return {
      lesson: item.lesson,
      top: weekTimelineTop(item.start, metrics),
      height: Math.max(32, Math.round((item.end - item.start) * metrics.pixelsPerMinute)),
      left: item.column * width + gutter / 2,
      width: width - gutter
    };
  });
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

function lessonDurationMinutes(lesson) {
  return Math.max(30, Math.round(numeric(lesson.hours) * 60));
}

function monthDayCell(date, monthStart) {
  const lessons = state.lessons.filter((lesson) => isSameDay(lesson.dateObject, date)).sort(compareLessons);
  const isOutside = date.getMonth() !== monthStart.getMonth();
  const isToday = isSameDay(date, todayInTaiwan());
  const firstLesson = lessons[0];
  const visibleLessons = lessons.slice(0, 3);
  return `
    <button class="calendar-day ${isOutside ? "outside" : ""} ${isToday ? "today" : ""}" type="button" data-date="${dateKey(date)}">
      <span>${date.getDate()}</span>
      ${lessons.length ? `<strong>${lessons.length}</strong>` : ""}
      ${firstLesson ? `<small>${escapeHTML(firstLesson.startTime)} ${escapeHTML(firstLesson.student)}</small>` : ""}
      ${lessons.length ? `<div class="calendar-dots">${visibleLessons.map((lesson) => `<i title="${escapeHTML(lesson.student)}"></i>`).join("")}</div>` : ""}
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
    const file = files.find((candidate) => /CourseAssistantDatabase.*\.json$/i.test(candidate.name)) || files[0];
    const parsed = JSON.parse(await file.text());
    validateDatabase(parsed);
    localStorage.setItem(CACHE_KEYS.Database, JSON.stringify(parsed));
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
