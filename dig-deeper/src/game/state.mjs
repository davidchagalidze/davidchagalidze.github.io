/**
 * Состояние игры. Форма — из модели дизайнера (initialState), плюс игровые поля:
 * инвентарь расходников, рекорды, снимок незаконченного забега.
 *
 * Сохранение: localStorage, поле SAVE_VERSION, миграция со старой формы v1.
 */

import { ECONOMY, statsFor } from '../config/economy.mjs';
import { AXES } from '../config/upgrades.mjs';
import { createWorld, decodeDug, encodeDug, isValidDugMap } from '../engine/world.mjs';
import { createRun } from './run.mjs';
import { syncMachine } from './machine.mjs';
import { initialState as modelInitialState } from '../model/model-v1.mjs';

/**
 * v4 — постоянный мир: в сейве появилось `mine = { seed, dug }` (IDIGIT-13/14).
 * До v4 мир генерировался заново на каждый забег, и в сейве шахты не было.
 */
export const SAVE_VERSION = 4;
export const SAVE_KEY = 'dig-deeper.save';

const emptyTiers = () => Object.fromEntries(AXES.map((a) => [a.id, 0]));
const emptyInventory = () => ({ capsule: 0, coolant: 0, repairKit: 0 });

export function newGame({ mode = 'campaign', hardcore = false, seed = 1, now = 0 } = {}) {
  const base = modelInitialState({ seed });
  base.mode = mode === 'free' || mode === 'freeplay' ? 'freeplay' : 'campaign';
  if (base.mode === 'freeplay') {
    base.debt = 0;
    base.debtPaid = 0;
    base.cash = 0;
  }
  const tiers = { ...emptyTiers(), ...(base.tiers || {}) };
  const stats = statsFor(tiers);
  return {
    ...base,
    tiers,
    SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    hardcore: !!hardcore,
    inventory: emptyInventory(),
    // Машина: полный бак и корпус на старте, дальше — остатки с прошлого забега.
    machine: { fuel: stats.tankLiters, hull: stats.hp, depth: 0 },
    records: { totalRuns: 0, totalEarnings: 0, bestDepth: 0, deaths: 0, freeDepth: 0, freeEarnings: 0 },
    run: null,
    /**
     * Шахта кампании (R1, IDIGIT-13): сид выбирается один раз при новой игре,
     * `dug` — битовая карта выработки в base64. Живёт до «Новой игры».
     */
    mine: { seed: Math.round(Number(base.seed)) || 1, dug: '' },
  };
}

/**
 * Мир шахты из сейва: тот же сид + вся накопленная выработка. Одна функция на
 * все входы в забой (кампания, free play, продолжение) — чтобы случайный мир
 * не вернулся ни в один путь.
 */
export function mineWorld(state) {
  const mine = state?.mine || {};
  const seed = Math.round(finite(mine.seed, finite(state?.seed, 1))) || 1;
  const world = createWorld(seed);
  world.applySaved(isValidDugMap(mine.dug) ? decodeDug(mine.dug) : [], []);
  return world;
}

