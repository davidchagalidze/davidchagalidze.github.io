/**
 * Сдача заказа: начисление денег и прогресса в сейв — без DOM.
 *
 * Раньше это жило прямо в main.mjs рядом с модалкой, поэтому переходы экранов
 * нельзя было проверить тестом. Здесь только арифметика сейва; экран после
 * сдачи выставляет flow.mjs (createShell().deliver() → доска заказов).
 */

import { availableOrders } from './orders.mjs';

/**
 * Начисляет сдачу в save и возвращает отчёт для модалки.
 *
 * @param {object} p
 * @param {object} p.save      сейв (мутируется: деньги, счётчики, текущий заказ)
 * @param {object} p.session   сессия заказа (нужны order, preview(), stats, hopperKg)
 * @param {object} [p.breakdown] готовый preview() — чтобы не считать дважды
 * @returns {{breakdown: object, classId: string, newClass: ?string, ordersDone: number, money: number}|null}
 */
export function settleDelivery({ save, session, breakdown = null }) {
  if (!save || !session) return null;
  const b = breakdown || session.preview();
  const classId = session.order.classId;
  const capacityKg = session.stats?.capacityKg ?? save.hopperKg ?? 0;
  const returnPct = session.stats?.returnPct ?? 0;

  // «До» — состояние сейва без этого заказа: по нему видно, открылся ли новый класс.
  const unlockedBefore = availableOrders(
    { ...save.completed, [classId]: (save.completed[classId] || 0) - 1 },
    save.ordersDone - 1,
  ).length;

  save.money = Math.max(0, save.money + b.net);
  save.completed[classId] = (save.completed[classId] || 0) + 1;
  save.ordersDone += 1;
  save.totalEarned += Math.max(0, b.net);
  save.bestClean = Math.max(save.bestClean, b.cleanPct);
  save.hopperKg = Math.min(capacityKg, session.hopperKg + b.abrasiveKg * returnPct);
  save.lifetime.spraySeconds += b.elapsed || 0;
  save.lifetime.abrasiveKg += b.abrasiveKg;
  save.lifetime.energyKwh += b.kwh;
  save.lifetime.dents += b.damageRatio || 0;
  save.current = null;

  const unlockedAfter = availableOrders(save.completed, save.ordersDone).length;
  const newClass =
    unlockedAfter > unlockedBefore ? availableOrders(save.completed, save.ordersDone).slice(-1)[0]?.classId || null : null;

  return { breakdown: b, classId, newClass, ordersDone: save.ordersDone, money: save.money };
}
