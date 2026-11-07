/**
 * Находки: 34 типа по слоям — это арт и тактика («что тащить в трюм»).
 * Цена НЕ своя: она считается из модели дизайнера —
 *   value = oreValuePerUnit(глубина) × slots × mult × разброс × «богатая жила» × истощение слоя.
 * mult подобран так, чтобы средняя цена единицы трюма совпадала с моделью (~1.0).
 */

import { ECONOMY, layerAt, oreValuePerUnit } from './economy.mjs';
import { hash2 } from '../engine/rng.mjs';

const round2 = (v) => Math.round(v * 100) / 100;

export const LOOT_TYPES = [
  // --- Слой 1: грунт -------------------------------------------------------
  { id: 'clay', name: 'Ком глины', layer: 1, slots: 1, mult: 0.82, rarity: 26, shape: 'rock', color: '#b07b4f' },
  { id: 'sandstone', name: 'Песчаник', layer: 1, slots: 1, mult: 0.88, rarity: 20, shape: 'rock', color: '#d0a86a' },
  { id: 'rustbolt', name: 'Ржавый болт', layer: 1, slots: 1, mult: 0.8, rarity: 18, shape: 'nugget', color: '#9a6b45' },
  { id: 'root', name: 'Дубовый корень', layer: 1, slots: 1, mult: 0.95, rarity: 14, shape: 'bone', color: '#8a6a3a' },
  { id: 'coal', name: 'Уголь', layer: 1, slots: 1, mult: 1.0, rarity: 10, shape: 'rock', color: '#3d3a3f' },
  { id: 'copper', name: 'Медная руда', layer: 1, slots: 1, mult: 1.1, rarity: 7, shape: 'nugget', color: '#c9743c' },
  { id: 'quartz', name: 'Кварц', layer: 1, slots: 1, mult: 1.35, rarity: 4, shape: 'gem', color: '#e8e4f0' },
  { id: 'mushroomstone', name: 'Гриб-камень', layer: 1, slots: 1, mult: 1.45, rarity: 2.5, shape: 'orb', color: '#c86fa0' },
  { id: 'oldcoin', name: 'Старая монета', layer: 1, slots: 1, mult: 2.4, rarity: 1.2, shape: 'coin', color: '#e8c65a' },

  // --- Слой 2: порода ------------------------------------------------------
  { id: 'gypsum', name: 'Гипс', layer: 2, slots: 1, mult: 0.84, rarity: 18, shape: 'rock', color: '#cfc9bd' },
  { id: 'salt', name: 'Каменная соль', layer: 2, slots: 1, mult: 0.9, rarity: 16, shape: 'gem', color: '#f0f4f6' },
  { id: 'iron', name: 'Железная руда', layer: 2, slots: 1, mult: 0.98, rarity: 13, shape: 'nugget', color: '#8d8f96' },
  { id: 'silver', name: 'Серебро', layer: 2, slots: 1, mult: 1.15, rarity: 8, shape: 'nugget', color: '#d6dde4' },
  { id: 'granitesphere', name: 'Гранитная сфера', layer: 2, slots: 2, mult: 0.95, rarity: 5, shape: 'orb', color: '#9c8e80' },
  { id: 'amethyst', name: 'Аметист', layer: 2, slots: 1, mult: 1.3, rarity: 4, shape: 'crystal', color: '#a86fd6' },
  { id: 'fossil', name: 'Окаменелость', layer: 2, slots: 2, mult: 1.15, rarity: 2.4, shape: 'bone', color: '#c7b28e' },
  { id: 'meteor', name: 'Крошка метеорита', layer: 2, slots: 1, mult: 2.1, rarity: 1.2, shape: 'nugget', color: '#6f7f92' },

  // --- Слой 3: кристальные пещеры -----------------------------------------
  { id: 'gold', name: 'Золото', layer: 3, slots: 1, mult: 1.0, rarity: 14, shape: 'nugget', color: '#f2c94c' },
  { id: 'crystal', name: 'Хрусталь', layer: 3, slots: 1, mult: 1.0, rarity: 12, shape: 'crystal', color: '#9fe8ff' },
  { id: 'emerald', name: 'Изумруд', layer: 3, slots: 1, mult: 1.15, rarity: 8, shape: 'gem', color: '#5fd48a' },
  { id: 'moonstone', name: 'Лунный камень', layer: 3, slots: 1, mult: 1.15, rarity: 6, shape: 'orb', color: '#cfe0ff' },
  { id: 'sapphire', name: 'Сапфир', layer: 3, slots: 1, mult: 1.2, rarity: 5, shape: 'gem', color: '#4a7fe8' },
  { id: 'resonator', name: 'Кристалл-резонатор', layer: 3, slots: 2, mult: 0.9, rarity: 3, shape: 'crystal', color: '#7fe3d0' },
  { id: 'deep_parkle', name: 'Жемчуг бездны', layer: 3, slots: 1, mult: 1.7, rarity: 1.4, shape: 'shell', color: '#f0d8e8' },

  // --- Слой 4: лава --------------------------------------------------------
  { id: 'titanium', name: 'Титан', layer: 4, slots: 2, mult: 0.85, rarity: 14, shape: 'nugget', color: '#b8c4cc' },
  { id: 'platinum', name: 'Платина', layer: 4, slots: 1, mult: 1.05, rarity: 10, shape: 'nugget', color: '#e6eef5' },
  { id: 'ruby', name: 'Рубин', layer: 4, slots: 1, mult: 1.25, rarity: 7, shape: 'gem', color: '#e8465a' },
  { id: 'obsidian', name: 'Обсидиановая искра', layer: 4, slots: 1, mult: 1.35, rarity: 3, shape: 'gem', color: '#6d4a9c' },
  { id: 'seismocrystal', name: 'Сейсмо-кристалл', layer: 4, slots: 2, mult: 1.1, rarity: 4, shape: 'crystal', color: '#ff9a52' },
  { id: 'magmacore', name: 'Магма-ядро', layer: 4, slots: 2, mult: 1.25, rarity: 1.6, shape: 'orb', color: '#ff6b35' },
  { id: 'artifact', name: 'Древний артефакт', layer: 4, slots: 2, mult: 2.0, rarity: 0.8, shape: 'artifact', color: '#e0c98a' },

  // --- Слой 5: бездна ------------------------------------------------------
  { id: 'adamant', name: 'Адамантий', layer: 5, slots: 2, mult: 0.85, rarity: 10, shape: 'nugget', color: '#9bd4c8' },
  { id: 'star_shard', name: 'Звёздный осколок', layer: 5, slots: 1, mult: 1.1, rarity: 5, shape: 'gem', color: '#ffe9a8' },
  { id: 'voidpearl', name: 'Пустотный жемчуг', layer: 5, slots: 1, mult: 1.15, rarity: 6, shape: 'shell', color: '#c9b3ff' },
  { id: 'abysscore', name: 'Ядро бездны', layer: 5, slots: 3, mult: 0.9, rarity: 2, shape: 'orb', color: '#7a4bd6' },
  { id: 'comet', name: 'Осколок кометы', layer: 5, slots: 2, mult: 1.15, rarity: 3, shape: 'crystal', color: '#a8f0ff' },
  { id: 'echo', name: 'Эхо-камень', layer: 5, slots: 1, mult: 2.0, rarity: 1, shape: 'artifact', color: '#b8ffd9' },
];

