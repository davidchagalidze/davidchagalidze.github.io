/**
 * Адаптер между исполняемой моделью дизайнера и движком игры.
 *
 * ИСТОЧНИК ИСТИНЫ — `src/model/model-v1.mjs` (карточка t_7e61261f; в design/ остался
 * только шим для design/tools/tests). Здесь нет ни одного
 * собственного числа баланса: ECONOMY, DEPTH и AXES реэкспортируются из модели, а
 * функции ниже только раскладывают её формулы по единицам движка (пиксели, секунды).
 *
 * Движковые константы (размер ячейки, пикселей на метр) — не баланс, а геометрия
 * рендера; они лежат в ENGINE и в модель не входят.
 */

import {
  AXES as MODEL_AXES,
  CFG,
  DEPTH as MODEL_DEPTH,
  ECONOMY as MODEL_ECONOMY,
  LAYERS as MODEL_LAYERS,
  VERSION,
  ambientTemp as modelAmbientTemp,
  comfortableDepth as modelComfortableDepth,
  deriveStats as modelDeriveStats,
  fuelNeededFor as modelFuelNeededFor,
  layerAt as modelLayerAt,
  layerFatigue as modelLayerFatigue,
  mineRateAt as modelMineRateAt,
  oreValuePerUnit as modelOreValuePerUnit,
  pressureAt as modelPressureAt,
  repairCostPerHp as modelRepairCostPerHp,
  maxReachableDepth as modelMaxReachableDepth,
  thermalLimitDepth as modelThermalLimitDepth,
} from '../model/model-v1.mjs';

export { CFG, MODEL_AXES, VERSION };
export const ECONOMY = MODEL_ECONOMY;

/** Геометрия мира (не баланс): 8 px на ячейку, 12 px на метр. */
export const ENGINE = { tile: 8, pxPerMeter: 12, cols: 240 };

/** Палитры слоёв — только арт, числа слоёв берутся из модели. */
const PALETTE = [
  { soil: '#8d5a3b', soilDark: '#74472e', soilLight: '#a97047', rock: '#7d6b5a', accent: '#c9a06b' },
  { soil: '#6b6152', soilDark: '#544c40', soilLight: '#847a68', rock: '#5d5749', accent: '#9aa3a8' },
  { soil: '#3d5570', soilDark: '#2f4358', soilLight: '#4f6d8c', rock: '#35506b', accent: '#7fd8ff' },
  { soil: '#4a2a2c', soilDark: '#37201f', soilLight: '#6b3634', rock: '#3f2528', accent: '#ff8a3d' },
  { soil: '#241f3a', soilDark: '#191529', soilLight: '#332c50', rock: '#2b2440', accent: '#c08cff' },
];

export const DEPTH = {
  ...MODEL_DEPTH,
  tile: ENGINE.tile,
  pxPerMeter: ENGINE.pxPerMeter,
  cols: ENGINE.cols,
  layers: MODEL_LAYERS.map((layer, i) => ({ ...layer, ...(PALETTE[i] || PALETTE[PALETTE.length - 1]) })),
  // Контакт с жидкостями. В модели жидкостей нет (она знает только фоновую
  // температуру по глубине), поэтому это движковые константы, а не баланс модели.
  // Раньше +55 °C/с были захардкожены в run.mjs и сжигали корпус за один контакт
  // с магмой — из-за этого забеги глубже ~1700 м были невозможны.
  // Потолок нагрева от магмы — 12 °C/с, вода снимает 14 °C/с.
  waterCoolPerSec: 14,
  magmaHeatPerSec: 12,
};

/* ── формулы модели, переэкспорт с удобными именами ─────────────────────── */

