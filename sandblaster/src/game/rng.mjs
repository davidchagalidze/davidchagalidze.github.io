/** Детерминированный генератор: заказ восстанавливается из сида один-в-один. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Строковый сид в uint32 (FNV-1a). */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Гладкий value-noise: решётка 256×256, билинейная интерполяция с smoothstep. */
const NOISE_SIZE = 256;
const NOISE_TABLE = (() => {
  const rnd = mulberry32(0x5a4d9e1);
  const arr = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < arr.length; i += 1) arr[i] = rnd();
  return arr;
})();

const smooth = (t) => t * t * (3 - 2 * t);

export function valueNoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const x0 = ((xi % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
  const y0 = ((yi % NOISE_SIZE) + NOISE_SIZE) % NOISE_SIZE;
  const x1 = (x0 + 1) % NOISE_SIZE;
  const y1 = (y0 + 1) % NOISE_SIZE;
  const a = NOISE_TABLE[y0 * NOISE_SIZE + x0];
  const b = NOISE_TABLE[y0 * NOISE_SIZE + x1];
  const c = NOISE_TABLE[y1 * NOISE_SIZE + x0];
  const d = NOISE_TABLE[y1 * NOISE_SIZE + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Фрактальный шум: пятна ржавчины крупные, с рваными краями. */
export function fbm(x, y, octaves = 3) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o += 1) {
    sum += valueNoise(fx, fy) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 2.01;
  }
  return sum / norm;
}

/** Взвешенный выбор ключа по таблице долей. */
export function pickWeighted(table, r) {
  const entries = Object.entries(table).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  const target = r * total;
  for (const [key, w] of entries) {
    acc += w;
    if (target <= acc) return key;
  }
  return entries.length ? entries[entries.length - 1][0] : null;
}
