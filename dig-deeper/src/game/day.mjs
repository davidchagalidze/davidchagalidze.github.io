/**
 * День и ипотека — обёртки над моделью дизайнера.
 *
 * Правила модели (src/model/model-v1.mjs):
 *  - банк забирает 40% выручки каждого забега сразу при продаже (в run.mjs);
 *  - выписка каждые 5 забегов: недобрал floor — пропуск;
 *  - 2-й пропуск подряд снимает тир, 3-й — отчуждение фермы;
 *  - 0.09%/день на остаток долга, дедлайн 45 забегов, долг 0 → победа.
 */

import { ECONOMY } from '../config/economy.mjs';
import { advanceDay as modelAdvanceDay } from '../model/model-v1.mjs';
import { highestTierAxis } from './upgrades.mjs';

const m = ECONOMY.mortgage;

/** Вызывается после завершённого забега. Мутирует state, возвращает события. */
export function advanceDay(state) {
  const res = modelAdvanceDay(state);
  Object.assign(state, res.state);
  return res.events || [];
}

/** Платёж, который банк ждёт в этом окне (для подсказки в городе). */
export function paymentDue(state) {
  return m.floor;
}

/** Сколько забегов до выписки банка. */
export function runsUntilPayment(state) {
  if (state.mode === 'freeplay') return 0;
  const mod = Math.max(0, Math.round(state.day || 0)) % m.paymentEveryRuns;
  return mod === 0 ? m.paymentEveryRuns : m.paymentEveryRuns - mod;
}

/** Сколько забегов осталось до дедлайна кампании. */
export function runsUntilDeadline(state) {
  return Math.max(0, m.deadlineDays - state.day);
}

/**
 * Досрочное погашение из банка наличными: списывает деньги и уменьшает долг.
 * (Модель гасит долг только долей выручки; досрочка — удобство игрока, экономику
 * не ломает: сумма та же, просто быстрее.)
 */
export function payDebt(state, amount) {
  const want = Math.max(0, Math.round(amount || 0));
  const pay = Math.min(want, state.debt, Math.max(0, Math.round(state.cash)));
  if (pay <= 0) return { ok: false, reason: 'nothing', paid: 0 };
  state.cash -= pay;
  state.debt = Math.max(0, Math.round((state.debt - pay) * 100) / 100);
  state.debtPaid = Math.round(((state.debtPaid || 0) + pay) * 100) / 100;
  state.consecutiveMisses = 0;
  const events = [{ type: 'loan-early', amount: pay, remaining: state.debt }];
  if (state.debt <= 0 && state.status === 'playing') {
    state.debt = 0;
    state.status = 'won';
    events.push({ type: 'win', day: state.day, dayLimit: m.deadlineDays });
  }
  return { ok: true, paid: pay, remaining: state.debt, events };
}

/** Доля ипотеки в выручке забега — для подсказки. */
export function mortgageShare() {
  return m.share;
}

export { highestTierAxis };