export const LOOT_BY_ID = new Map(LOOT_TYPES.map((t) => [t.id, t]));

export function lootType(id) {
  return LOOT_BY_ID.get(id) || null;
}

export function lootPoolForLayer(layerIndex) {
  const n = layerIndex + 1;
  const pool = LOOT_TYPES.filter((t) => t.layer === n);
  return pool.length ? pool : LOOT_TYPES.filter((t) => t.layer === 5);
}

export function poolWeight(pool) {
  return pool.reduce((s, t) => s + (Number(t.rarity) || 0), 0);
}

/**
 * Множитель единицы без цены глубины: слоты × mult × разброс × «богатая жила».
 * Детерминирован координатой ячейки — как и rollUnitValue.
 */
export function rollUnitFactor(type, seed, col, row) {
  const o = ECONOMY.ore;
  const n1 = hash2(seed ^ 0x51ed, col, row);
  const n2 = hash2(seed ^ 0x7a11, row, col);
  const noise = 1 + o.variance * (n1 * 2 - 1);
  const jackpot = n2 < o.jackpotChance ? o.jackpotMult : 1;
  return type.slots * type.mult * noise * jackpot;
}

/**
 * Цена груза при заданной цене единицы на забое: unit = facePrice × factor.
 * Семантика «цена по забойной глубине» (карточка IDIGIT-11, ENGINE-PARITY.md §8):
 * платим не за глубину конкретной ячейки, а за глубину, до которой дошли.
 * Груз без factor (сохранения до v3) считается по записанной цене ячейки.
 */
