/**
 * Шесть осей апгрейда для интерфейса: числа и цены — из модели дизайнера
 * (src/model/model-v1.mjs → AXES), здесь только русские подписи и формулы эффекта.
 */

import { MODEL_AXES, upgradePrice } from './economy.mjs';

const AXIS_META = {
  hull: {
    icon: '🛡',
    what: 'прочность и рейтинг давления',
    why: 'открывает следующий слой: выше рейтинга давление бьёт по корпусу',
    effect: (t) => `${t.hp} HP · держит до ${t.safeDepth} м`,
  },
  engine: {
    icon: '⚙',
    what: 'скорость хода и подъёма',
    why: 'быстрее возвращаешься наверх — меньше времени под давлением',
    effect: (t) => `${t.speedDown.toFixed(1)} м/с вниз · ${t.speedUp.toFixed(1)} м/с вверх`,
  },
  drill: {
    icon: '⛏',
    what: 'скорость добычи и твёрдость',
    why: 'быстрее набираешь трюм, реже буксуешь в твёрдой породе',
    effect: (t) => `${t.rate.toFixed(2)} ед/с · твёрдость ${t.hardness}`,
  },
  cargo: {
    icon: '📦',
    what: 'вместимость трюма',
    why: 'больше руды за забег; полный трюм тяжелее — подъём дольше',
    effect: (t) => `${t.slots} ед. · подъём ×${t.weightSlow.toFixed(2)}`,
  },
  fuel: {
    icon: '⛽',
    what: 'запас топлива',
    why: 'дальше радиус: до какой глубины хватает бака туда и обратно',
    effect: (t) => `${t.liters} л`,
  },
  cooling: {
    icon: '❄',
    what: 'теплоотвод и предел температуры',
    why: 'перегрев бьёт по корпусу: без охлаждения в лаве делать нечего',
    effect: (t) => `×${t.coolRate.toFixed(1)} теплоотвод · до ${t.maxTemp}°`,
  },
};

export const AXES = Object.entries(MODEL_AXES).map(([id, axis]) => ({
  id,
  name: axis.label,
  short: axis.label,
  ...AXIS_META[id],
  tiers: axis.tiers,
}));

export const AXIS_BY_ID = new Map(AXES.map((a) => [a.id, a]));

export const CONSUMABLES = [
  { id: 'capsule', name: 'Капсула давления', icon: '🜛', hint: 'щит от давления: +0.55 бара (~165 м) на забег' },
  { id: 'coolant', name: 'Охлаждающая смесь', icon: '❄', hint: 'теплоотвод ×1.9 на забег' },
  { id: 'repairKit', name: 'Ремонтный набор', icon: '🔧', hint: 'латает 40% корпуса, когда HP ниже 35%' },
];

/** Характеристики машины для заданного набора тиров (обёртка над моделью). */
export { statsFor as computeStats } from './economy.mjs';

/** Цена и наличие следующего тира — для кнопок в городе. */
export function nextTier(axisId, tier) {
  const axis = MODEL_AXES[axisId];
  if (!axis) return null;
  const next = Math.floor(tier || 0) + 1;
  if (next >= axis.tiers.length) return null;
  return { tier: next, cost: upgradePrice(axisId, tier), data: axis.tiers[next] };
}
