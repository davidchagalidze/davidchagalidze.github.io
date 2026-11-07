/**
 * Dig Deeper — исполняемая модель экономики v1.
 *
 * Чистые функции, Node без зависимостей. Единственный источник чисел:
 * игра импортирует ECONOMY / DEPTH / AXES / LAYERS отсюда, а док
 * (design/dig-deeper-design-v1.md) собирается из вывода design/tables.mjs,
 * который читает эти же объекты. Руками числа в документ не пишутся.
 *
 * Термины:
 *   забег == день (1 забег = 1 день кампании);
 *   бар = 1 + depth / DEPTH.metersPerBar  (давление);
 *   рейтинг корпуса = давление на безопасной глубине тира.
 *
 * Публичный API:
 *   initialState(opts)                 → состояние на старте кампании
 *   deriveStats(state, cfg?)           → производные характеристики машины
 *   pressureAt(depth, cfg?)            → бар
 *   ambientTemp(depth, cfg?)           → °C породы
 *   oreValuePerUnit(depth, cfg?)       → $ за единицу руды на глубине
 *   simulateRun(state, policy, cfg?)   → { depth, mined, income, fuelCost, repairCost, hullLost, died, days, ... }
 *   buyUpgrade(state, axis, cfg?)      → { ok, state, cost, reason }
 *   advanceDay(state, cfg?)            → { state, events, payment, interest, status }
 *   playDay(state, policy, cfg?)       → { state, run, day, events }
 *   enterFreePlay(state, cfg?)         → отдельное песочное состояние (долг не гасится)
 */

export const VERSION = 'v1';

/* ------------------------------------------------------------------ *
 * 6 осей апгрейда. 5 тиров у каждой (0 — сток, 4 — максимум).        *
 * cost — цена перехода НА этот тир.                                   *
 * ------------------------------------------------------------------ */
export const AXES = {
  hull: {
    key: 'hull',
    label: 'Корпус',
    // hp — запас прочности, safeDepth — максимальная глубина без урона от давления,
    // repairMult — во сколько дороже ремонт HP на этом тире (растущая цена глубины).
    tiers: [
      { cost: 0,     hp: 100, safeDepth: 300,  repairMult: 1.00 },
      { cost: 1500,  hp: 150, safeDepth: 600,  repairMult: 1.15 },
      { cost: 5000,  hp: 220, safeDepth: 1500, repairMult: 1.35 },
      { cost: 10000, hp: 310, safeDepth: 2200, repairMult: 1.60 },
      { cost: 20000, hp: 430, safeDepth: 3400, repairMult: 1.90 },
    ],
  },
  engine: {
    key: 'engine',
    label: 'Двигатель',
    tiers: [
      { cost: 0,     speedDown: 8.0,  speedUp: 5.0,  burnMult: 1.00 },
      { cost: 900,   speedDown: 9.6,  speedUp: 6.0,  burnMult: 0.95 },
      { cost: 3000,  speedDown: 11.5, speedUp: 7.2,  burnMult: 0.90 },
      { cost: 6500,  speedDown: 13.8, speedUp: 8.6,  burnMult: 0.85 },
      { cost: 12000, speedDown: 16.5, speedUp: 10.3, burnMult: 0.80 },
    ],
  },
  drill: {
    key: 'drill',
    label: 'Бур',
    // rate — единиц руды в секунду на «своей» породе; hardness — до какой твёрдости
    // бур работает штатно (ниже — режет скорость в hardnessPenalty раз).
    tiers: [
      { cost: 0,     rate: 0.50, hardness: 1 },
      { cost: 800,   rate: 0.68, hardness: 2 },
      { cost: 2500,  rate: 0.92, hardness: 3 },
      { cost: 5500,  rate: 1.25, hardness: 4 },
      { cost: 10000, rate: 1.70, hardness: 5 },
    ],
  },
  cargo: {
    key: 'cargo',
    label: 'Трюм',
    // slots — единиц руды (и расходников) в трюме; weightSlow — штраф к скорости
    // подъёма (тяжёлый трюм медленнее всплывает = дольше под давлением).
    tiers: [
      { cost: 0,     slots: 14, weightSlow: 1.00 },
      { cost: 700,   slots: 20, weightSlow: 1.06 },
      { cost: 2400,  slots: 28, weightSlow: 1.12 },
      { cost: 5500,  slots: 38, weightSlow: 1.18 },
      { cost: 10000, slots: 50, weightSlow: 1.24 },
    ],
  },
  fuel: {
    key: 'fuel',
    label: 'Бак',
    tiers: [
      { cost: 0,     liters: 40,  weightSlow: 1.00 },
      { cost: 700,   liters: 80,  weightSlow: 1.02 },
      { cost: 2200,  liters: 120, weightSlow: 1.04 },
      { cost: 5000,  liters: 170, weightSlow: 1.06 },
      { cost: 9000,  liters: 230, weightSlow: 1.08 },
    ],
  },
  cooling: {
    key: 'cooling',
    label: 'Охлаждение',
    // coolRate — °C/сек отвода при разнице 10°, maxTemp — предел, выше — урон корпусу.
    tiers: [
      { cost: 0,     coolRate: 1.0, maxTemp: 70 },
      { cost: 900,   coolRate: 1.5, maxTemp: 85 },
      { cost: 2800,  coolRate: 2.1, maxTemp: 105 },
      { cost: 6000,  coolRate: 2.9, maxTemp: 125 },
      { cost: 10000, coolRate: 3.8, maxTemp: 150 },
    ],
  },
};