export function cargoValueAt(cargo, facePrice) {
  const merged = new Map();
  for (const item of cargo || []) {
    const type = LOOT_BY_ID.get(item.typeId);
    if (!type) continue;
    const count = Math.max(0, Math.floor(item.count ?? 1));
    if (count <= 0) continue;
    const unit = item.factor != null ? round2(facePrice * item.factor) : Number(item.unitValue) || 0;
    const key = type.id + '|' + Math.round(unit * 100);
    const prev = merged.get(key);
    if (prev) { prev.count += count; prev.sum = round2(prev.sum + unit * count); }
    else merged.set(key, { typeId: type.id, name: type.name, color: type.color, count, unit, sum: round2(unit * count) });
  }
  const lines = [...merged.values()];
  lines.sort((a, b) => b.sum - a.sum);
  const total = round2(lines.reduce((s, l) => s + l.sum, 0));
  return { total, lines };
}

/**
 * Цена одной находки в момент подбора — из формулы модели.
 * noise и «богатая жила» детерминированы координатой ячейки.
 * Это цена ЯЧЕЙКИ (подсказки, событие pickup); при продаже у груза с factor
 * она не используется: см. cargoValueAt и sellCargo.
 */
export function rollUnitValue(type, depth, seed, col, row, fatigue = 1) {
  const o = ECONOMY.ore;
  const base = oreValuePerUnit(depth);
  const n1 = hash2(seed ^ 0x51ed, col, row);
  const n2 = hash2(seed ^ 0x7a11, row, col);
  const noise = 1 + o.variance * (n1 * 2 - 1);
  const jackpot = n2 < o.jackpotChance ? o.jackpotMult : 1;
  return round2((base * type.slots * type.mult * noise * jackpot * fatigue) / 1);
}

/** Цена находки без разброса — для README и подсказок. */
export function baseValue(type, depth, fatigue = 1) {
  return round2(oreValuePerUnit(depth) * type.slots * type.mult * fatigue);
}

/** Груз: стек { typeId, count, unitValue } — суммируем ровно то, что заплатили. */
export function cargoValue(cargo) {
  const merged = new Map();
  for (const item of cargo || []) {
    const type = LOOT_BY_ID.get(item.typeId);
    if (!type) continue;
    const count = Math.max(0, Math.floor(item.count ?? 1));
    if (count <= 0) continue;
    const unit = Number(item.unitValue) || 0;
    const key = type.id + '|' + Math.round(unit * 100);
    const prev = merged.get(key);
    if (prev) {
      prev.count += count;
      prev.sum = round2(prev.sum + unit * count);
    } else {
      merged.set(key, { typeId: type.id, name: type.name, color: type.color, count, unit, sum: round2(unit * count) });
    }
  }
  const lines = [...merged.values()];
  lines.sort((a, b) => b.sum - a.sum);
  const total = round2(lines.reduce((s, l) => s + l.sum, 0));
  return { total, lines };
}

/** Сколько слотов трюма занимает груз. */
export function cargoWeight(cargo) {
  let slots = 0;
  for (const item of cargo || []) {
    const type = LOOT_BY_ID.get(item.typeId);
    if (!type) continue;
    slots += type.slots * Math.max(0, Math.floor(item.count ?? 1));
  }
  return slots;
}

/** Добавить находку в трюм, сливая одинаковые стеки. */
export function addCargo(cargo, typeId, unitValue, factor = null) {
  const existing = (cargo || []).find(
    (c) => c.typeId === typeId && Math.abs((c.unitValue || 0) - unitValue) < 0.005
      && (factor == null || c.factor == null || Math.abs(c.factor - factor) < 1e-9),
  );
  if (existing) existing.count += 1;
  else cargo.push({ typeId, count: 1, unitValue, factor });
  return cargo;
}

export const LOOT_LAYER_NAMES = ['Грунт', 'Порода', 'Кристаллы', 'Лава', 'Бездна'];
export { layerAt };
