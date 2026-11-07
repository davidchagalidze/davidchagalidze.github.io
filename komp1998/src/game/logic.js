// Чистая игровая логика «Компьютерщик'98» v3. Никакого DOM — всё тестируется в Node.
//
// Каркас (§2 дизайн-документа):
//   ДЕНЬ  : работа | заказ | курс | отдых  — ровно одно (daySlotUsed)
//   ВЕЧЕР : учёба | библиотека | взлом | развлечение — необязательно (eveningUsed)
//   НОЧЬ  : день+1, деградация ресурсов, еда, аренда/налог, болезнь, обморок, долг.

import {
  SAVE_VERSION, TOTAL_DAYS, START_YEAR, MONTHS_RU, MONTHS_NOM_RU, WEEKDAYS_RU,
  BALANCE, SLOTS, PARTS, OSES, SOFTWARE, JOBS, COURSES, CONTRACTS, REST_OPTIONS,
  EVENING_RESTS,
  BBS_OFFERS, ANTIVIRUSES, HACK_TARGETS, VIRUS_NAMES, WAGE_BY_TIER,
  SKILLS, SKILL_BRANCHES, SERVERS, LUXURY, MAX_GEN, GEN_RELEASE,
  contractDensity, eveningRestGain, generatedContract, eveningRestById,
  partById, partsOfSlot, osById, softwareById, jobById, courseById, restById,
  contractById, bbsOfferById, antivirusById, cpuNameForTier, osNamesFor,
  serverById, luxuryById, genName, mapTiersToGens,
} from './data.js';

export const SAVE_KEY = 'komp1998.save';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round1 = (n) => Math.round(n * 100) / 100;

// Детерминированный ГПСЧ (mulberry32): нужен, чтобы прогоны ботов и тесты
// с вирусами/взломами/заказами были воспроизводимы.
export function makeRng(seed = 1) {
  let a = (Number(seed) || 1) >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const defaultRng = () => Math.random();

// ---------------------------------------------------------------------------
// Даты
// ---------------------------------------------------------------------------

export function dateOf(day) {
  const safeDay = Math.max(1, Math.floor(day || 1));
  const d = new Date(Date.UTC(START_YEAR, 0, 1));
  d.setUTCDate(d.getUTCDate() + (safeDay - 1));
  return {
    day: safeDay,
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    monthDay: d.getUTCDate(),
    weekday: WEEKDAYS_RU[(d.getUTCDay() + 6) % 7],
  };
}

export function formatDateRu(day) {
  const d = dateOf(day);
  return `${d.monthDay} ${MONTHS_RU[d.month - 1]} ${d.year}`;
}

export function formatDateShortRu(day) {
  const d = dateOf(day);
  return `${d.monthDay}.${String(d.month).padStart(2, '0')}.${d.year}`;
}

// Индекс месяца от начала игры: 0 — январь 1998.
export function monthIndexOf(day) {
  const d = dateOf(day);
  return (d.year - START_YEAR) * 12 + (d.month - 1);
}

// ---------------------------------------------------------------------------
// Создание состояния
// ---------------------------------------------------------------------------

function emptyLogEntry() {
  return {
    day: 1,
    kind: 'info',
    text: `1 января 1998 года. Комната, кровать, стол и $${BALANCE.startCash} в кармане. `
      + 'Компьютера нет, работы нет, знаний — ноль. День теперь один, вечер — второй: '
      + 'выбирайте, чем занять оба.',
  };
}

// ---------------------------------------------------------------------------
// v3.6: блок рэкета. Один объект, все поля — числа/флаги; нормализация ниже
// принимает и сейв v6, и старый v5, где блока ещё не было.
// ---------------------------------------------------------------------------

function emptyRacket() {
  return {
    started: false,
    pending: null,
    nextVisitDay: null,
    appetite: BALANCE.racket.appetiteStart,
    arrears: 0,
    incomeSinceVisit: 0,
    incomeMonth: 0,
    visits: 0,
    decisions: 0,
    hangDays: 0,
    payments: 0,
    refusals: 0,
    repelled: 0,
    backoffs: 0,
    raids: 0,
    moves: 0,
    layLows: 0,
    paidTotal: 0,
    takenTotal: 0,
    protection: 0,
    police: 0,
    krysha: { active: false, since: null, points: 0, lastPointDay: null },
    kryshaEver: false,
    kryshaBanned: false,
    layLowUntil: 0,
    history: [],
  };
}

function normalizeRacket(raw) {
  const base = emptyRacket();
  if (!raw || typeof raw !== 'object') return base;
  const r = { ...base, ...raw };
  const int = (v, min, max) => clamp(Math.floor(num(v, min)), min, max);
  r.started = Boolean(raw.started);
  r.appetite = clamp(num(raw.appetite, base.appetite), BALANCE.racket.appetiteStart, BALANCE.racket.appetiteCap);
  r.arrears = Math.max(0, num(raw.arrears, 0));
  r.incomeSinceVisit = Math.max(0, num(raw.incomeSinceVisit, 0));
  r.incomeMonth = Math.max(0, num(raw.incomeMonth, 0));
  for (const key of ['visits', 'decisions', 'hangDays', 'payments', 'refusals', 'repelled',
    'backoffs', 'raids', 'moves', 'layLows']) {
    r[key] = int(raw[key], 0, 100000);
  }
  r.paidTotal = Math.max(0, num(raw.paidTotal, 0));
  r.takenTotal = Math.max(0, num(raw.takenTotal, 0));
  r.protection = raw.protection ? 1 : 0;
  r.police = clamp(num(raw.police, 0), 0, BALANCE.racket.policeMax);
  const k = (raw.krysha && typeof raw.krysha === 'object') ? raw.krysha : {};
  r.krysha = {
    active: Boolean(k.active),
    since: Number.isFinite(Number(k.since)) ? Math.max(1, Math.floor(Number(k.since))) : null,
    points: clamp(Math.floor(num(k.points, 0)), 0, BALANCE.racket.kryshaMaxPoints),
    lastPointDay: Number.isFinite(Number(k.lastPointDay)) ? Math.floor(Number(k.lastPointDay)) : null,
  };
  r.kryshaEver = Boolean(raw.kryshaEver);
  r.kryshaBanned = Boolean(raw.kryshaBanned);
  r.layLowUntil = Math.max(0, Math.floor(num(raw.layLowUntil, 0)));
  const p = raw.pending;
  r.pending = (p && typeof p === 'object' && p.kind && num(p.amount, 0) >= 0)
    ? {
      kind: ['first', 'demand', 'competitor'].includes(p.kind) ? p.kind : 'demand',
      amount: Math.max(0, Math.round(num(p.amount, 0))),
      base: Math.max(0, Math.round(num(p.base, 0))),
      sinceDay: Math.max(1, Math.floor(num(p.sinceDay, 1))),
      dueDay: Math.max(1, Math.floor(num(p.dueDay, 1))),
      appetite: clamp(num(p.appetite, r.appetite), BALANCE.racket.appetiteStart, BALANCE.racket.appetiteCap),
    }
    : null;
  r.nextVisitDay = Number.isFinite(Number(raw.nextVisitDay)) && raw.nextVisitDay !== null
    ? Math.max(1, Math.floor(Number(raw.nextVisitDay)))
    : null;
  r.history = Array.isArray(raw.history)
    ? raw.history.filter((h) => h && typeof h === 'object').slice(-50)
    : [];
  return r;
}

export function createInitialState() {
  return {
    version: SAVE_VERSION,
    day: 1,
    cash: BALANCE.startCash,
    knowledge: 0,
    mood: BALANCE.startMood,
    energy: BALANCE.startEnergy,
    // --- слоты (§2) ---
    daySlotUsed: false,
    daySlotKind: null,
    eveningUsed: false,
    lastSickDay: -99,
    // --- ресурсы (§3) ---
    rep: 0,
    heat: 0,
    // --- работа и железо ---
    jobId: null,
    jobStartDay: null,
    hardware: { cpu: null, ram: null, hdd: null, gpu: null, modem: null },
    os: null,
    software: {},
    office: false,
    // --- курсы ---
    courses: {},            // id -> сколько раз пройден
    courseProgress: null,   // { id, remaining, knowledge, price, repeats }
    libraryLastDay: -999,
    // --- заказы (§8) ---
    contractsDone: {},
    contractOffers: [],
    contract: null,
    // --- деньги и обязательства ---
    stain: false,
    monthIncome: 0,
    monthLabel: MONTHS_NOM_RU[0],
    phoneMinutes: 0,
    monthPhoneCost: 0,
    debtWarned: false,
    debtDeadline: null,
    pendingReceipt: null,
    // --- вирусы, антивирус, BBS, взломы ---
    infected: false,
    virus: null,
    systemDown: false,
    antivirus: null,
    bbsDownloads: 0,
    hacks: 0,
    lastHackDay: 0,
    proxies: 0,
    // --- v3.5: навыки, сервер, роскошь (DESIGN-v35 §7.2) ---
    skills: { hw: 0, code: 0, net: 0, crime: 0 },
    skillProgress: null,   // { branch, remaining, level, money, knowledge }
    server: { owned: {}, lastMaintDay: 0, pirate: false, offlineUntil: 0 },
    luxury: { car: false, garage: false, flat: false, dacha: false, yacht: false, plane: false },
    // --- v3.6: «Рэкет» (DESIGN-racket §6.1) ---------------------------------
    racket: emptyRacket(),
    books: {
      incomeWork: 0, incomeContract: 0, incomeHack: 0, incomeServer: 0, incomeResale: 0,
      spendGear: 0, spendOs: 0, spendCourse: 0, spendFood: 0, spendRent: 0, spendTax: 0,
      spendOffice: 0, spendRest: 0, spendSkill: 0, spendServer: 0, spendLuxury: 0,
      spendSick: 0, spendCollapse: 0, spendArrest: 0, spendRepair: 0,
      spendRacket: 0, spendProtection: 0, incomeKrysha: 0,
      knowledgeGained: 0, knowledgeSpent: 0, knowledgeForgotten: 0,
      incomeTopTier: 0, spendGearTopTier: 0,
    },
    // Окно после загрузки старого сейва: возраст ПК не штрафует, пока игрок
    // не увидит, что игра изменилась (§7.4).
    ageGraceUntilDay: 0,
    result: null,
    lostDays: 0,
    lostReason: null,
    log: [emptyLogEntry()],
    stats: {
      totalEarned: 0,
      totalSpent: 0,
      workDays: 0,
      studyDays: 0,
      restDays: 0,
      contractDays: 0,
      contractsDone: 0,
      contractsFailed: 0,
      sickDays: 0,
      collapseDays: 0,
      libraryVisits: 0,
      daysWorked: 0,      // старый ключ v2 — оставлен для совместимости
      actions: 0,
      hacks: 0,
      virusesCaught: 0,
      virusesCured: 0,
      bbsDownloads: 0,
      debtWarnings: 0,
      skillDays: 0,
      maintDays: 0,
      serverAttacks: 0,
      racketDays: 0,
      policeArrests: 0,
    },
  };
}

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Приводит загруженный объект к актуальной форме; мусорные значения заменяет.
// Миграция v1/v2/v3 → v4 по §10.2: знания ×2.2, репутация/след с нуля,
// software — объект, courses — счётчик. Старый сейв игрока не должен падать.
export function normalizeState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = createInitialState();
  const sourceVersion = num(raw.version, 1);
  const state = {
    ...base,
    ...raw,
    hardware: { ...base.hardware, ...(raw.hardware || {}) },
    stats: { ...base.stats, ...(raw.stats || {}) },
  };

  // --- миграция до нормализации полей ---
  if (sourceVersion < 4) {
    const oldSoftware = Array.isArray(raw.software) ? raw.software : [];
    const oldCourses = Array.isArray(raw.courses) ? raw.courses : [];
    const oldRepeats = (raw.courseRepeats && typeof raw.courseRepeats === 'object') ? raw.courseRepeats : {};
    const counters = {};
    for (const id of oldCourses) if (courseById(id)) counters[id] = Math.max(1, counters[id] || 0);
    for (const id of Object.keys(oldRepeats)) {
      const n = Math.floor(num(oldRepeats[id], 0));
      if (courseById(id) && n > 0) counters[id] = Math.max(counters[id] || 0, n);
    }
    state.software = Object.fromEntries(oldSoftware.filter((id) => softwareById(id)).map((id) => [id, true]));
    state.courses = counters;
    state.courseProgress = null;
    state.knowledge = Math.round(num(raw.knowledge, 0) * BALANCE.migrateKnowledgeMult);
    state.rep = 0;
    state.heat = 0;
    state.contractsDone = {};
    state.contractOffers = [];
    state.contract = null;
    state.daySlotUsed = false;
    state.daySlotKind = null;
    state.eveningUsed = false;
    state.office = false;
    state.stats.sickDays = 0;
    state.stats.collapseDays = 0;
    state.stats.contractDays = 0;
    state.stats.contractsDone = 0;
    state.stats.contractsFailed = 0;
    state.lastSickDay = -99;
  }

  state.version = SAVE_VERSION;
  // --- миграция v4 → v5 (DESIGN-v35 §7.4) ---
  // Новые поля — дефолты, работы/заказы/деньги сохраняются как есть.
  // Железо пересобираем: лестница v4 (22 детали) заменена поколенческой, id
  // другие. §7.4: тир → поколение, замена подбирается по мощности, чтобы сейв
  // не терял ни мощность, ни доступ к работе.
  if (sourceVersion < 5) {
    state.hardware = mapTiersToGens(state.hardware);
    state.skills = { ...createInitialState().skills, ...(raw.skills || {}) };
    state.server = {
      owned: { ...((raw.server && raw.server.owned) || {}) },
      lastMaintDay: Math.max(0, Math.floor(num(raw.server && raw.server.lastMaintDay, state.day))),
      pirate: Boolean(raw.server && raw.server.pirate),
    };
    state.luxury = { ...createInitialState().luxury, ...(raw.luxury || {}) };
    state.books = { ...createInitialState().books, ...(raw.books || {}) };
    state.skillProgress = null;
    // Окно 30 дней: старый сейв не теряет 45% дохода в первый же день.
    state.ageGraceUntilDay = state.day + BALANCE.ageGraceDays;
  }
  state.day = clamp(Math.floor(num(state.day, 1)), 1, TOTAL_DAYS + 1);
  state.cash = round1(num(state.cash, BALANCE.startCash));
  state.knowledge = clamp(num(state.knowledge, 0), 0, BALANCE.maxKnowledge);
  state.mood = clamp(num(state.mood, BALANCE.startMood), 0, BALANCE.maxMood);
  state.energy = clamp(num(state.energy, BALANCE.startEnergy), 0, BALANCE.maxEnergy);
  state.rep = clamp(num(state.rep, 0), 0, 100);
  state.heat = clamp(num(state.heat, 0), 0, BALANCE.heatLimit);
  state.monthIncome = Math.max(0, num(state.monthIncome, 0));
  state.phoneMinutes = Math.max(0, num(state.phoneMinutes, 0));
  state.monthPhoneCost = Math.max(0, num(state.monthPhoneCost, 0));
  state.daySlotUsed = Boolean(state.daySlotUsed);
  state.daySlotKind = ['work', 'contract', 'course', 'rest', 'quit', 'skill', 'maint', 'repair'].includes(state.daySlotKind)
    ? state.daySlotKind
    : (state.daySlotUsed ? 'work' : null);
  state.eveningUsed = Boolean(state.eveningUsed);
  state.lastSickDay = Math.floor(num(state.lastSickDay, -99));
  state.libraryLastDay = Math.floor(num(state.libraryLastDay, -999));
  state.office = Boolean(state.office);
  state.stain = Boolean(state.stain);
  state.debtWarned = Boolean(state.debtWarned);
  state.debtDeadline = Number.isFinite(Number(state.debtDeadline)) && state.debtDeadline !== null
    ? Math.max(1, Math.floor(Number(state.debtDeadline)))
    : null;
  state.infected = Boolean(state.infected);
  state.systemDown = Boolean(state.systemDown);
  state.bbsDownloads = Math.max(0, Math.floor(num(state.bbsDownloads, 0)));
  state.hacks = Math.max(0, Math.floor(num(state.hacks, 0)));
  state.lastHackDay = Math.max(0, Math.floor(num(state.lastHackDay, 0)));
  state.proxies = Math.max(0, Math.floor(num(state.proxies, 0)));
  // v3.5: навыки, сервер, роскошь, книги доходов/расходов.
  state.skills = {
    hw: clamp(Math.floor(num(state.skills && state.skills.hw, 0)), 0, BALANCE.skillMaxLevel),
    code: clamp(Math.floor(num(state.skills && state.skills.code, 0)), 0, BALANCE.skillMaxLevel),
    net: clamp(Math.floor(num(state.skills && state.skills.net, 0)), 0, BALANCE.skillMaxLevel),
    crime: clamp(Math.floor(num(state.skills && state.skills.crime, 0)), 0, BALANCE.skillMaxLevel),
  };
  const ownedRaw = (state.server && state.server.owned) || {};
  state.server = {
    owned: Object.fromEntries(SERVERS.filter((s) => ownedRaw[s.id]).map((s) => [s.id, true])),
    lastMaintDay: Math.max(0, Math.floor(num(state.server && state.server.lastMaintDay, 0))),
    pirate: Boolean(state.server && state.server.pirate),
    offlineUntil: Math.max(0, Math.floor(num(state.server && state.server.offlineUntil, 0))),
  };
  state.luxury = Object.fromEntries(LUXURY.map((l) => [l.id, Boolean(state.luxury && state.luxury[l.id])]));
  state.books = { ...createInitialState().books, ...((state.books && typeof state.books === 'object') ? state.books : {}) };
  // v5 → v6 (DESIGN-racket §6.5): добавляется только блок рэкета. Железо,
  // сервер, навыки, роскошь, деньги и заказы остаются как были — старый сейв
  // ничего не теряет. Нормализатор принимает и сейв без блока, поэтому
  // отдельная ветка sourceVersion < 6 не нужна: поля добираются из defaults.
  state.racket = normalizeRacket(state.racket);
  state.lostDays = Math.max(0, Math.floor(num(state.lostDays, 0)));
  state.lostReason = typeof state.lostReason === 'string' ? state.lostReason : null;
  for (const key of Object.keys(state.books)) {
    state.books[key] = num(state.books[key], 0);
  }
  const sp = state.skillProgress;
  if (sp && SKILLS[sp.branch] && num(sp.remaining, 0) > 0) {
    state.skillProgress = {
      branch: sp.branch,
      remaining: Math.max(1, Math.floor(num(sp.remaining, 1))),
      level: Math.max(1, Math.min(BALANCE.skillMaxLevel, Math.floor(num(sp.level, 1)))),
    };
  } else {
    state.skillProgress = null;
  }
  state.ageGraceUntilDay = Math.max(0, Math.floor(num(state.ageGraceUntilDay, 0)));
  state.pendingReceipt = state.pendingReceipt && typeof state.pendingReceipt === 'object'
    ? state.pendingReceipt
    : null;
  state.result = state.result && typeof state.result === 'object' ? state.result : null;
  state.log = Array.isArray(state.log) ? state.log.slice(-BALANCE.logLimit) : [];

  // software: v4 — объект {id:true}; на всякий случай принимаем и массив.
  if (Array.isArray(state.software)) {
    state.software = Object.fromEntries(state.software.filter((id) => softwareById(id)).map((id) => [id, true]));
  } else {
    const sw = {};
    for (const id of Object.keys(state.software || {})) if (softwareById(id) && state.software[id]) sw[id] = true;
    state.software = sw;
  }

  // courses: счётчик повторов, мусор выбрасываем.
  const counters = {};
  const rawCounters = (state.courses && typeof state.courses === 'object' && !Array.isArray(state.courses))
    ? state.courses
    : {};
  for (const id of Object.keys(rawCounters)) {
    if (!courseById(id)) continue;
    const count = Math.floor(num(rawCounters[id], 0));
    if (count > 0) counters[id] = count;
  }
  state.courses = counters;

  // Незаконченный курс переживает сохранение только если он ещё существует.
  const cp = state.courseProgress;
  if (cp && courseById(cp.id) && num(cp.remaining, 0) > 0) {
    state.courseProgress = {
      id: cp.id,
      remaining: Math.max(1, Math.floor(num(cp.remaining, 1))),
      knowledge: Math.max(1, Math.round(num(cp.knowledge, 1))),
      price: Math.max(0, Math.round(num(cp.price, 0))),
      repeats: Math.max(0, Math.floor(num(cp.repeats, 0))),
    };
  } else {
    state.courseProgress = null;
  }

  // Заказы на доске — только валидные сгенерированные записи.
  state.contractOffers = Array.isArray(state.contractOffers)
    ? state.contractOffers.filter((c) => c && c.id && c.days > 0 && c.pay > 0).slice(-8)
    : [];
  state.contractsDone = (state.contractsDone && typeof state.contractsDone === 'object') ? state.contractsDone : {};
  const active = state.contract;
  state.contract = active && typeof active === 'object' && active.id && active.leftDays > 0
    ? {
      ...active,
      leftDays: Math.max(0, Math.floor(num(active.leftDays, 0))),
      deadline: Math.max(1, Math.floor(num(active.deadline, state.day + 1))),
    }
    : null;

  // Вирус живёт только вместе с флагом заражения.
  if (!state.infected) {
    state.virus = null;
    state.systemDown = false;
  } else {
    state.virus = state.virus && typeof state.virus === 'object'
      ? state.virus
      : { name: 'Неизвестный вирус', stolen: 0, wiped: [], powerPenalty: BALANCE.virusPowerPenalty };
  }

  const av = state.antivirus
    ? antivirusById(state.antivirus.id || state.antivirus.level)
    : null;
  state.antivirus = av
    ? { id: av.id, updatedDay: Math.max(1, Math.floor(num(state.antivirus.updatedDay, state.day))) }
    : null;

  // Несуществующие id железа/ОС/работы выбрасываем, чтобы не ловить NaN в UI.
  for (const slot of SLOTS) {
    const id = state.hardware[slot.id];
    const part = id ? partById(id) : null;
    state.hardware[slot.id] = part && part.slot === slot.id ? part.id : null;
  }
  state.os = osById(state.os) ? state.os : null;
  state.jobId = jobById(state.jobId) ? state.jobId : null;
  if (!state.jobId) {
    // Работа, где игрок уже сидит, считается доступной (§10.2).
    if (sourceVersion < 4 && num(raw.jobId, 0)) state.jobId = 'janitor';
    state.jobStartDay = state.jobId ? state.day : null;
  } else if (sourceVersion < 2 || !Number.isFinite(Number(state.jobStartDay))) {
    state.jobStartDay = state.day - BALANCE.probationDays;
  } else {
    state.jobStartDay = Math.max(1, Math.floor(num(state.jobStartDay, 1)));
  }

  return state;
}

