/** Детерминированный генератор: один и тот же seed даёт один и тот же мир. */

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Стабильный хеш пары координат в [0,1). */
export function hash2(seed, x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/**
 * Гладкий value-noise по решётке cellSize ячеек. Детерминирован для любого (x,y),
 * поэтому чанки можно генерировать в любом порядке и независимо.
 */
export function noise2(seed, x, y, cellSize) {
  const size = Math.max(1, cellSize);
  const fx = x / size;
  const fy = y / size;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const v00 = hash2(seed, x0, y0);
  const v10 = hash2(seed, x0 + 1, y0);
  const v01 = hash2(seed, x0, y0 + 1);
  const v11 = hash2(seed, x0 + 1, y0 + 1);
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

/** Два октава — крупные пятна плюс мелкая деталь. */
export function fbm2(seed, x, y, cellSize, octaves = 2) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let size = cellSize;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(seed + i * 7919, x, y, size) * amp;
    norm += amp;
    amp *= 0.5;
    size = Math.max(1, size / 2);
  }
  return sum / norm;
}

export function randomInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}
