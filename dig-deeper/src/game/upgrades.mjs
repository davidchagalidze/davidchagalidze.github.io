/**
 * Апгрейды и снаряжение: покупки в городе. Цены и эффекты — из модели дизайнера.
 */

import { ECONOMY } from '../config/economy.mjs';
import { AXIS_BY_ID, computeStats } from '../config/upgrades.mjs';
import { upgradePrice } from '../config/economy.mjs';
import { applyUpgradeToMachine, syncMachine } from './machine.mjs';

/** Купить следующий тир оси: списывается ровно цена тира. */
export function buyUpgrade(state, axisId) {
  const axis = AXIS_BY_ID.get(axisId);
  if (!axis) return { ok: false, reason: 'unknown' };
  const tier = Math.max(0, Math.round(state.tiers[axisId] || 0));
  const price = upgradePrice(axisId, tier);
  if (price === null) return { ok: false, reason: 'max' };
  if (state.cash < price) return { ok: false, reason: 'money', price, missing: price - state.cash };
  const before = computeStats(state.tiers);
  state.cash = Math.round((state.cash - price) * 100) / 100;
  state.tiers[axisId] = tier + 1;
  state.totalUpgrades = Math.round(((state.totalUpgrades || 0) + price) * 100) / 100;
  // Новый корпус приходит с плитами (иначе игрок платит за тир и сразу за его же
  // ремонт), новый бак — пустой: литры сверх старого объёма покупаются отдельно.
  applyUpgradeToMachine(state, axisId, before, computeStats(state.tiers));
  syncMachine(state);
  return { ok: true, price, tier: state.tiers[axisId] };
}

export function totalConsumables(inventory) {
  return Object.values(inventory || {}).reduce((s, n) => s + Math.max(0, n | 0), 0);
}

/** Купить расходник: он занимает слот трюма, поэтому лимит — размер трюма. */
export function buyConsumable(state, kind) {
  const cfg = ECONOMY.consumables[kind];
  if (!cfg) return { ok: false, reason: 'unknown' };
  const stats = computeStats(state.tiers);
  if (totalConsumables(state.inventory) >= stats.cargoSlots) return { ok: false, reason: 'slots' };
  if (state.cash < cfg.price) return { ok: false, reason: 'money', price: cfg.price };
  state.cash = Math.round((state.cash - cfg.price) * 100) / 100;
  state.inventory[kind] = (state.inventory[kind] || 0) + 1;
  state.totalConsumables = Math.round(((state.totalConsumables || 0) + cfg.price) * 100) / 100;
  return { ok: true, price: cfg.price, count: state.inventory[kind] };
}

/** Самая прокачанная ось — её снимает банк за второй пропуск. */
export function highestTierAxis(tiers) {
  let best = null;
  for (const [id, tier] of Object.entries(tiers || {})) {
    if (!tier) continue;
    if (!best || tier > best.tier) best = { id, tier };
  }
  return best;
}
