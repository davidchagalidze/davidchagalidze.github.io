/**
 * Мир: чанковая сетка мелких ячеек (8 px), ленивая генерация, разрушение грунта.
 *
 * Мир детерминирован от seed: любой чанк можно сгенерировать независимо, поэтому
 * сохранение хранит только список выкопанных ячеек и собранных находок, а не 1.3 млн
 * ячеек целиком.
 */

import { DEPTH, ECONOMY, layerIndexAt } from '../config/economy.mjs';
import { lootPoolForLayer, poolWeight } from '../config/loot.mjs';
import { fbm2, hash2, noise2 } from './rng.mjs';

export const MAT = {
  AIR: 0,
  SOIL: 1,
  ROCK: 2,
  BOULDER: 3,
  WATER: 4,
  MAGMA: 5,
  BEDROCK: 6,
  CAVE: 7,
};

export const CHUNK = 32;
export const TILE = DEPTH.tile;

/**
 * Сетка карты выработки для сейва. Фиксирована геометрией мира (240 × 6300 =
 * 1 512 000 клеток → 189 000 байт → 252 000 символов base64), поэтому размер
 * сохранения не растёт с числом выкопанных клеток (карточка IDIGIT-13 §6).
 */
export const DUG_COLS = DEPTH.cols;
export const DUG_ROWS = Math.ceil((DEPTH.maxDepth * DEPTH.pxPerMeter) / TILE);

const HAS_BUFFER = typeof Buffer !== 'undefined' && typeof Buffer.from === 'function';