export function serialize(state) {
  return JSON.stringify(state);
}

// Сейвы версий 1..SAVE_VERSION принимаются, всё остальное — мимо.
export function deserialize(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  try {
    const parsed = JSON.parse(rawText);
    if (!parsed || typeof parsed !== 'object') return null;
    const version = num(parsed.version, 0);
    if (version < 1 || version > SAVE_VERSION) return null;
    return normalizeState(parsed);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Железо, мощность, совместимость
// ---------------------------------------------------------------------------

// --- v3.5: техно-гонка (§2.1) ----------------------------------------------

// Сколько поколений уже вышло к этому дню. Поколение приходит по календарю,
// а не по деньгам: раньше срока его не купить ни за какие деньги.
export function genAtDay(day) {
  const d = Math.max(1, Math.floor(num(day, 1)));
  return Math.max(1, Math.min(MAX_GEN, 1 + Math.floor((d - 1) / BALANCE.genStep)));
}

export function currentGen(state) {
  return genAtDay(state.day);
}

// Поколение ПК = поколение самой старой детали: машина настолько современна,
// насколько современна её слабая часть (обычно модем).
export function pcGen(state) {
  let gen = null;
  for (const slot of SLOTS) {
    const part = partById(state.hardware[slot.id]);
    if (!part) continue;
    gen = gen === null ? part.gen : Math.min(gen, part.gen);
  }
  return gen === null ? 0 : gen;
}

export function pcAge(state) {
  const gen = pcGen(state);
  if (!gen) return 0;
  return Math.max(0, currentGen(state) - gen);
}

// Штраф за устаревший ПК: −15% за поколение сверх допуска, пол 55%.
// Игра из-за железа не заканчивается: должность не сбрасывается, платят меньше.
export function agingMult(state, job = jobById(state.jobId)) {
  const allowed = job && job.req ? job.req.age : undefined;
  if (allowed === undefined) return 1;
  if (state.ageGraceUntilDay && state.day <= state.ageGraceUntilDay) return 1;
  const over = pcAge(state) - allowed;
  if (over <= 0) return 1;
  return Math.max(BALANCE.agingPenaltyFloor, 1 - BALANCE.agingPenaltyPerGen * over);
}

export function agingNote(state, job = jobById(state.jobId)) {
  const allowed = job && job.req ? job.req.age : undefined;
  if (allowed === undefined) return null;
  const mult = agingMult(state, job);
  if (mult >= 1) return null;
  return `ПК на ${pcAge(state) - allowed} поколения старше нормы: −${Math.round((1 - mult) * 100)}% к оплате`;
}

export function genSetStats(gen) {
  const parts = PARTS.filter((p) => p.gen === gen);
  return {
    gen,
    releaseDay: GEN_RELEASE(gen),
    price: parts.reduce((sum, p) => sum + p.price, 0),
    power: parts.reduce((sum, p) => sum + p.power, 0),
    parts,
  };
}

// --- v3.5: дерево навыков (§2.3) -------------------------------------------

export function skillLevel(state, branch) {
  return state.skills ? (state.skills[branch] || 0) : 0;
}

export function skillTotal(state) {
  return SKILL_BRANCHES.reduce((sum, b) => sum + skillLevel(state, b), 0);
}

// Уровень стоит знания + деньги + дни. Никаких гейтов.
export function skillCost(state, branch) {
  if (!SKILLS[branch]) return null;
  const level = skillLevel(state, branch);
  if (level >= BALANCE.skillMaxLevel) return null;
  return {
    branch,
    level: level + 1,
    name: SKILLS[branch].levels[level].name,
    desc: SKILLS[branch].levels[level].desc,
    knowledge: BALANCE.skillKnowCost[level],
    money: BALANCE.skillMoneyCost[level],
    days: BALANCE.skillDaysCost[level],
  };
}

export function canLearn(state, branch) {
  const cost = skillCost(state, branch);
  if (!cost) return ['ветка прокачана'];
  const reasons = [];
  if (state.result) reasons.push('игра окончена');
  if (state.skillProgress) reasons.push('уже идёт обучение');
  if (state.contract) reasons.push('взят заказ — срок идёт');
  if (state.daySlotUsed) reasons.push('день уже занят');
  if (state.knowledge < cost.knowledge) {
    reasons.push(`нужно знаний ${cost.knowledge}, у вас ${Math.floor(state.knowledge)}`);
  }
  if (state.cash < cost.money) {
    reasons.push(`нужно $${cost.money}, у вас ${fmtMoney(state.cash)}`);
  }
  if (state.energy < BALANCE.skillEnergy) {
    reasons.push(`нужно энергии ${BALANCE.skillEnergy}, осталось ${Math.floor(state.energy)}`);
  }
  return reasons;
}

// --- v3.5: сервер (§2.2) ---------------------------------------------------

export const serverOwned = (state, id) => Boolean(state.server && state.server.owned && state.server.owned[id]);

export function serverTier(state) {
  return SERVERS.filter((s) => serverOwned(state, s.id)).length;
}

export function serverGross(state) {
  if (!state.server || !state.server.owned) return 0;
  // v3.6: наезд рэкета выключает сервер на 10/21 день (§2.2).
  if (state.server.offlineUntil && state.day <= state.server.offlineUntil) return 0;
  let gross = 0;
  for (const s of SERVERS) if (serverOwned(state, s.id)) gross += s.income;
  if (gross === 0) return 0;
  gross *= 1 + BALANCE.serverKnowledgeBonus * (state.knowledge / BALANCE.maxKnowledge);
  if (skillLevel(state, 'net') >= 3) gross *= 1.15;
  if (state.server.pirate) gross *= 1 + BALANCE.serverPirateBonus;
  if (serverOverdue(state)) gross *= BALANCE.serverMaintPenalty;
  return Math.round(gross);
}

export function serverUpkeep(state) {
  if (!state.server || !state.server.owned) return 0;
  let upkeep = 0;
  for (const s of SERVERS) if (serverOwned(state, s.id)) upkeep += s.upkeep;
  if (skillLevel(state, 'net') >= 4) upkeep *= 0.8;
  return Math.round(upkeep);
}

export function serverRiskMult(state) {
  if (!state.server || !state.server.owned) return 1;
  let mult = 1;
  for (const s of SERVERS) if (serverOwned(state, s.id)) mult *= s.riskMult;
  if (skillLevel(state, 'net') >= 1) mult *= 0.75;
  return mult;
}

// Просрочено обслуживание: доход вдвое ниже, пока не почистишь.
export function serverOverdue(state) {
  if (!state.server || !serverOwned(state, 's1')) return false;
  return state.day - Math.max(0, num(state.server.lastMaintDay, 0)) > BALANCE.serverMaintDueDays;
}

export function serverMaintDueIn(state) {
  if (!serverOwned(state, 's1')) return null;
  const last = Math.max(0, num(state.server.lastMaintDay, 0));
  return Math.max(0, BALANCE.serverMaintDueDays - (state.day - last));
}

// --- v3.5: роскошь (§2.4) --------------------------------------------------

export const hasLuxury = (state, id) => Boolean(state.luxury && state.luxury[id]);

export function luxuryPoints(state) {
  return LUXURY.reduce((sum, l) => sum + (hasLuxury(state, l.id) ? l.points : 0), 0);
}

export function luxuryUpkeep(state) {
  return LUXURY.reduce((sum, l) => sum + (hasLuxury(state, l.id) ? l.upkeep : 0), 0);
}

export const hasEliteClients = (state) => hasLuxury(state, 'yacht') || hasLuxury(state, 'plane');

export function luxuryPrice(state, id) {
  const item = luxuryById(id);
  return item ? item.price : 0;
}

export function machineSpecs(state) {
  const specs = {};
  for (const slot of SLOTS) {
    const part = partById(state.hardware[slot.id]);
    specs[slot.id] = part ? part.spec : 0;
  }
  return specs;
}

// Мощность части с учётом ограничения по характеристике (для «урезания» под ОС).
export function powerAtSpec(slot, spec) {
  if (!spec) return 0;
  let best = 0;
  for (const part of partsOfSlot(slot)) {
    if (part.spec <= spec && part.power > best) best = part.power;
  }
  return best;
}

export function osCaps(state) {
  const os = osById(state.os);
  return os ? os.caps : null;
}

// Мощность слота: без ОС компьютер не работает, поэтому 0 (правило №6).
export function powerOfSlot(state, slot) {
  const caps = osCaps(state);
  if (!caps) return 0;
  const part = partById(state.hardware[slot]);
  if (!part) return 0;
  const usable = Math.min(part.spec, caps[slot] || 0);
  return powerAtSpec(slot, usable);
}

// Вирус режет мощность: железо то же, а работает как будто слабее.
export function virusPowerPenalty(state) {
  return state && state.infected ? BALANCE.virusPowerPenalty : 0;
}

export function totalPower(state) {
  const raw = SLOTS.reduce((sum, slot) => sum + powerOfSlot(state, slot.id), 0);
  let extra = 0;
  if (skillLevel(state, 'hw') >= 2) extra += 1;      // «Разгон»
  if (hasLuxury(state, 'garage')) extra += 1;        // гараж
  return Math.max(0, raw + extra - virusPowerPenalty(state));
}

export function hasWorkingPC(state) {
  return Boolean(state.hardware.cpu && state.hardware.ram && state.hardware.hdd && state.os);
}

// ---------------------------------------------------------------------------
// v3.6: «Рэкет» — угроза 90-х поверх v3.5 (DESIGN-racket.md)
//
// Система аддитивная: при `enabled: false` ни одна функция ниже не меняет
// состояние, поэтому выключенный рэкет — ровно v3.5. Все числа — в
// BALANCE.racket; здесь только формулы §6.3.
// ---------------------------------------------------------------------------

const RACKET = () => BALANCE.racket;

export const racketOn = () => BALANCE.racket.enabled !== false;

// Для тестов и ботов: v3.5-прогоны обязаны идти с выключенным рэкетом.
export function setRacketEnabled(on) {
  BALANCE.racket.enabled = Boolean(on);
}

// Доход на счёт. Сервер растит известность, но не входит в счёт (§1.5):
// иначе он облагался бы дважды — процентом и наездом.
export function trackIncome(state, amount, kind = 'other') {
  if (!racketOn() || !state.racket || !(amount > 0)) return;
  state.racket.incomeMonth += amount;
  if (kind === 'server') return;
  state.racket.incomeSinceVisit += amount;
}

// Давление милиции: 0 при внимании ≤ policeSafe, 1 при 100. Режет заказы,
// а не доход напрямую (§4.2).
export function policePressure(state) {
  if (!racketOn() || !state.racket) return 0;
  const r = RACKET();
  return clamp((state.racket.police - r.policeSafe) / (r.policeMax - r.policeSafe), 0, 1);
}

// Известность 0…3: доход, роскошь и репутация делают визиты чаще (§1.3).
export function racketFame(state) {
  if (!state.racket) return 0;
  const r = RACKET();
  let fame = 0;
  for (let i = 0; i < r.fameIncome.length; i += 1) {
    if (state.racket.incomeMonth >= r.fameIncome[i]) fame = i;
  }
  if (luxuryPoints(state) >= r.fameLuxPoints) fame += 1;
  if (state.rep >= r.fameRep) fame += 1;
  if (state.racket.krysha.active) fame = Math.max(fame, 2);
  return clamp(fame, 0, 3);
}

function racketCooldownDays(state, rng = defaultRng) {
  const [lo, hi] = RACKET().fameWeeks[racketFame(state)];
  return Math.round((lo + rng() * (hi - lo)) * 7);
}

// Счёт = процент аппетита от всего, что пришло с прошлого визита, плюс долг.
export function racketDemand(state) {
  const rk = state.racket;
  if (!rk) return 0;
  const r = RACKET();
  return Math.max(r.payMin, Math.round((rk.incomeSinceVisit * rk.appetite) / 100) + rk.arrears);
}

// Шанс отпора (§2.3). Защита и «своя крыша» помогают, аппетит и прошлые
// отказы — давят.
export function racketFightChance(state) {
  const rk = state.racket;
  const r = RACKET();
  if (!rk) return 0;
  const rep = Math.min(r.fightRepCap, state.rep);
  const p = r.fightBase + r.fightRep * rep + r.fightPower * totalPower(state)
    + r.fightProtection * (rk.protection ? 1 : 0) + (rk.krysha.active ? r.fightKrysha : 0)
    - r.fightAppetite * rk.appetite
    - r.escalatePenalty * Math.floor(rk.refusals / r.escalateEvery);
  return clamp(p, 0.05, 0.92);
}

export function canBecomeKrysha(state) {
  if (!racketOn() || !state.racket) return false;
  const rk = state.racket;
  const r = RACKET();
  return !rk.krysha.active && !rk.kryshaBanned
    && state.day >= r.kryshaDay
    && state.rep >= r.kryshaRep
    && skillLevel(state, 'crime') >= r.kryshaCrime
    && (state.hacks || 0) >= r.kryshaHacks
    && state.cash >= r.kryshaSetup;
}

export function firstRacketVisitDue(state) {
  if (!racketOn() || !state.racket) return false;
  const rk = state.racket;
  const r = RACKET();
  return !rk.started && state.day >= r.firstDayMin
    && state.rep >= r.firstRep && rk.incomeMonth >= r.firstMonthIncome;
}

// Самое дорогое железо уходит «в счёт долга»: забирают верхнюю планку слота.
function seizePart(state) {
  let best = null;
  for (const slot of SLOTS) {
    const tier = state.hardware[slot.id];
    const part = partById(tier);
    if (!part) continue;
    const price = gearPrice(state, part);
    if (!best || price > best.price) best = { slot: slot.id, part, price };
  }
  if (!best) return null;
  const lower = partsOfSlot(best.slot).filter((p) => p.power < best.part.power)
    .sort((a, b) => b.power - a.power)[0];
  state.hardware[best.slot] = lower ? lower.id : null;
  return { name: best.part.name, price: best.price };
}

function racketCardText(state, p) {
  const left = Math.max(0, p.dueDay - state.day);
  if (p.kind === 'competitor') {
    return `Заглянули соседи по цеху. «Ты теперь крыша? Вот и поделись: `
      + `$${p.amount} — наша доля со сбора». Сроку ${left} ${pluralRu(left, 'день', 'дня', 'дней')}.`;
  }
  return `В дверь позвонили двое. Один держит папку. «Ты тут компьютеры чинишь? Хорошо чинишь. `
    + `За месяц у тебя вышло $${Math.round(p.base || 0)}. `
    + `Наша доля — $${p.amount}». Сроку ${left} ${pluralRu(left, 'день', 'дня', 'дней')}.`;
}

function postRacketVisit(state, kind, rng = defaultRng) {
  const rk = state.racket;
  const r = RACKET();
  const amount = kind === 'competitor'
    ? Math.max(r.payMin, Math.round(rk.krysha.points * r.kryshaPointIncome * r.competitorShare))
    : racketDemand(state);
  const span = r.windowDays[1] - r.windowDays[0];
  const win = r.windowDays[0] + Math.floor(rng() * (span + 1));
  rk.pending = {
    kind,
    amount,
    base: Math.round(rk.incomeSinceVisit),
    sinceDay: state.day,
    dueDay: state.day + win,
    appetite: rk.appetite,
  };
  rk.visits += 1;
  rk.decisions += 1;
  rk.incomeSinceVisit = 0;
  rk.nextVisitDay = null;
  return rk.pending;
}

// Текст карточки для журнала: и в момент прихода, и после ответа.
export function racketCardTextOf(state) {
  return state.racket && state.racket.pending ? racketCardText(state, state.racket.pending) : '';
}

// Ответ на висящую карточку. choice: pay | fight | move | krysha | protect | laylow | ignore
export function resolveRacket(state, choice, { rng = defaultRng } = {}) {
  const events = [];
  if (!racketOn() || !state.racket) return events;
  const rk = state.racket;
  const r = RACKET();
  const p = rk.pending;
  if (!p) return events;
  rk.hangDays += Math.max(0, state.day - p.sinceDay);
  rk.pending = null;
  const amount = p.amount;
  rk.history.push({ day: state.day, kind: p.kind, amount, choice, appetite: rk.appetite, cash: Math.round(state.cash) });
  if (rk.history.length > 50) rk.history.shift();
  const scheduleNext = () => { rk.nextVisitDay = state.day + racketCooldownDays(state, rng); };

  // ── заплатить ────────────────────────────────────────────────────────────
  if (choice === 'pay') {
    // последнее не забирают: иначе в следующий раз платить нечем
    const paid = Math.min(Math.max(0, state.cash - r.floorCash), amount);
    state.cash -= paid;
    state.books.spendRacket = round1(state.books.spendRacket + paid);
    rk.paidTotal += paid;
    rk.payments += 1;
    let short = amount - paid;
    // железо забирают только при втором пропуске подряд: один — долг
    if (short > 0 && rk.arrears > 0) {
      const lost = seizePart(state);
      if (lost) {
        rk.takenTotal += lost.price;
        short = Math.max(0, short - lost.price);
        events.push({ type: 'racket-gear-taken', name: lost.name, value: lost.price });
      }
    }
    rk.arrears = short;
    rk.appetite = Math.min(r.appetiteCap, rk.appetite + r.appetiteStep);
    scheduleNext();
    logMsg(state, 'money', `Рэкету заплачено $${paid}${short ? `, осталось в долг $${short}` : ''}. `
      + `Аппетит вырос до ${fmtNum(rk.appetite)}%.`);
    events.push({ type: 'racket-paid', amount: paid, short, appetite: rk.appetite });
    return events;
  }

  // ── нанять защиту (карточка остаётся висеть) ─────────────────────────────
  if (choice === 'protect') {
    if (rk.protection || state.cash < r.protectionCost) return events;
    state.cash -= r.protectionCost;
    state.books.spendProtection = round1(state.books.spendProtection + r.protectionCost);
    rk.protection = 1;
    rk.pending = p;
    rk.hangDays -= Math.max(0, state.day - p.sinceDay);
    logMsg(state, 'info', `Нанята защита за $${r.protectionCost}: отпор легче на `
      + `${Math.round(r.fightProtection * 100)} п.п., наезд — на ступень слабее, `
      + `содержание $${r.protectionUpkeep}/мес.`);
    events.push({ type: 'racket-protection', cost: r.protectionCost });
    return events;
  }

  // ── отбиваться / проигнорировать ─────────────────────────────────────────
  if (choice === 'fight' || choice === 'ignore') {
    if (choice === 'ignore') {
      logMsg(state, 'bad', 'Срок вышел. Они решили, что ты их игнорируешь.');
    }
    rk.refusals += 1;
    // каждый N-й отказ — не разговор, а погром
    const sevRaw = Math.floor(rk.refusals / r.escalateEvery);
    if (rk.refusals % r.escalateEvery === 0 && sevRaw > 0) {
      let sev = Math.min(3, sevRaw);
      if (rk.protection) sev = Math.max(1, sev - 1);
      const cashHit = r.raidCash[sev - 1];
      const hit = Math.min(Math.max(0, state.cash - r.floorCash), cashHit);
      state.cash -= hit;
      state.books.spendRacket = round1(state.books.spendRacket + hit);
      rk.takenTotal += hit;
      state.lostDays = (state.lostDays || 0) + r.raidDays[sev - 1];
      state.stats.racketDays += r.raidDays[sev - 1];
      rk.raids += 1;
      let serverDown = 0;
      if (serverOwned(state, 's1') && r.raidServerDays[sev - 1] > 0) {
        serverDown = r.raidServerDays[sev - 1];
        state.server.offlineUntil = state.day + serverDown;
      }
      const text = `Наезд: из кассы забрали $${hit}${serverDown ? `, сервер разбит на ${serverDown} дней` : ''}`
        + `${r.raidDays[sev - 1] ? `, потеряно ${r.raidDays[sev - 1]} дн.` : ''}.`;
      logMsg(state, 'bad', text);
      events.push({ type: 'racket-raid', severity: sev, cash: hit, serverDown, days: r.raidDays[sev - 1] });
    }
    const chance = clamp(racketFightChance(state) - (choice === 'ignore' ? r.ignorePenalty : 0), 0.05, 0.95);
    const won = rng() < chance;
    if (won) {
      rk.repelled += 1;
      rk.appetite = Math.max(r.appetiteStart, rk.appetite - r.fightSuccessAppetite);
      state.rep = clamp(state.rep + r.fightSuccessRep, 0, 100);
      state.heat = Math.min(BALANCE.heatLimit, state.heat + r.fightSuccessHeat);
      rk.police = Math.min(r.policeMax, rk.police + r.fightSuccessPolice);
      if (rng() < r.backoffChance) {
        rk.backoffs += 1;
        const [lo, hi] = r.backoffWeeks;
        rk.nextVisitDay = state.day + Math.round((lo + rng() * (hi - lo)) * 7);
      } else {
        rk.nextVisitDay = state.day + racketCooldownDays(state, rng) + 7;
      }
      logMsg(state, 'good', `Отбился (шанс был ${Math.round(chance * 100)}%): аппетит упал до `
        + `${fmtNum(rk.appetite)}%, репутация ${Math.round(state.rep)}. `
        + `Они написали заявление — внимание милиции ${rk.police}/100.`);
      events.push({ type: 'racket-repelled', chance, appetite: rk.appetite, backoff: rk.backoffs });
    } else {
      const take = Math.max(r.fightFailMin, Math.round(amount * r.fightFailCashShare));
      const paid = Math.min(Math.max(0, state.cash - r.floorCash), take);
      state.cash -= paid;
      state.books.spendRacket = round1(state.books.spendRacket + paid);
      rk.takenTotal += paid;
      let lost = null;
      if (rng() < r.fightFailGearChance) lost = seizePart(state);
      state.mood = Math.max(0, state.mood - r.fightFailMood);
      if (rng() < r.fightFailDayChance) {
        state.lostDays = (state.lostDays || 0) + r.fightFailDays;
        state.lostReason = 'racket';
        state.stats.racketDays += r.fightFailDays;
      }
      state.heat = Math.min(BALANCE.heatLimit, state.heat + r.fightFailHeat);
      rk.police = Math.min(r.policeMax, rk.police + r.fightFailPolice);
      rk.appetite = Math.min(r.appetiteCap, rk.appetite + r.escalateAppetite);
      if (lost) rk.takenTotal += lost.price;
      scheduleNext();
      const text = `Проиграл: забрали $${paid}${lost ? `, железо «${lost.name}»` : ''}, `
        + `настроение −${r.fightFailMood}, день потерян. Аппетит ${fmtNum(rk.appetite)}%.`;
      logMsg(state, 'bad', text);
      events.push({ type: 'racket-beaten', chance, cash: paid, gear: lost ? lost.name : null, appetite: rk.appetite });
    }
    return events;
  }

  // ── лечь на дно (только когда милиция уже дышит в затылок) ───────────────
  if (choice === 'laylow') {
    if (rk.police < r.layLowFrom) return events;
    rk.pending = p;
    rk.layLowUntil = state.day + r.layLowDays;
    rk.police = Math.max(0, rk.police - r.layLowPoliceDrop);
    state.rep = Math.max(0, state.rep - r.layLowRep);
    state.mood = Math.max(0, state.mood - r.layLowMood);
    state.lostDays = (state.lostDays || 0) + r.layLowLostDays;
    state.stats.racketDays += r.layLowLostDays;
    rk.layLows += 1;
    rk.nextVisitDay = state.day + r.layLowDays + 14;
    logMsg(state, 'info', `Лёг на дно: ${r.layLowDays} дней без сбора, внимание милиции `
      + `упало до ${rk.police}/100.`);
    events.push({ type: 'racket-laylow', until: rk.layLowUntil, police: rk.police });
    return events;
  }

  // ── съехать ──────────────────────────────────────────────────────────────
  if (choice === 'move') {
    const cost = r.moveCost + (serverOwned(state, 's1') ? r.moveServerCost : 0)
      + (state.office ? r.moveOfficeCost : 0);
    if (rk.krysha.active || rk.moves >= r.moveMax || state.cash < cost) {
      rk.pending = p;
      return events;
    }
    state.cash -= cost;
    state.books.spendRacket = round1(state.books.spendRacket + cost);
    rk.moves += 1;
    rk.appetite = r.moveAppetite;
    rk.refusals = 0;
    rk.arrears = 0;
    // «своя квартира» продаётся срочно, ниже рынка
    const soldFlat = hasLuxury(state, 'flat');
    if (soldFlat) {
      state.luxury.flat = false;
      const back = Math.round(luxuryPrice(state, 'flat') * r.moveFlatResale);
      state.cash += back;
      state.books.incomeResale = round1(state.books.incomeResale + back);
    }
    state.lostDays = (state.lostDays || 0) + r.moveDays;
    state.stats.racketDays += r.moveDays;
    if (serverOwned(state, 's1')) state.server.offlineUntil = state.day + r.moveServerDays;
    const [lo, hi] = r.moveWeeks;
    rk.nextVisitDay = state.day + Math.round((lo + rng() * (hi - lo)) * 7);
    logMsg(state, 'info', `Переезд за $${cost}: аппетит сброшен до ${r.moveAppetite}%, `
      + `следующий визит — примерно через ${lo}–${hi} недель`
      + `${soldFlat ? '. Квартира продана срочно за 60%' : ''}.`);
    events.push({ type: 'racket-moved', cost, officeMoved: !!state.office, flatSold: soldFlat });
    return events;
  }

  // ── стать крышей ─────────────────────────────────────────────────────────
  if (choice === 'krysha') {
    if (!canBecomeKrysha(state)) {
      rk.pending = p;
      return events;
    }
    state.cash -= r.kryshaSetup;
    state.books.spendRacket = round1(state.books.spendRacket + r.kryshaSetup);
    rk.krysha.active = true;
    rk.kryshaEver = true;
    rk.krysha.since = state.day;
    rk.krysha.points = r.kryshaPointsStart;
    rk.krysha.lastPointDay = state.day;
    rk.police = Math.min(r.policeMax, rk.police + r.kryshaPoliceSetup);
    rk.appetite = r.appetiteStart;
    rk.refusals = 0;
    rk.nextVisitDay = null;
    logMsg(state, 'racket', `Своя крыша: взнос $${r.kryshaSetup}, ${r.kryshaPointsStart} точки `
      + `по $${r.kryshaPointIncome}/мес. Внимание милиции ${rk.police}/100 — теперь оно не остывает, `
      + 'пока собираешь.');
    events.push({ type: 'racket-became-krysha', cost: r.kryshaSetup, police: rk.police });
    return events;
  }

  // Неизвестный выбор: карточка возвращается, ничего не потеряно.
  rk.pending = p;
  return events;
}

// Бот держит в подушке будущий счёт: он видит процент и знает доход месяца.
export function racketReserve(state) {
  if (!racketOn() || !state.racket || !state.racket.started) return 0;
  return Math.round((state.racket.incomeMonth * state.racket.appetite) / 100);
}

// Что можно нажать на карточке. Кнопка не исчезает, а гаснет с причиной —
// как серый навык в v3.5 (§6.4).
export function racketChoices(state) {
  if (!racketOn() || !state.racket || !state.racket.pending) return [];
  const rk = state.racket;
  const r = RACKET();
  const p = rk.pending;
  const moveCost = r.moveCost + (serverOwned(state, 's1') ? r.moveServerCost : 0)
    + (state.office ? r.moveOfficeCost : 0);
  const out = [
    { choice: 'pay', label: `Заплатить $${p.amount}`, enabled: true, reason: '' },
    {
      choice: 'fight',
      label: 'Отбиваться',
      enabled: true,
      reason: `шанс ${Math.round(racketFightChance(state) * 100)}%`,
    },
    {
      choice: 'protect',
      label: `Нанять защиту $${r.protectionCost}`,
      enabled: !rk.protection && state.cash >= r.protectionCost,
      reason: rk.protection ? 'защита уже есть' : (state.cash < r.protectionCost ? `нет $${r.protectionCost}` : ''),
    },
    {
      choice: 'move',
      label: `Съехать $${moveCost}`,
      enabled: !rk.krysha.active && rk.moves < r.moveMax && state.cash >= moveCost,
      reason: rk.krysha.active ? 'крыша не переезжает'
        : (rk.moves >= r.moveMax ? 'уже переезжал дважды'
          : (state.cash < moveCost ? `нет $${moveCost}` : '')),
    },
    {
      choice: 'krysha',
      label: `Стать крышей $${r.kryshaSetup}`,
      enabled: canBecomeKrysha(state) && !rk.krysha.active,
      reason: rk.krysha.active ? 'ты уже крыша'
        : (rk.kryshaBanned ? 'дело завели — второй раз не сесть'
          : kryshaBlocker(state)),
    },
  ];
  if (rk.krysha.active && rk.police >= r.layLowFrom) {
    out.push({
      choice: 'laylow',
      label: `Лечь на дно (${r.layLowDays} дн.)`,
      enabled: true,
      reason: `−${r.layLowPoliceDrop} внимания`,
    });
  }
  return out;
}

function kryshaBlocker(state) {
  const r = RACKET();
  if (state.day < r.kryshaDay) return `только после ${r.kryshaDay}-го дня`;
  if (state.rep < r.kryshaRep) return `нужна репутация ${r.kryshaRep}`;
  if (skillLevel(state, 'crime') < r.kryshaCrime) return `нужен криминал ${r.kryshaCrime}`;
  if ((state.hacks || 0) < r.kryshaHacks) return 'нужен хотя бы один взлом';
  if (state.cash < r.kryshaSetup) return `нет $${r.kryshaSetup}`;
  return '';
}

// Ночной тик рэкета: сроки, милиция, сбор с крыши, арест, расписание.
export function racketNight(state, events, { rng = defaultRng } = {}) {
  if (!racketOn() || !state.racket) return;
  const rk = state.racket;
  const r = RACKET();

  // 1. висящая карточка: срок вышел — это отказ (отпор со штрафом к шансу)
  if (rk.pending && state.day > rk.pending.dueDay) {
    events.push(...resolveRacket(state, 'ignore', { rng }));
  }

  // 2. внимание милиции остывает, только пока ты не крыша
  if (!rk.krysha.active && rk.police > 0 && state.day % r.policeDecayDays === 0) {
    rk.police = Math.max(0, rk.police - r.policeDecayPer10);
  }

  // 3. крыша: месячный сбор, точки, конкуренты. «Дно» останавливает сбор.
  if (rk.krysha.active && state.day % 30 === 0 && state.day > rk.layLowUntil) {
    const gross = rk.krysha.points * r.kryshaPointIncome;
    state.cash += gross;
    state.books.incomeKrysha = round1(state.books.incomeKrysha + gross);
    trackIncome(state, gross);
    rk.police = Math.min(r.policeMax, rk.police + r.kryshaPolicePerMonth);
    state.rep = clamp(state.rep + r.kryshaRepPerMonth, 0, 100);
    if (rk.krysha.points < r.kryshaMaxPoints
      && state.day - (rk.krysha.lastPointDay || rk.krysha.since || state.day) >= r.kryshaPointEveryDays) {
      rk.krysha.points += 1;
      rk.krysha.lastPointDay = state.day;
    }
    logMsg(state, 'money', `Сбор с крыши: +$${gross} (${rk.krysha.points} точек). `
      + `Внимание милиции ${rk.police}/100.`);
    events.push({ type: 'racket-collect', gross, police: rk.police, points: rk.krysha.points });
    if (!rk.pending && rng() < r.kryshaCompetitorChance) postRacketVisit(state, 'competitor', rng);
  }

  // 4. внимание переполнилось — арест (второй, независимый от «следа» путь)
  if (rk.police >= r.policeMax) {
    // Рэкет не может быть причиной game over: штраф не уводит кассу ниже пола.
    const fine = Math.min(r.policeArrestFine, Math.max(0, state.cash - r.floorCash));
    state.cash -= fine;
    state.books.spendArrest = round1(state.books.spendArrest + fine);
    state.rep = Math.max(0, state.rep - r.policeArrestRep);
    state.lostDays = (state.lostDays || 0) + r.policeArrestDays;
    state.lostReason = 'police-arrest';
    state.stats.policeArrests = (state.stats.policeArrests || 0) + 1;
    rk.police = r.policeArrestReset;
    const wasKrysha = rk.krysha.active;
    if (wasKrysha) {
      rk.krysha.active = false;
      rk.kryshaBanned = true;
      rk.nextVisitDay = state.day + 28;
    }
    logMsg(state, 'bad', `Арест: внимание милиции переполнилось (100/100). `
      + `${r.policeArrestDays} дня, штраф $${fine}, репутация −${r.policeArrestRep}`
      + `${wasKrysha ? ', крыша закрыта навсегда — дело завели' : ''}.`);
    events.push({ type: 'police-arrest', fine, kryshaClosed: wasKrysha });
  }

  // 5. месячный сброс «дохода текущего месяца» (для известности)
  if (state.day % 30 === 0) rk.incomeMonth = 0;

  // 6. расписание следующего визита
  if (!rk.pending) {
    if (!rk.started) {
      if (firstRacketVisitDue(state)) {
        rk.started = true;
        postRacketVisit(state, 'first', rng);
      }
    } else if (rk.nextVisitDay !== null && state.day >= rk.nextVisitDay) {
      postRacketVisit(state, rk.krysha.active ? 'competitor' : 'demand', rng);
    }
  }
}


// Что из купленного ОС не умеет использовать — чтобы игрок понимал, зачем платил.
export function wasteReport(state) {
  const os = osById(state.os);
  if (!os) return [];
  const out = [];
  for (const slot of SLOTS) {
    const part = partById(state.hardware[slot.id]);
    if (!part) continue;
    const cap = os.caps[slot.id] || 0;
    if (part.spec > cap) {
      const text = slot.id === 'cpu'
        ? `${slot.label}: ${os.name} не использует ${part.name} — работает как ${cpuNameForTier(cap)}. Излишек впустую.`
        : `${slot.label}: ${os.name} не использует больше ${cap}${slot.unit} `
          + `(у вас ${part.spec}${slot.unit}) — излишек впустую.`;
      out.push({ slot: slot.id, text });
    }
  }
  return out;
}

export function diskUsed(state) {
  const os = osById(state.os);
  const swSize = Object.keys(state.software || {}).reduce((sum, id) => {
    const item = softwareById(id);
    return sum + (item ? item.sizeMb : 0);
  }, 0);
  return (os ? os.sizeMb : 0) + swSize;
}

export function diskFree(state) {
  const hdd = partById(state.hardware.hdd);
  if (!hdd) return 0;
  return Math.max(0, hdd.spec - diskUsed(state));
}

// Дефляция привязана к поколениям (§2.1): каждый выход нового обесценивает
// старое на 25%. Ждать выгодно, но ожидание стоит денег (agingMult).
export function partPrice(part, day = 1) {
  if (!part) return 0;
  const gap = Math.max(0, genAtDay(day) - (part.gen || 1));
  return Math.max(1, Math.round(part.price * (BALANCE.genDeflate ** gap)));
}

// Цена детали для игрока: дефляция поколений плюс скидки навыков «Железо».
export function gearPrice(state, part) {
  if (!part) return 0;
  let price = partPrice(part, state.day);
  if (skillLevel(state, 'hw') >= 1) price *= 0.9;  // «Пайка и тестер»
  if (skillLevel(state, 'hw') >= 4) price *= 0.8;  // «Своя мастерская» (итого −28%)
  return Math.max(1, Math.round(price));
}

// Ставка скупки старой детали: 30% остаточной цены, 40% со «Скупкой».
export function resaleRate(state) {
  return skillLevel(state, 'crime') >= 3 ? BALANCE.gearResaleSkill : BALANCE.gearResale;
}

// Купить можно только вышедшее поколение. Раньше срока — нет.
export function partAvailable(state, part) {
  return Boolean(part) && state.day >= GEN_RELEASE(part.gen || 1);
}

export function machineSummary(state) {
  const specs = machineSpecs(state);
  return {
    cpu: specs.cpu ? partById(state.hardware.cpu).name : '—',
    ram: specs.ram,
    hdd: specs.hdd,
    gpu: specs.gpu,
    modem: specs.modem,
    os: state.os ? osById(state.os).name : 'нет',
    power: totalPower(state),
    rawPower: SLOTS.reduce((sum, slot) => sum + powerOfSlot(state, slot.id), 0),
    diskUsed: diskUsed(state),
    diskFree: diskFree(state),
    working: hasWorkingPC(state),
    infected: Boolean(state.infected),
    systemDown: Boolean(state.systemDown),
    antivirus: state.antivirus ? (antivirusById(state.antivirus.id) || {}).name || 'есть' : 'нет',
  };
}

function logMsg(state, kind, text) {
  state.log.push({ day: state.day, kind, text });
  if (state.log.length > BALANCE.logLimit) state.log = state.log.slice(-BALANCE.logLimit);
}

const ok = (message, extra = {}) => ({ ok: true, message, ...extra });
const fail = (error) => ({ ok: false, error });

function guard(state) {
  if (!state) return fail('Состояние игры потеряно.');
  if (state.result) return fail('Игра окончена. Начните новую.');
  return null;
}

function spendCash(state, amount) {
  const value = round1(Math.max(0, num(amount, 0)));
  state.cash = round1(state.cash - value);
  state.stats.totalSpent = round1(state.stats.totalSpent + value);
  return value;
}

function earnCash(state, amount) {
  const value = round1(Math.max(0, num(amount, 0)));
  state.cash = round1(state.cash + value);
  state.stats.totalEarned = round1(state.stats.totalEarned + value);
  return value;
}

// ---------------------------------------------------------------------------
// Действия: железо
// ---------------------------------------------------------------------------

export function buyPart(state, partId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const part = partById(partId);
  if (!part) return fail('Такой детали нет в продаже.');
  if (!partAvailable(state, part)) {
    return fail(`${part.name} ещё не поступил: ${genName(part.gen)} появляется в магазине `
      + `на ${GEN_RELEASE(part.gen)}-й день.`);
  }
  const previous = state.hardware[part.slot];
  const previousPart = previous ? partById(previous) : null;
  const price = gearPrice(state, part);
  // Апгрейд не бесплатный: старую деталь принимают за 30% (40% со «Скупкой»).
  const tradeIn = previousPart ? Math.round(gearPrice(state, previousPart) * resaleRate(state)) : 0;
  const toPay = Math.max(0, price - tradeIn);
  if (state.cash < toPay) {
    return fail(`Не хватает денег: ${part.name} стоит $${price}`
      + `${tradeIn ? ` (с учётом старой детали — $${toPay})` : ''}, у вас ${fmtMoney(state.cash)}.`);
  }
  state.cash = round1(state.cash - price + tradeIn);
  state.books.spendGear = round1(state.books.spendGear + price);
  state.books.incomeResale = round1(state.books.incomeResale + tradeIn);
  state.stats.totalSpent = round1(Math.max(0, state.stats.totalSpent + price - tradeIn));
  state.stats.actions += 1;
  state.hardware[part.slot] = part.id;
  const slotLabel = SLOTS.find((s) => s.id === part.slot).label;
  if (previousPart && tradeIn > 0) {
    logMsg(state, 'money', `Комиссионка: ${previousPart.name} принята за $${tradeIn} в счёт покупки.`);
  }
  logMsg(state, 'money', previousPart
    ? `Куплено: ${part.name} за $${price}. Прежняя деталь (${slotLabel}) — ${previousPart.name} — сдана в трейд-ин.`
    : `Куплено: ${part.name} за $${price}.`);
  return ok(`Куплено: ${part.name}.`, { price, tradeIn, gen: part.gen });
}

export function sellPart(state, slotId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const part = partById(state.hardware[slotId]);
  if (!part) return fail('Здесь нечего продавать.');
  const price = Math.round(gearPrice(state, part) * resaleRate(state));
  state.hardware[slotId] = null;
  state.cash = round1(state.cash + price);
  state.books.incomeResale = round1(state.books.incomeResale + price);
  state.stats.totalSpent = round1(Math.max(0, state.stats.totalSpent - price));
  state.stats.actions += 1;
  logMsg(state, 'money', `Продано: ${part.name} за $${price}.`);
  return ok(`Продано: ${part.name} за $${price}.`);
}

export function buyOffice(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (state.office) return fail('Офис уже есть.');
  if (state.cash < BALANCE.officePrice) {
    return fail(`Не хватает денег: офис стоит $${BALANCE.officePrice}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, BALANCE.officePrice);
  state.stats.actions += 1;
  state.office = true;
  logMsg(state, 'good', `Арендован офис за $${BALANCE.officePrice}. Теперь можно брать «Кассу 98».`);
  return ok('Офис арендован.', { price: BALANCE.officePrice });
}

export function installOS(state, osId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const os = osById(osId);
  if (!os) return fail('Такой системы нет в продаже.');
  if (state.os === os.id) return fail(`${os.name} уже установлена.`);

  const specs = machineSpecs(state);

  if (!state.hardware.cpu) return fail('В компьютере нет процессора — устанавливать некуда.');
  if (!state.hardware.ram) return fail('В компьютере нет памяти — устанавливать некуда.');
  if (!state.hardware.hdd) return fail('В компьютере нет винчестера — устанавливать некуда.');

  if (specs.cpu < os.req.cpu) {
    return fail(`Слишком слабый процессор: нужен ${cpuNameForTier(os.req.cpu)}, установлен ${partById(state.hardware.cpu).name}.`);
  }
  if (specs.ram < os.req.ram) {
    return fail(`Недостаточно памяти: нужно ${os.req.ram} МБ ОЗУ, установлено ${specs.ram} МБ.`);
  }
  if (specs.hdd < os.req.hdd) {
    return fail(`Мало места на диске: нужно ${os.req.hdd} МБ винчестера, установлено ${specs.hdd} МБ.`);
  }

  const hdd = partById(state.hardware.hdd);
  const swSize = Object.keys(state.software || {}).reduce((sum, id) => {
    const item = softwareById(id);
    return sum + (item ? item.sizeMb : 0);
  }, 0);
  const freeForOS = hdd.spec - swSize;
  const needed = os.sizeMb + 40;
  if (freeForOS < needed) {
    return fail(`Мало места на диске: для ${os.name} нужно ${needed} МБ свободно, а свободно ${freeForOS} МБ.`);
  }

  if (state.cash < os.price) {
    return fail(`Не хватает денег: ${os.name} стоит $${os.price}, у вас ${fmtMoney(state.cash)}.`);
  }

  spendCash(state, os.price);
  state.stats.actions += 1;
  state.os = os.id;
  state.knowledge = clamp(state.knowledge + os.knowledge, 0, BALANCE.maxKnowledge);
  logMsg(state, 'good', `Установлена ${os.name} (−$${os.price}, +${os.knowledge} знаний).`);
  return ok(`${os.name} установлена.`, { price: os.price, knowledge: os.knowledge });
}

function hasSoftware(state, id) {
  return Boolean(state.software && state.software[id]);
}

export function installSoftware(state, swId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const item = softwareById(swId);
  if (!item) return fail('Такого диска нет в продаже.');
  if (hasSoftware(state, item.id)) return fail(`${item.name} уже установлен.`);
  if (!state.os) return fail(`Сначала установите операционную систему: ${item.name} без неё не запустится.`);
  if (!item.req.os.includes(state.os)) {
    return fail(`Нужна ОС: ${osNamesFor(item.req.os)}. У вас установлена ${osById(state.os).name}.`);
  }

  const specs = machineSpecs(state);
  if (item.req.cpu && specs.cpu < item.req.cpu) {
    return fail(`Слишком слабый процессор: нужен ${cpuNameForTier(item.req.cpu)}, установлен ${partById(state.hardware.cpu).name}.`);
  }
  if (item.req.ram && specs.ram < item.req.ram) {
    return fail(`Недостаточно памяти: нужно ${item.req.ram} МБ ОЗУ, установлено ${specs.ram} МБ.`);
  }
  if (item.req.modem && specs.modem < item.req.modem) {
    return fail(`Нужен модем не хуже ${item.req.modem} бод, установлен ${specs.modem ? `${specs.modem} бод` : 'никакой'}.`);
  }
  if (diskFree(state) < item.sizeMb) {
    return fail(`Мало места на диске: ${item.name} занимает ${item.sizeMb} МБ, свободно ${diskFree(state)} МБ.`);
  }
  if (state.cash < item.price) {
    return fail(`Не хватает денег: ${item.name} стоит $${item.price}, у вас ${fmtMoney(state.cash)}.`);
  }

  spendCash(state, item.price);
  state.stats.actions += 1;
  state.software[item.id] = true;
  state.knowledge = clamp(state.knowledge + item.knowledge, 0, BALANCE.maxKnowledge);
  logMsg(state, 'good', `Установлено: ${item.name} (−$${item.price}, +${item.knowledge} знаний).`);
  return ok(`Установлено: ${item.name}.`, { price: item.price, knowledge: item.knowledge });
}

// ---------------------------------------------------------------------------
// Работа
// ---------------------------------------------------------------------------

// Чистая проверка набора требований (одна для работ, курсов и заказов).
export function meetsRequirements(state, req = {}) {
  if (req.knowledge && state.knowledge < req.knowledge) return false;
  if (req.power && totalPower(state) < req.power) return false;
  if (req.os && !state.os) return false;
  if (req.rep && state.rep < req.rep) return false;
  if (req.hacks && state.hacks < req.hacks) return false;
  if (req.modem && machineSpecs(state).modem < req.modem) return false;
  if (req.office && !state.office) return false;
  // v3.5: свежесть ПК. Не гейт для навыков — только для работ и верхних заказов.
  if (req.age !== undefined && pcAge(state) > req.age) return false;
  return true;
}

// Постоянные причины недоступности (энергия проверяется отдельно — это не тупик).
// ignoreAge — для уже занимаемой должности: старый ПК режет оплату, но не
// увольняет (жёсткое правило §8.3).
// ignoreKnowledge — тоже для занимаемой должности: знания тратятся на дерево
// навыков (§2.3), и просевший запас режет зарплату через salaryMult, но не
// отбирает работу. Иначе покупка навыка незаметно запирает игрока без дохода.
export function jobBlockers(state, jobId, { ignoreAge = false, ignoreKnowledge = false } = {}) {
  const job = jobById(jobId);
  if (!job) return ['Такой вакансии нет.'];
  const reasons = [];
  const req = job.req || {};

  // Правило №6: без ОС доступны только дворник и курьер.
  const needsOS = req.os || (job.id !== 'janitor' && job.id !== 'courier');
  if (needsOS && !state.os) reasons.push('нужен свой работающий компьютер с операционной системой');
  if (req.power) {
    const power = totalPower(state);
    if (power < req.power) reasons.push(`нужен компьютер мощностью ${req.power}, у вас ${power}`);
  }
  if (!ignoreKnowledge && req.knowledge && state.knowledge < req.knowledge) {
    reasons.push(`нужно знаний ${req.knowledge}, у вас ${Math.floor(state.knowledge)}`);
  }
  if (req.rep && state.rep < req.rep) {
    reasons.push(`нужна репутация ${req.rep}, у вас ${Math.floor(state.rep)}`);
  }
  if (req.modem) {
    const specs = machineSpecs(state);
    if (specs.modem < req.modem) {
      reasons.push(`нужен модем ${req.modem} бод, у вас ${specs.modem ? `${specs.modem} бод` : 'модема нет'}`);
    }
  }
  if (req.hacks) {
    const hacks = state.hacks || 0;
    if (hacks < req.hacks) {
      reasons.push(`нужен хотя бы один успешный взлом (у вас ${hacks})`);
    }
  }
  if (!ignoreAge && req.age !== undefined) {
    const age = pcAge(state);
    if (age > req.age) {
      reasons.push(`ПК старше нормы: ${age} поколений при допуске ${req.age} `
        + `(нужно ${genName(pcGen(state) + 1)} и новее)`);
    }
  }
  return reasons;
}

export function jobStatus(state, jobId) {
  const job = jobById(jobId);
  const reasons = jobBlockers(state, jobId);
  return {
    available: reasons.length === 0,
    reasons,
    current: state.jobId === jobId,
    needsEnergy: Boolean(job && state.energy < job.energy),
  };
}

export function takeJob(state, jobId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const job = jobById(jobId);
  if (!job) return fail('Такой вакансии нет.');
  const reasons = jobBlockers(state, jobId);
  if (reasons.length) return fail(`Вас не берут: ${reasons.join('; ')}.`);
  if (state.jobId === job.id) return fail('Вы уже работаете здесь.');
  state.jobId = job.id;
  state.jobStartDay = state.day;
  state.stats.actions += 1;
  const probation = BALANCE.probationDays;
  logMsg(state, 'good', `Вы устроились: ${job.name}, $${job.salary} в день.`
    + ` Первые ${probation} ${pluralRu(probation, 'день', 'дня', 'дней')} — испытательный срок, платят `
    + `${Math.round(BALANCE.probationPayRate * 100)}%.`);
  return ok(`Вы устроились: ${job.name}. Испытательный срок — ${probation} дн.`, { jobId: job.id });
}

export function quitJob(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const job = jobById(state.jobId);
  if (!job) return fail('Вы и так без работы.');
  if (state.daySlotUsed) {
    return fail('День уже занят: увольняются утром, а не вечером.');
  }
  state.jobId = null;
  state.jobStartDay = null;
  state.stain = true;
  state.daySlotUsed = true;
  state.daySlotKind = 'quit';
  state.mood = clamp(state.mood - BALANCE.quitMoodPenalty, 0, BALANCE.maxMood);
  state.stats.actions += 1;
  logMsg(state, 'bad', `Вы уволились с «${job.name}». День потерян, в трудовой — пятно: `
    + 'следующая зарплата будет меньше.');
  return ok('Вы уволились. День потерян, в трудовой осталось пятно.');
}

// Множитель разрыва: больше знаний сверх требования — больше платят (§10.2).
export function salaryMult(state, job = jobById(state.jobId)) {
  if (!job) return 1;
  const req = (job.req && job.req.knowledge) || 0;
  let m = 1;
  if (req) {
    const gap = (state.knowledge - req) / req;
    m = clamp(1 + BALANCE.gapBonusK * gap, BALANCE.gapMultMin, BALANCE.gapMultMax);
  }
  m *= agingMult(state, job);                       // v3.5: старый ПК платит меньше
  if (skillLevel(state, 'code') >= 1) m *= 1.08;    // «Алгоритмы»
  return m;
}

// Сколько заплатят сегодня: разрыв по знаниям, испытательный срок, пятно.
export function salaryFor(state) {
  const job = jobById(state.jobId);
  if (!job) return 0;
  let pay = job.salary * salaryMult(state, job);
  if (onProbation(state)) pay *= BALANCE.probationPayRate;
  if (state.stain) pay -= Math.max(BALANCE.stainPenaltyMin, pay * BALANCE.stainPenaltyRate);
  return Math.max(1, Math.round(pay));
}

export function onProbation(state) {
  if (!state.jobId) return false;
  const start = Number(state.jobStartDay);
  if (!Number.isFinite(start)) return false;
  return state.day - start < BALANCE.probationDays;
}

export function probationDaysLeft(state) {
  if (!onProbation(state)) return 0;
  return Math.max(0, BALANCE.probationDays - (state.day - Number(state.jobStartDay)));
}

// Общие причины, по которым день занят: слот, курс, заказ.
function daySlotBlockers(state, { ignoreContract = false } = {}) {
  const reasons = [];
  if (state.daySlotUsed) reasons.push('день уже занят');
  if (state.courseProgress) reasons.push('идёт курс — сначала доучитесь');
  if (state.contract && !ignoreContract) reasons.push('взят заказ — срок идёт, работайте на заказе');
  return reasons;
}

export function work(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (state.sickToday) return fail('Вы простужены. Сегодня работа не для вас — только постель и чай.');
  if (state.systemDown) {
    return fail('Система не грузится: вирус положил машину. Без рабочего компьютера на работу не выйти — нужен антивирус.');
  }
  const job = jobById(state.jobId);
  if (!job) return fail('Сначала найдите работу — на улице никто не платит.');
  const slotBlockers = daySlotBlockers(state);
  if (slotBlockers.length) return fail(`Сегодня уже не выйдет: ${slotBlockers.join('; ')}.`);
  const reasons = jobBlockers(state, job.id, { ignoreAge: true, ignoreKnowledge: true });
  if (reasons.length) return fail(`Работа больше недоступна: ${reasons.join('; ')}.`);
  if (state.energy < job.energy) {
    return fail(`Не хватает энергии: нужно ${job.energy}, осталось ${Math.floor(state.energy)}. `
      + 'Энергия утром зависит от настроения — отдохните днём.');
  }

  const pay = salaryFor(state);
  const probation = onProbation(state);
  earnCash(state, pay);
  state.monthIncome = round1(state.monthIncome + pay);
  trackIncome(state, pay);
  state.stats.workDays += 1;
  state.stats.daysWorked += 1;
  state.stats.actions += 1;
  state.energy = clamp(state.energy - job.energy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood - job.mood, 0, BALANCE.maxMood);
  const gain = job.gain + (skillLevel(state, 'code') >= 3 && job.gain > 0 ? 1 : 0);
  if (gain) state.knowledge = clamp(state.knowledge + gain, 0, BALANCE.maxKnowledge);
  state.books.incomeWork = round1(state.books.incomeWork + pay);
  state.books.knowledgeGained = round1(state.books.knowledgeGained + gain);
  state.daySlotUsed = true;
  state.daySlotKind = 'work';
  const stainPaid = state.stain;
  state.stain = false;

  logMsg(state, 'money', `${job.name}: +$${pay} за день.`);
  if (probation) logMsg(state, 'info', 'Испытательный срок: платят 60% оклада.');
  if (stainPaid) logMsg(state, 'bad', 'Пятно в трудовой: с этой зарплаты удержали штраф.');
  const ageNote = agingNote(state, job);
  if (ageNote) logMsg(state, 'bad', `${ageNote}. Железо пора обновить.`);
  if (gain) logMsg(state, 'info', `Опыт: +${gain} знаний.`);

  let warning = null;
  if (state.mood <= 10) {
    warning = 'Настроение на дне. Ещё немного — и можно свалиться прямо на улице.';
    logMsg(state, 'bad', warning);
  }
  return ok(`Отработан день: +$${pay}.`, { salary: pay, warning });
}

// ---------------------------------------------------------------------------
// Курсы (§4, §7.2): знания из формулы, повтор дороже и скупее
// ---------------------------------------------------------------------------

export function courseAttempt(state, courseId) {
  const course = courseById(courseId);
  if (!course) return null;
  const repeats = Math.max(0, Math.floor(num((state.courses || {})[courseId], 0)));
  const price = Math.round(course.price * (BALANCE.courseRepeatCostGrowth ** repeats));
  const knowledge = Math.max(
    BALANCE.courseRepeatKnowMin,
    Math.round(course.knowledge * (BALANCE.courseRepeatKnowFalloff ** repeats)),
  );
  return {
    course,
    repeats,
    price,
    knowledge,
    first: repeats === 0,
    perKnowledge: pricePerKnowledge(price, knowledge),
    affordable: state.cash >= price && state.energy >= course.energy,
  };
}

export function pricePerKnowledge(price, knowledge) {
  const p = num(price, 0);
  const k = num(knowledge, 0);
  if (k <= 0) return null;
  if (p <= 0) return 0;
  return Math.round((p / k) * 10) / 10;
}

export function courseBlockers(state, courseId) {
  const course = courseById(courseId);
  if (!course) return ['Такого курса нет.'];
  const attempt = courseAttempt(state, courseId);
  const reasons = [];

  if (state.daySlotUsed && !(state.courseProgress && state.courseProgress.id === course.id)) {
    reasons.push('день уже занят');
  }
  if (state.courseProgress && state.courseProgress.id !== course.id) {
    reasons.push('сначала закончите начатый курс');
  }
  if (state.contract) reasons.push('взят заказ — срок идёт');
  if (course.req.knowledge && state.knowledge < course.req.knowledge) {
    reasons.push(`нужно знаний ${course.req.knowledge}, у вас ${Math.floor(state.knowledge)}`);
  }
  if (course.req.modem) {
    const specs = machineSpecs(state);
    if (specs.modem < course.req.modem) {
      reasons.push(`нужен модем ${course.req.modem} бод, а у вас ${specs.modem ? `${specs.modem} бод` : 'модема нет'}`);
    }
  }
  if (state.energy < course.energy) {
    reasons.push(`нужно энергии ${course.energy}, осталось ${Math.floor(state.energy)}`);
  }
  if (attempt.price > 0 && state.cash < attempt.price) {
    reasons.push(`не хватает денег: нужно $${attempt.price}, у вас ${fmtMoney(state.cash)}`);
  }
  return reasons;
}

// Курс занимает `days` дней. Первый день оплачивается и тратит энергию,
// остальные — по одному дню через повторный вызов study().
export function study(state, courseId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const course = courseById(courseId);
  if (!course) return fail('Такого курса нет.');

  const inProgress = state.courseProgress && state.courseProgress.id === course.id;

  if (inProgress) {
    // Продолжение уже оплаченного курса: требования проверены при старте,
    // повторно их не проверяем (иначе забывание знаний запирает игрока в курсе).
    if (state.daySlotUsed) return fail(`«${course.name}»: день уже занят.`);
    // Продолжение: ещё один день курса (энергия списана при старте — §7.2).
    state.mood = clamp(state.mood - 1, 0, BALANCE.maxMood);
    state.courseProgress.remaining -= 1;
    state.daySlotUsed = true;
    state.daySlotKind = 'course';
    state.stats.actions += 1;
    if (state.courseProgress.remaining <= 0) {
      const gained = state.courseProgress.knowledge;
      const repeats = state.courseProgress.repeats;
      state.knowledge = clamp(state.knowledge + gained, 0, BALANCE.maxKnowledge);
      state.courses[course.id] = repeats + 1;
      state.courseProgress = null;
      logMsg(state, 'good', `${course.name}: курс окончен, +${gained} знаний`
        + `${repeats ? ` (повтор №${repeats})` : ''}.`);
      return ok(`${course.name}: знания +${gained}.`, { knowledge: gained, repeat: repeats, completed: true });
    }
    logMsg(state, 'info', `${course.name}: ещё ${state.courseProgress.remaining} `
      + `${pluralRu(state.courseProgress.remaining, 'день', 'дня', 'дней')} учёбы.`);
    return ok(`${course.name}: день учёбы. Осталось ${state.courseProgress.remaining} дн.`);
  }

  const reasons = courseBlockers(state, courseId);
  if (reasons.length) return fail(`«${course.name}»: ${reasons.join('; ')}.`);

  const attempt = courseAttempt(state, courseId);
  spendCash(state, attempt.price);
  state.energy = clamp(state.energy - course.energy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood - 1, 0, BALANCE.maxMood);
  state.daySlotUsed = true;
  state.daySlotKind = 'course';
  state.stats.actions += 1;
  state.stats.studyDays += 1;

  if (course.days <= 1) {
    state.knowledge = clamp(state.knowledge + attempt.knowledge, 0, BALANCE.maxKnowledge);
    state.courses[course.id] = attempt.repeats + 1;
    logMsg(state, 'good', `${course.name}: +${attempt.knowledge} знаний`
      + `${attempt.price ? ` (−$${attempt.price})` : ''}${attempt.first ? '' : `, повтор №${attempt.repeats}`}.`);
    return ok(`${course.name}: знания +${attempt.knowledge}.`, {
      knowledge: attempt.knowledge, price: attempt.price, repeat: attempt.repeats,
    });
  }

  state.courseProgress = {
    id: course.id,
    remaining: course.days - 1,
    knowledge: attempt.knowledge,
    price: attempt.price,
    repeats: attempt.repeats,
  };
  logMsg(state, 'info', `${course.name}: первый день из ${course.days}, оплачено $${attempt.price}.`);
  return ok(`${course.name}: первый день. Осталось ${course.days - 1} дн.`, {
    knowledge: 0, price: attempt.price, daysLeft: course.days - 1,
  });
}

// ---------------------------------------------------------------------------
// Отдых днём
// ---------------------------------------------------------------------------

export function rest(state, restId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const option = restById(restId);
  if (!option) return fail('Такого развлечения нет.');
  const slotBlockers = daySlotBlockers(state, { ignoreContract: true });
  if (slotBlockers.length) return fail(`Отдых не выйдет: ${slotBlockers.join('; ')}.`);
  // Правило №1: бесплатное действие доступно при отрицательном балансе.
  if (option.price > 0 && state.cash < option.price) {
    return fail(`Не хватает денег: нужно $${option.price}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, option.price);
  state.stats.actions += 1;
  state.stats.restDays += 1;
  state.daySlotUsed = true;
  state.daySlotKind = 'rest';
  const restMood = hasLuxury(state, 'dacha')
    ? Math.round(option.mood * BALANCE.dachaRestBonus)
    : option.mood;
  state.mood = clamp(state.mood + restMood, 0, BALANCE.maxMood);
  state.energy = clamp(state.energy - option.energy, 0, BALANCE.maxEnergy);
  logMsg(state, 'good', `${option.name}: настроение +${restMood}`
    + `${option.price ? ` (−$${option.price})` : ''}. День потрачен.`);
  return ok(`${option.name}: настроение +${restMood}. День потрачен.`, { mood: restMood });
}

// ---------------------------------------------------------------------------
// Вечерний слот (§4): учёба, библиотека, взлом, развлечение
// ---------------------------------------------------------------------------

function eveningBlockers(state) {
  const reasons = [];
  if (state.result) reasons.push('игра окончена');
  if (state.eveningUsed) reasons.push('вечер уже занят');
  const meaningfulDay = ['work', 'contract', 'course'].includes(state.daySlotKind);
  if (!meaningfulDay) reasons.push('вечер бывает только после рабочего дня, заказа или курса');
  return reasons;
}

export function eveningStudy(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const reasons = eveningBlockers(state);
  // §4/§10.2 и design/model-v3.mjs: вечерняя учёба упирается только в энергию,
  // компьютер с ОС не требуется (это не «своё самообразование» из v2.1).
  if (state.systemDown) reasons.push('система не грузится');
  if (state.energy < BALANCE.studyEnergy) {
    reasons.push(`нужно энергии ${BALANCE.studyEnergy}, осталось ${Math.floor(state.energy)}`);
  }
  if (reasons.length) return fail(`Вечерняя учёба: ${reasons.join('; ')}.`);

  state.energy = clamp(state.energy - BALANCE.studyEnergy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood - BALANCE.studyMood, 0, BALANCE.maxMood);
  state.knowledge = clamp(state.knowledge + BALANCE.studyKnowledge, 0, BALANCE.maxKnowledge);
  state.eveningUsed = true;
  state.stats.studyDays += 1;
  state.stats.actions += 1;
  logMsg(state, 'good', `Вечерняя учёба: +${BALANCE.studyKnowledge} знаний `
    + `(−${BALANCE.studyEnergy} энергии, −${BALANCE.studyMood} настроения).`);
  return ok(`Вечерняя учёба: знания +${BALANCE.studyKnowledge}.`, { knowledge: BALANCE.studyKnowledge });
}

export function libraryReady(state) {
  return state.day - Math.max(-999, num(state.libraryLastDay, -999)) >= BALANCE.libraryCooldown;
}

export function eveningLibrary(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const reasons = eveningBlockers(state);
  if (!libraryReady(state)) {
    const wait = BALANCE.libraryCooldown - (state.day - num(state.libraryLastDay, -999));
    reasons.push(`библиотека закрыта ещё ${wait} ${pluralRu(wait, 'день', 'дня', 'дней')}`);
  }
  if (state.energy < BALANCE.libraryEnergy) {
    reasons.push(`нужно энергии ${BALANCE.libraryEnergy}, осталось ${Math.floor(state.energy)}`);
  }
  if (reasons.length) return fail(`Библиотека: ${reasons.join('; ')}.`);

  state.energy = clamp(state.energy - BALANCE.libraryEnergy, 0, BALANCE.maxEnergy);
  state.knowledge = clamp(state.knowledge + BALANCE.libraryK, 0, BALANCE.maxKnowledge);
  state.libraryLastDay = state.day;
  state.eveningUsed = true;
  state.stats.libraryVisits += 1;
  state.stats.actions += 1;
  logMsg(state, 'good', `Библиотека: подшивка «Радио» — +${BALANCE.libraryK} знаний.`);
  return ok(`Библиотека: знания +${BALANCE.libraryK}.`, { knowledge: BALANCE.libraryK });
}

// Вечернее развлечение: 25% от дневного и не выше 55 (правило №3).
export function eveningRest(state, restId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const option = eveningRestById(restId) || EVENING_RESTS[0];
  const reasons = eveningBlockers(state);
  const gain = eveningRestGain(option, state.mood);
  if (gain <= 0) reasons.push(`настроение и так выше ${BALANCE.eveningMoodCap}`);
  if (option.price > 0 && state.cash < option.price) {
    reasons.push(`не хватает денег: нужно $${option.price}`);
  }
  if (state.energy < option.energy) {
    reasons.push(`нужно энергии ${option.energy}`);
  }
  if (reasons.length) return fail(`${option.name} вечером: ${reasons.join('; ')}.`);

  spendCash(state, option.price);
  state.energy = clamp(state.energy - option.energy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood + gain, 0, BALANCE.eveningMoodCap);
  state.eveningUsed = true;
  state.stats.actions += 1;
  logMsg(state, 'good', `${option.name} вечером: настроение +${gain}`
    + `${option.price ? ` (−$${option.price})` : ''}.`);
  return ok(`${option.name}: настроение +${gain}.`, { mood: gain });
}

// ---------------------------------------------------------------------------
// Заказы (§8)
// ---------------------------------------------------------------------------

// Чистая проверка требований — одно правило для UI и для бота.
export function canTakeContract(state, contract) {
  if (!contract) return ['Такого заказа нет.'];
  const reasons = [];
  const req = contract.req || {};
  if (contract.kind === 'manual' && state.contractsDone[contract.id]) {
    reasons.push('этот заказ уже сдан');
  }
  if (state.contract) reasons.push('у вас уже есть взятый заказ');
  if (state.result) reasons.push('игра окончена');
  if (req.os && !state.os) reasons.push('нужен свой компьютер с ОС');
  if (req.knowledge && state.knowledge < req.knowledge) {
    reasons.push(`нужно знаний ${req.knowledge}, у вас ${Math.floor(state.knowledge)}`);
  }
  if (req.power && totalPower(state) < req.power) {
    reasons.push(`нужна мощность ${req.power}, у вас ${totalPower(state)}`);
  }
  if (req.modem) {
    const specs = machineSpecs(state);
    if (specs.modem < req.modem) reasons.push(`нужен модем ${req.modem} бод`);
  }
  if (req.hacks && state.hacks < req.hacks) reasons.push('нужен хотя бы один взлом');
  if (req.rep && state.rep < req.rep) reasons.push(`нужна репутация ${req.rep}, у вас ${Math.floor(state.rep)}`);
  if (req.office && !state.office) reasons.push('нужен офис ($' + BALANCE.officePrice + ')');
  if (req.age !== undefined && pcAge(state) > req.age) {
    reasons.push(`верхние заказы не звонят на старый ПК: ${pcAge(state)} поколений при допуске ${req.age}`);
  }
  if (state.energy < BALANCE.contractEnergy) reasons.push(`нужно энергии ${BALANCE.contractEnergy}`);
  return reasons;
}

// Доска заказов: 12 ручных + сгенерированные, у каждого — причина недоступности.
export function openContracts(state) {
  const list = [];
  for (const c of CONTRACTS) {
    if (state.contractsDone[c.id]) continue;
    const reasons = canTakeContract(state, c);
    list.push({ ...c, available: reasons.length === 0, reasons });
  }
  for (const c of state.contractOffers || []) {
    const reasons = canTakeContract(state, c);
    list.push({ ...c, available: reasons.length === 0, reasons });
  }
  return list;
}

export function acceptContract(state, contractId) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const offer = (state.contractOffers || []).find((c) => c.id === contractId)
    || CONTRACTS.find((c) => c.id === contractId);
  if (!offer) return fail('Такого заказа нет на доске.');
  const reasons = canTakeContract(state, offer);
  if (reasons.length) return fail(`Заказ недоступен: ${reasons.join('; ')}.`);

  const pay = contractPayActual(state, offer);
  const advance = Math.round(pay * BALANCE.contractAdvance);
  earnCash(state, advance);
  state.monthIncome = round1(state.monthIncome + advance);
  trackIncome(state, advance);
  state.contract = {
    id: offer.id,
    kind: offer.kind,
    t: offer.t,
    name: offer.name,
    days: offer.days,
    leftDays: offer.days,
    knowledge: offer.knowledge,
    rep: offer.rep,
    risk: offer.risk,
    pay,
    advance,
    deadline: state.day + offer.days + BALANCE.contractSlack,
    req: { ...offer.req },
  };
  state.stats.actions += 1;
  logMsg(state, 'money', `Подписан заказ «${offer.name}»: аванс $${advance} на руки, `
    + `срок — ${offer.days} ${pluralRu(offer.days, 'день', 'дня', 'дней')} работы до ${formatDateRu(state.contract.deadline)}.`);
  return ok(`Взят заказ «${offer.name}». Аванс $${advance}.`, { advance, deadline: state.contract.deadline });
}

// Эффективный риск: запас знаний сверх требования режет риск (§8).
export function contractRisk(state, contract) {
  if (!contract) return 1;
  const req = (contract.req && contract.req.knowledge) || 0;
  let risk;
  if (!req) {
    risk = clamp(contract.risk, BALANCE.riskMin, 1);
  } else {
    // Запас знаний режет риск, но НАСЫЩАЕТСЯ (§13 Д4): линейная формула
    // обнуляла риск при любом большом запасе и делала доску безрисковой.
    const surplus = Math.max(0, state.knowledge - req) / req;
    const relief = Math.min(1, surplus) * BALANCE.riskKnowledgeRelief;
    risk = clamp(contract.risk * (1 - relief), BALANCE.riskMin, 1);
  }
  if (skillLevel(state, 'code') >= 2) risk *= 0.75; // «Отладка»
  // v3.6: внимание милиции режет заказы риском (+0…12 п.п.), а не доход.
  risk += BALANCE.racket.policeRisk * policePressure(state);
  return clamp(risk, BALANCE.riskMin, 0.8);
}

// Работа над заказом: −35 энергии, −3 настроения, день занят.
export function contractPayActual(state, contract) {
  if (!contract) return 0;
  let pay = contract.pay;
  if (skillLevel(state, 'code') >= 1) pay *= 1.08;                    // «Алгоритмы»
  if (skillLevel(state, 'hw') >= 3 && contract.req && contract.req.power) pay *= 1.1; // «Сборка на заказ»
  if (skillLevel(state, 'code') >= 4 && contract.t >= 9) pay *= 1.12; // «Свой продукт»
  if (hasEliteClients(state) && contract.t >= BALANCE.luxuryEliteTier) pay *= BALANCE.luxuryElitePay;
  // Верхние заказы смотрят на свежесть машины так же, как зарплата.
  if (contract.t >= 9) pay *= agingMult(state, { req: { age: 1 } });
  return Math.round(pay);
}
export function doContractWork(state, { rng = defaultRng } = {}) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const c = state.contract;
  if (!c) return fail('Нет взятого заказа — сначала выберите на доске.');
  if (state.sickToday) return fail('Вы простужены — на заказ сегодня не выйти.');
  if (state.systemDown) return fail('Система не грузится — работать не на чем.');
  const slotBlockers = daySlotBlockers(state, { ignoreContract: true });
  if (slotBlockers.length) return fail(`День уже занят: ${slotBlockers.join('; ')}.`);
  if (state.energy < BALANCE.contractEnergy) {
    return fail(`Не хватает энергии: нужно ${BALANCE.contractEnergy}, осталось ${Math.floor(state.energy)}.`);
  }

  state.energy = clamp(state.energy - BALANCE.contractEnergy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood - BALANCE.contractMood, 0, BALANCE.maxMood);
  state.daySlotUsed = true;
  state.daySlotKind = 'contract';
  state.contract.leftDays -= 1;
  state.stats.contractDays += 1;
  state.stats.actions += 1;
  logMsg(state, 'info', `Заказ «${c.name}»: день работы, осталось ${c.leftDays}.`);

  if (state.contract.leftDays > 0) {
    return ok(`Работа по заказу: осталось ${c.leftDays} ${pluralRu(c.leftDays, 'день', 'дня', 'дней')}.`, {
      leftDays: c.leftDays,
    });
  }
  return resolveContract(state, { rng });
}

function resolveContract(state, { rng = defaultRng } = {}) {
  const c = state.contract;
  if (!c) return fail('Нет заказа.');
  const risk = contractRisk(state, c);
  const success = rng() >= risk;
  state.contract = null;
  if (success) {
    const rest = Math.max(0, c.pay - c.advance);
    earnCash(state, rest);
    state.monthIncome = round1(state.monthIncome + rest);
    trackIncome(state, rest);
    state.books.incomeContract = round1(state.books.incomeContract + c.pay);
    if (c.t >= 9) state.books.incomeTopTier = round1(state.books.incomeTopTier + c.pay);
    state.knowledge = clamp(state.knowledge + c.knowledge, 0, BALANCE.maxKnowledge);
    state.books.knowledgeGained = round1(state.books.knowledgeGained + c.knowledge);
    state.rep = clamp(state.rep + c.rep, 0, 100);
    state.contractsDone[c.id] = true;
    state.stats.contractsDone += 1;
    logMsg(state, 'good', `Заказ «${c.name}» сдан: +$${rest} остатка, +${c.knowledge} знаний, `
      + `репутация ${c.rep >= 0 ? '+' : ''}${c.rep} (${Math.round(state.rep)}).`);
    return ok(`Заказ «${c.name}» сдан.`, {
      completed: c.id, pay: c.pay, knowledge: c.knowledge, rep: c.rep,
    });
  }
  // Провал: аванс возвращается, репутация страдает.
  const loss = Math.max(0, c.advance);
  spendCash(state, loss);
  if (c.kind === 'manual') state.contractsDone[c.id] = true;
  state.stats.contractsFailed += 1;
  const repLoss = BALANCE.contractFailRepMin
    + Math.floor(rng() * (BALANCE.contractFailRepMax - BALANCE.contractFailRepMin + 1));
  state.rep = clamp(state.rep - repLoss, 0, 100);
  logMsg(state, 'bad', `Заказ «${c.name}» провален (риск ${Math.round(risk * 100)}%): `
    + `аванс $${loss} пришлось вернуть, репутация −${repLoss} (${Math.round(state.rep)}).`);
  return ok(`Заказ «${c.name}» провален. Аванс возвращён, репутация −${repLoss}.`, {
    failed: c.id, returned: loss, repLoss,
  });
}

// Заказ тикает в ночь: если срок вышел, а работа не сделана — провал.
function contractTick(state, { rng = defaultRng } = {}) {
  const c = state.contract;
  if (!c) return null;
  if (state.day < c.deadline) return null;
  if (c.leftDays <= 0) return null;
  const repLoss = BALANCE.contractFailRepMin
    + Math.floor(rng() * (BALANCE.contractFailRepMax - BALANCE.contractFailRepMin + 1));
  const loss = Math.max(0, c.advance);
  spendCash(state, loss);
  if (c.kind === 'manual') state.contractsDone[c.id] = true;
  state.contract = null;
  state.stats.contractsFailed += 1;
  state.rep = clamp(state.rep - repLoss, 0, 100);
  const text = `Срок заказа «${c.name}» вышел: заказ провален, аванс $${loss} возвращён, `
    + `репутация −${repLoss}.`;
  logMsg(state, 'bad', text);
  return { type: 'contract-failed', text, contractId: c.id };
}

// Раз в неделю доска обновляется сгенерированными заказами (§8).
// v3.5: тир ограничен знаниями, мощностью (2 + мощность) и свежестью
// (12 − 2×возраст). Знания без железа верхних заказов не открывают.
export function offerTierCaps(state) {
  const byKnowledge = Math.max(1, Math.min(12, Math.round(state.knowledge / 9) + 1));
  const byPower = 2 + totalPower(state);
  const byAge = 12 - 2 * pcAge(state);
  return { byKnowledge, byPower, byAge, max: Math.max(1, Math.min(12, byPower, byAge)) };
}

function offerTick(state, { rng = defaultRng } = {}) {
  if (state.day % 7 !== 0) return null;
  const events = [];
  const addOffer = (tier) => {
    const offer = generatedContract(tier, rng);
    state.contractOffers.push(offer);
    if (state.contractOffers.length > 8) state.contractOffers.shift();
    events.push({ type: 'offer', contractId: offer.id, text: `Новый заказ на доске: ${offer.name}, $${offer.pay}.` });
  };
  const caps = offerTierCaps(state);
  const tierNow = Math.min(caps.byKnowledge, caps.max);
  // v3.6: милиция сушит поток заказов (до −50%), но не трогает доход.
  const offerCut = 1 - BALANCE.racket.policeOfferCut * policePressure(state);
  if (rng() < BALANCE.contractOfferChance * offerCut) addOffer(tierNow);
  if (rng() < BALANCE.contractOfferLowerChance * offerCut) addOffer(Math.max(1, tierNow - 2));
  return events.length ? events : null;
}

// ---------------------------------------------------------------------------
// Ночь: деградация, еда, аренда/налог, болезнь, обморок, долг
// ---------------------------------------------------------------------------

export function rentFor(state) {
  // Своя квартира: аренды нет, но есть коммуналка и налог на имущество —
  // сопоставимая сумма (§2.4). Давление жилья не исчезает, просто фиксируется.
  if (hasLuxury(state, 'flat')) return BALANCE.flatPropertyTax;
  const job = jobById(state.jobId);
  return job ? job.rent : BALANCE.rent;
}

// Налог §7.3: 13% с суммы свыше $400, 20% с суммы свыше $1200.
export function taxFor(income) {
  const total = Math.max(0, num(income, 0));
  const taxable = Math.max(0, total - BALANCE.taxFree);
  const lowSlice = Math.max(0, Math.min(taxable, BALANCE.taxHighFrom - BALANCE.taxFree));
  const highSlice = Math.max(0, taxable - lowSlice);
  return Math.round(lowSlice * BALANCE.taxRate + highSlice * BALANCE.taxRateHigh);
}

export function monthlyObligations(state) {
  const income = Math.max(0, state.monthIncome);
  const rent = rentFor(state) + (state.office ? BALANCE.officeRent : 0);
  let tax = taxFor(income);
  if (skillLevel(state, 'crime') >= 4) tax = Math.round(tax * 0.75); // «Отмыв»
  const phone = round1(Math.max(0, state.monthPhoneCost));
  const phoneMinutes = Math.max(0, state.phoneMinutes);
  const server = serverUpkeep(state);
  // Коммуналка квартиры — отдельной строкой, чтобы игрок видел, за что платит.
  const luxury = luxuryUpkeep(state);
  // v3.6: содержание защиты идёт в тот же месячный блок.
  const protection = (state.racket && state.racket.protection) ? BALANCE.racket.protectionUpkeep : 0;
  return {
    income, rent, tax, phone, phoneMinutes, server, luxury, protection,
    total: round1(rent + tax + server + luxury + protection),
  };
}

// Сколько энергии будет утром: 55 + 45 × настроение/100 (правило №4).
// v3.5: машина добавляет +8 — дорога больше не съедает утро.
export function energyOnWake(state) {
  const share = clamp(state.mood / BALANCE.maxMood, 0, 1);
  const car = hasLuxury(state, 'car') ? BALANCE.carEnergy : 0;
  return Math.round(BALANCE.energyFloor + BALANCE.energySpan * share + car);
}

// Шанс простуды: от 0 при нормальном настроении до гарантированного при нуле.
export function sickChanceFor(state) {
  if (state.mood > BALANCE.sickMoodSet) return 0;
  if (state.day - num(state.lastSickDay, -99) < BALANCE.sickCooldownDays) return 0;
  return BALANCE.sickChanceAtZero;
}

// Забывание знаний: 1% от остатка, но не больше 0,6 в день.
// «Алгоритмы» (код 1) замедляют забывание на 15%.
export function forgetAmount(state) {
  const raw = Math.min(state.knowledge * BALANCE.forgetRate, BALANCE.forgetCapPerDay);
  return skillLevel(state, 'code') >= 1 ? raw * 0.85 : raw;
}

// Часть месяца: сколько дней осталось до 1-го числа.
function daysLeftInMonth(day) {
  const d = dateOf(day);
  const last = new Date(Date.UTC(d.year, d.month, 0));
  return last.getUTCDate() - d.monthDay;
}

export function sleep(state, { rng = defaultRng } = {}) {
  const blocked = guard(state);
  if (blocked) return blocked;

  const events = [];
  const endedDay = state.day;

  // 1. Новый день.
  state.day += 1;

  // 1b. v3.6: потерянные дни (отпор, наезд, переезд, арест, «дно»). День
  // пропускается целиком — с заказом, обслуживанием сервера и вечером, — но
  // сама игра не останавливается. Это не отдельная механика: те же lostDays.
  if (state.lostDays > 0) {
    state.lostDays -= 1;
    state.daySlotUsed = false;
    state.daySlotKind = null;
    state.eveningUsed = false;
    state.sickToday = false;
    state.energy = clamp(energyOnWake(state), 0, BALANCE.maxEnergy);
    const text = state.lostReason === 'police-arrest'
      ? 'День в отделении: объяснения, протокол, холодная батарея. Работа и заказы стоят.'
      : 'День потерян: разборки, синяки и разбитое железо. Работа и заказы стоят.';
    state.lostReason = null;
    logMsg(state, 'bad', text);
    events.push({ type: 'racket-lost-day', text });
    state.stats.actions += 1;
    if (state.day > TOTAL_DAYS) {
      state.day = TOTAL_DAYS + 1;
      state.result = { type: 'finish', ...scoreOf(state) };
      logMsg(state, 'info', 'Год закончился. Пора подвести итоги.');
      events.push({ type: 'finish', text: 'Год закончился.' });
      return { ok: true, message: 'Год закончился.', events, finished: true, endedDay };
    }
    checkDebt(state, events);
    if (state.result) {
      return { ok: true, message: 'Долг не закрыт — игра окончена.', events, gameOver: true, endedDay };
    }
    return { ok: true, message: `День потерян. Наступило ${formatDateRu(state.day)}.`, events, date: dateOf(state.day), endedDay };
  }

  // 2. Забывание знаний и дрейф настроения — у каждого ресурса есть сток.
  const forgot = forgetAmount(state);
  if (forgot > 0) {
    state.knowledge = clamp(round1(state.knowledge - forgot), 0, BALANCE.maxKnowledge);
  }
  state.mood = clamp(round1(state.mood - BALANCE.moodDrift), 0, BALANCE.maxMood);

  // 3. Остывание репутации и следа.
  if (state.rep > 0 && state.day % BALANCE.repDecayDays === 0) {
    state.rep = Math.max(0, state.rep - 1);
    logMsg(state, 'info', 'Репутация понемногу остывает: о вас реже вспоминают.');
  }
  if (state.heat > 0 && state.day % BALANCE.heatDecayDays === 0) {
    state.heat = Math.max(0, state.heat - 1);
    logMsg(state, 'info', 'След от старых взломов подостыл: милиция занялась чем-то другим.');
  }

  // 4. Еда — каждый день.
  spendCash(state, BALANCE.foodPerDay);

  // 5. Аренда и налог — 1-го числа. Вместе с ними: доход сервера, содержание
  // сервера и роскоши, атака, репутация от яхты/самолёта (§2.2, §2.4).
  const date = dateOf(state.day);
  if (state.day <= TOTAL_DAYS && date.monthDay === 1) {
    const monthName = MONTHS_NOM_RU[(date.month - 1 + 11) % 12];

    // 5a. Сервер: доход, атака, пиратский след.
    const gross = serverGross(state);
    let lost = 0;
    let repair = 0;
    if (serverOwned(state, 's1')) {
      if (rng() < BALANCE.serverAttackBase * serverRiskMult(state)) {
        const backup = serverOwned(state, 's4');
        lost = backup ? Math.round(gross * 0.5) : gross;
        repair = backup ? Math.round(BALANCE.serverRepairCost * 0.25) : BALANCE.serverRepairCost;
        state.stats.serverAttacks += 1;
        state.mood = clamp(state.mood - 6, 0, BALANCE.maxMood);
        if (!backup) {
          state.energy = 0;
          state.daySlotUsed = true;
          state.daySlotKind = 'repair';
        }
        const text = backup
          ? `Атака на сервер: резервные копии спасли половину — потеряно $${lost}, ремонт $${repair}.`
          : `Атака на сервер: месяц дохода потерян ($${lost}), ремонт $${repair}. Резервных копий нет.`;
        logMsg(state, 'bad', text);
        events.push({ type: 'server-attack', text, lost, repair, backup });
      }
      if (state.server.pirate) {
        state.heat = Math.min(BALANCE.heatLimit, state.heat + BALANCE.serverPirateHeat);
        const text = `Пиратский контент на сервере: +35% дохода, но след вырос до ${state.heat}.`;
        logMsg(state, 'bad', text);
        events.push({ type: 'pirate-heat', text, heat: state.heat });
      }
    }
    const net = Math.max(0, gross - lost);
    if (net > 0) {
      earnCash(state, net);
      state.books.incomeServer = round1(state.books.incomeServer + net);
      // v3.6: сервер растит известность, но в счёт рэкета не входит (§1.5).
      trackIncome(state, net, 'server');
      logMsg(state, 'money', `Сервер за ${monthName}: +$${net} (доход $${gross}`
        + `${lost ? `, потеряно $${lost}` : ''}${repair ? `, ремонт $${repair}` : ''}).`);
    }
    if (repair > 0) {
      spendCash(state, repair);
      state.books.spendRepair = round1(state.books.spendRepair + repair);
    }

    // 5b. Аренда/налог/содержание.
    const obligations = monthlyObligations(state);
    spendCash(state, obligations.total);
    state.books.spendRent = round1(state.books.spendRent + obligations.rent);
    state.books.spendTax = round1(state.books.spendTax + obligations.tax);
    state.books.spendServer = round1(state.books.spendServer + obligations.server);
    state.books.spendLuxury = round1(state.books.spendLuxury + obligations.luxury);
    if (obligations.protection > 0) {
      state.books.spendProtection = round1(state.books.spendProtection + obligations.protection);
      logMsg(state, 'money', `Содержание защиты: −$${obligations.protection}.`);
    }
    logMsg(state, 'money', `Аренда за ${MONTHS_NOM_RU[date.month - 1]}: −$${obligations.rent}`
      + `${hasLuxury(state, 'flat') ? ' (своя квартира: налог вместо аренды)' : ''}`
      + `${state.jobId ? ` (жильё под стать работе «${jobById(state.jobId).name}»)` : ''}`
      + `${state.office ? `, включая офис $${BALANCE.officeRent}` : ''}.`);
    logMsg(state, 'money', `Налог за ${monthName}: −$${obligations.tax} (с дохода $${obligations.income}).`);
    if (obligations.server > 0) {
      logMsg(state, 'money', `Содержание сервера: −$${obligations.server}`
        + `${serverOverdue(state) ? ' (обслуживание просрочено — доход вдвое ниже)' : ''}.`);
    }
    if (obligations.luxury > 0) {
      logMsg(state, 'money', `Содержание роскоши: −$${obligations.luxury}.`);
    }
    if (obligations.phone > 0) {
      logMsg(state, 'money', `Телефон за ${monthName}: $${obligations.phone} (${obligations.phoneMinutes} мин. линии, уже списано).`);
    }

    // 5c. Престиж: яхта и самолёт капают репутацией каждый месяц.
    if (hasLuxury(state, 'yacht')) state.rep = clamp(state.rep + BALANCE.yachtRepPerMonth, 0, 100);
    if (hasLuxury(state, 'plane')) state.rep = clamp(state.rep + BALANCE.planeRepPerMonth, 0, 100);

    state.pendingReceipt = {
      monthDay: date.monthDay,
      month: date.month,
      rent: obligations.rent,
      tax: obligations.tax,
      phone: obligations.phone,
      phoneMinutes: obligations.phoneMinutes,
      income: obligations.income,
      server: obligations.server,
      luxury: obligations.luxury,
      protection: obligations.protection,
      serverIncome: net,
      total: obligations.total,
    };
    events.push({ type: 'receipt', ...state.pendingReceipt });
    state.monthIncome = 0;
    state.monthPhoneCost = 0;
    state.phoneMinutes = 0;
  }

  // 6. Вирус по ночам тянет деньги со счёта.
  if (state.infected && state.cash > 0) {
    const bite = round1(Math.min(BALANCE.virusNightlyMax, state.cash * BALANCE.virusNightlyShare));
    if (bite > 0) {
      spendCash(state, bite);
      const text = `Вирус всю ночь звонил куда-то по модему: со счёта ушло $${bite}. Нужен антивирус.`;
      logMsg(state, 'bad', text);
      events.push({ type: 'virus-bite', text });
    }
  }

  // 7. Болезнь: настроение только срезается, выше текущего не поднимается.
  //    Идёт ДО обморока — так эксплойт «работать до нуля» платит и за простуду,
  //    и за обморок (иначе обморок каждый раз «съедает» болезнь).
  state.sickToday = false;
  {
    const sickChance = sickChanceFor(state);
    if (sickChance > 0 && rng() < sickChance) {
      state.sickToday = true;
      state.lastSickDay = state.day;
      spendCash(state, BALANCE.sickCost);
      state.mood = clamp(Math.min(state.mood, BALANCE.sickMoodSet), 0, BALANCE.maxMood);
      state.stats.sickDays += 1;
      const text = `Вы слегли с простудой: ${formatDateRu(state.day)} потерян, `
        + `на лекарства ушло $${BALANCE.sickCost}. Болезнь настроение не поднимает — `
        + `настроение ${Math.round(state.mood)}.`;
      logMsg(state, 'bad', text);
      events.push({ type: 'sick', mood: state.mood, text });
    }
  }

  // 8. Обморок: настроение на нуле. Два дня и $40, настроение — не выше 10.
  if (state.mood <= 0) {
    // Не «лечение»: из нуля обморок возвращает не больше 10 настроения,
    // зато отнимает два дня и $40. Это хуже прогулки (8 за день, бесплатно).
    state.mood = BALANCE.collapseMoodSet;
    state.day += BALANCE.collapseDays;
    spendCash(state, BALANCE.collapseCost);
    state.stats.collapseDays += BALANCE.collapseDays;
    state.sickToday = false;
    const text = `Обморок: вы очнулись через ${BALANCE.collapseDays} дня, в кармане минус $${BALANCE.collapseCost}. `
      + `Настроение ${Math.round(state.mood)} — до отдыха ещё далеко.`;
    logMsg(state, 'bad', text);
    events.push({ type: 'collapse', text });
  }

  // 8b. v3.6: рэкет — сроки карточек, милиция, сбор с крыши, арест, расписание.
  racketNight(state, events, { rng });

  // 9. Срок заказа.
  const failed = contractTick(state, { rng });
  if (failed) events.push(failed);

  // 10. Новая доска заказов.
  const offers = offerTick(state, { rng });
  if (offers) events.push(...offers);

  // 11. Сброс слотов и энергия на утро.
  state.daySlotUsed = false;
  state.daySlotKind = null;
  state.eveningUsed = false;
  state.energy = clamp(energyOnWake(state), 0, BALANCE.maxEnergy);
  state.stats.actions += 1;

  // 12. Конец года.
  if (state.day > TOTAL_DAYS) {
    state.day = TOTAL_DAYS + 1;
    state.result = { type: 'finish', ...scoreOf(state) };
    logMsg(state, 'info', 'Год закончился. Пора подвести итоги.');
    events.push({ type: 'finish', text: 'Год закончился.' });
    return { ok: true, message: 'Год закончился.', events, finished: true, endedDay };
  }

  // 13. Долг закрывает игру (правило №10).
  checkDebt(state, events);
  if (state.result) {
    return { ok: true, message: 'Долг не закрыт — игра окончена.', events, gameOver: true, endedDay };
  }

  // 14. Знания ниже требования текущей работы — повод остановить пакет.
  const job = jobById(state.jobId);
  if (job && job.req.knowledge && state.knowledge < job.req.knowledge) {
    const text = `Знания просели ниже требования работы «${job.name}»: `
      + `${Math.floor(state.knowledge)} против ${job.req.knowledge}. Забывание идёт каждый день.`;
    events.push({ type: 'knowledge-below', text });
  }

  logMsg(state, 'info', `${formatDateRu(state.day)}, ${dateOf(state.day).weekday}. Новый день. `
    + `Энергия ${Math.round(state.energy)} (по настроению ${Math.round(state.mood)}).`);
  return { ok: true, message: `Наступило ${formatDateRu(state.day)}.`, events, date: dateOf(state.day), endedDay };
}

function checkDebt(state, events) {
  if (state.cash <= BALANCE.debtLimit) {
    if (!state.debtWarned) {
      state.debtWarned = true;
      state.debtDeadline = state.day + BALANCE.debtGraceDays;
      state.stats.debtWarnings = (state.stats.debtWarnings || 0) + 1;
      const text = `Долг ${fmtMoney(state.cash)} глубже предела ${fmtMoney(BALANCE.debtLimit)}. `
        + `Есть ${BALANCE.debtGraceDays} ${pluralRu(BALANCE.debtGraceDays, 'день', 'дня', 'дней')} `
        + `(до ${formatDateRu(state.debtDeadline)}), иначе игра закончится.`;
      logMsg(state, 'bad', text);
      events.push({ type: 'debt-warning', text, deadline: state.debtDeadline });
    } else if (state.day >= Number(state.debtDeadline || 0)) {
      state.result = { type: 'debt', ...scoreOf(state) };
      logMsg(state, 'bad', `Долг ${fmtMoney(Math.abs(state.cash))} не закрыт. Игра окончена.`);
      events.push({ type: 'gameover', text: 'Долг не закрыт.' });
    }
  } else if (state.cash > 0 && state.debtWarned) {
    state.debtWarned = false;
    state.debtDeadline = null;
    logMsg(state, 'good', 'Долг закрыт: баланс снова положительный.');
  }
}

// ---------------------------------------------------------------------------
// Пакетный режим (§10.4): один вызов = N дней, остановка на событии
// ---------------------------------------------------------------------------

function runDayPlan(state, planDay, rng) {
  if (!planDay || planDay === 'rest') {
    return rest(state, 'walk');
  }
  if (planDay === 'work') return work(state);
  if (planDay === 'maint') return serverMaintenance(state);
  if (planDay === 'skill') return advanceSkill(state);
  if (planDay.startsWith('skill:')) {
    const branch = planDay.slice(6);
    if (state.skillProgress && state.skillProgress.branch === branch) return advanceSkill(state);
    return startSkill(state, branch);
  }
  if (planDay === 'contract') {
    if (!state.contract) {
      const options = openContracts(state).filter((c) => c.available);
      if (!options.length) return fail('На доске нет доступного заказа.');
      options.sort((a, b) => (b.pay / b.days) - (a.pay / a.days));
      const taken = acceptContract(state, options[0].id);
      if (!taken.ok) return taken;
    }
    return doContractWork(state, { rng });
  }
  if (planDay.startsWith('course:')) return study(state, planDay.slice(7));
  if (planDay.startsWith('rest:')) return rest(state, planDay.slice(5));
  return fail(`Неизвестное действие дня: ${planDay}`);
}

function runEveningPlan(state, planEvening) {
  if (!planEvening) return fail('вечер не запланирован');
  if (planEvening === 'study') return eveningStudy(state);
  if (planEvening === 'library') return eveningLibrary(state);
  if (planEvening === 'hack') return eveningHack(state);
  if (planEvening.startsWith('rest:')) return eveningRest(state, planEvening.slice(5));
  return fail(`Неизвестное вечернее действие: ${planEvening}`);
}

const STOP_EVENTS = new Set(['sick', 'collapse', 'contract-completed', 'contract-failed', 'offer', 'debt-warning', 'gameover', 'finish', 'knowledge-below',
  'racket-raid', 'police-arrest', 'racket-lost-day']);

// plan = { day: 'work'|'contract'|'course:<id>'|'rest:<id>', evening: 'study'|'library'|'rest:<id>'|'hack',
//          stopIf: { moodBelow, cashBelow, contractDone, daySlotFails } }
export function advanceDays(state, plan = {}, maxDays = 7, { rng = defaultRng } = {}) {
  const days = [];
  const stopIf = plan.stopIf || {};
  let stoppedBy = null;
  let advanced = 0;

  for (let i = 0; i < Math.max(0, Math.floor(maxDays)); i += 1) {
    if (state.result) { stoppedBy = 'gameover'; break; }
    const events = [];
    const startedDay = state.day;

    const dayResult = runDayPlan(state, plan.day, rng);
    if (!dayResult.ok) {
      events.push({ type: 'day-slot-failed', text: dayResult.error });
      days.push({ day: startedDay, events });
      stoppedBy = 'day-slot-failed';
      break;
    }
    if (dayResult.completed) events.push({ type: 'contract-completed', contractId: dayResult.completed });
    if (dayResult.failed) events.push({ type: 'contract-failed', contractId: dayResult.failed });

    if (plan.evening) {
      const evening = runEveningPlan(state, plan.evening);
      if (!evening.ok) events.push({ type: 'evening-skipped', text: evening.error });
    }

    const night = sleep(state, { rng });
    events.push(...(night.events || []));
    days.push({ day: startedDay, events });
    advanced += 1;

    if (night.finished) { stoppedBy = 'finish'; break; }
    if (night.gameOver) { stoppedBy = 'gameover'; break; }

    const stopEvent = events.find((e) => STOP_EVENTS.has(e.type)
      && !((e.type === 'contract-completed' || e.type === 'contract-failed') && stopIf.contractDone === false));
    if (stopEvent) { stoppedBy = stopEvent.type; break; }

    if (stopIf.moodBelow != null && state.mood < stopIf.moodBelow) { stoppedBy = 'mood'; break; }
    if (stopIf.cashBelow != null && state.cash < stopIf.cashBelow) { stoppedBy = 'cash'; break; }
  }

  return { daysAdvanced: advanced, days, stoppedBy };
}

// ---------------------------------------------------------------------------
// BBS, вирусы, антивирус
// ---------------------------------------------------------------------------

export function modemSpeed(state) {
  return machineSpecs(state).modem || 0;
}

export function lineMinutesFor(state, sizeMb) {
  const speed = modemSpeed(state);
  if (!speed) return 0;
  const perMb = BALANCE.lineMinutesPerMb[speed] || BALANCE.lineMinutesPerMb[14400];
  return Math.max(1, Math.ceil(sizeMb * perMb));
}

export function lineCostFor(state, sizeMb) {
  return round1(lineMinutesFor(state, sizeMb) * BALANCE.lineCostPerMinute);
}

export function bbsCatalog(state) {
  const speed = modemSpeed(state);
  return BBS_OFFERS.map((offer) => {
    const item = offer.kind === 'software' ? softwareById(offer.id) : null;
    const av = offer.kind === 'antivirus' ? antivirusById(offer.itemId || offer.id) : null;
    const minutes = lineMinutesFor(state, offer.sizeMb);
    return {
      ...offer,
      name: item ? item.name : (av ? av.name : offer.id),
      minutes,
      lineCost: round1(minutes * BALANCE.lineCostPerMinute),
      total: round1(offer.price + minutes * BALANCE.lineCostPerMinute),
      available: Boolean(speed),
    };
  });
}

export function catchRateFor(state) {
  if (!state.antivirus) return 0;
  const av = antivirusById(state.antivirus.id);
  if (!av) return 0;
  const age = state.day - Number(state.antivirus.updatedDay || 1);
  if (age > BALANCE.antivirusStaleDays) return BALANCE.antivirusStaleCatch;
  return av.catchRate;
}

export function antivirusStale(state) {
  if (!state.antivirus) return false;
  return state.day - Number(state.antivirus.updatedDay || 1) > BALANCE.antivirusStaleDays;
}

export function applyVirus(state, { rng = defaultRng, source = 'BBS' } = {}) {
  const name = VIRUS_NAMES[Math.floor(rng() * VIRUS_NAMES.length) % VIRUS_NAMES.length];
  const steal = round1(Math.min(BALANCE.virusStealMax, Math.max(0, state.cash) * BALANCE.virusStealShare));
  if (steal > 0) spendCash(state, steal);

  let wiped = [];
  const installed = Object.keys(state.software || {});
  if (installed.length > 0 && rng() < BALANCE.virusWipeChance) {
    const idx = Math.floor(rng() * installed.length) % installed.length;
    const victim = installed[idx];
    delete state.software[victim];
    wiped = [victim];
  }
  const down = rng() < BALANCE.systemDownChance;

  state.infected = true;
  state.systemDown = Boolean(down);
  state.virus = {
    name,
    stolen: steal,
    wiped,
    powerPenalty: BALANCE.virusPowerPenalty,
    source,
    day: state.day,
  };
  const parts = [`В архиве сидел вирус «${name}».`];
  if (steal > 0) parts.push(`Со счёта ушло $${steal}.`);
  parts.push(`Мощность компьютера упала на ${BALANCE.virusPowerPenalty}.`);
  if (wiped.length) parts.push(`Стёрт установленный софт: ${wiped.map((id) => (softwareById(id) || {}).name || id).join(', ')}.`);
  if (down) parts.push('Система не грузится — на работу завтра не выйти.');
  const text = parts.join(' ');
  logMsg(state, 'bad', text);
  return { name, stolen: steal, wiped, systemDown: Boolean(down), text };
}

export function downloadFromBbs(state, offerId, { rng = defaultRng } = {}) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const offer = bbsOfferById(offerId);
  if (!offer) return fail('На BBS такого файла нет.');
  if (!hasWorkingPC(state)) return fail('BBS отвечает только на звонок с компьютера, на котором есть ОС.');
  if (!modemSpeed(state)) return fail('Нужен модем: без него на BBS не дозвониться.');

  const item = offer.kind === 'software' ? softwareById(offer.id) : null;
  const av = offer.kind === 'antivirus' ? antivirusById(offer.itemId || offer.id) : null;

  if (item) {
    if (hasSoftware(state, item.id)) return fail(`${item.name} уже установлен.`);
    if (!item.req.os.includes(state.os)) {
      return fail(`Нужна ОС: ${osNamesFor(item.req.os)}. У вас установлена ${osById(state.os).name}.`);
    }
    const specs = machineSpecs(state);
    if (item.req.cpu && specs.cpu < item.req.cpu) return fail(`Слишком слабый процессор: нужен ${cpuNameForTier(item.req.cpu)}.`);
    if (item.req.ram && specs.ram < item.req.ram) return fail(`Недостаточно памяти: нужно ${item.req.ram} МБ ОЗУ.`);
    if (item.req.modem && specs.modem < item.req.modem) return fail(`Нужен модем не хуже ${item.req.modem} бод.`);
    if (diskFree(state) < item.sizeMb) return fail(`Мало места на диске: нужно ${item.sizeMb} МБ.`);
  }
  if (av && state.antivirus && state.antivirus.id === av.id) {
    return fail(`${av.name} уже установлен.`);
  }

  const minutes = lineMinutesFor(state, offer.sizeMb);
  const lineCost = round1(minutes * BALANCE.lineCostPerMinute);
  const total = round1(offer.price + lineCost);
  if (state.cash < total) {
    return fail(`Не хватает денег: файл $${offer.price} + ${minutes} мин. линии $${lineCost} = $${total}, у вас ${fmtMoney(state.cash)}.`);
  }

  spendCash(state, total);
  state.stats.actions += 1;
  state.bbsDownloads += 1;
  state.stats.bbsDownloads += 1;
  state.phoneMinutes += minutes;
  state.monthPhoneCost = round1(state.monthPhoneCost + lineCost);
  logMsg(state, 'money', `BBS: ${minutes} мин. линии на ${modemSpeed(state)} бод — $${lineCost}`
    + `${offer.price ? `, файл $${offer.price}` : ', файл бесплатно'}.`);

  let caught = false;
  if (offer.risk > 0 && state.antivirus) {
    if (rng() < catchRateFor(state)) caught = true;
  }

  if (item) {
    state.software[item.id] = true;
    state.knowledge = clamp(state.knowledge + item.knowledge, 0, BALANCE.maxKnowledge);
    logMsg(state, 'good', `Установлено с BBS: ${item.name} (+${item.knowledge} знаний).`);
  } else if (av) {
    state.antivirus = { id: av.id, updatedDay: state.day };
    logMsg(state, 'good', `Установлен ${av.name} с BBS.`);
  }

  let infection = null;
  if (caught) {
    state.stats.virusesCaught += 1;
    logMsg(state, 'good', 'Антивирус проверил архив и остановил заразу.');
  } else if (offer.risk > 0 && rng() < offer.risk) {
    infection = applyVirus(state, { rng, source: 'BBS' });
  }

  const message = infection
    ? 'Файл скачан, но в архиве был вирус.'
    : 'Файл скачан с BBS.';
  return ok(message, {
    lineCost, minutes, total, infection, caught, itemId: item ? item.id : null,
  });
}

