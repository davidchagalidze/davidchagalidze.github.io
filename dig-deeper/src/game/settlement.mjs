/**
 * Расчёт после забега — один код для игры и для дымового прогона баланса.
 *
 * Порядок из модели дизайнера: забег → продажа (банк сразу забирает 40%) →
 * машина остаётся в том виде, в котором вернулась → ипотека (advanceDay
 * вызывает уже игровой цикл, потому что это отдельный шаг «дня»).
 *
 * Смерть: груз теряется, корпус латают в мастерской бесплатно (как в модели:
 * при смерти платится только эвакуация), бак остаётся пустым — заправка
 * за деньги игрока. Апгрейды и банк не трогаются (если не включён хардкор).
 */

import { applyDeath, sellCargo } from './run.mjs';
import { machineAfterRun } from './machine.mjs';

export function settleRun(state, run) {
  const died = !!run.deathReason;
  let lost = null;
  let sale = null;

  if (died) lost = applyDeath(state, run);
  else sale = sellCargo(state, run);

  machineAfterRun(state, run);

  state.records.totalRuns = (state.records.totalRuns || 0) + 1;
  state.records.bestDepth = Math.max(state.records.bestDepth || 0, Math.round(run.maxDepth || 0));
  state.bestDepth = Math.max(state.bestDepth || 0, Math.round(run.maxDepth || 0));
  if (sale) state.records.totalEarnings = Math.round((state.records.totalEarnings || 0) + sale.total);

  if (state.mode === 'freeplay') {
    state.records.freeDepth = Math.max(state.records.freeDepth || 0, Math.round(run.maxDepth || 0));
    state.records.freeEarnings = round2((state.records.freeEarnings || 0) + (sale ? sale.total : 0));
  }

  return {
    died,
    sale,
    lost,
    depth: Math.round(run.maxDepth || 0),
    fuelLeft: round2(run.fuel),
    hullLeft: Math.round(run.hull),
    maxHull: Math.round(run.maxHull),
    fuelUsed: round2(run.fuelUsed || 0),
    mined: round2(run.mined || 0),
  };
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}
