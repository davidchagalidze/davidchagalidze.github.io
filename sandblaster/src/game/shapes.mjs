/**
 * Предметы заказа: геометрия в координатах сетки (320×240).
 *
 * Один и тот же набор примитивов используется дважды:
 *   • `insideItem()` — маска загрязнений и попадания частиц (аналитически, без canvas);
 *   • `drawItem()`    — отрисовка чистого металла (canvas 2D).
 * Поэтому дырка, которую видно, и дырка, в которой нет грязи, — одна и та же.
 *
 * Примитивы: add — металл, sub — вырез. Всё остальное за пределами предмета — пустота кабины.
 */

const TAU = Math.PI * 2;

/** Точка внутри многоугольника (ray casting). */
export function pointInPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(p, x, y) {
  const { x: rx, y: ry, w, h, r } = p;
  if (x < rx || y < ry || x > rx + w || y > ry + h) return false;
  const rr = Math.min(r, w / 2, h / 2);
  if (rr <= 0) return true;
  const cx = Math.min(Math.max(x, rx + rr), rx + w - rr);
  const cy = Math.min(Math.max(y, ry + rr), ry + h - rr);
  return (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr;
}

function insideGear(p, x, y) {
  const dx = x - p.cx;
  const dy = y - p.cy;
  const d = Math.hypot(dx, dy);
  if (d > p.rOuter) return false;
  if (d <= p.rInner) return true;
  const step = TAU / p.teeth;
  const angle = Math.atan2(dy, dx);
  const phase = ((angle % step) + step) % step;
  const half = (step * p.toothWidth) / 2;
  const inTooth = phase < half || phase > step - half;
  // Внутри зуба — до rOuter, между зубьями — только до rInner.
  return inTooth ? d <= p.rOuter : d <= p.rInner;
}

function insidePrim(prim, x, y) {
  switch (prim.kind) {
    case 'circle':
      return (x - prim.cx) ** 2 + (y - prim.cy) ** 2 <= prim.r * prim.r;
    case 'ring':
      return (x - prim.cx) ** 2 + (y - prim.cy) ** 2 <= prim.r * prim.r;
    case 'rrect':
      return insideRoundedRect(prim, x, y);
    case 'poly':
      return pointInPoly(prim.pts, x, y);
    case 'gear':
      return insideGear(prim, x, y);
    default:
      return false;
  }
}

export function insideItem(item, x, y) {
  let hit = false;
  for (const prim of item.prims) {
    if (prim.op === 'sub') {
      if (insidePrim(prim, x, y)) return false;
    } else if (!hit && insidePrim(prim, x, y)) {
      hit = true;
    }
  }
  return hit;
}

export function itemBounds(item) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of item.prims) {
    if (p.kind === 'circle' || p.kind === 'ring' || p.kind === 'gear') {
      const r = p.kind === 'gear' ? p.rOuter : p.r;
      minX = Math.min(minX, p.cx - r);
      maxX = Math.max(maxX, p.cx + r);
      minY = Math.min(minY, p.cy - r);
      maxY = Math.max(maxY, p.cy + r);
    } else if (p.kind === 'rrect') {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    } else if (p.kind === 'poly') {
      for (const [x, y] of p.pts) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

const gear = (cx, cy, rOuter, rInner, teeth, toothWidth = 0.52) => ({
  kind: 'gear',
  op: 'add',
  cx,
  cy,
  rOuter,
  rInner,
  teeth,
  toothWidth,
});

/** Каталог предметов. id совпадает с ECONOMY.orders.classN.items. */
export const ITEMS = {
  hood: {
    id: 'hood',
    label: 'Капот',
    prims: [
      {
        kind: 'poly',
        op: 'add',
        pts: [
          [62, 74],
          [258, 74],
          [272, 118],
          [268, 166],
          [52, 166],
          [48, 118],
        ],
      },
      { kind: 'rrect', op: 'sub', x: 96, y: 96, w: 62, h: 34, r: 12 },
      { kind: 'rrect', op: 'sub', x: 176, y: 96, w: 62, h: 34, r: 12 },
    ],
    bolts: [
      [78, 88],
      [242, 88],
      [78, 152],
      [242, 152],
    ],
  },
  wheel: {
    id: 'wheel',
    label: 'Диск колеса',
    prims: [
      { kind: 'circle', op: 'add', cx: 160, cy: 120, r: 82 },
      { kind: 'circle', op: 'sub', cx: 160, cy: 120, r: 26 },
      ...[0, 1, 2, 3, 4].map((i) => {
        const a = (i / 5) * TAU - Math.PI / 2;
        return {
          kind: 'circle',
          op: 'sub',
          cx: 160 + Math.cos(a) * 52,
          cy: 120 + Math.sin(a) * 52,
          r: 15,
        };
      }),
    ],
    bolts: [
      [160, 100],
      [160, 140],
      [143, 130],
      [177, 130],
      [143, 110],
      [177, 110],
    ],
  },
  gear: {
    id: 'gear',
    label: 'Шестерня',
    prims: [
      gear(160, 120, 88, 68, 14, 0.55),
      { kind: 'circle', op: 'sub', cx: 160, cy: 120, r: 22 },
      { kind: 'circle', op: 'add', cx: 160, cy: 120, r: 34 },
      { kind: 'circle', op: 'sub', cx: 160, cy: 120, r: 16 },
    ],
    bolts: [
      [160, 104],
      [176, 120],
      [160, 136],
      [144, 120],
    ],
  },
  sign: {
    id: 'sign',
    label: 'Вывеска',
    prims: [
      { kind: 'rrect', op: 'add', x: 42, y: 58, w: 236, h: 128, r: 16 },
      { kind: 'rrect', op: 'sub', x: 68, y: 82, w: 184, h: 80, r: 8 },
      { kind: 'rrect', op: 'add', x: 76, y: 90, w: 168, h: 64, r: 5 },
    ],
    bolts: [
      [54, 70],
      [266, 70],
      [54, 174],
      [266, 174],
    ],
  },
  frame: {
    id: 'frame',
    label: 'Рама',
    prims: [
      { kind: 'rrect', op: 'add', x: 44, y: 52, w: 232, h: 138, r: 10 },
      { kind: 'rrect', op: 'sub', x: 76, y: 80, w: 168, h: 82, r: 6 },
      { kind: 'poly', op: 'add', pts: [[150, 80], [170, 80], [212, 162], [192, 162]] },
      { kind: 'poly', op: 'add', pts: [[170, 80], [150, 80], [108, 162], [128, 162]] },
    ],
    bolts: [
      [60, 68],
      [260, 68],
      [60, 174],
      [260, 174],
    ],
  },
  turbine: {
    id: 'turbine',
    label: 'Турбина',
    prims: [
      { kind: 'circle', op: 'add', cx: 160, cy: 120, r: 76 },
      { kind: 'circle', op: 'add', cx: 160, cy: 120, r: 92, ...{} },
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
        const a = (i / 8) * TAU;
        const a2 = a + 0.22;
        const r0 = 30;
        const r1 = 92;
        return {
          kind: 'poly',
          op: 'add',
          pts: [
            [160 + Math.cos(a) * r0, 120 + Math.sin(a) * r0],
            [160 + Math.cos(a) * r1, 120 + Math.sin(a) * r1],
            [160 + Math.cos(a2) * r1, 120 + Math.sin(a2) * r1],
            [160 + Math.cos(a2 + 0.12) * r0, 120 + Math.sin(a2 + 0.12) * r0],
          ],
        };
      }),
      { kind: 'circle', op: 'sub', cx: 160, cy: 120, r: 16 },
    ],
    bolts: [
      [160, 102],
      [178, 120],
      [160, 138],
      [142, 120],
    ],
  },
};