export function buyAntivirus(state, level) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const av = antivirusById(level);
  if (!av) return fail('Такого антивируса нет в продаже.');
  if (state.antivirus && state.antivirus.id === av.id) return fail(`${av.name} уже установлен.`);
  if (!state.os) return fail('Сначала установите операционную систему.');
  if (state.cash < av.price) {
    return fail(`Не хватает денег: ${av.name} стоит $${av.price}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, av.price);
  state.stats.actions += 1;
  state.antivirus = { id: av.id, updatedDay: state.day };
  logMsg(state, 'good', `Установлен ${av.name} (−$${av.price}). Базы свежие до ${formatDateRu(state.day + BALANCE.antivirusStaleDays)}.`);
  return ok(`${av.name} установлен.`, { price: av.price });
}

export function updateAntivirus(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (!state.antivirus) return fail('Антивируса нет — нечего обновлять.');
  const av = antivirusById(state.antivirus.id);
  if (state.cash < av.updatePrice) {
    return fail(`Не хватает денег: обновление баз стоит $${av.updatePrice}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, av.updatePrice);
  state.stats.actions += 1;
  state.antivirus.updatedDay = state.day;
  logMsg(state, 'money', `Базы ${av.name} обновлены (−$${av.updatePrice}).`);
  return ok('Базы обновлены.', { price: av.updatePrice });
}

