// Игровые данные «Компьютерщик'98»: железо, ОС, софт, работы, курсы, заказы, отдых.
// Все числа баланса собраны здесь, чтобы их можно было править в одном месте.
// v3: слоты дня и вечера, деградация ресурсов, заказы вместо «покупки знаний».
// Числа взяты из design/DESIGN-v3.md (§3, §4, §7, §8, §10.1, §11) — не выдуманы.

export const SAVE_VERSION = 6;

export const TOTAL_DAYS = 365;
export const START_YEAR = 1998;

export const MONTHS_RU = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

export const MONTHS_NOM_RU = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

export const WEEKDAYS_RU = [
  'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье',
];

export const BALANCE = {
  startCash: 100,
  startMood: 72,
  startEnergy: 100,
  maxEnergy: 100,
  maxMood: 100,
  maxKnowledge: 220,

  // --- Деградация и сон (v3, §3, §10.1) ------------------------------------
  // Знания забываются каждый день: 1% от остатка, но не больше 0,6 в день.
  forgetRate: 0.010,
  forgetCapPerDay: 0.6,
  // Настроение само сползает: бесплатного восстановления из сна больше нет.
  moodDrift: 0.8,
  // Репутация остывает раз в 10 дней, след — раз в 21.
  repDecayDays: 10,
  heatDecayDays: 21,
  heatLimit: 4,
  // Энергия утром: 55 + 45 × настроение/100 (жёсткое правило №4).
  energyFloor: 55,
  energySpan: 45,

  // --- Вечерний слот (§4, §10.1) -------------------------------------------
  studyEnergy: 30,
  studyMood: 2,
  studyKnowledge: 1,
  libraryK: 4,
  libraryCooldown: 10,
  libraryEnergy: 24,
  eveningMoodCap: 55,
  eveningMoodGain: 0.25,

  // --- Экономика (§7.3, §10.1) ---------------------------------------------
  rent: 60,                 // комната у тёти, когда работы нет
  rentMonths: 4.0,          // аренда = 4 дневных оклада в месяц
  foodPerDay: 3,
  taxFree: 400,             // до $400 дохода в месяц — налога нет
  taxRate: 0.13,            // 13% с суммы свыше $400...
  taxHighFrom: 1200,        // ...и 20% с суммы свыше $1200
  taxRateHigh: 0.2,
  gearDeflation: 0.955,     // железо дешевеет 4,5% в месяц — ждать выгодно
  sellRatio: 0.5,
  officePrice: 3000,
  officeRent: 180,

  // Пакетный режим (§10.4): кнопка «провести неделю» ставит эти пороги остановки.
  // Держим их здесь, чтобы README брал числа из одного места (scripts/readme-tables.mjs).
  weekDays: 7,
  weekStopMood: 25,
  weekStopCash: -120,

  // Миграция сейвов v1–v3 → v4 (§10.2): знания пересчитываются в новую шкалу.
  migrateKnowledgeMult: 2.2,

  // Испытательный срок и «пятно в трудовой» (наследие v2, оставлено).
  probationDays: 7,
  probationPayRate: 0.6,
  stainPenaltyRate: 0.25,
  stainPenaltyMin: 8,
  quitMoodPenalty: 9,

  // --- Разрыв в зарплате по знаниям (§10.2) --------------------------------
  gapBonusK: 0.5,
  gapMultMin: 0.75,
  gapMultMax: 1.25,

  // --- Курсы (§7.2, §10.1) -------------------------------------------------
  courseDensityBase: 0.110,
  courseDensityGrowth: 1.08,
  courseRepeatCostGrowth: 1.6,
  courseRepeatKnowFalloff: 0.6,
  courseRepeatKnowMin: 1,

  // --- Заказы (§7.2, §8, §10.1) -------------------------------------------
  contractAdvance: 0.3,
  contractSlack: 2,
  contractEnergy: 35,
  contractMood: 3,
  riskKnowledgeRelief: 0.5,
  riskMin: 0.02,
  densityBase: 1.15,
  densityGrowth: 1.055,
  knowledgeDayValue: 0.5,
  contractOfferChance: 0.6,
  contractOfferLowerChance: 0.35,

  // --- Болезнь, обморок, долг (§3, §10.1) ---------------------------------
  sickMoodThreshold: 6,
  sickChanceAtZero: 0.35,
  sickCooldownDays: 10,
  sickMoodSet: 6,
  sickCost: 25,
  collapseDays: 2,
  collapseCost: 40,
  collapseMoodSet: 10,
  debtLimit: -150,
  debtGraceDays: 10,
  // Арест (§4): 4 следа — и за вами приходят. Механика v2: игра окончена.
  arrestDays: 3,
  arrestFine: 500,
  arrestRep: 20,

  // --- Очки (формула §9: воспроизводит все шесть строк таблицы) -----------
  scoreCashCap: 150,
  scorePowerMult: 3,
  scoreContract: 6,
  scoreHack: 2,

  // Провал заказа бьёт по репутации на случайную величину из этого диапазона.
  contractFailRepMin: 3,
  contractFailRepMax: 13,

  // --- Модем, телефонная линия, BBS --------------------------------------
  lineCostPerMinute: 0.35,
  lineMinutesPerMb: { 14400: 1.2, 33600: 0.6, 56000: 0.35 },

  // --- Вирусы и антивирус -------------------------------------------------
  virusStealShare: 0.3,
  virusStealMax: 400,
  virusNightlyShare: 0.06,
  virusNightlyMax: 40,
  virusPowerPenalty: 3,
  virusWipeChance: 0.5,
  systemDownChance: 0.4,
  antivirusStaleDays: 30,
  antivirusStaleCatch: 0.35,

  // --- Взломы — теперь вечерний слот (§4, §3) ------------------------------
  hackEnergy: 45,
  hackMood: 8,
  hackMinIncome: 300,
  hackMaxIncome: 1200,
  hackCooldownDays: 9,
  hackTrailPerHack: 1,
  proxyPrice: 450,
  proxyCharges: 2,

  // --- v3.5: техно-гонка (DESIGN-v35 §2.1) ---------------------------------
  genStep: 60,              // новое поколение железа раз в 60 дней
  genDeflate: 0.75,         // старое поколение стоит 75% за каждый шаг
  gearResale: 0.30,         // скупка старой детали — 30% остаточной цены
  gearResaleSkill: 0.40,    // «Скупка» (криминал 3)
  agingPenaltyPerGen: 0.15, // −15% за поколение сверх допуска
  agingPenaltyFloor: 0.55,  // но не ниже 55% — игра из-за железа не кончается
  ageGraceDays: 30,         // окно после загрузки сейва v4, где возраста нет

  // --- v3.5: дерево навыков (§2.3) -----------------------------------------
  skillMaxLevel: 4,
  skillDaysCost: [1, 1, 2, 2],
  skillMoneyCost: [100, 250, 450, 800],
  skillKnowCost: [8, 14, 22, 32],
  skillEnergy: 25,
  skillMood: 1,

  // --- v3.5: свой сервер (§2.2) --------------------------------------------
  serverMaintEnergy: 20,
  serverMaintDueDays: 30,
  serverMaintPenalty: 0.5,  // не обслужен — доход вдвое ниже
  serverAttackBase: 0.10,   // шанс атаки в месяц на первом уровне
  serverRepairCost: 700,
  serverRepairDays: 1,
  serverPirateBonus: 0.35,
  serverPirateHeat: 1,
  serverKnowledgeBonus: 0.2, // доход × (1 + 0.2 × знания/220)

  // --- v3.5: роскошь (§2.4) ------------------------------------------------
  luxuryEliteTier: 9,
  luxuryElitePay: 1.12,
  carEnergy: 8,
  dachaRestBonus: 1.25,
  flatPropertyTax: 80,
  flatUpkeep: 560,
  yachtRepPerMonth: 5,
  planeRepPerMonth: 10,

  // --- v3.5: очки за новые системы (§7.2) ----------------------------------
  scoreSkill: 30,
  scoreServer: 40,

  // --- v3.6: «Рэкет» (design/DESIGN-racket.md §6.2) -------------------------
  // Все крутилки рэкета — здесь и только здесь. Ни одно число не живёт в
  // logic.js: правка BALANCE.racket меняет и игру, и таблицы README.
  racket: {
    enabled: true,
    firstDayMin: 60, firstRep: 25, firstMonthIncome: 1200,
    fameWeeks: [[4, 6], [3, 5], [3, 4], [2, 4]],
    fameIncome: [0, 2500, 5000, 8000], fameLuxPoints: 120, fameRep: 55,
    appetiteStart: 10, appetiteStep: 2.5, appetiteCap: 35, payMin: 150, floorCash: 250,
    windowDays: [3, 5],
    fightBase: 0.22, fightRep: 0.0035, fightRepCap: 60, fightPower: 0.010,
    fightAppetite: 0.006, fightProtection: 0.18, fightKrysha: 0.10,
    fightSuccessAppetite: 5, fightSuccessRep: 2, fightSuccessHeat: 1, fightSuccessPolice: 4,
    fightFailCashShare: 2.0, fightFailMin: 400, fightFailGearChance: 0.30,
    fightFailMood: 12, fightFailDays: 1, fightFailDayChance: 1.0,
    fightFailHeat: 1, fightFailPolice: 3,
    backoffChance: 0.25, backoffWeeks: [8, 11], ignorePenalty: 0.15,
    escalateEvery: 4, escalateAppetite: 3, escalatePenalty: 0.06,
    raidCash: [1200, 2500, 4000], raidDays: [1, 2, 3], raidServerDays: [0, 10, 21],
    protectionCost: 3500, protectionUpkeep: 60,
    moveCost: 900, moveServerCost: 800, moveOfficeCost: 700, moveDays: 2, moveServerDays: 5,
    moveWeeks: [9, 12], moveMax: 2, moveAppetite: 10, moveFlatResale: 0.6,
    kryshaDay: 150, kryshaRep: 55, kryshaCrime: 2, kryshaHacks: 1, kryshaSetup: 2000,
    kryshaPointIncome: 450, kryshaPointsStart: 3, kryshaPointEveryDays: 40, kryshaMaxPoints: 6,
    kryshaPoliceSetup: 18, kryshaPolicePerMonth: 22, kryshaRepPerMonth: 1,
    kryshaCompetitorChance: 0.30, competitorShare: 0.6,
    policeMax: 100, policeSafe: 40, policeDecayDays: 10, policeDecayPer10: 2,
    policeRisk: 0.12, policeOfferCut: 0.5,
    policeArrestDays: 3, policeArrestFine: 600, policeArrestRep: 20, policeArrestReset: 40,
    layLowFrom: 60, layLowDays: 21, layLowPoliceDrop: 25, layLowRep: 3, layLowMood: 6, layLowLostDays: 1,
  },

  logLimit: 80,
};

