/**
 * Игровая сессия одного заказа — без DOM.
 *
 * Механика считается по формулам модели SAND-1:
 *   • струя летит с задержкой `ENGINE.beamDelaySec` (8–14 кадров при 60 fps);
 *   • темп = πr²·pressure·grade HP/с; пятно распределяет его с профилем, среднее которого 1;
 *   • песок = работа · kgPerSec/(πr²·grade) / √(p·refPressure) — расход падает с давлением;
 *   • пустой бак: частицы летят, урона нет, кВт·ч капают;
 *   • тонкий лист мнётся, если давление выше ПОРОГА ЭТОГО ЗАКАЗА (order.thinLimit);
 *   • накладка (скрытый очаг) снимается струёй отдельно, под ней грязь.
 *
 * Деньги за расходники не списываются в момент струи: счёт выставляется при сдаче
 * (`billOrder`), как в модели — поэтому старт с нуля не запирает игрока.
 */

import { ECONOMY, ENGINE, RULES } from './config.mjs';
import { applySpray, buildOrderGrid, decaySmear, gridStats, handWork, restoreGrid } from './grid.mjs';
import { getItem } from './shapes.mjs';
import { statsFor } from './upgrades.mjs';
import { mulberry32 } from './rng.mjs';
import { billOrder, planOrder } from './pay.mjs';

