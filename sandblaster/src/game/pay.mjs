/**
 * Расчёты по заказу: работа, смета, счёт за заказ, окупаемость.
 *
 * Формулы — из модели SAND-1 (design/sandblaster-v1/model.mjs), повторены здесь 1:1,
 * потому что design/ не публикуется на Pages:
 *
 *   hp        = π·r² · pressure · grade                    [HP/с]
 *   работа W  = Σ cells·share·hardness                     [HP]
 *   струя     = (1−tailShare)·W / hp + хвост                [с]
 *   песок     = W · kgPerSec/(πr²·grade) / √(p·refPressure) [кг]
 *   кВт·ч     = kW·(струя + половина простоя)/3600
 *   оплата    = base·clean^1.2 − 0.25·base·damage (+bonus100)
 *
 * Песок не зависит от давления (дозировка идёт расходом воздуха): давление покупает
 * только время и кВт·ч, иначе оно было бы единственным осмысленным апгрейдом.
 *
 * `planOrder()` — статическая смета (витрина, ROI, бот). `billOrder()` — счёт по факту
 * (сколько реально длилась струя, сколько песка ушло), по тем же формулам.
 */

import { ECONOMY, RULES } from './config.mjs';
import { statsFor } from './upgrades.mjs';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Работа заказа в HP и средняя прочность ячейки. */
export function orderWork(order) {
  let h = 0;
  for (const [k, share] of Object.entries(order.dirtMix || {})) {
    const dirt = ECONOMY.dirt[k];
    if (dirt && share > 0) h += share * dirt.hardness;
  }
  return { work: (order.cells ?? order.dirtCells ?? 0) * h, hardness: h };
}

/** base, выведенная из маски (должна совпадать с spec.base в пределах 0.5%). */
export function derivedBase(order) {
  let p = 0;
  for (const [k, share] of Object.entries(order.dirtMix || {})) {
    const dirt = ECONOMY.dirt[k];
    if (dirt && share > 0) p += share * dirt.price;
  }
  return (order.cells ?? order.dirtCells ?? 0) * p;
}

export function pressureOf(levels) {
  return statsFor(levels).pressure;
}

/** Время хвоста: последние 5% разбросаны, эффективность пятна падает. */
export function tailSeconds(spread, work, hp) {
  const steps = 240;
  const dRem = RULES.tailShare / steps;
  let acc = 0;
  for (let i = 0; i < steps; i += 1) {
    const rem = RULES.tailShare * (1 - (i + 0.5) / steps);
    const eta = clamp(rem / (RULES.tailEtaSpan * spread), RULES.tailEtaFloor, 1);
    acc += dRem / eta;
  }
  return (work / hp) * acc;
}

/** Оплата по проценту зачистки (без расходников). */
export function payout({ base, cleanPct, damageRatio = 0, full = false }) {
  const clean = clamp((Number(cleanPct) || 0) / 100, 0, 1);
  const gross = base * Math.pow(clean, ECONOMY.pay.curve);
  const bonus = full ? ECONOMY.pay.bonus100 * base : 0;
  const penalty = ECONOMY.pay.damagePenalty * base * clamp(damageRatio, 0, 1);
  return { gross, bonus, penalty, pay: Math.max(0, gross + bonus - penalty) };
}

/**
 * Статическая смета заказа — как `quote()` в модели.
 * @param {{order: object, levels: object, pressure?: number, full?: boolean, player?: boolean}} args
 */
export function planOrder({ order, levels, pressure, full = false, player = true }) {
  const stats = statsFor(levels);
  const p = clamp(pressure ?? stats.pressure, 1, stats.pressure);
  const { work, hardness } = orderWork(order);
  const hpPlayer = player ? stats.hpPerSec(p) : 0;
  const hpTotal = hpPlayer + stats.handHP;
  const mainSec = hpTotal > 0 ? (work * (1 - RULES.tailShare)) / hpTotal : Infinity;
  let tail = 0;
  if (full) {
    tail = tailSeconds(order.tailSpread ?? 0.6, work, hpTotal);
    if (order.stubborn) tail += RULES.stubbornShare * mainSec;
  }
  const streamSec = mainSec + tail;

  const kg = stats.kgPerHPAt(p) * work;
  const fills = Math.max(1, Math.ceil(kg / stats.capacityKg));
  const refillSec = (fills - 1) * RULES.refillSec;
  const overheadSec = RULES.setupSec + refillSec;
  const cycleSec = streamSec + overheadSec;

  const kwh = (stats.kW * (streamSec + 0.5 * overheadSec)) / 3600;
  const sandCost = kg * stats.gradePrice * (1 - stats.bulkDiscount) * (1 - stats.returnPct);
  const powerCost = kwh * RULES.kwhPrice;
  const boothCost = (RULES.boothPerHour * cycleSec) / 3600;
  const wageCost = (stats.wagePerHour * streamSec) / 3600;
  const upkeep = stats.upkeep;
  const cleanPct = full ? 100 : (1 - RULES.tailShare) * 100;
  const damage = order.material === 'thin'
    ? clamp(ECONOMY.materials.thin.damageRate * Math.max(0, p - (order.thinLimit ?? ECONOMY.materials.thin.damagePressure)) * streamSec, 0, 1)
    : 0;
  const paid = payout({ base: order.base, cleanPct, damageRatio: damage, full });
  const consumables = sandCost + powerCost;
  const net = paid.pay - consumables - boothCost - wageCost - upkeep;

  return {
    pressure: p,
    work,
    hardness,
    hpPlayer,
    hpTotal,
    mainSec,
    tailSec: tail,
    streamSec,
    cycleSec,
    fills,
    refillSec,
    kg,
    kwh,
    sandCost,
    powerCost,
    boothCost,
    wageCost,
    upkeep,
    consumables,
    damage,
    cleanPct,
    base: order.base,
    gross: paid.gross,
    bonus: paid.bonus,
    penalty: paid.penalty,
    pay: paid.pay,
    net,
    marginPct: paid.pay > 0 ? (net / paid.pay) * 100 : 0,
    netPerSec: Number.isFinite(cycleSec) && cycleSec > 0 ? net / cycleSec : -Infinity,
    netPerHour: Number.isFinite(cycleSec) && cycleSec > 0 ? (net / cycleSec) * 3600 : -Infinity,
  };
}