export const AXIS_ORDER = ['hull', 'engine', 'drill', 'cargo', 'fuel', 'cooling'];

/* ------------------------------------------------------------------ *
 * Слои глубины. Границы — из карточки кодера (5 полос).              *
 * ------------------------------------------------------------------ */
export const LAYERS = [
  { index: 0, key: 'soil',    name: 'Грунт',     from: 0,    to: 150,  hardness: 1, ambientAdd: 0,  hazard: 'мягкий грунт: быстро, дёшево, мало' },
  { index: 1, key: 'rock',    name: 'Порода',    from: 150,  to: 600,  hardness: 1, ambientAdd: 1,  hazard: 'валуны: бур режет медленно, если тир ниже' },
  { index: 2, key: 'crystal', name: 'Кристаллы', from: 600,  to: 1500, hardness: 2, ambientAdd: 2,  hazard: 'карманы воды: сбивают температуру, но бьют по корпусу при вскрытии' },
  { index: 3, key: 'lava',    name: 'Лава',      from: 1500, to: 3000, hardness: 3, ambientAdd: 6,  hazard: 'магма: +6°C к фону, перегрев без охлаждения' },
  { index: 4, key: 'abyss',   name: 'Бездна',    from: 3000, to: 4200, hardness: 4, ambientAdd: 10, hazard: 'давление + жар одновременно' },
];

/* ------------------------------------------------------------------ *
 * Экономика. Всё, что код игры должен читать, а не переписывать.      *
 * ------------------------------------------------------------------ */