// Слоты железа. spec — числовая характеристика слота (тир процессора, МБ, бод).
export const SLOTS = [
  { id: 'cpu', label: 'Процессор', unit: '' },
  { id: 'ram', label: 'ОЗУ', unit: ' МБ' },
  { id: 'hdd', label: 'Винчестер', unit: ' МБ' },
  { id: 'gpu', label: 'Видеокарта', unit: ' МБ' },
  { id: 'modem', label: 'Модем', unit: ' бод' },
];

// Железо v3.5: семь поколений × пять слотов. `gen` — волна (появляется в
// магазине по календарю: день 1/61/121/181/241/301/361), `t` — тир деталей
// (его «видит» ОС, как раньше spec), `power` — вклад в мощность.
// Поколения 1–4 — лестница мощности 6/13/18/22; поколения 5–7 мощности НЕ
// добавляют: наверху апгрейд даёт право продолжать работать, а не силу.
export const PARTS = [
  // Процессоры
  { id: 'cpu-486', slot: 'cpu', gen: 1, t: 1, name: '486DX2-66', price: 50, spec: 1, power: 1, note: '66 МГц' },
  { id: 'cpu-p100', slot: 'cpu', gen: 2, t: 2, name: 'Pentium-100', price: 320, spec: 2, power: 3, note: '100 МГц' },
  { id: 'cpu-p266', slot: 'cpu', gen: 3, t: 3, name: 'Pentium II-266', price: 1400, spec: 3, power: 5, note: '266 МГц' },
  { id: 'cpu-p450', slot: 'cpu', gen: 4, t: 4, name: 'Pentium II-450', price: 3200, spec: 4, power: 6, note: '450 МГц' },
  { id: 'cpu-p3-450', slot: 'cpu', gen: 5, t: 4, name: 'Pentium III-450', price: 8200, spec: 4, power: 6, note: '450 МГц, Katmai' },
  { id: 'cpu-p3-600', slot: 'cpu', gen: 6, t: 4, name: 'Pentium III-600', price: 10200, spec: 4, power: 6, note: '600 МГц' },
  { id: 'cpu-p3-800', slot: 'cpu', gen: 7, t: 4, name: 'Pentium III-800', price: 11200, spec: 4, power: 6, note: '800 МГц' },

  // Память
  { id: 'ram-4', slot: 'ram', gen: 1, t: 1, name: 'SIMM 4 МБ', price: 30, spec: 4, power: 1, note: 'SIMM 72-pin' },
  { id: 'ram-16', slot: 'ram', gen: 2, t: 2, name: 'SIMM 16 МБ', price: 180, spec: 16, power: 2, note: 'SIMM 72-pin' },
  { id: 'ram-32', slot: 'ram', gen: 3, t: 3, name: 'DIMM 32 МБ', price: 420, spec: 32, power: 3, note: 'DIMM' },
  { id: 'ram-64', slot: 'ram', gen: 4, t: 4, name: 'DIMM 64 МБ', price: 900, spec: 64, power: 4, note: 'DIMM' },
  { id: 'ram-128', slot: 'ram', gen: 5, t: 4, name: 'DIMM 128 МБ', price: 2000, spec: 128, power: 4, note: 'PC100' },
  { id: 'ram-128b', slot: 'ram', gen: 6, t: 4, name: 'DIMM 128 МБ PC100', price: 2500, spec: 128, power: 4, note: 'PC100, отборные' },
  { id: 'ram-256', slot: 'ram', gen: 7, t: 4, name: 'DIMM 256 МБ', price: 2800, spec: 256, power: 4, note: 'PC133' },

  // Винчестеры
  { id: 'hdd-340', slot: 'hdd', gen: 1, t: 1, name: 'Conner 340 МБ', price: 40, spec: 340, power: 1, note: 'IDE' },
  { id: 'hdd-2g', slot: 'hdd', gen: 2, t: 2, name: 'Seagate 2,1 ГБ', price: 180, spec: 2100, power: 2, note: 'IDE' },
  { id: 'hdd-4g', slot: 'hdd', gen: 3, t: 3, name: 'Quantum 4,3 ГБ', price: 450, spec: 4300, power: 3, note: 'IDE' },
  { id: 'hdd-6g', slot: 'hdd', gen: 4, t: 4, name: 'IBM 6,4 ГБ', price: 950, spec: 6400, power: 4, note: 'IDE' },
  { id: 'hdd-8g', slot: 'hdd', gen: 5, t: 4, name: 'IBM 8,4 ГБ', price: 2300, spec: 8400, power: 4, note: 'IDE' },
  { id: 'hdd-12g', slot: 'hdd', gen: 6, t: 4, name: 'Quantum 12 ГБ', price: 2700, spec: 12000, power: 4, note: 'IDE' },
  { id: 'hdd-20g', slot: 'hdd', gen: 7, t: 4, name: 'Seagate 20 ГБ', price: 3000, spec: 20000, power: 4, note: 'IDE' },

  // Видеокарты
  { id: 'gpu-s3', slot: 'gpu', gen: 1, t: 1, name: 'S3 Trio64, 1 МБ', price: 60, spec: 1, power: 1, note: 'PCI' },
  { id: 'gpu-riva', slot: 'gpu', gen: 2, t: 2, name: 'Riva 128, 4 МБ', price: 150, spec: 2, power: 2, note: 'AGP' },
  { id: 'gpu-v1', slot: 'gpu', gen: 3, t: 3, name: 'Voodoo 1, 4 МБ', price: 320, spec: 4, power: 3, note: '3Dfx' },
  { id: 'gpu-v2', slot: 'gpu', gen: 4, t: 4, name: 'Voodoo2, 12 МБ', price: 800, spec: 12, power: 4, note: '3Dfx' },
  { id: 'gpu-v3', slot: 'gpu', gen: 5, t: 4, name: 'Voodoo 3, 16 МБ', price: 1950, spec: 16, power: 4, note: '3Dfx' },
  { id: 'gpu-tnt2', slot: 'gpu', gen: 6, t: 4, name: 'Riva TNT2, 32 МБ', price: 2400, spec: 32, power: 4, note: 'nVidia' },
  { id: 'gpu-gf', slot: 'gpu', gen: 7, t: 4, name: 'GeForce 256, 64 МБ', price: 2700, spec: 64, power: 4, note: 'nVidia' },

  // Модемы (первое поколение — 33600: без него не берут в «Операторы»)
  { id: 'modem-336', slot: 'modem', gen: 1, t: 2, name: 'Модем 33600', price: 120, spec: 33600, power: 2, note: 'Zyxel' },
  { id: 'modem-56k', slot: 'modem', gen: 2, t: 4, name: 'Модем 56k', price: 300, spec: 56000, power: 4, note: 'US Robotics' },
  { id: 'modem-56k2', slot: 'modem', gen: 3, t: 4, name: 'Модем 56k v.90', price: 300, spec: 56000, power: 4, note: 'US Robotics' },
  { id: 'modem-56k3', slot: 'modem', gen: 4, t: 4, name: 'Модем 56k внешний', price: 320, spec: 56000, power: 4, note: 'Zyxel' },
  { id: 'modem-isdn', slot: 'modem', gen: 5, t: 4, name: 'ISDN-терминал', price: 900, spec: 56000, power: 4, note: 'ISDN' },
  { id: 'modem-isdn2', slot: 'modem', gen: 6, t: 4, name: 'ISDN-терминал 128k', price: 1100, spec: 56000, power: 4, note: 'ISDN' },
  { id: 'modem-adsl', slot: 'modem', gen: 7, t: 4, name: 'ADSL-модем', price: 1250, spec: 56000, power: 4, note: 'ADSL' },
];

