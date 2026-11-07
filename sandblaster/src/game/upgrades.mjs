/**
 * Шесть осей и производные характеристики.
 *
 * Уровни — индексы в таблицы `ECONOMY.<axis>` из economy.mjs (SAND-1). Здесь только
 * перевод тиров в измеримые величины, которые видны в UI и проверяются тестами:
 * радиус пятна, HP/с, кг/с, бар, кВт, скидка, рекуперация, темп рабочего, обслуживание.
 */

import { ECONOMY, RULES } from './config.mjs';

const clampLevel = (table, level) => Math.max(0, Math.min(table.length - 1, Math.round(Number(level) || 0)));

export const AXES = [
  { id: 'nozzle', label: 'Сопло', table: ECONOMY.nozzle },
  { id: 'compressor', label: 'Компрессор', table: ECONOMY.compressor },
  { id: 'abrasive', label: 'Абразив', table: ECONOMY.abrasive },
  { id: 'hopper', label: 'Бункер', table: ECONOMY.hopper },
  { id: 'reclaim', label: 'Рекуперация', table: ECONOMY.reclaim },
  { id: 'hand', label: 'Наёмный рабочий', table: ECONOMY.hand },
];

export const AXIS_IDS = AXES.map((a) => a.id);

export function emptyLevels() {
  return Object.fromEntries(AXIS_IDS.map((id) => [id, 0]));
}

export function axisById(id) {
  const axis = AXES.find((a) => a.id === id);
  if (!axis) throw new Error(`неизвестная ось апгрейда: ${id}`);
  return axis;
}

export function levelOf(levels, id) {
  return clampLevel(axisById(id).table, levels?.[id] ?? 0);
}

export function levelEntry(id, level) {
  const axis = axisById(id);
  return axis.table[clampLevel(axis.table, level)];
}

export function maxTier(id) {
  return axisById(id).table.length - 1;
}

/** Производные характеристики — единственный контракт между балансом и движком. */
export function statsFor(levels = {}) {
  const nozzle = levelEntry('nozzle', levelOf(levels, 'nozzle'));
  const comp = levelEntry('compressor', levelOf(levels, 'compressor'));
  const abrasive = levelEntry('abrasive', levelOf(levels, 'abrasive'));
  const hopper = levelEntry('hopper', levelOf(levels, 'hopper'));
  const reclaim = levelEntry('reclaim', levelOf(levels, 'reclaim'));
  const hand = levelEntry('hand', levelOf(levels, 'hand'));
  const area = Math.PI * nozzle.radiusCells * nozzle.radiusCells;
  const tiers = AXIS_IDS.reduce((sum, id) => sum + levelOf(levels, id), 0);

  return {
    // сопло
    radiusCells: nozzle.radiusCells,
    kgPerSec: nozzle.kgPerSec,
    area,
    // компрессор
    pressure: comp.pressure,
    bar: comp.pressure,
    kW: comp.kW,
    // абразив
    gradeId: abrasive.id,
    gradeName: abrasive.name,
    damageMult: abrasive.damageMult,
    gradePrice: abrasive.pricePerKg,
    pricePerKg: abrasive.pricePerKg, // старый псевдоним для UI
    // бункер
    capacityKg: hopper.capacityKg,
    bulkDiscount: hopper.bulkDiscount,
    // рекуперация
    returnPct: reclaim.returnPct,
    reclaimPct: reclaim.returnPct, // псевдоним
    // рабочий
    handCellsPerSec: hand.cleanCellsPerSec,
    handHP: hand.cleanCellsPerSec,
    wagePerHour: hand.wagePerHour,
    handWagePerHour: hand.wagePerHour,
    // обслуживание машины: растёт с числом купленных тиров
    tiers,
    upkeep: tiers * RULES.upkeepPerTierPerOrder,
    // функции темпа/расхода — формулы модели
    hpPerSec: (p = comp.pressure) => area * p * abrasive.damageMult,
    kgPerHP: nozzle.kgPerSec / (area * abrasive.damageMult),
    kgPerHPAt: (p = comp.pressure) => nozzle.kgPerSec / (area * abrasive.damageMult) / Math.sqrt(p * RULES.refPressure),
    energyCostPerHour: comp.kW * RULES.kwhPrice,
  };
}

/** Цена следующего тира (абразив покупается разово как класс). */
export function nextPrice(levels, id) {
  const table = axisById(id).table;
  const lvl = levelOf(levels, id);
  if (lvl >= table.length - 1) return null;
  const next = table[lvl + 1];
  return id === 'abrasive' ? next.unlockPrice : next.price;
}

/** Человекочитаемое «что даёт уровень» — для витрины. */
export function describeAxis(id, levels) {
  const lvl = levelOf(levels, id);
  const axis = axisById(id);
  const cur = axis.table[lvl];
  const next = lvl < axis.table.length - 1 ? axis.table[lvl + 1] : null;
  switch (id) {
    case 'nozzle':
      return next
        ? `пятно ${cur.radiusCells.toFixed(2)} → ${next.radiusCells.toFixed(2)} кл · песок ${cur.kgPerSec.toFixed(3)} → ${next.kgPerSec.toFixed(3)} кг/с`
        : `пятно ${cur.radiusCells.toFixed(2)} кл · ${cur.kgPerSec.toFixed(3)} кг/с (макс)`;
    case 'compressor':
      return next
        ? `давление ${cur.pressure.toFixed(1)} → ${next.pressure.toFixed(1)} бар · ${cur.kW} → ${next.kW} кВт`
        : `давление ${cur.pressure.toFixed(1)} бар · ${cur.kW} кВт (макс)`;
    case 'abrasive':
      return next
        ? `урон ×${cur.damageMult.toFixed(2)} → ×${next.damageMult.toFixed(2)} · ${cur.pricePerKg.toFixed(2)} → ${next.pricePerKg.toFixed(2)} $/кг`
        : `урон ×${cur.damageMult.toFixed(2)} · ${cur.pricePerKg.toFixed(2)} $/кг (макс)`;
    case 'hopper':
      return next
        ? `бак ${cur.capacityKg} → ${next.capacityKg} кг · скидка ${Math.round(cur.bulkDiscount * 100)}% → ${Math.round(next.bulkDiscount * 100)}%`
        : `бак ${cur.capacityKg} кг · скидка ${Math.round(cur.bulkDiscount * 100)}% (макс)`;
    case 'reclaim':
      return next
        ? `возврат ${Math.round(cur.returnPct * 100)}% → ${Math.round(next.returnPct * 100)}%`
        : `возврат ${Math.round(cur.returnPct * 100)}% (макс)`;
    case 'hand':
      return next
        ? `${cur.cleanCellsPerSec} → ${next.cleanCellsPerSec} кл/с · ${cur.wagePerHour} → ${next.wagePerHour} $/ч`
        : `${cur.cleanCellsPerSec} кл/с · ${cur.wagePerHour} $/ч (макс)`;
    default:
      return '';
  }
}