export const ECONOMY = {
  version: VERSION,

  // ── руда ──────────────────────────────────────────────────────────
  // Цена единицы растёт с глубиной квадратично: depth платит нелинейно.
  //   value(d) = base + linear*d + quad*d*d  (линейная + квадратичная часть)
  ore: {
    base: 16,
    linear: 0.07,
    quad: 0.00004,
    variance: 0.18,          // ±18% разброс цены единицы за забег
    jackpotChance: 0.015,    // «богатая жила»: 1.5% единиц
    jackpotMult: 2.2,        // ... дороже в 2.2 раза
    // Истощение слоя: слой отдаёт reserve единиц, дальше цена падает до floor.
    reservePerLayer: 3000,
    depletionFloor: 0.50,
  },

  // ── топливо ───────────────────────────────────────────────────────
  fuel: {
    pricePerLiter: 6.0,      // $ за литр
    burnBase: 0.085,         // л/сек на тире 0 (умножается на burnMult двигателя)
    depthBurnPer1000m: 0.12, // +12% расхода на каждые 1000 м (насосам тяжелее)
    fillMinimum: 25,         // минимальный чек заправки, $
  },

  // ── ремонт ────────────────────────────────────────────────────────
  repair: {
    perHp: 1.0,              // $ за 1 HP на тире 0 корпуса
    depthPer1000m: 0.55,     // +55% к цене HP на 1000 м (глубинный ремонт дороже)
    minimum: 0,              // ремонт не берёт денег, если HP целый
  },

  // ── смерть ────────────────────────────────────────────────────────
  death: {
    loseCargo: true,         // груз теряется
    towFee: 120,             // эвакуация машины: фикс
    keepUpgrades: true,      // апгрейды и банк остаются
    hardcore: false,         // флаг «хардкор»: при смерти теряется тир (по умолчанию off)
  },

  // ── расходники (занимают слот трюма) ──────────────────────────────
  consumables: {
    capsule:   { key: 'capsule',   label: 'Капсула давления', price: 550, ratingBonus: 0.55, slots: 1 },
    coolant:   { key: 'coolant',   label: 'Охлаждающая смесь', price: 160, coolMult: 1.9, slots: 1 },
    repairKit: { key: 'repairKit', label: 'Ремонтный набор',  price: 220, healFrac: 0.40, slots: 1 },
  },

  // ── ипотека ───────────────────────────────────────────────────────
  // Платёж раз в 5 забегов = 40% выручки этих 5 забегов, но не меньше floor.
  // Доля, а не фикс: плохой забег не превращается в кабалу (это и была
  // главная жалоба на оригинал: «копал только чтобы заправиться»).
  mortgage: {
    principal: 100000,
    paymentEveryRuns: 5,
    share: 0.40,
    floor: 400,              // минимальный платёж, $ — наказывает простой
    dailyInterest: 0.0009,   // 0.09%/день на остаток
    deadlineDays: 45,        // после — отчуждение фермы
    warningsBeforeSeize: 3,  // 3 пропуска подряд → отчуждение
    tierLossPerMiss: 1,      // 2-й пропуск подряд → теряется тир апгрейда
  },

  startCash: 0,
  freePlayStartCash: 0,
};

/* ------------------------------------------------------------------ *
 * Глубина: давление, температура, время.                              *
 * ------------------------------------------------------------------ */
export const DEPTH = {
  maxDepth: 4200,
  metersPerBar: 300,        // давление = 1 + depth/300
  surfaceTemp: 20,          // °C на поверхности
  ambientPer100m: 2.2,      // °C на 100 м породы

  // Урон давлением: dps = pressureK * max(0, bar - rating)^pressureExp * (1 + времяПодДавлением/tau)
  // Второй множитель — «усталость корпуса»: короткий мазок за рейтинг почти
  // бесплатен, а долгая добыча ниже рейтинга убивает даже крепкую машину.
  pressureK: 8.0,
  pressureExp: 2.0,
  pressureFatigueTau: 40,   // сек; на 40-й секунде ниже рейтинга урон вдвое

  // Тепло: dT = mineHeat + heatPerUnit*rate - coolRate*(T-ambient)/coolTau
  mineHeat: 3.0,            // °C/сек от работающего бура
  heatPerUnit: 1.1,         // °C/сек на единицу/сек добычи
  coolTau: 9,               // сек инерции охлаждения
  overheatDps: 0.45,        // HP/сек на градус перегрева

  // Топливо: запас на подъём с коэффициентом.
  ascentReserve: 1.20,

  // Производительность/безопасность
  hardnessPenalty: 0.35,    // множитель скорости бура, если порода твёрже тира
  hardnessQuality: 0.12,    // −12% цены руды за каждый «лишний» уровень твёрдости
  hardnessQualityFloor: 0.65,
  maxRunSeconds: 1200,      // страховочный предел длительности забега
};

const CFG = { ECONOMY, DEPTH, AXES, LAYERS };
export { CFG };

/* ------------------------------------------------------------------ *
 * Утилиты                                                             *
 * ------------------------------------------------------------------ */
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const round2 = (v) => Math.round(v * 100) / 100;