// Сколько поколений вышло к этому дню и когда выходит конкретное.
export const MAX_GEN = 7;
export const GEN_RELEASE = (gen) => 1 + (gen - 1) * BALANCE.genStep;
export const genName = (gen) => (gen >= 1 && gen <= MAX_GEN ? `поколение ${gen}` : '—');
export const partsOfGen = (gen) => PARTS.filter((p) => p.gen === gen);
export const genSetPrice = (gen) => partsOfGen(gen).reduce((sum, p) => sum + p.price, 0);

// Старая лестница v3/v4 (22 детали). Нужна ровно для миграции сейвов: в v3.5
// id деталей сменились на «поколенческие» (cpu-386 → cpu-486), и без этой
// таблицы normalizeState выбрасывал знакомые игроку детали в null — сейв v3
// терял процессор, винчестер, видео и модем, мощность падала до 2 и работа
// становилась недоступна. `power`/`spec` — из v4, по ним и подбирается замена.
export const LEGACY_PARTS = [
  { id: 'cpu-386', slot: 'cpu', spec: 1, power: 1 },
  { id: 'cpu-486', slot: 'cpu', spec: 2, power: 2 },
  { id: 'cpu-p133', slot: 'cpu', spec: 3, power: 3 },
  { id: 'cpu-p2-300', slot: 'cpu', spec: 4, power: 4 },
  { id: 'cpu-p2-450', slot: 'cpu', spec: 5, power: 5 },
  { id: 'ram-4', slot: 'ram', spec: 4, power: 1 },
  { id: 'ram-8', slot: 'ram', spec: 8, power: 2 },
  { id: 'ram-16', slot: 'ram', spec: 16, power: 3 },
  { id: 'ram-32', slot: 'ram', spec: 32, power: 4 },
  { id: 'ram-64', slot: 'ram', spec: 64, power: 5 },
  { id: 'hdd-210', slot: 'hdd', spec: 210, power: 1 },
  { id: 'hdd-540', slot: 'hdd', spec: 540, power: 2 },
  { id: 'hdd-1200', slot: 'hdd', spec: 1200, power: 3 },
  { id: 'hdd-3200', slot: 'hdd', spec: 3200, power: 4 },
  { id: 'hdd-6400', slot: 'hdd', spec: 6400, power: 5 },
  { id: 'gpu-trident', slot: 'gpu', spec: 1, power: 1 },
  { id: 'gpu-s3', slot: 'gpu', spec: 2, power: 2 },
  { id: 'gpu-matrox', slot: 'gpu', spec: 4, power: 3 },
  { id: 'gpu-voodoo2', slot: 'gpu', spec: 12, power: 4 },
  { id: 'modem-14400', slot: 'modem', spec: 14400, power: 1 },
  { id: 'modem-33600', slot: 'modem', spec: 33600, power: 2 },
  { id: 'modem-56000', slot: 'modem', spec: 56000, power: 3 },
];