function bytesToBase64(bytes) {
  if (HAS_BUFFER) return Buffer.from(bytes).toString('base64');
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    const slice = bytes.subarray(i, i + step);
    let s = '';
    for (let j = 0; j < slice.length; j++) s += String.fromCharCode(slice[j]);
    bin += s;
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  if (HAS_BUFFER) return new Uint8Array(Buffer.from(String(b64 || ''), 'base64'));
  const bin = atob(String(b64 || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Выработка → битовая карта в base64. `bit = row * cols + col`.
 * Пустая карта — пустая строка (ни одной клетки).
 */
export function encodeDug(dugIds, cols = DUG_COLS, rows = DUG_ROWS) {
  const bytes = new Uint8Array(Math.ceil((cols * rows) / 8));
  for (const id of dugIds || []) {
    const i = id.indexOf(',');
    if (i < 0) continue;
    const col = Number(id.slice(0, i));
    const row = Number(id.slice(i + 1));
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= cols || row >= rows) continue;
    const bit = row * cols + col;
    bytes[bit >> 3] |= 1 << (bit & 7);
  }
  return bytesToBase64(bytes);
}

/** Битовая карта base64 → список «col,row» (порядок — по строкам). */
export function decodeDug(b64, cols = DUG_COLS, rows = DUG_ROWS) {
  const bytes = base64ToBytes(b64);
  const out = [];
  const total = cols * rows;
  for (let byte = 0; byte < bytes.length; byte++) {
    const v = bytes[byte];
    if (!v) continue;
    for (let b = 0; b < 8; b++) {
      if (!(v & (1 << b))) continue;
      const bit = byte * 8 + b;
      if (bit >= total) break;
      out.push(`${bit % cols},${Math.floor(bit / cols)}`);
    }
  }
  return out;
}

/** Похожа ли строка на нашу карту выработки (base64 нужной длины). Пустая — да. */
export function isValidDugMap(b64, cols = DUG_COLS, rows = DUG_ROWS) {
  if (typeof b64 !== 'string') return false;
  if (b64 === '') return true;
  const expectedBytes = Math.ceil((cols * rows) / 8);
  if (b64.length !== Math.ceil(expectedBytes / 3) * 4) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return false;
  return base64ToBytes(b64).length === expectedBytes;
}

/** Что игрок видит в городе: сколько клеток выработано и до какой глубины шахта. */
export function dugStats(b64, cols = DUG_COLS, rows = DUG_ROWS) {
  const bytes = base64ToBytes(b64);
  let cells = 0;
  let lastByte = -1;
  for (let byte = 0; byte < bytes.length; byte++) {
    let v = bytes[byte];
    if (!v) continue;
    lastByte = byte;
    while (v) {
      cells += v & 1;
      v >>= 1;
    }
  }
  if (lastByte < 0) return { cells: 0, maxRow: -1, depth: 0 };
  const last = bytes[lastByte];
  let highBit = 0;
  for (let b = 7; b >= 0; b--) {
    if (last & (1 << b)) {
      highBit = b;
      break;
    }
  }
  const maxRow = Math.min(rows - 1, Math.floor((lastByte * 8 + highBit) / cols));
  return { cells, maxRow, depth: ((maxRow + 1) * TILE) / DEPTH.pxPerMeter };
}


/** Плотность находок по слоям (доля ячеек, в которых лежит находка). */
const LOOT_DENSITY = [0.036, 0.032, 0.03, 0.028, 0.026];

/** Порог «дыр» (пещер) по слоям. */
const CAVE_THRESHOLD = [0.80, 0.76, 0.72, 0.74, 0.70];

/** Условная твёрдость материала — только для визуальных эффектов и звука. */
export const HARDNESS = {
  [MAT.SOIL]: { fuel: 1, heat: 1, hits: 1 },
  [MAT.ROCK]: { fuel: 1, heat: 1, hits: 1 },
  [MAT.BOULDER]: { fuel: 1, heat: 1, hits: 1 },
};

export function isSolidMat(mat) {
  return mat === MAT.SOIL || mat === MAT.ROCK || mat === MAT.BOULDER || mat === MAT.BEDROCK;
}

export function isFluidMat(mat) {
  return mat === MAT.WATER || mat === MAT.MAGMA;
}

export function createWorld(seed, opts = {}) {
  const safeSeed = (Number(seed) >>> 0) || 1;
  const cols = opts.cols || DEPTH.cols;
  const rows = opts.rows || Math.ceil((DEPTH.maxDepth * DEPTH.pxPerMeter) / TILE);
  const widthPx = cols * TILE;
  const heightPx = rows * TILE;
  const chunks = new Map();
  const dirtyChunks = new Set();
  /** Выкопанные ячейки — источник правды и для рендера, и для сохранения. */
  const dug = new Set();
  /** Собранные находки (id). */
  const taken = new Set();

  const key = (cx, cy) => cx + ':' + cy;
  const cellKey = (col, row) => col + ',' + row;

  function materialAt(col, row, depthM) {
    if (col < 2 || col >= cols - 2 || row >= rows - 3) return MAT.BEDROCK;
    if (depthM < 0.7) return MAT.AIR;
    const layer = layerIndexAt(depthM);
    const cave = fbm2(safeSeed ^ 0x1111, col, row, 9, 2);
    if (cave > CAVE_THRESHOLD[layer]) return MAT.CAVE;

    const rockN = fbm2(safeSeed ^ 0x2222, col, row, 7, 2);
    let mat = MAT.SOIL;
    if (layer === 0) {
      if (rockN > 0.72) mat = MAT.ROCK;
    } else if (layer === 1) {
      if (rockN > 0.52) mat = MAT.ROCK;
    } else {
      mat = MAT.ROCK;
      if (rockN > 0.72) mat = MAT.SOIL;
    }

    const boulderN = noise2(safeSeed ^ 0x3333, col, row, 3.4);
    if (layer >= 1 && boulderN > 0.815) return MAT.BOULDER;

    if (layer >= 2) {
      const waterN = fbm2(safeSeed ^ 0x4444, col, row, 8, 2);
      if (waterN > 0.815) return MAT.WATER;
    }
    if (layer >= 3) {
      const magmaN = noise2(safeSeed ^ 0x5555, col, row, 6.5);
      if (magmaN > 0.805) return MAT.MAGMA;
    }
    return mat;
  }

  function lootAt(col, row, depthM) {
    const layer = layerIndexAt(depthM);
    const density = LOOT_DENSITY[layer] || LOOT_DENSITY[0];
    if (hash2(safeSeed ^ 0xabcd, col, row) >= density) return null;
    const pool = lootPoolForLayer(layer);
    const total = poolWeight(pool) || 1;
    let r = hash2(safeSeed ^ 0x0f0f, col, row + 17) * total;
    for (const type of pool) {
      r -= Number(type.rarity) || 0;
      if (r <= 0) return type;
    }
    return pool[pool.length - 1];
  }

  function generateChunk(cx, cy) {
    const cells = new Uint8Array(CHUNK * CHUNK);
    const loot = [];
    for (let j = 0; j < CHUNK; j++) {
      const row = cy * CHUNK + j;
      if (row < 0 || row >= rows) continue;
      const depthM = (row * TILE) / DEPTH.pxPerMeter;
      for (let i = 0; i < CHUNK; i++) {
        const col = cx * CHUNK + i;
        if (col < 0 || col >= cols) continue;
        let mat = materialAt(col, row, depthM);
        const idx = j * CHUNK + i;
        const id = cellKey(col, row);
        if (dug.has(id)) {
          cells[idx] = MAT.AIR;
          continue;
        }
        cells[idx] = mat;
        if (isSolidMat(mat) && mat !== MAT.BEDROCK && !taken.has(id)) {
          const type = lootAt(col, row, depthM);
          if (type) loot.push({ id, col, row, typeId: type.id, taken: false });
        }
      }
    }
    const chunk = { cx, cy, cells, loot, dirty: true };
    chunks.set(key(cx, cy), chunk);
    return chunk;
  }

  function ensureChunk(cx, cy) {
    const k = key(cx, cy);
    let chunk = chunks.get(k);
    if (!chunk) chunk = generateChunk(cx, cy);
    return chunk;
  }

  function getCell(col, row) {
    if (col < 0 || col >= cols) return MAT.BEDROCK;
    if (row < 0) return MAT.AIR;
    if (row >= rows) return MAT.BEDROCK;
    const cx = Math.floor(col / CHUNK);
    const cy = Math.floor(row / CHUNK);
    const chunk = ensureChunk(cx, cy);
    return chunk.cells[(row - cy * CHUNK) * CHUNK + (col - cx * CHUNK)];
  }

  function setCell(col, row, mat) {
    if (col < 0 || col >= cols || row < 0 || row >= rows) return;
    const cx = Math.floor(col / CHUNK);
    const cy = Math.floor(row / CHUNK);
    const chunk = ensureChunk(cx, cy);
    chunk.cells[(row - cy * CHUNK) * CHUNK + (col - cx * CHUNK)] = mat;
    chunk.dirty = true;
    dirtyChunks.add(key(cx, cy));
  }

  const cellAtPx = (x, y) => getCell(Math.floor(x / TILE), Math.floor(y / TILE));
  const isSolid = (x, y) => isSolidMat(cellAtPx(x, y));

  /**
   * Разрушить ячейку. Возвращает { dug:boolean, material, loot }.
   * Находка позиционная (R2, IDIGIT-13): она помечается собранной в тот же
   * момент, когда срезана порода. В трюм её кладёт вызывающий код, если есть
   * место; иначе она потеряна. Без этого поведение зависело от перезагрузки:
   * до неё находку можно было подобрать позже, после — клетка уже воздух.
   */
  function digCell(col, row) {
    const mat = getCell(col, row);
    if (!isSolidMat(mat) || mat === MAT.BEDROCK) return { dug: false, material: mat, loot: null };
    setCell(col, row, MAT.AIR);
    const id = cellKey(col, row);
    dug.add(id);
    const chunk = ensureChunk(Math.floor(col / CHUNK), Math.floor(row / CHUNK));
    const loot = chunk.loot.find((l) => l.col === col && l.row === row && !l.taken) || null;
    if (loot) {
      loot.taken = true;
      taken.add(id);
    }
    return { dug: true, material: mat, loot };
  }

  function markTaken(id) {
    taken.add(id);
  }

  function hasDug(col, row) {
    return dug.has(cellKey(col, row));
  }

  /** Находки в прямоугольнике (для рендера и подбора). */
  function lootInRect(x0, y0, x1, y1) {
    const cx0 = Math.floor(x0 / (CHUNK * TILE));
    const cx1 = Math.floor(x1 / (CHUNK * TILE));
    const cy0 = Math.floor(y0 / (CHUNK * TILE));
    const cy1 = Math.floor(y1 / (CHUNK * TILE));
    const out = [];
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = ensureChunk(cx, cy);
        for (const loot of chunk.loot) {
          if (loot.taken) continue;
          const px = loot.col * TILE + TILE / 2;
          const py = loot.row * TILE + TILE / 2;
          if (px < x0 || px > x1 || py < y0 || py > y1) continue;
          out.push(loot);
        }
      }
    }
    return out;
  }

  function consumeDirty() {
    if (!dirtyChunks.size) return [];
    const out = [...dirtyChunks];
    dirtyChunks.clear();
    for (const k of out) {
      const chunk = chunks.get(k);
      if (chunk) chunk.dirty = true;
    }
    return out;
  }

  function chunkAt(cx, cy) {
    return ensureChunk(cx, cy);
  }

  const depthAtY = (y) => Math.max(0, y) / DEPTH.pxPerMeter;

  return {
    seed: safeSeed,
    cols,
    rows,
    widthPx,
    heightPx,
    tile: TILE,
    /** Линия поверхности: верхняя граница грунта в мировых px. */
    surfaceY: TILE,
    chunks,
    dug,
    taken,
    ensureChunk,
    chunkAt,
    getCell,
    setCell,
    cellAtPx,
    isSolid,
    digCell,
    markTaken,
    hasDug,
    lootInRect,
    consumeDirty,
    depthAtY,
    /** Для сохранения: список выкопанных ячеек «col,row». */
    serializeDug: () => [...dug],
    serializeTaken: () => [...taken],
    /** Межзабеговое состояние (IDIGIT-13 §6): битовая карта выработки, base64. */
    encodeDug: () => encodeDug(dug, cols, rows),
    decodeDug: (b64) => decodeDug(b64, cols, rows),
    applySaved(dugList = [], takenList = []) {
      for (const id of dugList) dug.add(id);
      for (const id of takenList) taken.add(id);
      // Уже сгенерированные чанки надо пересобрать с учётом восстановленного состояния.
      for (const k of [...chunks.keys()]) {
        chunks.delete(k);
      }
      dirtyChunks.clear();
    },
  };
}