export function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function hashInt(...xs) {
  let h = 2166136261 >>> 0;
  for (const x of xs) {
    h ^= (x | 0);
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/* ------------------------------------------------------------------ *
 * Формулы глубины                                                     *
 * ------------------------------------------------------------------ */
export function pressureAt(depth, cfg = CFG) {
  return 1 + Math.max(0, depth) / cfg.DEPTH.metersPerBar;
}

export function ambientTemp(depth, cfg = CFG) {
  const D = cfg.DEPTH;
  const L = layerAt(depth, cfg);
  return D.surfaceTemp + D.ambientPer100m * (depth / 100) + (L?.ambientAdd ?? 0);
}

export function layerAt(depth, cfg = CFG) {
  const L = cfg.LAYERS;
  for (let i = L.length - 1; i >= 0; i--) if (depth >= L[i].from) return L[i];
  return L[0];
}

export function oreValuePerUnit(depth, cfg = CFG) {
  const o = cfg.ECONOMY.ore;
  return o.base + o.linear * depth + o.quad * depth * depth;
}

/** Множитель истощения слоя: чем больше из него выбрано, тем дешевле руда. */
export function layerFatigue(state, layerIndex, cfg = CFG) {
  const o = cfg.ECONOMY.ore;
  const mined = state.layerMined?.[layerIndex] ?? 0;
  const left = 1 - mined / o.reservePerLayer;
  return clamp(left, o.depletionFloor, 1);
}

/* ------------------------------------------------------------------ *
 * Состояние                                                           *
 * ------------------------------------------------------------------ */
export function initialState(opts = {}) {
  const tiers = {};
  for (const a of AXIS_ORDER) tiers[a] = 0;
  return {
    mode: 'campaign',            // 'campaign' | 'freeplay'
    day: 0,
    runs: 0,
    seed: opts.seed ?? 1,
    cash: opts.cash ?? ECONOMY.startCash,
    debt: opts.debt ?? ECONOMY.mortgage.principal,
    debtPaid: 0,
    lastFiveGross: [],           // выручка последних 5 забегов
    bankEscrow: 0,               // 40% выручки, отложенные банку до дня платежа
    windowPaid: 0,               // сколько банк получил в текущем 5-забежном окне
    missedPayments: 0,
    consecutiveMisses: 0,
    warnings: [],
    tiers: Object.assign(tiers, opts.tiers || {}),
    layerMined: cfgLayers().map(() => 0),
    totalIncome: 0,
    totalFuel: 0,
    totalRepair: 0,
    totalConsumables: 0,
    totalUpgrades: 0,
    totalBank: 0,
    totalTow: 0,
    bestDepth: 0,
    bestNet: 0,
    status: 'playing',           // playing | won | seized
  };
}

function cfgLayers() { return LAYERS; }

/* ------------------------------------------------------------------ *
 * Производные характеристики                                          *
 * ------------------------------------------------------------------ */
export function deriveStats(state, cfg = CFG) {
  const A = cfg.AXES;
  const t = Object.assign({ hull: 0, engine: 0, drill: 0, cargo: 0, fuel: 0, cooling: 0 }, state.tiers || {});
  const hull = A.hull.tiers[t.hull];
  const engine = A.engine.tiers[t.engine];
  const drill = A.drill.tiers[t.drill];
  const cargo = A.cargo.tiers[t.cargo];
  const fuel = A.fuel.tiers[t.fuel];
  const cool = A.cooling.tiers[t.cooling];

  const slow = cargo.weightSlow * fuel.weightSlow;
  return {
    tier: Object.assign({}, t),
    hp: hull.hp,
    safeDepth: hull.safeDepth,
    pressureRating: pressureAt(hull.safeDepth, cfg),
    repairMult: hull.repairMult,
    speedDown: engine.speedDown / slow,
    speedUp: engine.speedUp / slow,
    burnPerSec: cfg.ECONOMY.fuel.burnBase * engine.burnMult,
    rate: drill.rate,
    hardness: drill.hardness,
    cargoSlots: cargo.slots,
    tankLiters: fuel.liters,
    coolRate: cool.coolRate,
    maxTemp: cool.maxTemp,
  };
}

/** Скорость добычи с учётом твёрдости породы. */
export function mineRateAt(S, layer, cfg = CFG) {
  const hard = Math.max(0, (layer?.hardness ?? 1) - S.hardness);
  return S.rate * Math.max(0.30, 1 - 0.25 * hard);
}

/** Цена ремонта 1 HP на данной глубине и тире корпуса. */
export function repairCostPerHp(S, depth, cfg = CFG) {
  const r = cfg.ECONOMY.repair;
  return r.perHp * S.repairMult * (1 + (depth / 1000) * r.depthPer1000m);
}

/** Сколько литров нужно, чтобы сходить на глубину depth и вернуться (+ extraSec добычи). */
export function fuelNeededFor(depth, S, cfg = CFG, extraSec = 0) {
  const burn = S.burnPerSec * (1 + (depth / 1000) * cfg.ECONOMY.fuel.depthBurnPer1000m);
  return burn * (depth / S.speedDown + depth / S.speedUp + extraSec) * cfg.DEPTH.ascentReserve;
}

/**
 * Максимальная глубина, на которую хватит бака с запасом на подъём.
 * Именно этот предел должен рисовать HUD («бака хватит до N м»).
 */
export function maxReachableDepth(S, cfg = CFG, extraSec = 0) {
  let lo = 0, hi = cfg.DEPTH.maxDepth;
  if (fuelNeededFor(hi, S, cfg, extraSec) <= S.tankLiters) return hi;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fuelNeededFor(mid, S, cfg, extraSec) <= S.tankLiters) lo = mid; else hi = mid;
  }
  return Math.floor(lo / 10) * 10;
}

