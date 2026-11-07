/**
 * Машина между забегами: остаток бака и корпуса + обслуживание в городе.
 *
 * Модель дизайнера (src/model/model-v1.mjs) для каждого забега считает:
 *   fuelCost   = сожжённые литры × ECONOMY.fuel.pricePerLiter
 *   repairCost = потерянные HP × repairCostPerHp(S, глубина)
 * Здесь ровно эта же арифметика, но не «после забега автоматом», а руками игрока
 * в мастерской: видно, сколько литров и HP не хватает, сколько это стоит, и
 * следующий забег начинается с того состояния, до которого машину довели.
 *
 * Новых чисел баланса здесь нет: цена литра, минимальный чек и $/HP — из модели.
 * Единственное правило сверх модели — аварийная канистра, чтобы из состояния
 * «бак пуст и денег нет» всегда был выход (модель такого состояния не знает:
 * в ней каждый забег начинается с полным баком).
 */

import { ECONOMY, refuelCost, repairCost, statsFor } from '../config/economy.mjs';

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Минимальная заправка: столько литров даёт минимальный чек модели ($25 → 5 л). */
export const MIN_FUEL_LITERS = Math.ceil(ECONOMY.fuel.fillMinimum / ECONOMY.fuel.pricePerLiter);

export function statsOf(state) {
  return statsFor(state.tiers || {});
}

/** Приводит state.machine к текущим тирам: без NaN, без переполнения бака и корпуса. */
export function syncMachine(state) {
  const stats = statsOf(state);
  const src = state.machine || {};
  const machine = {
    fuel: round2(clamp(num(src.fuel, stats.tankLiters), 0, stats.tankLiters)),
    hull: round2(clamp(num(src.hull, stats.hp), 0, stats.hp)),
    depth: Math.max(0, Math.round(num(src.depth, 0))),
  };
  state.machine = machine;
  return machine;
}

/** Что нужно машине и сколько это стоит. Цены — из модели, без наценок. */
export function serviceQuote(state, machine = syncMachine(state)) {
  const stats = statsOf(state);
  const liters = Math.max(0, Math.ceil(stats.tankLiters - machine.fuel));
  const hp = Math.max(0, Math.ceil(stats.hp - machine.hull));
  const fuelCost = refuelCost(liters);
  const hpCost = repairCost(hp, machine.depth, state.tiers?.hull || 0);
  return {
    stats,
    liters,
    hp,
    fuelCost,
    hpCost,
    total: round2(fuelCost + hpCost),
    minFuelLiters: Math.min(stats.tankLiters, MIN_FUEL_LITERS),
    minFuelCost: ECONOMY.fuel.fillMinimum,
  };
}

/**
 * Заправка: полный бак, а если денег не хватает — столько литров, сколько
 * оплачено (не меньше минимального чека модели). Списывается ровно цена.
 */
export function refuel(state, machine = syncMachine(state)) {
  const q = serviceQuote(state, machine);
  if (q.liters <= 0) return { ok: false, reason: 'full', cost: 0, liters: 0 };

  const price = ECONOMY.fuel.pricePerLiter;
  let liters = q.liters;
  let cost = q.fuelCost;

  if (state.cash < cost) {
    liters = Math.min(q.liters, Math.max(0, Math.floor(state.cash / price)));
    while (liters > 0 && refuelCost(liters) > state.cash) liters--;
    if (liters <= 0) return { ok: false, reason: 'money', cost: q.fuelCost, missing: round2(q.fuelCost - state.cash) };
    cost = refuelCost(liters);
  }

  state.cash = round2(Math.max(0, state.cash - cost));
  state.totalFuel = round2((state.totalFuel || 0) + cost);
  machine.fuel = round2(clamp(machine.fuel + liters, 0, q.stats.tankLiters));
  return { ok: true, liters, cost, full: liters >= q.liters };
}

/** Ремонт: до полного корпуса, а если денег не хватает — сколько HP оплачено. */
export function repair(state, machine = syncMachine(state)) {
  const q = serviceQuote(state, machine);
  if (q.hp <= 0) return { ok: false, reason: 'full', cost: 0, hp: 0 };

  const depth = machine.depth;
  const tier = state.tiers?.hull || 0;
  let hp = q.hp;
  let cost = q.hpCost;

  if (state.cash < cost) {
    hp = q.hp;
    while (hp > 0 && repairCost(hp, depth, tier) > state.cash) hp--;
    if (hp <= 0) return { ok: false, reason: 'money', cost: q.hpCost, missing: round2(q.hpCost - state.cash) };
    cost = repairCost(hp, depth, tier);
  }

  state.cash = round2(Math.max(0, state.cash - cost));
  state.totalRepair = round2((state.totalRepair || 0) + cost);
  machine.hull = round2(clamp(machine.hull + hp, 0, q.stats.hp));
  return { ok: true, hp, cost, depth, full: hp >= q.hp };
}

/**
 * Аварийная канистра: бак пуст, а на минимальный чек денег нет.
 * В кампании долг банку (как эвакуация), в свободной игре — бесплатно.
 * Так из «пусто и ноль денег» всегда есть выход, и забег не может залипнуть.
 */
export function emergencyRefuel(state, machine = syncMachine(state)) {
  if (machine.fuel > 0.01) return { ok: false, reason: 'not-empty' };
  const q = serviceQuote(state, machine);
  const liters = Math.min(q.stats.tankLiters, MIN_FUEL_LITERS);
  const cost = refuelCost(liters);
  const paid = round2(Math.min(state.cash, cost));
  const credit = round2(cost - paid);
  state.cash = round2(state.cash - paid);
  if (credit > 0 && state.mode === 'campaign') state.debt = round2((state.debt || 0) + credit);
  state.totalFuel = round2((state.totalFuel || 0) + cost);
  machine.fuel = round2(clamp(machine.fuel + liters, 0, q.stats.tankLiters));
  return { ok: true, liters, cost, paid, credit, free: credit > 0 && state.mode !== 'campaign' };
}

/** Перед выходом в забой: бак не должен быть пустым. Возвращает { ok, emergency? }. */
export function ensureFuelForDive(state) {
  const machine = syncMachine(state);
  if (machine.fuel > 0.01) return { ok: true, emergency: null };
  const emergency = emergencyRefuel(state, machine);
  return { ok: machine.fuel > 0, emergency };
}

/** Запомнить состояние машины после забега (остаток бака/корпуса и глубина ремонта). */
export function machineAfterRun(state, run) {
  const stats = statsOf(state);
  state.machine = {
    fuel: round2(clamp(num(run.fuel, 0), 0, stats.tankLiters)),
    hull: round2(clamp(num(run.hull, 0), 0, stats.hp)),
    depth: Math.max(0, Math.round(num(run.maxDepth, 0))),
  };
  return state.machine;
}

/**
 * Учёт апгрейда: новые плиты корпуса ставят при покупке (иначе игрок платит
 * за тир и тут же за ремонт его же HP), а расширенный бак топливом не наполняется —
 * литры сверх старого бака игрок покупает как обычно.
 */
export function applyUpgradeToMachine(state, axisId, beforeStats, afterStats) {
  const machine = syncMachine(state);
  if (axisId === 'hull') {
    const gained = Math.max(0, afterStats.hp - beforeStats.hp);
    machine.hull = round2(clamp(machine.hull + gained, 0, afterStats.hp));
  }
  return syncMachine(state);
}