/** Записать выработку мира обратно в состояние (перед persist, см. endRun). */
export function saveMine(state, world) {
  state.mine = { seed: world.seed, dug: world.encodeDug() };
  return state.mine;
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

const finite = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const nonNeg = (v, fallback = 0) => Math.max(0, finite(v, fallback));

/** Приводит состояние к безопасному виду: никаких NaN и отрицательных денег в UI. */
export function sanitizeState(raw) {
  const src = raw || {};
  const s = newGame({
    mode: src.mode === 'freeplay' || src.mode === 'free' ? 'free' : 'campaign',
    seed: Math.round(finite(src.seed, 1)) || 1,
    hardcore: !!src.hardcore,
  });

  s.day = nonNeg(Math.round(finite(src.day, 0)));
  s.runs = nonNeg(Math.round(finite(src.runs, s.day)));
  s.cash = nonNeg(src.cash);
  s.debt = nonNeg(src.debt, ECONOMY.mortgage.principal);
  s.debtPaid = nonNeg(src.debtPaid);
  s.windowPaid = nonNeg(src.windowPaid);
  s.bankEscrow = nonNeg(src.bankEscrow);
  s.missedPayments = nonNeg(Math.round(finite(src.missedPayments, 0)));
  s.consecutiveMisses = nonNeg(Math.round(finite(src.consecutiveMisses, 0)));
  s.status = ['playing', 'won', 'seized'].includes(src.status) ? src.status : 'playing';
  s.bestDepth = nonNeg(Math.round(finite(src.bestDepth, 0)));
  s.bestNet = finite(src.bestNet, 0);
  s.totalIncome = nonNeg(src.totalIncome);
  s.totalFuel = nonNeg(src.totalFuel);
  s.totalRepair = nonNeg(src.totalRepair);
  s.totalBank = nonNeg(src.totalBank);
  s.totalTow = nonNeg(src.totalTow);
  s.totalUpgrades = nonNeg(src.totalUpgrades);
  s.totalConsumables = nonNeg(src.totalConsumables);

  s.tiers = emptyTiers();
  for (const axis of AXES) {
    const t = Math.round(finite(src.tiers?.[axis.id], 0));
    s.tiers[axis.id] = Math.min(axis.tiers.length - 1, Math.max(0, t));
  }

  s.layerMined = (Array.isArray(src.layerMined) ? src.layerMined : []).slice(0, 5).map((v) => nonNeg(v));
  while (s.layerMined.length < 5) s.layerMined.push(0);
  s.lastFiveGross = Array.isArray(src.lastFiveGross) ? src.lastFiveGross.filter((v) => Number.isFinite(Number(v))).map(Number).slice(-5) : [];
  s.warnings = Array.isArray(src.warnings) ? src.warnings.filter((w) => w && typeof w.text === 'string').slice(-20) : [];

  s.inventory = {
    capsule: nonNeg(Math.round(finite(src.inventory?.capsule, 0))),
    coolant: nonNeg(Math.round(finite(src.inventory?.coolant, 0))),
    repairKit: nonNeg(Math.round(finite(src.inventory?.repairKit, 0))),
  };

  // Машина: в старых сохранениях её нет — считаем, что она в полном порядке.
  // syncMachine сам приводит числа к диапазону бака/корпуса и выкидывает мусор.
  s.machine = src.machine && typeof src.machine === 'object' ? src.machine : null;
  syncMachine(s);

  const r = src.records || {};
  s.records = {
    totalRuns: nonNeg(Math.round(finite(r.totalRuns, 0))),
    totalEarnings: nonNeg(Math.round(finite(r.totalEarnings, 0))),
    bestDepth: nonNeg(Math.round(finite(r.bestDepth, 0))),
    deaths: nonNeg(Math.round(finite(r.deaths, 0))),
    freeDepth: nonNeg(Math.round(finite(r.freeDepth, 0))),
    freeEarnings: nonNeg(Math.round(finite(r.freeEarnings, 0))),
  };

  s.run = src.run && typeof src.run === 'object' ? src.run : null;

  // Шахта: сид и карта выработки. Битый base64 или карта чужой сетки — считаем
  // шахту нетронутой (мир сгенерируется из сида), деньги и апгрейды не страдают.
  const rawMineSeed = Math.round(finite(src.mine?.seed, finite(s.seed, 1))) || 1;
  s.mine = { seed: rawMineSeed, dug: isValidDugMap(src.mine?.dug) ? src.mine.dug : '' };
  s.seed = rawMineSeed;

  s.SAVE_VERSION = SAVE_VERSION;
  return s;
}

/**
 * Снимок забега. В снимок идёт ТОЛЬКО дельта мира — клетки, выкопанные этим
 * забегом (§6 IDIGIT-13): полная карта лежит в `state.mine.dug` и пишется в
 * конце забега. Иначе автосейв каждые 4 секунды таскал бы сотни килобайт.
 */
export function snapshotRun(run, world) {
  return {
    seed: world.seed,
    x: run.x,
    y: run.y,
    fuel: run.fuel,
    hull: run.hull,
    temp: run.temp,
    capsuleTimer: run.capsuleTimer,
    coolantActive: !!run.coolantActive,
    repairKitUsed: !!run.repairKitUsed,
    mineCredit: run.mineCredit,
    pressureTimer: run.pressureTimer,
    cargo: run.cargo.map((c) => ({ typeId: c.typeId, count: c.count, unitValue: c.unitValue, factor: c.factor ?? null })),
    consumables: { ...run.consumables },
    maxDepth: run.maxDepth,
    cellsDug: run.cellsDug,
    time: run.time,
    // Дельта забега. Полный список «col,row» писался до v4 (поле dug) — старые
    // снимки читаются в restoreRun как дельта (миграция v3→v4).
    dugDelta: [...(run.dugDelta || [])],
  };
}

export function restoreRun(state) {
  const snap = state?.run;
  if (!snap || !Number.isFinite(snap.seed)) return null;
  const seed = Math.round(snap.seed) || 1;
  const mine = state?.mine;
  const base = mine && Math.round(finite(mine.seed, seed)) === seed && isValidDugMap(mine.dug) ? decodeDug(mine.dug) : [];
  const delta = Array.isArray(snap.dugDelta) ? snap.dugDelta : Array.isArray(snap.dug) ? snap.dug : [];
  const all = base.concat(delta);
  const world = createWorld(seed);
  world.applySaved(all, Array.isArray(snap.taken) ? snap.taken : []);
  // Выработка незаконченного забега сразу переезжает в шахту: иначе второй
  // перезапуск посреди того же забега потерял бы тоннель, ведь в снимке
  // хранится только дельта.
  state.mine = { seed, dug: encodeDug(all) };
  const run = createRun(state, world);
  run.dugDelta = new Set();
  run.x = finite(snap.x, run.x);
  run.y = finite(snap.y, run.y);
  run.fuel = Math.min(run.stats.tankLiters, nonNeg(snap.fuel, run.stats.tankLiters));
  run.hull = Math.min(run.stats.hp, nonNeg(snap.hull, run.stats.hp));
  run.temp = Math.min(400, nonNeg(snap.temp, 20));
  run.capsuleTimer = nonNeg(snap.capsuleTimer);
  run.coolantActive = !!snap.coolantActive;
  run.repairKitUsed = !!snap.repairKitUsed;
  run.mineCredit = nonNeg(snap.mineCredit);
  run.pressureTimer = nonNeg(snap.pressureTimer);
  run.cargo = Array.isArray(snap.cargo)
    ? snap.cargo
        .filter((c) => c && c.typeId)
        .map((c) => ({
          typeId: c.typeId,
          count: Math.max(1, Math.round(finite(c.count, 1))),
          unitValue: nonNeg(c.unitValue),
          // Множитель находки: без него восстановленный из сохранения забег
          // продал бы руду по цене ячейки (старая семантика, IDIGIT-11).
          factor: c.factor != null && Number.isFinite(Number(c.factor)) ? Number(c.factor) : null,
        }))
    : [];
  run.consumables = { ...state.inventory };
  run.maxDepth = nonNeg(snap.maxDepth);
  run.cellsDug = nonNeg(snap.cellsDug);
  run.time = nonNeg(snap.time);
  run.depth = Math.max(0, run.y + run.h) / 12;
  return { world, run };
}

export function saveState(state, storage, now = 0) {
  state.updatedAt = now || state.updatedAt;
  storage.setItem(SAVE_KEY, JSON.stringify({ ...state, SAVE_VERSION }));
  return state;
}

/**
 * Миграция старых сохранений: v1 (money/loan/tiers) → v2 → v3 (машина) → v4
 * (постоянный мир: `mine = { seed, dug }`).
 *
 * v3→v4: мир в старом сейве не хранился — каждый забег генерировал новый.
 * Незаконченный забег переезжает как есть: его сид становится сидом шахты, а
 * выкопанные в нём клетки — её выработкой (список «col,row» → битовая карта).
 * Деньги, тиры, день, глубина и долг не трогаются вообще: их ведёт sanitize.
 */
function migrate(raw, version) {
  if (version >= SAVE_VERSION) return raw;
  let out = { ...raw };
  if (version < 3) out = migrateToV3(out, version);
  if (version < 4) out = migrateToV4(out);
  out.SAVE_VERSION = SAVE_VERSION;
  return out;
}

function migrateToV4(raw) {
  const out = { ...raw };
  const run = raw.run && typeof raw.run === 'object' ? raw.run : null;
  const seed = Math.round(finite(run?.seed, finite(raw.seed, 1))) || 1;
  const dug = Array.isArray(run?.dug) ? run.dug : [];
  out.seed = seed;
  out.mine = {
    seed,
    dug: encodeDug(dug.filter((id) => typeof id === 'string')),
  };
  return out;
}

function migrateToV3(raw, version) {
  if (version >= 2) {
    // v2→v3: появилась машина с остатком бака/корпуса. Старое сохранение
    // считается «машина в порядке» — sanitize поставит полный бак и корпус.
    return { ...raw };
  }
  const out = { ...raw };
  out.cash = nonNeg(raw.cash ?? raw.money);
  out.debt = nonNeg(raw.debt ?? raw.loan?.remaining, ECONOMY.mortgage.principal);
  out.day = nonNeg(raw.day);
  out.runs = out.day;
  out.status = raw.status === 'paid' ? 'won' : raw.status === 'foreclosed' ? 'seized' : 'playing';
  out.mode = raw.mode === 'free' ? 'freeplay' : 'campaign';
  out.tiers = { ...emptyTiers(), ...(raw.tiers || {}) };
  out.layerMined = [0, 0, 0, 0, 0];
  out.lastFiveGross = [];
  out.windowPaid = 0;
  out.consecutiveMisses = 0;
  out.missedPayments = 0;
  out.warnings = [];
  return out;
}

export function loadState(storage) {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const version = Math.round(finite(parsed.SAVE_VERSION, 1));
  if (version > SAVE_VERSION) return null;
  return sanitizeState(migrate(parsed, version));
}

export function clearSave(storage) {
  storage.removeItem(SAVE_KEY);
}