export const legacyPartById = (id) => LEGACY_PARTS.find((p) => p.id === id) || null;

// §7.4: старый id → поколение новой лестницы. Замену ищем в том же слоте с
// ближайшей мощностью (при равном расстоянии — не слабее, из ранних поколений),
// чтобы миграция не отнимала у игрока мощность и не давала бесплатный апгрейд.
export function legacyPartReplacement(id) {
  const old = legacyPartById(id);
  // id, которого старая лестница не знала, — обычная деталь v3.5.
  if (!old) return partById(id) ? id : null;
  const candidates = partsOfSlot(old.slot);
  if (!candidates.length) return null;
  let best = null;
  for (const part of candidates) {
    const delta = Math.abs(part.power - old.power);
    const better = !best
      || delta < best.delta
      || (delta === best.delta
        && (part.power >= old.power) > (best.part.power >= old.power))
      || (delta === best.delta
        && (part.power >= old.power) === (best.part.power >= old.power)
        && part.gen < best.part.gen);
    if (better) best = { part, delta };
  }
  return best ? best.part.id : null;
}

// Пересобирает hardware старого сейва. Неизвестные id (мусор) остаются как
// есть — их выбросит обычная нормализация.
export function mapTiersToGens(hardware) {
  const out = {};
  for (const slot of SLOTS) {
    const id = hardware && hardware[slot.id];
    out[slot.id] = id ? (legacyPartReplacement(id) || id) : null;
  }
  return out;
}

