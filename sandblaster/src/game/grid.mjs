/**
 * Сетка загрязнений и эрозия.
 *
 * Мир — 320×240 клеток (RULES.gridW/H). У клетки:
 *   mask[i]         1, если точка внутри предмета;
 *   dirt[i]         тип загрязнения 1..4 (хранится навсегда — нужен для процентов по типам);
 *   strength[i]     остаточная прочность 0..1 (1 = слой целый);
 *   plate[i]        1, если клетка закрыта накладкой (скрытый очаг окалины у 20% заказов);
 *   plateProgress   сколько секунд струи уже получила накладка;
 *   smear[i]        визуальный след от смазки, мс.
 *
 * Эрозия: урон в ячейке = pressure·grade/hardness · profile, где profile нормирован так,
 * что его среднее по пятну равно 1. Отсюда суммарный темп = πr²·pressure·grade = HP/с —
 * ровно та формула, по которой модель SAND-1 считает время заказа.
 */

import { ECONOMY, ENGINE, RULES } from './config.mjs';
import { fbm, mulberry32 } from './rng.mjs';
import { insideItem } from './shapes.mjs';

export const DIRT_IDS = ['rust', 'paint', 'scale', 'grease'];
export const DIRT_ID = Object.fromEntries(DIRT_IDS.map((k, i) => [k, i + 1]));

export function createGrid(w = RULES.gridW, h = RULES.gridH) {
  const n = w * h;
  return {
    w,
    h,
    mask: new Uint8Array(n),
    dirt: new Uint8Array(n),
    strength: new Float32Array(n),
    plate: new Uint8Array(n),
    plateProgress: new Float32Array(n),
    damage: new Float32Array(n),
    smear: new Float32Array(n),
    smearCount: 0,
  };
}

/**
 * Детерминированная маска заказа: ровно `order.cells` грязных клеток (как в модели,
 * иначе base не сойдётся), доли типов — из order.dirtMix, у части заказов под накладкой
 * спрятан очаг окалины.
 */
export function buildOrderGrid({ item, order, seed }) {
  const grid = createGrid();
  const { w, h } = grid;
  const n = w * h;
  const target = Math.max(1, Math.min(Number(order.cells) || order.dirtCells || 1000, n));

  // 1. маска предмета
  const inside = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (insideItem(item, x + 0.5, y + 0.5)) {
        grid.mask[i] = 1;
        inside.push(i);
      }
    }
  }
  if (inside.length === 0) throw new Error('пустой предмет: маска не пересекается с сеткой');
  if (target > inside.length) throw new Error(`заказ просит ${target} клеток, а в предмете ${inside.length}`);

  // 2. выбираем ровно target клеток по шуму (пятнами, а не равномерной солью)
  const noise = new Float32Array(n);
  const rng = mulberry32(seed >>> 0);
  for (const i of inside) {
    const x = i % w;
    const y = (i / w) | 0;
    let edge = 0;
    for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !grid.mask[ny * w + nx]) edge = 1;
    }
    noise[i] = fbm(x * 0.045 + 11.3, y * 0.045 + 7.7, 3) + edge * 0.18 * (0.6 + rng() * 0.8);
  }
  const ranked = inside.slice().sort((a, b) => noise[b] - noise[a]);
  const chosen = ranked.slice(0, target);

  // 3. типы — ровно по долям mix (счётчики), раскладываем детерминированно
  const counts = {};
  let assigned = 0;
  const keys = Object.keys(order.dirtMix || { rust: 1 }).filter((k) => DIRT_ID[k] && order.dirtMix[k] > 0);
  keys.forEach((k, idx) => {
    const share = order.dirtMix[k];
    const count = idx === keys.length - 1 ? target - assigned : Math.round(target * share);
    counts[k] = Math.max(0, count);
    assigned += counts[k];
  });
  const bag = [];
  for (const k of keys) for (let i = 0; i < counts[k]; i += 1) bag.push(DIRT_ID[k]);
  // тасуем мешок, чтобы типы легли пятнами, а не полосами по порядку обхода
  for (let i = bag.length - 1; i > 0; i -= 1) {
    const j = (rng() * (i + 1)) | 0;
    const t = bag[i];
    bag[i] = bag[j];
    bag[j] = t;
  }
  // порядок клеток тоже перемешиваем: иначе первый тип ляжет в верхнюю часть предмета
  for (let i = chosen.length - 1; i > 0; i -= 1) {
    const j = (rng() * (i + 1)) | 0;
    const t = chosen[i];
    chosen[i] = chosen[j];
    chosen[j] = t;
  }
  chosen.forEach((cell, idx) => {
    grid.dirt[cell] = bag[idx];
    grid.strength[cell] = 1;
  });

  // 4. скрытый очаг: накладка, под которой прячется горсть окалины
  if (order.stubborn) {
    const center = chosen[(rng() * chosen.length) | 0];
    const cx = center % w;
    const cy = (center / w) | 0;
    const radius = 11;
    for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y += 1) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
        const i = y * w + x;
        if (!grid.dirt[i]) continue;
        grid.plate[i] = 1;
        grid.plateProgress[i] = 0;
      }
    }
  }

  return grid;
}