export function runAntivirus(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (!state.antivirus) {
    return fail('Антивируса нет. Купите его в магазине софта — или вызывайте мастера с дискетой, но это дороже.');
  }
  if (!state.infected) return fail('Вирусов не найдено — машина чистая.');
  const av = antivirusById(state.antivirus.id);
  const virusName = state.virus ? state.virus.name : 'вирус';
  state.infected = false;
  state.systemDown = false;
  state.virus = null;
  state.stats.actions += 1;
  state.stats.virusesCured += 1;
  logMsg(state, 'good', `${av.name} вычистил «${virusName}». Система снова грузится.`);
  return ok(`Вирус «${virusName}» вылечен.`, { virusName });
}

export function virusStatus(state) {
  if (!state.infected) {
    return {
      infected: false,
      text: 'Вирусов нет',
      systemDown: false,
      antivirus: state.antivirus ? (antivirusById(state.antivirus.id) || {}).name : null,
    };
  }
  const name = state.virus ? state.virus.name : 'неизвестный вирус';
  return {
    infected: true,
    name,
    systemDown: Boolean(state.systemDown),
    powerPenalty: BALANCE.virusPowerPenalty,
    antivirus: state.antivirus ? (antivirusById(state.antivirus.id) || {}).name : null,
    text: `Заражено: «${name}»${state.systemDown ? ' · система не грузится' : ''}`,
  };
}

