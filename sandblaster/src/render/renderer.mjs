/**
 * Рендер кабины. Мир — 320×240 клеток, экран — любой: мир вписывается с сохранением
 * пропорций (contain), поэтому прицел не «съезжает» ни на десктопе, ни в 390×844.
 *
 * Слои: кабина → чистый металл (offscreen, один раз на заказ) → маска грязи (ImageData
 * 320×240, апскейл) → вмятины/смазка → частицы → сопло → прицел.
 * Частицы — визуал: урон считает session.mjs по пятну, а не по их попаданиям.
 */

import { ENGINE, PALETTE, DIRT_FALLBACK_COLOR } from '../game/config.mjs';
import { drawItem } from '../game/shapes.mjs';
import { DIRT_IDS } from '../game/grid.mjs';
import { fitView, clientToWorld } from './viewport.mjs';

/** '#rrggbb' → [r,g,b]; неизвестный/битый цвет не роняет модуль, а даёт нейтральный. */
export function hexToRgb(hex, fallback = DIRT_FALLBACK_COLOR) {
  const raw = typeof hex === 'string' ? hex.trim().replace(/^#/, '') : '';
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    console.warn(`[sandblaster] нет валидного цвета «${hex}», беру ${fallback}`);
    const f = fallback.replace(/^#/, '');
    return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
  }
  return [parseInt(raw.slice(0, 2), 16), parseInt(raw.slice(2, 4), 16), parseInt(raw.slice(4, 6), 16)];
}

/** Палитра грязи — из PALETTE (движок), а не из economy.mjs: там цветов нет. */
export const DIRT_RGB = DIRT_IDS.map((id) => hexToRgb(PALETTE.dirt?.[id]));
export const GREASE_RGB = hexToRgb(PALETTE.dirt?.grease);

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const gridCanvas = document.createElement('canvas');
  const gctx = gridCanvas.getContext('2d');
  const maskCanvas = document.createElement('canvas');
  const mctx = maskCanvas.getContext('2d');

  let view = { scale: 1, offsetX: 0, offsetY: 0, w: 0, h: 0 };
  let metalCanvas = null;
  let maskImage = null;
  let noise = null;
  let particles = [];
  let hover = { x: -100, y: -100 };
  let lastAim = { x: 160, y: 120 };
  let flash = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    view = { ...fitView(cssW, cssH, ENGINE.grid.w, ENGINE.grid.h), dpr };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return view;
  }

  /** Экран → мир. Работает и для мыши, и для touch (clientX/Y из события). */
  function worldFromClient(clientX, clientY) {
    return clientToWorld(canvas.getBoundingClientRect(), view, clientX, clientY);
  }

  function prepareOrder(session) {
    const { grid, item, order } = session;
    gridCanvas.width = grid.w;
    gridCanvas.height = grid.h;
    maskCanvas.width = grid.w;
    maskCanvas.height = grid.h;

    metalCanvas = document.createElement('canvas');
    metalCanvas.width = grid.w;
    metalCanvas.height = grid.h;
    const mctx2 = metalCanvas.getContext('2d');
    mctx2.fillStyle = 'rgba(0,0,0,0)';
    mctx2.clearRect(0, 0, grid.w, grid.h);
    drawItem(mctx2, item, { metal: PALETTE.metal, metalDark: PALETTE.metalDark, metalLight: PALETTE.metalLight });

    // Металл чуть темнее к краям: плоская заливка выглядит как стикер.
    const shade = mctx2.createLinearGradient(0, 0, 0, grid.h);
    shade.addColorStop(0, 'rgba(255,255,255,0.05)');
    shade.addColorStop(0.5, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.22)');
    mctx2.globalCompositeOperation = 'source-atop';
    mctx2.fillStyle = shade;
    mctx2.fillRect(0, 0, grid.w, grid.h);
    mctx2.globalCompositeOperation = 'source-over';

    maskImage = gctx.createImageData(grid.w, grid.h);
    noise = new Uint8Array(grid.w * grid.h);
    let seed = (order?.seed || 1) >>> 0;
    for (let i = 0; i < noise.length; i += 1) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      noise[i] = (seed >>> 16) & 0xff;
    }
    particles = [];
    flash = 0;
  }

  function drawMask(session) {
    const { grid } = session;
    const img = maskImage;
    const data = img.data;
    const n = grid.w * grid.h;
    const eps = ENGINE.cleanEpsilon;
    for (let i = 0; i < n; i += 1) {
      const o = i * 4;
      if (!grid.mask[i]) {
        data[o + 3] = 0;
        continue;
      }
      // Накладка: под ней не видно грязи, пока её не сдует струёй.
      if (grid.plate[i]) {
        const jitter = 0.9 + (noise[i] / 255) * 0.16;
        data[o] = Math.min(255, 186 * jitter);
        data[o + 1] = Math.min(255, 194 * jitter);
        data[o + 2] = Math.min(255, 206 * jitter);
        data[o + 3] = 240;
        continue;
      }
      const dmg = grid.damage[i];
      const smear = grid.smear[i];
      const st = grid.strength[i];
      const type = grid.dirt[i];
      if (type && st > eps) {
        const rgb = DIRT_RGB[type - 1];
        const jitter = 0.86 + (noise[i] / 255) * 0.28;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
        data[o + 3] = Math.min(255, 235 * Math.min(1, st) * jitter);
      } else if (smear > 0) {
        data[o] = GREASE_RGB[0];
        data[o + 1] = GREASE_RGB[1];
        data[o + 2] = GREASE_RGB[2];
        data[o + 3] = Math.min(150, (smear / 2200) * 120);
      } else {
        data[o + 3] = 0;
      }
      if (dmg > 0.02) {
        // Вмятина: затемняем металл и добавляем светлую кромку сверху — читается как скол.
        const a = Math.min(230, dmg * 235);
        data[o] = Math.round(data[o] * (1 - a / 255) + 14 * (a / 255));
        data[o + 1] = Math.round(data[o + 1] * (1 - a / 255) + 17 * (a / 255));
        data[o + 2] = Math.round(data[o + 2] * (1 - a / 255) + 22 * (a / 255));
        data[o + 3] = Math.max(data[o + 3], a);
      }
    }
    gctx.putImageData(img, 0, 0);
  }

  function spawnParticles(session, dt) {
    if (!session.sprayed) return;
    const stats = session.stats;
    const want = (session.sandPerSec || stats.kgPerSec) * ENGINE.particles.perKg * dt;
    const count = Math.min(28, Math.max(0, Math.round(want)));
    const nozzle = { x: 300, y: 224 };
    const aim = session.beamAim || session.aim;
    const dx = aim.x - nozzle.x;
    const dy = aim.y - nozzle.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = 900;
    for (let k = 0; k < count; k += 1) {
      if (particles.length >= ENGINE.particles.max) break;
      const spread = (Math.random() - 0.5) * ENGINE.particles.spread * 2;
      const cos = Math.cos(spread);
      const sin = Math.sin(spread);
      const vx = ((dx / len) * cos - (dy / len) * sin) * speed;
      const vy = ((dx / len) * sin + (dy / len) * cos) * speed;
      particles.push({
        x: nozzle.x + (Math.random() - 0.5) * 2,
        y: nozzle.y + (Math.random() - 0.5) * 2,
        vx,
        vy,
        life: ENGINE.particles.lifeSec[0] + Math.random() * (ENGINE.particles.lifeSec[1] - ENGINE.particles.lifeSec[0]),
        max: 1,
        size: 0.7 + Math.random() * 0.9,
        dust: Math.random() < 0.35,
      });
    }
    flash = Math.min(1, flash + dt * 6);
  }

  function updateParticles(dt, session) {
    const g = ENGINE.particles.gravity;
    const drag = ENGINE.particles.drag;
    const grid = session.grid;
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vy += g * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const gx = Math.floor(p.x);
      const gy = Math.floor(p.y);
      if (gx >= 0 && gy >= 0 && gx < grid.w && gy < grid.h && grid.mask[gy * grid.w + gx]) {
        // Рикошет от поверхности: гасим скорость и отбрасываем в сторону.
        p.x -= p.vx * dt;
        p.y -= p.vy * dt;
        p.vy = -Math.abs(p.vy) * ENGINE.particles.bounce;
        p.vx = p.vx * 0.55 + (Math.random() - 0.5) * 260;
        p.dust = true;
      }
      if (p.x < -20 || p.y > ENGINE.grid.h + 20 || p.x > ENGINE.grid.w + 20 || p.y < -20) particles.splice(i, 1);
    }
    flash = Math.max(0, flash - dt * 3);
  }

  function drawCabinet() {
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, PALETTE.bg1);
    g.addColorStop(1, PALETTE.bg0);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    // Задняя стенка кабины: крупная клетка + решётка, чтобы движение читалось.
    ctx.fillStyle = PALETTE.cabinet;
    ctx.fillRect(0, 0, ENGINE.grid.w, ENGINE.grid.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.028)';
    ctx.lineWidth = 0.7;
    for (let x = 0; x <= ENGINE.grid.w; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ENGINE.grid.h);
      ctx.stroke();
    }
    for (let y = 0; y <= ENGINE.grid.h; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(ENGINE.grid.w, y);
      ctx.stroke();
    }

    // Свет сверху и пыльная дымка — дешёвый объём.
    const light = ctx.createRadialGradient(160, 60, 20, 160, 130, 240);
    light.addColorStop(0, 'rgba(150,190,240,0.13)');
    light.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, ENGINE.grid.w, ENGINE.grid.h);

    ctx.restore();
  }

  function drawItemLayer(session) {
    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    ctx.imageSmoothingEnabled = true;
    if (metalCanvas) ctx.drawImage(metalCanvas, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (maskImage) ctx.drawImage(gridCanvas, 0, 0);
    ctx.restore();
  }

  function drawParticles(session) {
    // Цвет песка — палитра движка: в design-экономике у абразива цвета нет.
    const sandColor = PALETTE.sand;
    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    for (const p of particles) {
      const a = Math.min(1, p.life * 3.2);
      ctx.globalAlpha = p.dust ? a * 0.35 : a;
      ctx.fillStyle = p.dust ? PALETTE.dust : sandColor;
      const s = p.size * (p.dust ? 1.8 : 1);
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  function drawNozzle(session) {
    const nozzle = { x: 300, y: 224 };
    const aim = session.sprayed ? session.beamAim || session.aim : session.aim;
    const angle = Math.atan2(aim.y - nozzle.y, aim.x - nozzle.x);

    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);

    // Шланг: две кривые Безье, чтобы он не был палкой.
    ctx.strokeStyle = '#2b3542';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(nozzle.x + 16, nozzle.y + 12);
    ctx.bezierCurveTo(nozzle.x + 40, nozzle.y + 34, 250, 250, 200, 246);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.translate(nozzle.x, nozzle.y);
    ctx.rotate(angle);
    // Корпус пистолета
    ctx.fillStyle = '#3d4a5a';
    ctx.beginPath();
    ctx.roundRect(-18, -9, 34, 18, 6);
    ctx.fill();
    ctx.fillStyle = '#56657a';
    ctx.beginPath();
    ctx.roundRect(6, -6, 18, 12, 4);
    ctx.fill();
    // Сопло
    ctx.fillStyle = '#c8a15c';
    ctx.beginPath();
    ctx.moveTo(22, -5);
    ctx.lineTo(34, -3);
    ctx.lineTo(34, 3);
    ctx.lineTo(22, 5);
    ctx.closePath();
    ctx.fill();
    // Курок
    ctx.strokeStyle = '#7c8899';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-8, 8);
    ctx.lineTo(-10, 16);
    ctx.stroke();
    ctx.restore();

    // Конус струи + пятно. Сухая струя — серая и без свечения.
    const stats = session.stats;
    const r = session.spotRadius ?? stats.radiusCells;
    const dry = session.dry;
    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    if (session.sprayed) {
      const grad = ctx.createLinearGradient(nozzle.x, nozzle.y, aim.x, aim.y);
      const alpha = dry ? 0.05 : 0.16 + flash * 0.05;
      grad.addColorStop(0, `rgba(255,235,200,${alpha})`);
      grad.addColorStop(1, 'rgba(255,235,200,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = r * 1.5;
      ctx.globalAlpha = dry ? 0.35 : 0.85;
      ctx.beginPath();
      ctx.moveTo(nozzle.x, nozzle.y);
      ctx.lineTo(aim.x, aim.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Пятно на поверхности: дрожит, если абразива нет.
      const jitter = dry ? 1.6 : 0;
      ctx.strokeStyle = dry ? 'rgba(226,100,90,0.85)' : 'rgba(255,246,214,0.55)';
      ctx.lineWidth = dry ? 1.6 : 0.9;
      ctx.beginPath();
      ctx.arc(aim.x + (Math.random() - 0.5) * jitter, aim.y + (Math.random() - 0.5) * jitter, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Прицел (то, куда ведёт рука) — тонкий, чтобы не спорить с пятном эрозии.
    ctx.strokeStyle = 'rgba(140,220,255,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, 2.4, 0, Math.PI * 2);
    ctx.moveTo(hover.x - 7, hover.y);
    ctx.lineTo(hover.x - 3, hover.y);
    ctx.moveTo(hover.x + 3, hover.y);
    ctx.lineTo(hover.x + 7, hover.y);
    ctx.moveTo(hover.x, hover.y - 7);
    ctx.lineTo(hover.x, hover.y - 3);
    ctx.moveTo(hover.x, hover.y + 3);
    ctx.lineTo(hover.x, hover.y + 7);
    ctx.stroke();
    ctx.restore();
  }

  function drawFrame(session) {
    ctx.save();
    ctx.translate(view.offsetX, view.offsetY);
    ctx.scale(view.scale, view.scale);
    // Рамка «окна кабины»: тёмный бортик + опасная полоса снизу.
    ctx.strokeStyle = PALETTE.cabinetEdge;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, ENGINE.grid.w - 3, ENGINE.grid.h - 3);
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i < 10; i += 1) {
      ctx.fillRect(i * 32, ENGINE.grid.h - 6, 16, 2);
    }
    ctx.restore();

    // Виньетка по краям экрана.
    const v = ctx.createRadialGradient(view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.35, view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  function draw(session, dt = 1 / 60) {
    if (!session) return;
    // Раскладка могла поменяться после первого resize (док, шрифты, поворот экрана):
    // пересчитываем вьюпорт, иначе прицел начнёт врать на несколько процентов.
    const rect = canvas.getBoundingClientRect();
    if (Math.abs(rect.width - view.w) > 0.5 || Math.abs(rect.height - view.h) > 0.5) resize();
    lastAim = session.aim;
    spawnParticles(session, dt);
    updateParticles(dt, session);
    drawCabinet();
    drawItemLayer(session);
    drawParticles(session);
    drawNozzle(session);
    drawFrame(session);
  }

  function drawMaskFor(session) {
    drawMask(session);
  }

  return {
    resize,
    worldFromClient,
    prepareOrder,
    drawMask: drawMaskFor,
    draw,
    setHover(x, y) {
      hover = { x, y };
    },
    get view() {
      return view;
    },
    get particleCount() {
      return particles.length;
    },
    get lastAim() {
      return lastAim;
    },
  };
}