/** Секунды, нужные, чтобы заполнить трюм на данной глубине. */
export function mineSecondsForCargo(S, depth, cfg = CFG, slots = null) {
  const layer = layerAt(depth, cfg);
  const rate = mineRateAt(S, layer, cfg);
  return (slots == null ? S.cargoSlots : slots) / rate;
}

/**
 * Максимальная глубина, на которой машина ещё не перегревается при добыче.
 * Равновесная температура: фон + тепло бура × инерция охлаждения.
 */
export function thermalLimitDepth(S, cfg = CFG) {
  const heat = (cfg.DEPTH.mineHeat + cfg.DEPTH.heatPerUnit * S.rate) * cfg.DEPTH.coolTau / S.coolRate;
  let best = 0;
  for (let d = 0; d <= cfg.DEPTH.maxDepth; d += 25) {
    if (ambientTemp(d, cfg) + heat <= S.maxTemp) best = d; else break;
  }
  return best;
}

/**
 * «Своя» глубина по всем трём ограничениям сразу: рейтинг корпуса, бак, тепло.
 * Именно это должен показывать HUD как «машина тянет до N м».
 */
export function comfortableDepth(S, cfg = CFG) {
  const mineSec = mineSecondsForCargo(S, S.safeDepth, cfg);
  return Math.min(S.safeDepth, maxReachableDepth(S, cfg, mineSec), thermalLimitDepth(S, cfg));
}

/* ------------------------------------------------------------------ *
 * Забег                                                               *
 * ------------------------------------------------------------------ *
 * policy: { plan(state, S, cfg) -> { depth, loadout: {capsule,coolant,repairKit} } }
 * ------------------------------------------------------------------ */