export const pressureAt = (depth) => modelPressureAt(depth);
export const ambientTemp = (depth) => modelAmbientTemp(depth);
export const oreValuePerUnit = (depth) => modelOreValuePerUnit(depth);
export const layerAt = (depth) => modelLayerAt(depth);
/** Истощение слоя: чем больше выбрано, тем дешевле руда (пол 0.5 по модели). */
export const layerFatigue = (state, layerIndex) => modelLayerFatigue(state, layerIndex);
export const repairCostPerHp = (depth, hullTier) =>
  modelRepairCostPerHp(modelDeriveStats({ tiers: { hull: hullTier || 0 } }), depth);

export function layerIndexAt(depthM) {
  const layers = DEPTH.layers;
  const d = Math.max(0, Number(depthM) || 0);
  for (let i = layers.length - 1; i >= 0; i--) if (d >= layers[i].from) return i;
  return 0;
}

/** Рейтинг корпуса в барах для тира 0..4 — прямо из модели (безопасная глубина → бар). */
export function ratingForTier(tier) {
  const t = Math.min(MODEL_AXES.hull.tiers.length - 1, Math.max(0, Math.floor(tier || 0)));
  return pressureAt(MODEL_AXES.hull.tiers[t].safeDepth);
}

/** Обратная функция: до какой глубины держит рейтинг, м. */
export function safeDepthForRating(rating) {
  const r = Math.max(1, Number(rating) || 1);
  return (r - 1) * DEPTH.metersPerBar;
}

/**
 * Урон корпусу от давления, HP/сек. Формула модели:
 *   dps = pressureK * max(0, bar - rating)^pressureExp * (1 + tBelow / fatigueTau)
 * armor — множитель брони (в модели его нет, оставлен для совместимости = 1).
 */
export function pressureDps(depthM, rating, armor = 1, secondsBelow = 0) {
  const over = pressureAt(depthM) - rating;
  if (over <= 0) return 0;
  const scale = 1 + Math.max(0, secondsBelow) / DEPTH.pressureFatigueTau;
  return DEPTH.pressureK * Math.pow(over, DEPTH.pressureExp) * scale * (armor > 0 ? armor : 1);
}

/** Минимальный чек заправки: цена литров, но не меньше fillMinimum. */
export function refuelCost(liters) {
  const l = Math.max(0, Number(liters) || 0);
  if (l <= 0) return 0;
  return Math.max(ECONOMY.fuel.fillMinimum, Math.ceil(l * ECONOMY.fuel.pricePerLiter));
}

/** Стоимость ремонта hp единиц корпуса на глубине depth. */
export function repairCost(hp, depth = 0, hullTier = 0) {
  const h = Math.max(0, Number(hp) || 0);
  if (h <= 0) return 0;
  return Math.ceil(h * repairCostPerHp(depth, hullTier));
}

/** Цена следующего тира оси (или null, если максимум). */
export function upgradePrice(axisId, currentTier) {
  const axis = MODEL_AXES[axisId];
  if (!axis) return null;
  const next = Math.max(0, Math.floor(currentTier || 0)) + 1;
  if (next >= axis.tiers.length) return null;
  return axis.tiers[next].cost;
}

export function consumablePrice(kind) {
  const c = ECONOMY.consumables[kind];
  return c ? c.price : null;
}

export const statsFor = (tiers) => modelDeriveStats({ tiers: tiers || {} });
/** Сколько литров нужно, чтобы сходить на глубину и вернуться (с запасом модели). */
export const fuelNeeded = (depth, stats, extraSec = 0) => modelFuelNeededFor(depth, stats, CFG, extraSec);
export const comfortable = (stats) => modelComfortableDepth(stats);
export const maxReachable = (stats, extraSec = 0) => modelMaxReachableDepth(stats, CFG, extraSec);
export const thermalLimit = (stats) => modelThermalLimitDepth(stats);
export const mineRateAt = (stats, layer) => modelMineRateAt(stats, layer);

/** Форматирование денег: $1 250, без отрицательных и NaN. */
export function money(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return '$' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function num(n) {
  const v = Number(n) || 0;
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function pressureLabel(depth) {
  return pressureAt(depth).toFixed(2);
}
