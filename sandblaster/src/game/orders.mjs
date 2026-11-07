/**
 * Заказы: 3 класса из модели SAND-1, генерация из сида, открытие классов.
 *
 * Заказ — дескриптор (класс, предмет, сид, cells, mix, base, material, thinLimit,
 * tailSpread, stubborn), а не сетка: прогресс хранится отдельно RLE-строкой.
 *
 * `cells` берётся из ECONOMY.orders.classN.cells с вариацией ±6% (как в модели), а
 * `base` — фиксированная spec.base: parity-тест требует, чтобы base сходился с
 * cells·Σshare·price в пределах 0.5%, а не «примерно как получилось».
 */

import { ECONOMY, RULES } from './config.mjs';
import { hashSeed, pickWeighted, mulberry32 } from './rng.mjs';
import { ITEMS, getItem, insideItem } from './shapes.mjs';

export const CLASS_IDS = ['class1', 'class2', 'class3'];

/** Предметы подобраны так, чтобы маски хватало на cells класса (проверяется тестом). */
const CLASS_ITEMS = {
  class1: ['hood', 'wheel', 'gear'],
  class2: ['sign', 'frame', 'hood'],
  class3: ['turbine', 'frame', 'sign'],
};

export function classIndex(classId) {
  const i = CLASS_IDS.indexOf(classId);
  if (i < 0) throw new Error(`неизвестный класс заказа: ${classId}`);
  return i;
}

export function classDef(classId) {
  return ECONOMY.orders[classId];
}

export function unlockedClasses(completed = {}) {
  const out = [];
  for (const id of CLASS_IDS) {
    if (id === CLASS_IDS[0]) {
      out.push(id);
      continue;
    }
    const prev = CLASS_IDS[CLASS_IDS.indexOf(id) - 1];
    const donePrev = Number(completed[prev] || 0);
    if (donePrev >= (classDef(id).unlockAfter || 0)) out.push(id);
    else break;
  }
  return out;
}

export function nextUnlock(completed = {}) {
  for (const id of CLASS_IDS) {
    if (unlockedClasses(completed).includes(id)) continue;
    const prev = CLASS_IDS[CLASS_IDS.indexOf(id) - 1];
    return { classId: id, need: classDef(id).unlockAfter || 0, have: Number(completed[prev] || 0), prevClass: prev };
  }
  return null;
}

const areaCache = new Map();

export function itemArea(itemId) {
  if (areaCache.has(itemId)) return areaCache.get(itemId);
  const item = getItem(itemId);
  let area = 0;
  for (let y = 0; y < RULES.gridH; y += 1) {
    for (let x = 0; x < RULES.gridW; x += 1) if (insideItem(item, x + 0.5, y + 0.5)) area += 1;
  }
  areaCache.set(itemId, area);
  return area;
}

export function averageHardness(dirtMix) {
  let sum = 0;
  let weight = 0;
  for (const [type, share] of Object.entries(dirtMix || {})) {
    const def = ECONOMY.dirt[type];
    if (!def || !(share > 0)) continue;
    sum += def.hardness * share;
    weight += share;
  }
  return weight > 0 ? sum / weight : 1;
}

/** Средняя цена ячейки — из неё выводится base. */
export function averageCellPrice(dirtMix) {
  let sum = 0;
  let weight = 0;
  for (const [type, share] of Object.entries(dirtMix || {})) {
    const def = ECONOMY.dirt[type];
    if (!def || !(share > 0)) continue;
    sum += def.price * share;
    weight += share;
  }
  return weight > 0 ? sum / weight : 0;
}

/**
 * Детерминированный заказ — распределение как в модели: ±6% клеток, джиттер долей,
 * шанс тонкого листа, свой порог давления, свой разброс хвоста, шанс скрытого очага.
 */
export function makeOrder({ classId, index = 0, salt = '' }) {
  const spec = classDef(classId);
  const seed = hashSeed('sandblaster', classId, index, salt) >>> 0;
  const rng = mulberry32(seed);
  const items = CLASS_ITEMS[classId] || ['hood'];
  const cells = Math.round(spec.cells * (0.94 + rng() * 0.12));
  // Предмет обязан вместить всё грязное: маска меньше `cells` — движок упал бы на
  // генерации сетки (у знака 15 324 клетки против 16 000 у класса 3). Берём первый
  // предмет класса, куда грязь влезает; если таких нет — самый большой.
  const fits = items.filter((id) => itemArea(id) >= cells);
  const pool = fits.length ? fits : [items.slice().sort((a, b) => itemArea(b) - itemArea(a))[0]];
  const itemId = pool[Math.floor(rng() * pool.length) % pool.length];
  const mix = {};
  let sum = 0;
  for (const k of Object.keys(spec.mix)) {
    const v = spec.mix[k] * (0.85 + rng() * 0.3);
    mix[k] = v;
    sum += v;
  }
  for (const k of Object.keys(mix)) mix[k] /= sum;

  const thin = rng() < spec.thinChance;
  const thinLimit = thin ? ECONOMY.materials.thin.damagePressure + rng() * RULES.thinPressureSpread : 99;

  return {
    classId,
    classIndex: classIndex(classId),
    itemId,
    seed,
    index,
    cells,
    dirtCells: cells,
    dirtMix: mix,
    base: spec.base,
    material: thin ? 'thin' : 'steel',
    thinLimit,
    tailSpread: RULES.tailSpreadMin + rng() * (RULES.tailSpreadMax - RULES.tailSpreadMin),
    stubborn: rng() < RULES.stubbornChance,
    label: spec.label || classId,
    avgHardness: averageHardness(mix),
  };
}

export function availableOrders(completed = {}, ordersDone = 0) {
  const out = [];
  for (const classId of unlockedClasses(completed)) {
    out.push(makeOrder({ classId, index: ordersDone, salt: 'a' }));
    out.push(makeOrder({ classId, index: ordersDone, salt: 'b' }));
  }
  return out;
}

export function normalizeOrder(raw) {
  if (!raw || !CLASS_IDS.includes(raw.classId)) return null;
  const spec = classDef(raw.classId);
  const itemId = ITEMS[raw.itemId] ? raw.itemId : (CLASS_ITEMS[raw.classId]?.[0] ?? 'hood');
  const mix = raw.dirtMix && typeof raw.dirtMix === 'object' ? { ...raw.dirtMix } : { ...spec.mix };
  const cells = Number(raw.cells) > 0 ? Math.round(Number(raw.cells)) : spec.cells;
  return {
    classId: raw.classId,
    classIndex: classIndex(raw.classId),
    itemId,
    seed: Number(raw.seed) >>> 0,
    index: Number(raw.index) || 0,
    cells,
    dirtCells: cells,
    dirtMix: mix,
    base: Number(raw.base) > 0 ? Number(raw.base) : spec.base,
    material: ECONOMY.materials[raw.material] ? raw.material : 'steel',
    thinLimit: Number.isFinite(Number(raw.thinLimit)) ? Number(raw.thinLimit) : 99,
    tailSpread: Number(raw.tailSpread) > 0 ? Number(raw.tailSpread) : 0.6,
    stubborn: !!raw.stubborn,
    label: spec.label || raw.classId,
    avgHardness: averageHardness(mix),
  };
}

/** Взвешенный выбор типа грязи — экспорт для тестов и генератора маски. */
export { pickWeighted };