// Операционные системы. req — минимумы «живого» железа, caps — что ОС умеет использовать.
// Мощность считается только через ОС (жёсткое правило №6).
export const OSES = [
  {
    id: 'dos',
    name: 'MS-DOS 6.22',
    price: 20,
    sizeMb: 20,
    knowledge: 2,
    order: 1,
    req: { cpu: 1, ram: 4, hdd: 300 },
    caps: { cpu: 1, ram: 4, hdd: 340, gpu: 1, modem: 33600 },
    note: 'Дискета 3,5" и командная строка. Видит только железо первого поколения.',
  },
  {
    id: 'win95',
    name: 'Windows 95',
    price: 150,
    sizeMb: 90,
    knowledge: 5,
    order: 2,
    req: { cpu: 2, ram: 16, hdd: 2000 },
    caps: { cpu: 2, ram: 16, hdd: 2100, gpu: 2, modem: 56000 },
    note: 'Мышь, окна и «Пуск». Второе поколение целиком — и ни детали больше.',
  },
  {
    id: 'win98',
    name: 'Windows 98',
    price: 400,
    sizeMb: 180,
    knowledge: 7,
    order: 3,
    req: { cpu: 3, ram: 32, hdd: 4000 },
    caps: { cpu: 4, ram: 64, hdd: 6400, gpu: 12, modem: 56000 },
    note: 'Свежак с прилавка. Тянет всё, что влезет в корпус, — до четвёртого поколения.',
  },
];

// Софт. Ставится один раз, даёт знания и занимает место на диске.
// Знания — разовый источник (§10.1), а не лестница.
export const SOFTWARE = [
  {
    id: 'nc', name: 'Norton Commander 5.0', price: 30, sizeMb: 2, knowledge: 2,
    req: { os: ['dos', 'win95', 'win98'], ram: 4, cpu: 1 },
    note: 'Две панели — и ты уже не чайник.',
  },
  {
    id: 'nu', name: 'Norton Utilities 8.0', price: 60, sizeMb: 8, knowledge: 3,
    req: { os: ['dos', 'win95', 'win98'], ram: 4, cpu: 1 },
    note: 'Дефрагментация, проверка диска, восстановление файлов.',
  },
  {
    id: 'pascal', name: 'Turbo Pascal 7.0', price: 60, sizeMb: 6, knowledge: 4,
    req: { os: ['dos', 'win95', 'win98'], ram: 4, cpu: 1 },
    note: 'Синий экран и мигающий курсор — начало пути.',
  },
  {
    id: 'office', name: 'Microsoft Office 97', price: 180, sizeMb: 120, knowledge: 5,
    req: { os: ['win95', 'win98'], ram: 8, cpu: 2 },
    note: 'Word, Excel, «Проводник» — всё, что нужно конторе.',
  },
  {
    id: 'learnwin', name: 'Обучающий диск «Windows для начинающих»', price: 70, sizeMb: 60, knowledge: 5,
    req: { os: ['win95', 'win98'], ram: 8, cpu: 2 },
    note: 'Голос за кадром объясняет, что такое папка.',
  },
  {
    id: 'photoshop', name: 'Adobe Photoshop 4.0', price: 220, sizeMb: 200, knowledge: 4,
    req: { os: ['win95', 'win98'], ram: 16, cpu: 3 },
    note: 'Ретушь фотографий на заказ — первый настоящий фриланс.',
  },
  {
    id: 'websuite', name: 'Пакет для Интернета (Eudora + Netscape)', price: 160, sizeMb: 90, knowledge: 5,
    req: { os: ['win95', 'win98'], ram: 8, cpu: 2, modem: 14400 },
    note: 'Почта, новости, Фидонет — окно в мир.',
  },
];

// BBS: то же самое, но с «файлопомойки» — дешевле магазина и с риском.
export const BBS_OFFERS = [
  { id: 'nc', kind: 'software', price: 0, risk: 0.15, sizeMb: 2, note: 'Архив NC5.ZIP без пароля. Паспорт не спрашивают.' },
  { id: 'nu', kind: 'software', price: 8, risk: 0.16, sizeMb: 8, note: 'NU80.ZIP с соседней станции.' },
  { id: 'pascal', kind: 'software', price: 10, risk: 0.18, sizeMb: 6, note: 'TP7_FULL.ARJ — «проверено, вроде чисто».' },
  { id: 'learnwin', kind: 'software', price: 15, risk: 0.2, sizeMb: 60, note: 'Обучалка, содранная с лицензионного диска.' },
  { id: 'office', kind: 'software', price: 40, risk: 0.22, sizeMb: 120, note: 'OFFICE97.RAR, четыре части, каждая — лотерея.' },
  { id: 'websuite', kind: 'software', price: 35, risk: 0.3, sizeMb: 90, note: 'Сборка «всё в одном» от неизвестного сисопа.' },
  { id: 'photoshop', kind: 'software', price: 50, risk: 0.25, sizeMb: 200, note: 'PS4_CRACK.ZIP с ключом в README.TXT.' },
  { id: 'antivirus-pro', kind: 'antivirus', itemId: 'pro', price: 90, risk: 0.2, sizeMb: 12, note: '«AVP Pro» с рук: ловит больше, но кто его знает.' },
];

// Лицензионный антивирус в магазине.
export const ANTIVIRUSES = [
  {
    id: 'basic',
    name: 'Антивирус «Доктор A»',
    price: 120,
    catchRate: 0.7,
    updatePrice: 15,
    note: 'Ловит семь вирусов из десяти. Обновления — раз в месяц за деньги.',
  },
  {
    id: 'pro',
    name: 'Антивирус «AVP Pro»',
    price: 260,
    catchRate: 0.85,
    updatePrice: 25,
    note: 'Ловит почти всё. В магазине дорого, на BBS — с риском.',
  },
];

// Что взламываем: только вывеска, награду считает логика.
export const HACK_TARGETS = [
  { id: 'bank', name: 'Районный сбербанк', note: 'Переводы между счетами — на себя.' },
  { id: 'firm', name: 'Фирма «Транс-Логистик»', note: 'Бухгалтерия на дискете, пароль — 1234.' },
  { id: 'provider', name: 'Городской провайдер', note: 'База абонентов и счета за линию.' },
  { id: 'plant', name: 'Завод «Прогресс»', note: 'Сметы и зарплатная ведомость.' },
  { id: 'exchange', name: 'Пункт обмена валют', note: 'Касса, камеры, но модем — общий.' },
];