export function createSession({ order, save, now = Date.now(), grid = null }) {
  const item = getItem(order.itemId);
  const built = grid || buildOrderGrid({ item, order, seed: order.seed });
  let stats = statsFor(save.levels);

  /** Плотность грязи: доля грязных клеток в маске предмета (ρ моста «модель → сетка»). */
  function dirtShareOf(g) {
    let mask = 0;
    let dirt = 0;
    for (let i = 0; i < g.mask.length; i += 1) {
      if (!g.mask[i]) continue;
      mask += 1;
      if (g.dirt[i]) dirt += 1;
    }
    return mask > 0 ? dirt / mask : 1;
  }

  const dirtShare = dirtShareOf(built);

  const session = {
    order,
    item,
    grid: built,
    dirtShare,
    spotRadius: ENGINE.gridSpotRadius(stats.radiusCells, dirtShare),
    levels: save.levels,
    stats,
    hopperKg: Math.min(Number(save.hopperKg ?? stats.capacityKg) || 0, stats.capacityKg),
    sandKg: 0,
    elapsed: 0,
    downtimeSec: 0,
    refills: 0,
    spraying: false,
    dry: false,
    damageRatio: 0,
    aim: { x: 160, y: 120 },
    aimHistory: [],
    handRng: mulberry32((order.seed ^ 0x9e3779b9) >>> 0),
    handHP: 0,
    clearedTotal: 0,
    plateRemoved: 0,
    lastSpray: { cleared: 0, touched: 0, plateRemoved: 0 },
    startedAt: now,
    lastNow: now,
    delivered: null,
  };

  function delayedAim(tMs) {
    const target = tMs - ENGINE.beamDelaySec * 1000;
    let pos = session.aim;
    for (let i = session.aimHistory.length - 1; i >= 0; i -= 1) {
      if (session.aimHistory[i].t <= target) {
        pos = session.aimHistory[i];
        break;
      }
    }
    return pos;
  }

  /**
   * Расход песка на HP работы — свойство сопла и абразива из модели SAND-1:
   *   kg = work · kgPerSec/(πr²·grade) / √(p·refPressure)
   * Поэтому песок считается по снятой работе, а не по секундам струи: на чистом
   * металле работа нулевая, и песок не тратится (в модели та же формула).
   */
  function kgPerHP() {
    return stats.kgPerHPAt(stats.pressure);
  }

  /** Мгновенный расход, кг/с, — для HUD: столько уходит, пока пятно работает по грязи. */
  function sandPerSec() {
    return stats.kgPerSec * Math.sqrt(Math.max(0.05, stats.pressure) / RULES.refPressure);
  }

  function tick(dt, { now: tickNow = Date.now() } = {}) {
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    if (step <= 0 || session.delivered) return session;
    session.lastNow = tickNow;
    session.elapsed += step;
    session.aimHistory.push({ t: tickNow, x: session.aim.x, y: session.aim.y });
    const cutoff = tickNow - ENGINE.beamDelaySec * 1000 - 400;
    while (session.aimHistory.length > 2 && session.aimHistory[0].t < cutoff) session.aimHistory.shift();

    const aim = delayedAim(tickNow);
    session.dry = false;

    if (session.spraying) {
      // Песок — по работе. Пустой бак: частицы летят, урона нет, кВт·ч капают.
      const dryNow = session.hopperKg <= 1e-9;
      session.dry = dryNow;
      if (!dryNow) {
        const res = applySpray(session.grid, {
          cx: aim.x,
          cy: aim.y,
          radius: session.spotRadius,
          pressure: stats.pressure,
          gradeMult: stats.damageMult,
          dt: step,
        });
        session.lastSpray = res;
        session.clearedTotal += res.cleared;
        session.plateRemoved += res.plateRemoved;
        // Абразив списывается пропорционально снятой работе (кг на HP), бака может
        // не хватить на всю работу шага — тогда берём сколько есть и сушим.
        const want = kgPerHP() * res.hp;
        const used = Math.min(session.hopperKg, want);
        session.hopperKg -= used;
        session.sandKg += used;
        if (used < want - 1e-9) session.dry = true;
      } else {
        session.lastSpray = { cleared: 0, touched: 0, plateRemoved: 0, hp: 0 };
      }

      // Тонкий лист: доля вмятин растёт линейно по превышению порога и времени струи.
      if (session.order.material === 'thin') {
        const over = Math.max(0, stats.pressure - (session.order.thinLimit ?? ECONOMY.materials.thin.damagePressure));
        if (over > 0) {
          session.damageRatio = Math.min(1, session.damageRatio + ECONOMY.materials.thin.damageRate * over * step);
          paintDents(session, aim);
        }
      }
    } else {
      session.lastSpray = { cleared: 0, touched: 0, plateRemoved: 0 };
    }

    // Наёмный рабочий: HP/с, свой песок по той же формуле.
    if (stats.handHP > 0) {
      const hp = stats.handHP * step;
      const sandWant = stats.kgPerHPAt(stats.pressure) * hp;
      if (session.hopperKg >= Math.min(sandWant, 0.001) && session.hopperKg > 0) {
        const used = Math.min(session.hopperKg, sandWant);
        session.hopperKg -= used;
        session.sandKg += used;
        const { spent } = handWork(session.grid, { hp, rng: session.handRng });
        session.handHP += spent;
        session.clearedTotal += Math.round(spent / Math.max(0.3, session.order.avgHardness || 1));
      }
    }

    decaySmear(session.grid, step * 1000);
    return session;
  }

  /** Вмятины — только визуал: пятно темнеет там, где игрок пересидел с давлением. */
  function paintDents(sess, aim) {
    const { grid } = sess;
    const r = Math.max(3, sess.stats.radiusCells * 2.2);
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue;
        const x = Math.round(aim.x + dx);
        const y = Math.round(aim.y + dy);
        if (x < 0 || y < 0 || x >= grid.w || y >= grid.h) continue;
        const i = y * grid.w + x;
        if (!grid.mask[i] || grid.strength[i] > ENGINE.cleanEpsilon) continue;
        grid.damage[i] = Math.min(1, grid.damage[i] + 0.02);
      }
    }
  }

  function statsNow() {
    return gridStats(session.grid);
  }

  function canDeliver() {
    return !session.delivered && statsNow().cleanPct >= ENGINE.minDeliverPct;
  }

  function bill(cleanPct) {
    return billOrder({
      order,
      levels: session.levels,
      elapsedSec: session.elapsed,
      downtimeSec: session.downtimeSec,
      abrasiveKg: session.sandKg,
      cleanPct,
      damageRatio: session.damageRatio,
    });
  }

  function preview() {
    const s = statsNow();
    const b = bill(s.cleanPct);
    const plan = planOrder({ order, levels: session.levels });
    return {
      ...b,
      byType: s.byType,
      cleanPct: s.cleanPct,
      damageRatio: session.damageRatio,
      abrasiveKg: session.sandKg,
      reclaimKg: session.sandKg * stats.returnPct,
      elapsed: session.elapsed,
      planSeconds: plan.seconds ?? plan.cycleSec,
      deliverable: canDeliver(),
      plateCells: s.plateCells,
      hopperKg: session.hopperKg,
    };
  }

  function deliver() {
    if (!canDeliver()) return { ok: false, error: `нужно ≥${ENGINE.minDeliverPct}% зачистки` };
    const p = preview();
    session.delivered = p;
    return { ok: true, breakdown: p };
  }

  /** Доливка бака: денег не стоит, но съедает 12 с простоя (и аренду камеры). */
  function refill() {
    const room = stats.capacityKg - session.hopperKg;
    if (room <= 1e-6) return { added: 0, downtime: 0 };
    session.hopperKg = stats.capacityKg;
    session.downtimeSec += RULES.refillSec;
    session.refills += 1;
    return { added: room, downtime: RULES.refillSec };
  }

  return {
    order,
    item,
    grid: session.grid,
    get dirtShare() {
      return session.dirtShare;
    },
    /** Радиус пятна В КЛЕТКАХ СЕТКИ (мост «модель → сетка»), а не радиус из ECONOMY. */
    get spotRadius() {
      return session.spotRadius;
    },
    get stats() {
      return stats;
    },
    get levels() {
      return session.levels;
    },
    get hopperKg() {
      return session.hopperKg;
    },
    get capacityKg() {
      return stats.capacityKg;
    },
    get sandKg() {
      return session.sandKg;
    },
    get sandPerSec() {
      return sandPerSec();
    },
    /** Счётчик кВт·ч «на сейчас» — для HUD (окончательный счёт считает billOrder). */
    get energyKwh() {
      const overhead = RULES.setupSec + session.downtimeSec;
      return (stats.kW * (session.elapsed + 0.5 * overhead)) / 3600;
    },
    get energyCost() {
      return this.energyKwh * RULES.kwhPrice;
    },
    get elapsed() {
      return session.elapsed;
    },
    get downtimeSec() {
      return session.downtimeSec;
    },
    get dry() {
      return session.dry;
    },
    get sprayed() {
      return session.spraying;
    },
    get aim() {
      return session.aim;
    },
    get damageRatio() {
      return session.damageRatio;
    },
    get beamAim() {
      return delayedAim(session.lastNow);
    },
    get handCleaned() {
      return session.handHP;
    },
    get clearedTotal() {
      return session.clearedTotal;
    },
    get plateRemoved() {
      return session.plateRemoved;
    },
    get delivered() {
      return session.delivered;
    },
    setAim(x, y) {
      const w = session.grid.w;
      const h = session.grid.h;
      session.aim = { x: Math.max(3, Math.min(w - 3, x)), y: Math.max(3, Math.min(h - 3, y)) };
    },
    setSpraying(on) {
      session.spraying = !!on;
    },
    tick,
    gridStats: statsNow,
    preview,
    deliver,
    refill,
    canDeliver,
    refreshStats(levels) {
      session.levels = levels;
      stats = statsFor(levels);
      session.stats = stats;
      session.spotRadius = ENGINE.gridSpotRadius(stats.radiusCells, session.dirtShare);
      session.hopperKg = Math.min(session.hopperKg, stats.capacityKg);
      return stats;
    },
    restore(saved) {
      restoreGrid(session.grid, saved);
      return session;
    },
  };
}
