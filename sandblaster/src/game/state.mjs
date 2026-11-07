/**
 * Состояние и сохранение.
 *
 * Поле `save_version` + пошаговые миграции; старые ключи `sandblaster.save.vN` читаются,
 * если основного нет. Повреждённый сейв не должен ломать игру: loadState() возвращает
 * либо безопасное состояние, либо null + причину.
 */

import { ECONOMY, RULES } from './config.mjs';
import { normalizeOrder } from './orders.mjs';
import { AXIS_IDS, emptyLevels, levelOf, statsFor } from './upgrades.mjs';

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'sandblaster.save';
export const LEGACY_KEYS = ['sandblaster.save.v2', 'sandblaster.save.v1'];

const finite = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const nonNeg = (v, fallback = 0) => Math.max(0, finite(v, fallback));

export function newGame({ now = Date.now() } = {}) {
  const levels = emptyLevels();
  return {
    save_version: SAVE_VERSION,
    createdAt: now,
    lastSeen: now,
    money: RULES.startMoney,
    levels,
    hopperKg: statsFor(levels).capacityKg,
    completed: { class1: 0, class2: 0, class3: 0 },
    ordersDone: 0,
    totalEarned: 0,
    bestClean: 0,
    current: null,
    lifetime: { spraySeconds: 0, abrasiveKg: 0, energyKwh: 0, dents: 0, spent: 0 },
    pendingOffline: null,
  };
}

export function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _map: map,
  };
}

export function sanitizeState(raw, { now = Date.now() } = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = newGame({ now });

  const levels = emptyLevels();
  for (const id of AXIS_IDS) {
    const table = ECONOMY[id];
    levels[id] = Math.max(0, Math.min(table.length - 1, Math.round(finite(src.levels?.[id], 0))));
  }

  const completed = {
    class1: nonNeg(Math.round(finite(src.completed?.class1, 0))),
    class2: nonNeg(Math.round(finite(src.completed?.class2, 0))),
    class3: nonNeg(Math.round(finite(src.completed?.class3, 0))),
  };
  const ordersDone = Math.max(completed.class1 + completed.class2 + completed.class3, nonNeg(Math.round(finite(src.ordersDone, 0))));
  const order = normalizeOrder(src.current?.order);
  const capacity = statsFor(levels).capacityKg;

  return {
    ...base,
    createdAt: finite(src.createdAt, now),
    lastSeen: finite(src.lastSeen, now),
    money: nonNeg(src.money, base.money),
    levels,
    hopperKg: src.hopperKg == null ? capacity : Math.max(0, Math.min(capacity, nonNeg(src.hopperKg, 0))),
    completed,
    ordersDone,
    totalEarned: nonNeg(src.totalEarned, 0),
    bestClean: Math.max(0, Math.min(100, nonNeg(src.bestClean, 0))),
    current: order ? { order, grid: { strength: String(src.current?.grid?.strength || ''), damage: String(src.current?.grid?.damage || ''), plate: String(src.current?.grid?.plate || '') } } : null,
    lifetime: {
      spraySeconds: nonNeg(src.lifetime?.spraySeconds, 0),
      abrasiveKg: nonNeg(src.lifetime?.abrasiveKg, 0),
      energyKwh: nonNeg(src.lifetime?.energyKwh, 0),
      dents: nonNeg(src.lifetime?.dents, 0),
      spent: nonNeg(src.lifetime?.spent, 0),
    },
    pendingOffline: src.pendingOffline && typeof src.pendingOffline === 'object' ? { ...src.pendingOffline } : null,
  };
}

/** v1: {money, levels без hand, done}; v2: + hopperKg/completed; v3: + lifetime/current. */
export function migrate(raw) {
  if (!raw || typeof raw !== 'object') return { state: null, from: null, migrated: false, reason: 'нет данных' };
  const from = Math.round(finite(raw.save_version, 1));
  if (from > SAVE_VERSION) return { state: null, from, migrated: false, reason: `сейв новее игры (v${from} > v${SAVE_VERSION})` };
  let src = { ...raw };
  let version = from;

  if (version <= 1) {
    src.levels = { ...(src.levels || {}), hand: src.levels?.hand ?? 0 };
    const done = Math.max(0, Math.round(finite(src.done, 0)));
    src.completed = src.completed || { class1: done, class2: 0, class3: 0 };
    src.ordersDone = src.ordersDone ?? done;
    version = 2;
    src.save_version = 2;
  }
  if (version <= 2) {
    src.lifetime = src.lifetime || { spraySeconds: 0, abrasiveKg: 0, energyKwh: 0, dents: 0, spent: 0 };
    src.pendingOffline = src.pendingOffline ?? null;
    src.bestClean = src.bestClean ?? 0;
    src.current = src.current ?? null;
    version = 3;
    src.save_version = 3;
  }

  const state = sanitizeState(src);
  return { state, from, migrated: from !== SAVE_VERSION, reason: null };
}

export function loadState(storage, { now = Date.now() } = {}) {
  if (!storage) return { state: null, from: null, migrated: false, reason: 'нет storage' };
  for (const key of [SAVE_KEY, ...LEGACY_KEYS]) {
    let text = null;
    try {
      text = storage.getItem(key);
    } catch {
      continue;
    }
    if (!text) continue;
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      return { state: null, from: null, migrated: false, reason: 'сейв повреждён (не JSON)' };
    }
    return { ...migrate(raw), key };
  }
  return { state: null, from: null, migrated: false, reason: 'сейва нет' };
}

export function serializeState(state) {
  return JSON.stringify({ ...state, save_version: SAVE_VERSION });
}

export function saveState(storage, state, { now = Date.now() } = {}) {
  if (!storage) return false;
  try {
    storage.setItem(SAVE_KEY, serializeState({ ...state, lastSeen: now }));
    return true;
  } catch {
    return false;
  }
}

export function levelIn(state, id) {
  return levelOf(state.levels, id);
}

export function hopperCapacity(state) {
  return statsFor(state.levels).capacityKg;
}