// ---------------------------------------------------------------------------
// Взлом — вечерний слот (§4): механика та же, время другое
// ---------------------------------------------------------------------------

export function hackBlockers(state) {
  const reasons = [];
  const job = jobById(state.jobId);
  if ((!job || job.rank < 3) && !state.hacks) reasons.push('взлом открывается с уровня «Программист»');
  if (state.result) reasons.push('игра окончена');
  if (state.eveningUsed) reasons.push('вечер уже занят');
  if (!state.daySlotUsed) reasons.push('взлом — вечернее дело после рабочего дня');
  if (state.energy < BALANCE.hackEnergy) reasons.push(`нужно энергии ${BALANCE.hackEnergy}`);
  if (state.systemDown) reasons.push('система не грузится');
  const wait = BALANCE.hackCooldownDays - (state.day - Number(state.lastHackDay || 0));
  if (state.hacks > 0 && wait > 0) reasons.push(`заказ будет через ${wait} дн.`);
  return reasons;
}

export function hackStatus(state) {
  const reasons = hackBlockers(state);
  return {
    available: reasons.length === 0,
    reasons,
    heat: state.heat,
    limit: BALANCE.heatLimit,
    proxies: state.proxies,
    rewardMin: BALANCE.hackMinIncome,
    rewardMax: BALANCE.hackMaxIncome,
  };
}