export function simulateRun(state, policy, cfg = CFG) {
  const E = cfg.ECONOMY, D = cfg.DEPTH;
  const S = deriveStats(state, cfg);
  const rng = makeRng(hashInt(state.seed, state.day, state.runs, state.tiers.hull));

  const plan = policy.plan(state, S, cfg) || {};
  const targetDepth = clamp(Math.round(plan.depth || 0), 0, D.maxDepth);
  const lo = Object.assign({ capsule: 0, coolant: 0, repairKit: 0 }, plan.loadout || {});
  const C = E.consumables;
  const consumableCost =
    (lo.capsule ? C.capsule.price : 0) +
    (lo.coolant ? C.coolant.price : 0) +
    (lo.repairKit ? C.repairKit.price : 0);
  const slotsUsed =
    (lo.capsule ? C.capsule.slots : 0) +
    (lo.coolant ? C.coolant.slots : 0) +
    (lo.repairKit ? C.repairKit.slots : 0);

  const cargoCap = Math.max(0, S.cargoSlots - slotsUsed);
  const unitLimit = plan.maxUnits != null ? Math.min(cargoCap, plan.maxUnits) : cargoCap;
  const layer = layerAt(targetDepth, cfg);
  const fatigue = layerFatigue(state, layer.index, cfg);
  const hardGap = Math.max(0, (layer?.hardness ?? 1) - S.hardness);
  const quality = Math.max(D.hardnessQualityFloor, 1 - D.hardnessQuality * hardGap);
  const priceUnit = oreValuePerUnit(targetDepth, cfg) * quality;

  const coolMult = lo.coolant ? C.coolant.coolMult : 1;
  const coolRate = S.coolRate * coolMult;

  let t = 0;
  let z = 0;
  let maxZ = 0;
  let mined = 0;
  let gross = 0;
  let hp = S.hp;
  let fuel = S.tankLiters;
  let temp = ambientTemp(0, cfg);
  let shield = 0;
  const ratingBonus = lo.capsule ? C.capsule.ratingBonus : 0;
  const effRating = S.pressureRating + ratingBonus;
  let kitUsed = false;
  let died = false;
  let stranded = false;
  let cause = null;
  let phase = targetDepth > 0 ? 'down' : 'surface';
  let heatDamage = 0;
  let pressureDamage = 0;
  let overTimer = 0;

  while (t < D.maxRunSeconds && phase !== 'surface') {
    t++;
    const burn = S.burnPerSec * (1 + (z / 1000) * E.fuel.depthBurnPer1000m);
    fuel -= burn;

    if (fuel <= 0) {
      fuel = 0;
      if (z > 0.5) { stranded = true; died = true; cause = 'fuel'; break; }
    }

    if (phase === 'down') {
      z = Math.min(targetDepth, z + S.speedDown);
      maxZ = Math.max(maxZ, z);
      if (z >= targetDepth) phase = 'mine';
    } else if (phase === 'mine') {
      const rate = mineRateAt(S, layer, cfg);
      const ascentFuel = (z / S.speedUp) * S.burnPerSec * (1 + (z / 1000) * E.fuel.depthBurnPer1000m) * D.ascentReserve;
      if (mined >= unitLimit || fuel <= ascentFuel || temp > S.maxTemp * 1.02) {
        phase = 'up';
      } else {
        const take = Math.min(rate, unitLimit - mined);
        mined += take;
        const jackpot = rng() < E.ore.jackpotChance ? E.ore.jackpotMult : 1;
        const noise = 1 + E.ore.variance * (rng() * 2 - 1);
        gross += take * priceUnit * fatigue * jackpot * noise;
        temp += (D.mineHeat + D.heatPerUnit * rate) - coolRate * (temp - ambientTemp(z, cfg)) / D.coolTau;
      }
    }
    if (phase === 'up') {
      z = Math.max(0, z - S.speedUp);
      if (z <= 0) { phase = 'surface'; break; }
    }
    if (phase !== 'mine') {
      temp += -coolRate * (temp - ambientTemp(z, cfg)) / D.coolTau;
    }

    if (temp > S.maxTemp) {
      const dmg = D.overheatDps * (temp - S.maxTemp);
      hp -= dmg; heatDamage += dmg;
    }

    const over = pressureAt(z, cfg) - effRating;
    if (over > 0) {
      overTimer += 1;
      let dmg = D.pressureK * Math.pow(over, D.pressureExp) * (1 + overTimer / D.pressureFatigueTau);
      if (shield > 0) { const a = Math.min(shield, dmg); shield -= a; dmg -= a; }
      hp -= dmg; pressureDamage += dmg;
    } else if (overTimer > 0) {
      overTimer = Math.max(0, overTimer - 3);
    }

    if (lo.repairKit && !kitUsed && hp < S.hp * 0.35) {
      hp = Math.min(S.hp, hp + S.hp * C.repairKit.healFrac);
      kitUsed = true;
    }

    if (hp <= 0) { died = true; cause = heatDamage > pressureDamage ? 'heat' : 'pressure'; break; }

    // Решение игрока: повернуть наверх, пока корпус цел (bail — доля запаса HP).
    const bail = clamp(plan.bail ?? 0, 0, 0.95);
    if (bail > 0 && phase !== 'up' && hp < S.hp * bail) phase = 'up';
  }

  const hullLost = Math.max(0, S.hp - Math.max(0, hp));
  const fuelUsed = S.tankLiters - Math.max(0, fuel);
  const fuelCost = Math.max(0, round2(fuelUsed * E.fuel.pricePerLiter));

  let income = 0;
  let repairCost = 0;
  let towCost = 0;

  if (died) {
    income = 0;                       // груз потерян
    towCost = E.death.towFee;
    // корпус восстанавливают в мастерской, но груз и время забега — нет
  } else {
    income = round2(gross);
    repairCost = round2(hullLost * repairCostPerHp(S, targetDepth, cfg));
  }

  const net = round2(income - fuelCost - repairCost - towCost - consumableCost);

  return {
    depth: targetDepth,
    maxDepth: Math.round(maxZ),
    mined: round2(mined),
    income,
    fuelCost,
    repairCost,
    hullLost: Math.round(hullLost * 10) / 10,
    consumableCost,
    towCost,
    cost: round2(fuelCost + repairCost + towCost + consumableCost),
    net,
    died,
    stranded,
    cause,
    days: 1,
    seconds: t,
    layer: layer.key,
    layerIndex: layer.index,
    fatigue,
    loadout: lo,
    hpLeft: Math.max(0, Math.round(hp * 10) / 10),
  };
}