export function gridStats(grid) {
  let dirtCells = 0;
  let cleaned = 0;
  let damageSum = 0;
  let damagedCells = 0;
  let plateCells = 0;
  const byType = {};
  for (const id of DIRT_IDS) byType[id] = { dirt: 0, cleaned: 0 };
  const eps = ENGINE.cleanEpsilon;
  const n = grid.dirt.length;
  const mud = grid.dirt;
  const strength = grid.strength;
  const damage = grid.damage;
  for (let i = 0; i < n; i += 1) {
    const d = damage[i];
    if (d > 0) {
      damageSum += d;
      if (d > 0.02) damagedCells += 1;
    }
    const t = mud[i];
    if (!t) continue;
    dirtCells += 1;
    if (grid.plate[i]) plateCells += 1;
    const bucket = byType[DIRT_IDS[t - 1]];
    bucket.dirt += 1;
    if (strength[i] <= eps) {
      cleaned += 1;
      bucket.cleaned += 1;
    }
  }
  return {
    dirtCells,
    cleaned,
    cleanPct: dirtCells === 0 ? 100 : (cleaned / dirtCells) * 100,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, { ...v, pct: v.dirt === 0 ? 0 : (v.cleaned / v.dirt) * 100 }])),
    damagedCells,
    damageSum,
    plateCells,
  };
}

/**
 * Один шаг струи. dt — секунды, radius — клетки, pressure — бар.
 * Профиль пятна нормирован на среднее 1, поэтому суммарный темп = πr²·p·grade.
 */
export function applySpray(grid, { cx, cy, radius, pressure, gradeMult = 1, dt }) {
  const out = { cleared: 0, touched: 0, plateRemoved: 0, hp: 0 };
  if (!(dt > 0) || !(radius > 0) || !(pressure > 0)) return out;
  const { w, h } = grid;
  const r = radius;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(h - 1, Math.ceil(cy + r));
  const eps = ENGINE.cleanEpsilon;

  for (let y = y0; y <= y1; y += 1) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x + 0.5 - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const i = y * w + x;
      if (!grid.mask[i]) continue;
      // Накладка: сначала снимаем её, грязь под ней недоступна.
      if (grid.plate[i]) {
        grid.plateProgress[i] += dt;
        if (grid.plateProgress[i] >= ENGINE.plateSec) {
          grid.plate[i] = 0;
          out.plateRemoved += 1;
        }
        continue;
      }
      if (!grid.dirt[i] || grid.strength[i] <= eps) continue;
      const hardness = (ECONOMY.dirt[DIRT_IDS[grid.dirt[i] - 1]] || { hardness: 1 }).hardness;
      out.touched += 1;
      const before = grid.strength[i];
      // Урон — ровно формула модели: pressure·grade/hardness · dt.
      grid.strength[i] -= ((pressure * gradeMult) / hardness) * dt;
      if (grid.strength[i] <= eps) {
        grid.strength[i] = 0;
        out.cleared += 1;
        if (grid.dirt[i] === DIRT_ID.grease) markSmear(grid, x, y, 2200);
      }
      // Работа, реально снятая с клетки в HP — из неё считается расход абразива
      // (кг на HP, а не кг в секунду: так формула совпадает с моделью SAND-1).
      out.hp += (before - Math.max(0, grid.strength[i])) * hardness;
    }
  }
  return out;
}