export function buyProxy(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (state.cash < BALANCE.proxyPrice) {
    return fail(`Не хватает денег: прокси стоит $${BALANCE.proxyPrice}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, BALANCE.proxyPrice);
  state.stats.actions += 1;
  state.proxies += BALANCE.proxyCharges;
  logMsg(state, 'money', `Куплен анонимный ремейлер (−$${BALANCE.proxyPrice}): ${BALANCE.proxyCharges} `
    + `${pluralRu(BALANCE.proxyCharges, 'взлом', 'взлома', 'взломов')} без следа.`);
  return ok(`Прокси куплен: ${BALANCE.proxyCharges} чистых взлома.`, { proxies: state.proxies });
}

export function eveningHack(state, { rng = defaultRng } = {}) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const reasons = hackBlockers(state);
  if (reasons.length) return fail(`Взлом невозможен: ${reasons.join('; ')}.`);

  const target = HACK_TARGETS[Math.floor(rng() * HACK_TARGETS.length) % HACK_TARGETS.length];
  const span = BALANCE.hackMaxIncome - BALANCE.hackMinIncome;
  const reward = BALANCE.hackMinIncome + Math.round(rng() * span);

  const clean = state.proxies > 0;
  if (clean) state.proxies -= 1;
  else state.heat += BALANCE.hackTrailPerHack;

  earnCash(state, reward);
  state.monthIncome = round1(state.monthIncome + reward);
  trackIncome(state, reward);
  state.books.incomeHack = round1(state.books.incomeHack + reward);
  state.hacks += 1;
  state.lastHackDay = state.day;
  state.stats.hacks += 1;
  state.stats.actions += 1;
  state.energy = clamp(state.energy - BALANCE.hackEnergy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood - BALANCE.hackMood, 0, BALANCE.maxMood);
  state.eveningUsed = true;

  logMsg(state, 'money', `Взлом: ${target.name} — на счёт упало $${reward}.`);
  if (clean) logMsg(state, 'info', `Через анонимный ремейлер: следа нет (осталось прокси: ${state.proxies}).`);
  else logMsg(state, 'bad', `След вырос до ${state.heat} из ${BALANCE.heatLimit}. Дальше — наручники.`);

  if (state.heat >= BALANCE.heatLimit) {
    const text = 'Вас вычислили. Утром — звонок в дверь, понятые и изъятие компьютера.';
    state.result = { type: 'arrest', ...scoreOf(state), rank: 'Арестован', arrested: true };
    logMsg(state, 'bad', text);
    return ok(`Взлом удался (+$${reward}), но за вами пришли.`, { arrested: true, reward, text });
  }

  return ok(`Взлом удался: +$${reward}.`, { reward, heat: state.heat, clean });
}

// ---------------------------------------------------------------------------
// Итоги
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// v3.5: покупки — сервер и роскошь (§2.2, §2.4)
// ---------------------------------------------------------------------------

export function buyServerUpgrade(state, id) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const srv = serverById(id);
  if (!srv) return fail('Такого улучшения нет.');
  if (serverOwned(state, id)) return fail(`${srv.name} уже куплен.`);
  if (srv.needs && !serverOwned(state, srv.needs)) {
    const need = serverById(srv.needs);
    return fail(`Сначала нужен «${need.name}».`);
  }
  if (state.cash < srv.price) {
    return fail(`Не хватает денег: ${srv.name} стоит $${srv.price}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, srv.price);
  state.books.spendServer = round1(state.books.spendServer + srv.price);
  state.stats.actions += 1;
  state.server.owned[id] = true;
  if (id === 's1') state.server.lastMaintDay = state.day;
  logMsg(state, 'good', `Куплено: ${srv.name} за $${srv.price}. `
    + `Доход $${srv.income}/мес, содержание $${srv.upkeep}/мес.`);
  return ok(`${srv.name} куплен.`, { price: srv.price, income: srv.income });
}

// Обслуживание — день в месяц. Пропустил больше 30 дней — доход вдвое ниже.
export function serverMaintenance(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (!serverOwned(state, 's1')) return fail('Сервера ещё нет — обслуживать нечего.');
  if (state.daySlotUsed) return fail('День уже занят: обслуживание занимает день.');
  if (state.energy < BALANCE.serverMaintEnergy) {
    return fail(`Не хватает энергии: нужно ${BALANCE.serverMaintEnergy}, осталось ${Math.floor(state.energy)}.`);
  }
  const wasOverdue = serverOverdue(state);
  state.energy = clamp(state.energy - BALANCE.serverMaintEnergy, 0, BALANCE.maxEnergy);
  state.daySlotUsed = true;
  state.daySlotKind = 'maint';
  state.server.lastMaintDay = state.day;
  state.stats.maintDays += 1;
  state.stats.actions += 1;
  logMsg(state, 'good', 'Сервер обслужен: винты почищены, логи прокручены, доход снова полный.');
  return ok('Сервер обслужен.', { wasOverdue, gross: serverGross(state) });
}

export function setServerPirate(state, on) {
  const blocked = guard(state);
  if (blocked) return blocked;
  if (!serverOwned(state, 's1')) return fail('Сначала купите сервер.');
  state.server.pirate = Boolean(on);
  logMsg(state, 'info', state.server.pirate
    ? 'На сервере поселился пиратский контент: доход +35%, но след растёт каждый месяц.'
    : 'Пиратский контент убран: доход обычный, след больше не растёт.');
  return ok(state.server.pirate ? 'Пиратский контент включён.' : 'Пиратский контент выключен.');
}

export function buyLuxury(state, id) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const item = luxuryById(id);
  if (!item) return fail('Такой покупки нет.');
  if (hasLuxury(state, id)) return fail(`${item.name} уже есть.`);
  if (item.needs && !hasLuxury(state, item.needs)) {
    const need = luxuryById(item.needs);
    return fail(`Сначала нужно: «${need.name}». Лестница не перескакивается.`);
  }
  if (state.cash < item.price) {
    return fail(`Не хватает денег: ${item.name} стоит $${item.price}, у вас ${fmtMoney(state.cash)}.`);
  }
  spendCash(state, item.price);
  state.books.spendLuxury = round1(state.books.spendLuxury + item.price);
  state.stats.actions += 1;
  state.luxury[id] = true;
  logMsg(state, 'good', `Куплено: ${item.name} за $${item.price} (+${item.points} очков, `
    + `содержание $${item.upkeep}/мес). ${item.desc}.`);
  return ok(`${item.name} куплено.`, { price: item.price, points: item.points });
}