export function getItem(id) {
  return ITEMS[id] || ITEMS.hood;
}

/**
 * Отрисовка чистого металла в canvas-контексте, координаты — клетки сетки.
 * Вызывается один раз за заказ в offscreen-canvas.
 */
export function drawItem(ctx, item, { metal, metalDark, metalLight }) {
  const trace = (prim) => {
    ctx.beginPath();
    if (prim.kind === 'circle' || prim.kind === 'ring') {
      ctx.arc(prim.cx, prim.cy, prim.r, 0, TAU);
    } else if (prim.kind === 'rrect') {
      if (typeof ctx.roundRect === 'function') ctx.roundRect(prim.x, prim.y, prim.w, prim.h, Math.min(prim.r, prim.w / 2, prim.h / 2));
      else ctx.rect(prim.x, prim.y, prim.w, prim.h);
    } else if (prim.kind === 'poly') {
      prim.pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    } else if (prim.kind === 'gear') {
      const step = TAU / prim.teeth;
      const half = (step * prim.toothWidth) / 2;
      const pts = [];
      for (let t = 0; t < prim.teeth; t += 1) {
        const a0 = t * step - half;
        const a1 = t * step + half;
        pts.push([prim.cx + Math.cos(a0) * prim.rInner, prim.cy + Math.sin(a0) * prim.rInner]);
        pts.push([prim.cx + Math.cos(a0) * prim.rOuter, prim.cy + Math.sin(a0) * prim.rOuter]);
        pts.push([prim.cx + Math.cos(a1) * prim.rOuter, prim.cy + Math.sin(a1) * prim.rOuter]);
        pts.push([prim.cx + Math.cos(a1) * prim.rInner, prim.cy + Math.sin(a1) * prim.rInner]);
      }
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
      ctx.closePath();
    }
  };

  const grad = ctx.createLinearGradient(0, 40, 0, 200);
  grad.addColorStop(0, metalLight);
  grad.addColorStop(0.42, metal);
  grad.addColorStop(1, metalDark);

  for (const prim of item.prims) {
    if (prim.op === 'sub') continue;
    trace(prim);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.save();
    ctx.clip();
    // Продольная шлифовка + мягкие блики: металл должен выглядеть металлом, а не заливкой.
    ctx.globalAlpha = 0.16;
    for (let i = 0; i < 90; i += 1) {
      const y = 40 + (i * 1.9) % 170;
      ctx.strokeStyle = i % 3 === 0 ? '#ffffff' : '#4c5663';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(30, y);
      ctx.lineTo(290, y + 1.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Вырезы: выбиваем их фоном кабины, иначе «дырки» останутся металлом.
  for (const prim of item.prims) {
    if (prim.op !== 'sub') continue;
    trace(prim);
    ctx.fillStyle = '#10161f';
    ctx.fill();
  }

  // Кромка: тонкая светлая линия по контуру читается как фаска.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = 'rgba(240,246,255,0.35)';
  for (const prim of item.prims) {
    if (prim.op === 'sub') continue;
    trace(prim);
    ctx.stroke();
  }
  ctx.restore();

  for (const [x, y] of item.bolts || []) {
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, TAU);
    ctx.fillStyle = '#6d7784';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}