function markSmear(grid, x, y, ms) {
  const { w, h } = grid;
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (dx * dx + dy * dy > 5) continue;
      const i = ny * w + nx;
      if (grid.smear[i] <= 0) grid.smearCount += 1;
      grid.smear[i] = Math.max(grid.smear[i], ms * (1 - (dx * dx + dy * dy) / 6));
    }
  }
}

export function decaySmear(grid, dtMs) {
  if (!grid.smearCount) return;
  let alive = 0;
  for (let i = 0; i < grid.smear.length; i += 1) {
    if (grid.smear[i] > 0) {
      grid.smear[i] = Math.max(0, grid.smear[i] - dtMs);
      if (grid.smear[i] > 0) alive += 1;
    }
  }
  grid.smearCount = alive;
}

export function randomDirtyCell(grid, rng, tries = 64) {
  const { w, h } = grid;
  for (let t = 0; t < tries; t += 1) {
    const x = (rng() * w) | 0;
    const y = (rng() * h) | 0;
    const i = y * w + x;
    if (grid.dirt[i] && !grid.plate[i] && grid.strength[i] > ENGINE.cleanEpsilon) return { i, x, y };
  }
  for (let i = 0; i < grid.dirt.length; i += 1) {
    if (grid.dirt[i] && !grid.plate[i] && grid.strength[i] > ENGINE.cleanEpsilon) return { i, x: i % w, y: (i / w) | 0 };
  }
  return null;
}

/**
 * Работа наёмного рабочего. Его темп — HP/с (как в модели), поэтому ячейка hardness h
 * стоит h HP: тяжёлую грязь он снимает медленнее.
 */
export function handWork(grid, { hp, rng }) {
  let cleared = 0;
  let spent = 0;
  let guard = 0;
  while (spent < hp && guard < 4000) {
    guard += 1;
    const cell = randomDirtyCell(grid, rng);
    if (!cell) break;
    const hardness = (ECONOMY.dirt[DIRT_IDS[grid.dirt[cell.i] - 1]] || { hardness: 1 }).hardness;
    if (spent + hardness > hp && cleared > 0) break;
    grid.strength[cell.i] = 0;
    if (grid.dirt[cell.i] === DIRT_ID.grease) markSmear(grid, cell.x, cell.y, 2100);
    spent += hardness;
    cleared += 1;
  }
  return { cleared, spent };
}

// ─── компактное сохранение сетки (RLE) ──────────────────────────────────────

export function encodeField(arr, { quant = 255 } = {}) {
  const runs = [];
  let prev = -1;
  let count = 0;
  for (let i = 0; i < arr.length; i += 1) {
    const q = Math.max(0, Math.min(quant, Math.round(arr[i] * quant)));
    if (q === prev) count += 1;
    else {
      if (count > 0) runs.push(`${count.toString(36)}:${prev.toString(36)}`);
      prev = q;
      count = 1;
    }
  }
  if (count > 0) runs.push(`${count.toString(36)}:${prev.toString(36)}`);
  return runs.join(',');
}

export function decodeField(str, length, { quant = 255 } = {}) {
  const out = new Float32Array(length);
  if (!str) return out;
  let idx = 0;
  for (const run of String(str).split(',')) {
    if (!run) continue;
    const [c, v] = run.split(':');
    const count = parseInt(c, 36);
    const value = parseInt(v, 36) / quant;
    if (!Number.isFinite(count) || !Number.isFinite(value)) continue;
    for (let k = 0; k < count && idx < length; k += 1) out[idx++] = value;
    if (idx >= length) break;
  }
  return out;
}

export function serializeGrid(grid) {
  return {
    strength: encodeField(grid.strength),
    damage: encodeField(grid.damage),
    plate: encodeField(grid.plateProgress),
  };
}

export function restoreGrid(grid, saved) {
  if (!saved) return grid;
  const strength = decodeField(saved.strength, grid.strength.length);
  const damage = decodeField(saved.damage, grid.damage.length);
  const plate = decodeField(saved.plate, grid.plateProgress.length);
  for (let i = 0; i < grid.strength.length; i += 1) {
    grid.strength[i] = grid.dirt[i] ? Math.min(1, strength[i]) : 0;
    grid.damage[i] = Math.min(1, damage[i]);
    grid.plateProgress[i] = Math.min(ENGINE.plateSec, plate[i]);
    if (grid.plate[i] && grid.plateProgress[i] >= ENGINE.plateSec) grid.plate[i] = 0;
  }
  return grid;
}