// ---------------------------------------------------------------------------
// v3.5: дерево навыков — уровень стоит знания + деньги + дни (§2.3)
// ---------------------------------------------------------------------------

export function startSkill(state, branch) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const cost = skillCost(state, branch);
  if (!cost) return fail('Эта ветка уже прокачана до конца.');
  const reasons = canLearn(state, branch);
  if (reasons.length) return fail(`Навык «${cost.name}»: ${reasons.join('; ')}.`);
  spendCash(state, cost.money);
  state.books.spendSkill = round1(state.books.spendSkill + cost.money);
  state.knowledge = clamp(state.knowledge - cost.knowledge, 0, BALANCE.maxKnowledge);
  state.books.knowledgeSpent = round1(state.books.knowledgeSpent + cost.knowledge);
  state.energy = clamp(state.energy - BALANCE.skillEnergy, 0, BALANCE.maxEnergy);
  state.mood = clamp(state.mood - BALANCE.skillMood, 0, BALANCE.maxMood);
  state.daySlotUsed = true;
  state.daySlotKind = 'skill';
  state.stats.skillDays += 1;
  state.stats.actions += 1;
  state.skillProgress = {
    branch,
    remaining: Math.max(0, cost.days - 1),
    level: cost.level,
  };
  logMsg(state, 'good', `Навык «${cost.name}»: первый день из ${cost.days}, `
    + `−${cost.knowledge} знаний, −$${cost.money}.`);
  if (state.skillProgress.remaining <= 0) {
    const done = finishSkill(state);
    return ok(`Навык «${cost.name}» получен. ${cost.desc}.`, { ...done, level: cost.level });
  }
  return ok(`Навык «${cost.name}»: первый день. Осталось ${state.skillProgress.remaining} дн.`, {
    level: cost.level, daysLeft: state.skillProgress.remaining,
  });
}