/* ------------------------------------------------------------------ *
 * Апгрейды                                                            *
 * ------------------------------------------------------------------ */
export function upgradeCost(state, axis, cfg = CFG) {
  const tiers = cfg.AXES[axis]?.tiers;
  if (!tiers) return null;
  const next = state.tiers[axis] + 1;
  if (next >= tiers.length) return null;
  return tiers[next].cost;
}

export function buyUpgrade(state, axis, cfg = CFG) {
  if (!cfg.AXES[axis]) return { ok: false, reason: 'unknown-axis', axis, state };
  const next = state.tiers[axis] + 1;
  const tiers = cfg.AXES[axis].tiers;
  if (next >= tiers.length) return { ok: false, reason: 'maxed', axis, state };
  const cost = tiers[next].cost;
  if (state.cash < cost) {
    return { ok: false, reason: 'no-cash', axis, cost, shortfall: round2(cost - state.cash), state };
  }
  const s = cloneState(state);
  s.cash = round2(s.cash - cost);
  s.tiers[axis] = next;
  s.totalUpgrades = round2((s.totalUpgrades || 0) + cost);
  return { ok: true, state: s, axis, tier: next, cost };
}

export function cloneState(state) {
  return {
    ...state,
    tiers: Object.assign({}, state.tiers),
    layerMined: (state.layerMined || []).slice(),
    lastFiveGross: (state.lastFiveGross || []).slice(),
    warnings: (state.warnings || []).slice(),
  };
}

/* ------------------------------------------------------------------ *
 * День / ипотека                                                      *
 * ------------------------------------------------------------------ *
 * Вызывается после забега: забег уже добавил деньги в cash.
 * ------------------------------------------------------------------ */
export function advanceDay(state, cfg = CFG) {
  const M = cfg.ECONOMY.mortgage;
  const s = cloneState(state);
  const events = [];
  s.day += 1;

  if (s.mode === 'freeplay') {
    return { state: s, events: [{ type: 'day', day: s.day }], payment: 0, interest: 0, status: s.status };
  }

  const interest = round2(s.debt * M.dailyInterest);
  if (s.debt > 0) s.debt = round2(s.debt + interest);

  let payment = 0;
  if (s.day % M.paymentEveryRuns === 0 && s.mode === 'campaign') {
    // Банк забирает 40% выручки сразу при продаже (см. playDay), а раз в пять
    // забегов приходит «выписка»: сколько ушло, сколько осталось.
    // Пропуском считается окно, в котором банку не досталось даже floor.
    const due = M.floor;
    const paidInWindow = s.windowPaid || 0;
    payment = paidInWindow;
    if (paidInWindow < due && s.debt > 0) {
      s.missedPayments += 1;
      s.consecutiveMisses += 1;
      events.push({
        type: 'miss',
        day: s.day,
        due: round2(due),
        paid: round2(paidInWindow),
        shortfall: round2(due - paidInWindow),
        streak: s.consecutiveMisses,
      });
      s.warnings.push({ day: s.day, text: `Банк недополучил: ${round2(due - paidInWindow)}$ за 5 забегов` });
      if (s.consecutiveMisses >= 2) {
        const axis = biggestAxis(s);
        if (axis && s.tiers[axis] > 0) {
          s.tiers[axis] -= 1;
          events.push({ type: 'repo-tier', day: s.day, axis, tier: s.tiers[axis] });
          s.warnings.push({ day: s.day, text: `Банк забрал ${cfg.AXES[axis].label} до тира ${s.tiers[axis]}` });
        }
      }
      if (s.consecutiveMisses >= M.warningsBeforeSeize) {
        s.status = 'seized';
        events.push({ type: 'seized', day: s.day, debt: s.debt });
      }
    } else if (s.debt > 0) {
      s.consecutiveMisses = 0;
      events.push({ type: 'statement', day: s.day, paid: round2(paidInWindow), debt: s.debt });
    }
    s.windowPaid = 0;
    s.lastFiveGross = [];
  }

  if (s.debt <= 0 && s.status === 'playing') {
    s.debt = 0;
    s.status = 'won';
    events.push({ type: 'win', day: s.day, dayLimit: M.deadlineDays });
  }
  if (s.status === 'playing' && s.day > M.deadlineDays) {
    s.status = 'seized';
    events.push({ type: 'deadline', day: s.day, debt: s.debt });
  }

  return { state: s, events, payment, interest, status: s.status };
}