/**
 * Счёт по факту: сколько игрок реально держал струю, сколько песка ушло, сколько простоев.
 * Формулы те же, что в planOrder, но время берётся из сессии.
 */
export function billOrder({ order, levels, elapsedSec, downtimeSec = 0, abrasiveKg = 0, cleanPct, damageRatio = 0 }) {
  const stats = statsFor(levels);
  const cycleSec = Math.max(0, elapsedSec) + RULES.setupSec + Math.max(0, downtimeSec);
  const kwh = (stats.kW * (Math.max(0, elapsedSec) + 0.5 * (RULES.setupSec + Math.max(0, downtimeSec)))) / 3600;
  const sandCost = Math.max(0, abrasiveKg) * stats.gradePrice * (1 - stats.bulkDiscount) * (1 - stats.returnPct);
  const powerCost = kwh * RULES.kwhPrice;
  const boothCost = (RULES.boothPerHour * cycleSec) / 3600;
  const wageCost = (stats.wagePerHour * Math.max(0, elapsedSec)) / 3600;
  const upkeep = stats.upkeep;
  const full = cleanPct >= 99.5;
  const paid = payout({ base: order.base, cleanPct, damageRatio, full });
  const consumables = sandCost + powerCost;
  const net = paid.pay - consumables - boothCost - wageCost - upkeep;
  return {
    cycleSec,
    kwh,
    sandCost,
    powerCost,
    boothCost,
    wageCost,
    upkeep,
    consumables,
    cleanPct,
    damageRatio,
    base: order.base,
    gross: paid.gross,
    bonus: paid.bonus,
    penalty: paid.penalty,
    pay: paid.pay,
    net,
    marginPct: paid.pay > 0 ? (net / paid.pay) * 100 : 0,
    full,
  };
}

/**
 * Окупаемость следующего тира — две метрики, как в модели SAND-1:
 *   orders     = цена / чистая прибыль заказа (простая «цена в заказах», её и показываем);
 *   payback    = цена / прирост прибыли в секунду × длительность заказа (реальная).
 */
export function roiForUpgrade({ axisId, levels, order }) {
  const before = planOrder({ order, levels });
  const price = nextPrice(axisId, levels);
  if (price == null) return { axisId, price: null, orders: null, payback: null, deltaNet: 0, cycleBefore: before.cycleSec };
  const after = planOrder({ order, levels: { ...levels, [axisId]: (Number(levels?.[axisId]) || 0) + 1 } });
  const deltaNet = after.net - before.net;
  const deltaPerSec = after.netPerSec - before.netPerSec;
  return {
    axisId,
    price,
    deltaNet,
    cycleBefore: before.cycleSec,
    cycleAfter: after.cycleSec,
    orders: before.net > 0 ? price / before.net : null,
    payback: deltaPerSec > 0 ? price / (deltaPerSec * before.cycleSec) : null,
  };
}

/** Цена следующего тира: у абразива это разовая покупка класса. */
export function nextPrice(axisId, levels) {
  const table = ECONOMY[axisId];
  if (!Array.isArray(table)) return null;
  const lvl = Math.max(0, Math.min(table.length - 1, Math.round(Number(levels?.[axisId]) || 0)));
  if (lvl >= table.length - 1) return null;
  const next = table[lvl + 1];
  return axisId === 'abrasive' ? (next.unlockPrice ?? next.price ?? null) : next.price;
}

/** Сколько песка влезет и сколько это стоит (для подсказки в UI). */
export function sandPrice(levels) {
  const s = statsFor(levels);
  return s.gradePrice * (1 - s.bulkDiscount);
}