function finishSkill(state) {
  const p = state.skillProgress;
  state.skillProgress = null;
  state.skills[p.branch] = Math.max(state.skills[p.branch] || 0, p.level);
  const branch = SKILLS[p.branch];
  logMsg(state, 'good', `Навык получен: «${branch.name} — ${branch.levels[p.level - 1].name}». `
    + `${branch.levels[p.level - 1].desc}.`);
  return { branch: p.branch, level: p.level };
}

// Продолжение обучения: ещё один день.
export function advanceSkill(state) {
  const blocked = guard(state);
  if (blocked) return blocked;
  const p = state.skillProgress;
  if (!p) return fail('Обучение не начато.');
  if (state.daySlotUsed) return fail('День уже занят.');
  state.daySlotUsed = true;
  state.daySlotKind = 'skill';
  state.stats.skillDays += 1;
  state.stats.actions += 1;
  p.remaining -= 1;
  if (p.remaining <= 0) {
    const done = finishSkill(state);
    return ok(`Навык «${SKILLS[done.branch].levels[done.level - 1].name}» получен.`, done);
  }
  return ok(`Обучение: осталось ${p.remaining} дн.`);
}

// ---------------------------------------------------------------------------
// v3.5: экономические сводки для UI и ботов
// ---------------------------------------------------------------------------

// Полный месячный расход: аренда, еда, офис, содержание сервера и роскоши,
// резерв под налог. Нужен и боту, и подсказке «следующий счёт».
export function monthlyBurn(state) {
  const rent = rentFor(state);
  const taxProvision = 0.25 * Math.max(0, state.monthIncome || 0);
  return Math.round(rent + BALANCE.foodPerDay * 30 + (state.office ? BALANCE.officeRent : 0)
    + serverUpkeep(state) + luxuryUpkeep(state) + taxProvision + 450);
}

// Средний дневной баланс: активная игра минус содержание и пассивный доход.
export function incomePerDay(state) {
  const job = jobById(state.jobId);
  const gross = job ? job.salary * 26 : 0;
  const tax = taxFor(gross);
  const fixed = monthlyObligations({ ...state, monthIncome: 0 }).rent
    + serverUpkeep(state) + luxuryUpkeep(state) - serverGross(state);
  return Math.round((gross - tax - BALANCE.foodPerDay * 30 - fixed)) / 30;
}

export const RANK_BY_JOB = {
  janitor: 'Чайник',
  courier: 'Чайник',
  operator: 'Оператор ПК',
  programmer: 'Программист',
  sysadmin: 'Сисадмин',
  hacker: 'Хакер',
};

// Звание — по занимаемой должности, а не по сумме знаний (правило №8).
export function rankOf(state) {
  const arrested = Boolean(state.result && state.result.type === 'arrest');
  if (arrested) return 'Арестован';
  return RANK_BY_JOB[state.jobId] || 'Чайник';
}

export function scoreOf(state) {
  const power = totalPower(state);
  const cash = Math.max(0, Math.round(state.cash));
  const knowledge = Math.round(state.knowledge);
  // Формула §9: деньги (не больше 150 очков) + знания + 3×мощность +
  // 6×сданные заказы + 2×взломы. Она воспроизводит все шесть строк таблицы §9.
  const moneyPoints = Math.min(BALANCE.scoreCashCap, Math.round(cash / 100));
  const contracts = state.stats ? (state.stats.contractsDone || 0) : 0;
  // v3.5: очки за роскошь, уровни дерева и уровни сервера (§7.2).
  const luxury = luxuryPoints(state);
  const skills = skillTotal(state);
  const server = serverTier(state);
  const raw = moneyPoints + knowledge + BALANCE.scorePowerMult * power
    + BALANCE.scoreContract * contracts + BALANCE.scoreHack * (state.hacks || 0)
    + luxury + BALANCE.scoreSkill * skills + BALANCE.scoreServer * server;
  return {
    raw,
    rank: rankOf(state),
    power,
    cash,
    knowledge,
    rep: Math.round(state.rep),
    contracts,
    hacks: state.hacks || 0,
    luxury,
    skills,
    server,
    day: state.day,
    jobId: state.jobId,
    debtWarned: Boolean(state.debtWarned),
    arrested: Boolean(state.result && state.result.type === 'arrest'),
  };
}

export function fmtMoney(value) {
  const n = round1(num(value, 0));
  const sign = n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const grouped = text.replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
  return `${sign}$${grouped}`;
}

// «1 очко», «2 очка», «5 очков» — чтобы итоги не звучали как машинный перевод.
export function pluralRu(count, one, few, many) {
  const n = Math.abs(Math.round(num(count, 0))) % 100;
  const n10 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

export function fmtNum(value) {
  const n = num(value, 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export {
  BALANCE, SLOTS, PARTS, OSES, SOFTWARE, JOBS, COURSES, CONTRACTS, REST_OPTIONS, TOTAL_DAYS,
  BBS_OFFERS, ANTIVIRUSES, HACK_TARGETS, WAGE_BY_TIER, contractDensity, daysLeftInMonth,
};