function biggestAxis(s) {
  let best = null, bestTier = 0;
  for (const a of AXIS_ORDER) if (s.tiers[a] > bestTier) { bestTier = s.tiers[a]; best = a; }
  return best;
}

/* ------------------------------------------------------------------ *
 * Полный день: забег + продажа + банк                                 *
 * ------------------------------------------------------------------ */
export function playDay(state, policy, cfg = CFG) {
  const s = cloneState(state);
  const run = simulateRun(s, policy, cfg);

  s.runs += 1;
  const rawShare = s.mode === 'freeplay' ? 0 : round2(run.income * cfg.ECONOMY.mortgage.share);
  const bankShare = Math.min(rawShare, Math.max(0, s.debt));
  s.debt = round2(s.debt - bankShare);
  s.debtPaid = round2(s.debtPaid + bankShare);
  s.totalBank = round2((s.totalBank || 0) + bankShare);
  s.windowPaid = round2((s.windowPaid || 0) + bankShare);
  s.cash = round2(s.cash + run.income - run.cost - bankShare);
  if (s.cash < 0 && s.mode === 'campaign') {
    // В минус не уходим: нехватка на топливо/эвакуацию уходит в долг банку.
    s.debt = round2(s.debt + (-s.cash));
    run.deficit = round2(-s.cash);
    s.cash = 0;
  } else if (s.cash < 0) {
    s.cash = 0;
  }
  run.bankShare = bankShare;
  run.cashDelta = round2(run.income - run.cost - bankShare);
  s.totalIncome = round2((s.totalIncome || 0) + run.income);
  s.totalFuel = round2((s.totalFuel || 0) + run.fuelCost);
  s.totalRepair = round2((s.totalRepair || 0) + run.repairCost);
  s.totalTow = round2((s.totalTow || 0) + run.towCost);
  s.totalConsumables = round2((s.totalConsumables || 0) + run.consumableCost);
  s.lastFiveGross.push(run.income);
  if (s.lastFiveGross.length > cfg.ECONOMY.mortgage.paymentEveryRuns) s.lastFiveGross.shift();
  if (run.maxDepth > s.bestDepth) s.bestDepth = run.maxDepth;
  if (run.net > (s.bestNet || 0)) s.bestNet = run.net;
  s.avgCashDelta = round2((s.avgCashDelta || 0) * 0.6 + run.cashDelta * 0.4);
  s.layerMined[run.layerIndex] = round2((s.layerMined[run.layerIndex] || 0) + run.mined);

  const adv = advanceDay(s, cfg);
  return { state: adv.state, run, events: adv.events, payment: adv.payment, interest: adv.interest };
}

/* ------------------------------------------------------------------ *
 * Free play: отдельная песочница, долг кампании не гасится             *
 * ------------------------------------------------------------------ */
export function enterFreePlay(state, cfg = CFG) {
  const s = cloneState(state);
  s.mode = 'freeplay';
  s.cash = cfg.ECONOMY.freePlayStartCash;
  s.debt = 0;
  s.lastFiveGross = [];
  s.consecutiveMisses = 0;
  s.missedPayments = 0;
  return s;
}
