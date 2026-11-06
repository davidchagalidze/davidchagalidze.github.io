/**
 * Оффлайн-слой наёмного рабочего.
 *
 * Пока игра закрыта, рабочий берёт сторонние заказы того же класса. Считается по той же
 * смете, что видит игрок, но без игрока (`player: false`), поэтому:
 *   • часы обрезаются `rules.offlineHours` (8 ч);
 *   • объём — не больше `rules.offlineMaxOrders` (1 заказ), иначе idle съел бы активную игру;
 *   • расходники, аренда камеры и обслуживание вычитаются как обычно.
 */

import { RULES } from './config.mjs';
import { statsFor } from './upgrades.mjs';
import { planOrder } from './pay.mjs';

export function settleOffline({ state, order, now = Date.now() }) {
  const stats = statsFor(state.levels);
  const lastSeenRaw = Number(state.lastSeen);
  const lastSeen = Number.isFinite(lastSeenRaw) ? lastSeenRaw : now;
  const rawHours = (now - lastSeen) / 3_600_000;
  const hours = Math.max(0, Math.min(RULES.offlineHours, Number.isFinite(rawHours) ? rawHours : 0));

  const empty = {
    hours: 0,
    capped: false,
    orders: 0,
    gross: 0,
    consumables: 0,
    booth: 0,
    wage: 0,
    upkeep: 0,
    net: 0,
    handLevel: state.levels?.hand ?? 0,
    cellsPerSec: stats.handCellsPerSec,
  };

  if (stats.handHP <= 0 || hours <= 0.02 || !order) return empty;

  const plan = planOrder({ order, levels: state.levels, player: false });
  if (!Number.isFinite(plan.cycleSec) || plan.cycleSec <= 0) return { ...empty, hours };
  const orders = Math.min(RULES.offlineMaxOrders, hours / RULES.offlineHours);
  const net = Math.max(0, plan.net) * orders;

  return {
    hours,
    capped: rawHours > RULES.offlineHours,
    orders,
    gross: plan.pay * orders,
    consumables: plan.consumables * orders,
    booth: plan.boothCost * orders,
    wage: plan.wageCost * orders,
    upkeep: plan.upkeep * orders,
    net,
    handLevel: state.levels?.hand ?? 0,
    cellsPerSec: stats.handCellsPerSec,
  };
}
