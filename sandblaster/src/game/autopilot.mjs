/**
 * Автопилот: водит сопло так, как это делает аккуратный игрок — по полосам грязи,
 * со скоростью, при которой пятно успевает снять слой (а не «пролетает мимо»).
 *
 * Скорость ограничена физикой: клетка на краю полосы проводит под пятном
 * `chord/v` секунд (chord — хорда пятна на этом смещении) и получает
 * `pressure·grade·cutAssist·chord/v` HP. Отсюда предел скорости.
 *
 * Радиус пятна здесь — СЕТОЧНЫЙ (`session.spotRadius`), а не радиус сопла из
 * ECONOMY: мост «модель → сетка» живёт в `ENGINE.gridSpotRadius` (config.mjs).
 *
 * Используется в tools/balance-sim.mjs, тестах и `window.__sand.autoClean()`.
 */

import { ECONOMY, ENGINE, RULES } from './config.mjs';
import { gridStats } from './grid.mjs';
import { statsFor } from './upgrades.mjs';

/**
 * Шаг полос в радиусах пятна. Полоса шириной BAND_PITCH·r перекрывается соседней:
 * клетка на краю полосы проводит под пятном 2·√(r²−(s/2)²)/v секунд. При 1.5
 * перекрытие 22% — проход один, без «проплешин», из-за которых полосы пришлось бы
 * проходить повторно (именно это и съедало темп до калибровки).
 */
export const BAND_PITCH = 1.5;

/**
 * Полосы по грязным участкам. Пересчитывается на каждый проход: грязь кончается.
 *
 * Колонки проходятся «змейкой»: направление внутри колонки выбирается так, чтобы
 * закончить там, где начинается следующая, — иначе сопло летит через всю кабину по
 * читому железу (на замере это была треть маршрута и, значит, треть времени).
 */
export function dirtyBands(grid, radius) {
  const spacing = Math.max(2, Math.round(radius * BAND_PITCH));
  const gapTol = Math.max(2, Math.round(radius * 1.2));
  const half = Math.max(1, Math.ceil((spacing - 1) / 2));
  const path = [];
  let enterTop = true;
  for (let x = Math.max(2, Math.round(radius * 0.4)); x < grid.w - 2; x += spacing) {
    // Колонка-слэб: полоса шириной spacing. Смотрим грязь во всём слэбе, иначе
    // клетки между полосами (они в пятне, но не в осевой колонке) остаются навсегда.
    const isDirty = (y) => {
      for (let dx = -half; dx <= half; dx += 1) {
        const xx = x + dx;
        if (xx < 0 || xx >= grid.w) continue;
        const i = y * grid.w + xx;
        if (grid.dirt[i] && (grid.plate[i] || grid.strength[i] > ENGINE.cleanEpsilon)) return true;
      }
      return false;
    };
    const runs = [];
    let start = -1;
    let lastDirty = -1;
    for (let y = 0; y < grid.h; y += 1) {
      if (isDirty(y)) {
        if (start < 0) start = y;
        else if (y - lastDirty > gapTol) {
          runs.push([start, lastDirty]);
          start = y;
        }
        lastDirty = y;
      }
    }
    if (start >= 0) runs.push([start, lastDirty]);
    if (!runs.length) continue;
    const ordered = enterTop ? runs : runs.slice().reverse();
    let down = enterTop;
    for (const [a, b] of ordered) {
      if (b <= a) {
        path.push({ x, y: a });
        continue;
      }
      path.push({ x, y: down ? a : b }, { x, y: down ? b : a });
      down = !down;
    }
    enterTop = !down;
  }
  return path;
}

/**
 * Скорость, при которой пятно успевает снять слой за один проход (клетки/с).
 *
 * Клетка на самом краю полосы (смещение s/2 = BAND_PITCH·r/2 от оси) проходит под
 * пятном хорду `2√(r²−(s/2)²)` клеток, то есть висит под струёй `chord/v` секунд и
 * получает `pressure·grade·cutAssist·chord/v` HP. Чтобы слой hardness снимался за
 * этот проход, скорость не выше `chord·pressure·grade·cutAssist/hardness`; берём
 * 0.9 от предела, чтобы кромка не оставалась наполовину снятой.
 */
export function sweepSpeed(stats, hardness = 1, spotRadius = stats.radiusCells) {
  const r = Math.max(0.5, spotRadius);
  const spacing = Math.max(2, r * BAND_PITCH);
  const chord = spacing < 2 * r ? 2 * Math.sqrt(r * r - (spacing / 2) ** 2) : 2 * r;
  const dose = ENGINE.cutAssist || 1;
  return Math.max(5, ((chord * stats.pressure * (stats.damageMult || 1) * dose) / Math.max(0.3, hardness)) * 0.9);
}

/**
 * Прогнать заказ автопилотом.
 * @returns {{seconds:number, seconds95:number|null, cleanPct:number, reached:boolean}}
 */
export function runAutopilot(session, { targetPct = 95, maxSeconds = 900, dt = 1 / 60, refill = true, speed } = {}) {
  const stats = session.stats;
  const spot = session.spotRadius ?? stats.radiusCells;
  const v = speed || sweepSpeed(stats, session.order.avgHardness || 1, spot);
  session.setSpraying(true);
  let t = 0;
  let seconds95 = null;
  let reached = false;
  let lastStatsAt = -1;
  let path = dirtyBands(session.grid, spot);
  let idx = 1;
  let cur = path[0] ? { ...path[0] } : { x: 160, y: 120 };
  session.setAim(cur.x, cur.y);
  if (!path.length) return { seconds: 0, seconds95: null, cleanPct: 100, reached: true };

  while (t < maxSeconds) {
    if (refill && session.hopperKg < 0.5) session.refill();
    const target = path[idx % path.length];
    const dx = target.x - cur.x;
    const dy = target.y - cur.y;
    const dist = Math.hypot(dx, dy);
    const travel = v * dt;
    if (dist <= travel) {
      cur = { ...target };
      idx += 1;
      if (idx >= path.length) {
        // Прошли все полосы — пересобрать маршрут по тому, что осталось.
        path = dirtyBands(session.grid, spot);
        idx = 1;
        if (!path.length) break;
        cur = { ...path[0] };
      }
    } else {
      cur = { x: cur.x + (dx / dist) * travel, y: cur.y + (dy / dist) * travel };
    }
    session.setAim(cur.x, cur.y);
    session.tick(dt, { now: t * 1000 });
    t += dt;
    if (t - lastStatsAt < 0.1) continue;
    lastStatsAt = t;
    const s = gridStats(session.grid);
    if (seconds95 === null && s.cleanPct >= 95) seconds95 = t;
    if (s.cleanPct >= Math.min(targetPct, 99.95)) {
      reached = true;
      break;
    }
  }
  const s = gridStats(session.grid);
  return { seconds: t, seconds95, cleanPct: s.cleanPct, reached, stats: s, speed: v, avgHardness: session.order.avgHardness, economy: ECONOMY, rules: RULES };
}