// Подписи вирусов: с BBS приходит не только софт.
export const VIRUS_NAMES = [
  'Michelangelo (модификация)',
  'OneHalf.3544',
  'Cascade.1701',
  'Dir-II',
  'AntiEXE',
];

// Работы: лестница §10.1. Звание считается по занимаемой должности (правило №8),
// поэтому rank — это и есть ступень звания.
export const JOBS = [
  {
    id: 'janitor', rank: 1, name: 'Дворник', salary: 10, energy: 30, mood: 2, gain: 0,
    req: {}, note: 'Метла, лопата и свежий воздух. Берут всегда.',
  },
  {
    id: 'courier', rank: 1, name: 'Курьер-грузчик', salary: 22, energy: 45, mood: 3, gain: 0,
    req: {}, note: 'Ноги кормят, но выматывают: энергии уходит много.',
  },
  {
    id: 'operator', rank: 2, name: 'Оператор ПК', salary: 50, energy: 30, mood: 2, gain: 1,
    req: { knowledge: 20, power: 4, os: true, age: 3 }, note: 'Набирать тексты и сводки в конторе.',
  },
  {
    id: 'programmer', rank: 3, name: 'Программист', salary: 85, energy: 32, mood: 3, gain: 2,
    req: { knowledge: 80, power: 11, os: true, age: 2 }, note: 'Писать «1С»-подобное за деньги.',
  },
  {
    id: 'sysadmin', rank: 4, name: 'Сисадмин', salary: 120, energy: 32, mood: 3, gain: 2,
    req: { knowledge: 150, power: 16, os: true, rep: 18, age: 2 }, note: 'Держать в порядке чужую сеть.',
  },
  {
    id: 'hacker', rank: 5, name: 'Хакер-фрилансер', salary: 160, energy: 36, mood: 4, gain: 3,
    req: { knowledge: 215, power: 21, os: true, modem: 56000, hacks: 1, rep: 65, age: 0 },
    note: 'Заказы приходят по модему. Легально? Почти.',
  },
].map((job) => ({ ...job, rent: Math.round(job.salary * 4) }));

// Курсы §10.1: знания НЕ пишутся руками — выводятся из формулы плотности §7.2
// (жёсткое правило №9). Поэтому дорогой курс не может быть хуже дешёвого.
export const COURSE_TIERS = [
  { id: 'pc-basics', t: 1, name: 'Курсы «Оператор ПК»', price: 40, days: 1, wage: 50 },
  { id: 'prog', t: 2, name: 'Курсы «C++»', price: 100, days: 2, wage: 85 },
  { id: 'sysadmin', t: 3, name: 'Курсы «Сисадмин»', price: 150, days: 2, wage: 120 },
  { id: 'networks', t: 4, name: 'Курсы «Сети и протоколы»', price: 260, days: 3, wage: 160 },
];

export const courseDensity = (t) => BALANCE.courseDensityBase * (BALANCE.courseDensityGrowth ** (t - 1));

export const COURSES = COURSE_TIERS.map((c) => ({
  ...c,
  energy: 40 + c.t * 10,
  knowledge: Math.round(courseDensity(c.t) * (c.price + c.days * c.wage)),
  req: c.t === 1 ? {} : (c.t === 4 ? { knowledge: 95, modem: 33600 } : { knowledge: c.t === 2 ? 15 : 55 }),
  note: c.t === 1
    ? 'Клавиатура, «Ворд», «Эксель» — за партой. Один день и базовые знания.'
    : `Плотность ${courseDensity(c.t).toFixed(4)}: знаний на доллар вложения больше, чем у прошлого курса.`,
}));

// Заказы §8: 12 ручных записей. `deposit` — залог, подобранный так, чтобы
// формула §7.2 воспроизводила оплату §8 до доллара (см. design/model-v3.mjs).
const RAW_CONTRACTS = [
  { t: 1, name: 'Наклейки на дискеты соседу', days: 2, deposit: 0, k: 2, rep: 1, risk: 0.05, req: {}, note: 'Сосед просит подписать дискеты. Работы на два вечера, платят честно.' },
  { t: 2, name: 'Собрать ПК бухгалтеру', days: 3, deposit: 60, k: 3, rep: 2, risk: 0.10, req: { os: true }, note: 'Собрать из её же железа и поставить «Винду».' },
  { t: 3, name: 'Напечатать курсовую', days: 2, deposit: 0, k: 3, rep: 1, risk: 0.08, req: { knowledge: 12 }, note: 'Студентка платит вперёд, но придирается к абзацам.' },
  { t: 4, name: 'Вычистить винт от вируса', days: 3, deposit: 40, k: 4, rep: 3, risk: 0.15, req: { knowledge: 20, os: true }, note: 'Фирма поймала «Микеланджело» и паникует.' },
  { t: 5, name: 'Настроить «1С» в конторе', days: 5, deposit: 80, k: 6, rep: 5, risk: 0.20, req: { knowledge: 28, os: true }, note: 'Проводки, отчёты, бухгалтер в зачётке.' },
  { t: 6, name: 'Локальная сеть на 6 машин', days: 7, deposit: 150, k: 8, rep: 7, risk: 0.22, req: { knowledge: 40, power: 8 }, note: 'Коаксиал, терминаторы и вечное «а он меня не видит».' },
  { t: 7, name: 'Сайт для магазина', days: 6, deposit: 100, k: 10, rep: 8, risk: 0.20, req: { knowledge: 52, modem: 33600 }, note: 'Прайс, фотографии и «чтобы как у конкурентов».' },
  { t: 8, name: 'Взлом «на заказ» (серая)', days: 4, deposit: 200, k: 5, rep: -4, risk: 0.35, req: { knowledge: 62, hacks: 1 }, note: 'Заказчик не спрашивает, зачем. Репутация поедет вниз.' },
  { t: 9, name: 'Миграция бухгалтерии на Win98', days: 9, deposit: 300, k: 12, rep: 10, risk: 0.25, req: { knowledge: 70, power: 12, age: 2 }, note: 'Переставить всё, ничего не потерять, объяснить бухгалтеру.' },
  { t: 10, name: 'Спасти сервер провайдера', days: 10, deposit: 400, k: 15, rep: 14, risk: 0.30, req: { knowledge: 84, power: 16, age: 2 }, note: 'Ночью, по телефону, без права на ошибку.' },
  { t: 11, name: 'Свой продукт: «Касса 98»', days: 30, deposit: 3000, k: 18, rep: 20, risk: 0.35, req: { knowledge: 90, rep: 55, office: true, age: 2 }, note: 'Не заказ, а свой продукт: офис, лицензия, продажи.' },
  { t: 12, name: 'Аудит безопасности банка', days: 12, deposit: 500, k: 10, rep: 18, risk: 0.30, req: { knowledge: 95, rep: 70, age: 2 }, note: 'Легальная проверка на прочность: странно, но платят.' },
];

export const WAGE_BY_TIER = {
  1: 22, 2: 50, 3: 50, 4: 85, 5: 85, 6: 85, 7: 120, 8: 120, 9: 120, 10: 160, 11: 160, 12: 160,
};

// Плотность заказа по тиру: 1,15 × 1,055^(t−1) (§7.2).
export const contractDensity = (t) => BALANCE.densityBase * (BALANCE.densityGrowth ** (t - 1));

// §7.2: оплата = плотность × (дни×ставка + залог) − знания×ставка/2.
export function contractPay(t, days, deposit, knowledgeReward) {
  const rate = WAGE_BY_TIER[t] || WAGE_BY_TIER[1];
  return Math.round(contractDensity(t) * (days * rate + deposit) - (knowledgeReward * rate) / 2);
}

// Выгода на единицу вложения (§7.1): польза / (дни×ставка + залог).
export function contractBenefit(t, days, deposit, knowledgeReward) {
  const rate = WAGE_BY_TIER[t] || WAGE_BY_TIER[1];
  const pay = contractPay(t, days, deposit, knowledgeReward);
  return (pay + (knowledgeReward * rate) / 2) / (days * rate + deposit);
}

export const CONTRACTS = RAW_CONTRACTS.map((c) => ({
  ...c,
  id: `c${String(c.t).padStart(2, '0')}`,
  kind: 'manual',
  knowledge: c.k,
  pay: contractPay(c.t, c.days, c.deposit, c.k),
  benefit: contractBenefit(c.t, c.days, c.deposit, c.k),
}));

// Генератор после 12-го заказа (§8): тир от знаний, дни/знания/залог из той же
// формулы плотности, поэтому сгенерированный заказ так же выгоден, как ручной.
export function generatedContract(tier, rng = Math.random) {
  const t = Math.max(1, Math.min(12, Math.round(tier)));
  const days = 4 + Math.floor(rng() * 7);          // 4..10
  const knowledge = 3 + Math.floor(rng() * 7);     // 3..9
  const deposit = [0, 100, 200, 300, 400][Math.floor(rng() * 5)];
  return {
    id: `gen-${t}-${Math.floor(rng() * 1e9)}`,
    kind: 'generated',
    t,
    name: `Заказ ${t}-го тира`,
    days,
    deposit,
    k: knowledge,
    knowledge,
    rep: Math.max(1, Math.round(t * 1.5)),
    risk: Math.round((0.12 + 0.015 * t) * 100) / 100,
    pay: contractPay(t, days, deposit, knowledge),
    benefit: contractBenefit(t, days, deposit, knowledge),
    req: { knowledge: Math.max(0, (t - 1) * 8) },
    note: 'Доска обновилась: заказ пришёл по телефону, срок поджимает.',
  };
}

// Отдых днём: цена дня. energy — сколько энергии он съедает (§4: 0..20).
export const REST_OPTIONS = [
  { id: 'walk', name: 'Прогулка по району', price: 0, mood: 8, energy: 0, note: 'Бесплатно: воздух, собаки, разговоры у подъезда. Немного настроения — и день ушёл.' },
  { id: 'cinema', name: 'Видеосалон («Элен и ребята»)', price: 6, mood: 14, energy: 10, note: 'Два фильма на кассете, попкорн нельзя.' },
  { id: 'arcade', name: 'Автомат «Арканоид» в подвале', price: 12, mood: 20, energy: 15, note: 'Пятнадцать минут — и ты снова человек. Но день уже не вернуть.' },
  { id: 'sauna', name: 'Сауна с друзьями', price: 18, mood: 34, energy: 20, note: 'Дорого, но выходишь новым человеком.' },
];

// Вечернее развлечение: 25% от дневного и не выше 55 (жёсткое правило №3).
export const EVENING_RESTS = [
  { id: 'e-walk', name: 'Погулять перед сном', price: 0, mood: 2, energy: 10, note: 'Свежий воздух и тишина. Дёшево и почти бесполезно.' },
  { id: 'e-arcade', name: 'Аркада на полчаса', price: 4, mood: 4, energy: 12, note: 'Один жетон — и день не такой пустой.' },
  { id: 'e-cinema', name: 'Видеосалон вечером', price: 6, mood: 6, energy: 16, note: 'Кассета на ночь. Утром всё равно на работу.' },
  { id: 'e-club', name: 'Клуб с друзьями', price: 8, mood: 9, energy: 20, note: 'Дороже и позже, зато настроение держится.' },
];

export function eveningRestById(id) {
  return EVENING_RESTS.find((r) => r.id === id) || null;
}

// Вечернее развлечение даёт 25% дневного, но не поднимает настроение выше 55.
export function eveningRestGain(option, mood) {
  if (!option) return 0;
  return Math.max(0, Math.min(option.mood, BALANCE.eveningMoodCap - mood));
}

export function partById(id) {
  return PARTS.find((p) => p.id === id) || null;
}

export function partsOfSlot(slot) {
  return PARTS.filter((p) => p.slot === slot);
}

export function osById(id) {
  return OSES.find((o) => o.id === id) || null;
}

export function softwareById(id) {
  return SOFTWARE.find((s) => s.id === id) || null;
}

export function jobById(id) {
  return JOBS.find((j) => j.id === id) || null;
}

export function courseById(id) {
  return COURSES.find((c) => c.id === id) || null;
}

export function restById(id) {
  return REST_OPTIONS.find((r) => r.id === id) || null;
}

export function contractById(id) {
  return CONTRACTS.find((c) => c.id === id) || null;
}

export function bbsOfferById(id) {
  return BBS_OFFERS.find((o) => o.id === id) || null;
}

export function antivirusById(id) {
  return ANTIVIRUSES.find((a) => a.id === id) || null;
}

export function hackTargetById(id) {
  return HACK_TARGETS.find((t) => t.id === id) || null;
}

// Название самого дешёвого процессора, который закрывает требование.
export function cpuNameForTier(tier) {
  const parts = partsOfSlot('cpu').filter((p) => p.spec >= tier).sort((a, b) => a.spec - b.spec);
  return parts.length ? parts[0].name : 'процессор';
}

export function osNamesFor(ids) {
  return ids.map((id) => (osById(id) || {}).name || id).join(' / ');
}

// ---------------------------------------------------------------------------
// v3.5: дерево навыков (DESIGN-v35 §2.3)
// Каждый уровень — ровно одно число-модификатор. Гейтов нет: ни работа, ни
// заказ не смотрят на уровень навыка.
// ---------------------------------------------------------------------------

export const SKILLS = {
  hw: {
    name: 'Железо',
    levels: [
      { name: 'Пайка и тестер', desc: 'железо дешевле на 10%' },
      { name: 'Разгон', desc: '+1 мощность к любому ПК' },
      { name: 'Сборка на заказ', desc: 'заказы с требованием мощности платят +10%' },
      { name: 'Своя мастерская', desc: 'железо дешевле ещё на 20% (итого −28%)' },
    ],
  },
  code: {
    name: 'Код',
    levels: [
      { name: 'Алгоритмы', desc: 'заказы и зарплата +8%, забывание −15%' },
      { name: 'Отладка', desc: 'риск провала заказа −25%' },
      { name: 'Быстрый код', desc: '+1 знание за рабочий день' },
      { name: 'Свой продукт', desc: 'заказы с 9-го тира платят +12%' },
    ],
  },
  net: {
    name: 'Сети',
    levels: [
      { name: 'Модемы', desc: 'шанс атаки на сервер и заражения −25%' },
      { name: 'Прокси', desc: 'шанс ареста −30%' },
      { name: 'Сервер', desc: 'доход с сервера +15%' },
      { name: 'Свой канал', desc: 'содержание сервера −20%' },
    ],
  },
  crime: {
    name: 'Криминал',
    levels: [
      { name: 'Тишина', desc: 'шанс ареста −20%' },
      { name: 'Свои люди', desc: 'штраф при аресте −30%' },
      { name: 'Скупка', desc: 'старое железо сдаётся за 40% вместо 30%' },
      { name: 'Отмыв', desc: 'налог −25%' },
    ],
  },
};

export const SKILL_BRANCHES = ['hw', 'code', 'net', 'crime'];

export function skillBranchById(id) {
  return SKILLS[id] || null;
}

// ---------------------------------------------------------------------------
// v3.5: свой сервер (§2.2). Доход ежемесячный, обслуживание — день в месяц.
// ---------------------------------------------------------------------------

export const SERVERS = [
  { id: 's1', name: 'Сервер в гараже', price: 6500, income: 1000, upkeep: 220, riskMult: 1.0, needs: null },
  { id: 's2', name: 'Вторая машина', price: 4500, income: 875, upkeep: 160, riskMult: 1.0, needs: 's1' },
  { id: 's3', name: 'Свой канал, 2 Мбит', price: 4000, income: 750, upkeep: 240, riskMult: 0.7, needs: 's2' },
  { id: 's4', name: 'Резервные копии', price: 3000, income: 375, upkeep: 100, riskMult: 0.5, needs: 's2' },
];

export function serverById(id) {
  return SERVERS.find((s) => s.id === id) || null;
}

// ---------------------------------------------------------------------------
// v3.5: роскошь (§2.4). У каждой покупки есть содержание и очки: разовой
// покупкой роскошь не бывает.
// ---------------------------------------------------------------------------

export const LUXURY = [
  { id: 'car', name: 'Волга 3110', price: 3500, upkeep: 70, points: 50, needs: null, desc: '+8 энергии каждое утро' },
  { id: 'garage', name: 'Гараж', price: 1200, upkeep: 15, points: 18, needs: 'car', desc: '+1 мощность' },
  { id: 'flat', name: 'Своя квартира', price: 9000, upkeep: BALANCE.flatUpkeep, points: 135, needs: null, desc: 'аренды нет: коммуналка $560 + налог $80' },
  { id: 'dacha', name: 'Дача', price: 5000, upkeep: 60, points: 78, needs: null, desc: 'дневной отдых даёт +25% настроения' },
  { id: 'yacht', name: 'Яхта', price: 22000, upkeep: 700, points: 350, needs: 'flat', desc: '+5 репутации в месяц, элитные заказы +12%' },
  { id: 'plane', name: 'Самолёт', price: 60000, upkeep: 2500, points: 960, needs: 'yacht', desc: '+10 репутации в месяц, элитные заказы +12%' },
];

export function luxuryById(id) {
  return LUXURY.find((l) => l.id === id) || null;
}
