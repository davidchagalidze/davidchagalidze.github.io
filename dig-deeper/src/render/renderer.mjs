/**
 * Canvas-рендер: чанки грунта кэшируются в offscreen-канвасы, перерисовывается
 * только изменённый чанк. Ничего не пересобирается целиком каждый кадр.
 */

import { DEPTH, layerIndexAt } from '../config/economy.mjs';
import { lootType } from '../config/loot.mjs';
import { CHUNK, MAT, TILE } from '../engine/world.mjs';
import { hash2 } from '../engine/rng.mjs';
import { machinePose } from './machine-pose.mjs';

const CHUNK_PX = CHUNK * TILE;
const MAX_CACHED_CHUNKS = 260;

const DARK = {
  air: '#0b0e14',
};

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.w = 360;
    this.h = 640;
    this.chunks = new Map();
    this.particles = [];
    this.floats = [];
    this.lastCellsDug = 0;
    this.shake = 0;
    this.time = 0;
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(200, Math.round(rect.width));
    this.h = Math.max(200, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Камера держит машину ниже центра экрана, чтобы HUD не закрывал её. */
  cameraFor(world, run) {
    const viewW = this.w;
    const viewH = this.h;
    let cx = run.x + run.w / 2 - viewW * 0.42;
    let cy = run.y + run.h / 2 - viewH * 0.62;
    cx = Math.max(0, Math.min(world.widthPx - viewW, cx));
    cy = Math.max(-viewH * 0.45, Math.min(world.heightPx - viewH, cy));
    return { x: Math.round(cx), y: Math.round(cy) };
  }

  invalidate(pairs) {
    for (const k of pairs) this.chunks.delete(k);
  }

  chunkCanvas(world, cx, cy) {
    const key = cx + ':' + cy;
    const cached = this.chunks.get(key);
    if (cached) return cached;

    const c = document.createElement('canvas');
    c.width = CHUNK_PX;
    c.height = CHUNK_PX;
    const g = c.getContext('2d');
    const chunk = world.chunkAt(cx, cy);

    // Фон чанка — цвет слоя, чтобы дыры выглядели как пробитый тоннель.
    for (let j = 0; j < CHUNK; j++) {
      for (let i = 0; i < CHUNK; i++) {
        const mat = chunk.cells[j * CHUNK + i];
        const col = cx * CHUNK + i;
        const row = cy * CHUNK + j;
        const depthM = (row * TILE) / DEPTH.pxPerMeter;
        const layer = DEPTH.layers[layerIndexAt(depthM)];
        const px = i * TILE;
        const py = j * TILE;
        const hsh = hash2(world.seed, col, row);

        if (mat === MAT.AIR) continue;

        if (mat === MAT.CAVE) {
          g.fillStyle = shade(layer.soilDark, -16);
          g.fillRect(px, py, TILE, TILE);
          continue;
        }

        if (mat === MAT.SOIL) {
          const tone = hsh < 0.33 ? layer.soil : hsh < 0.66 ? layer.soilDark : layer.soilLight;
          g.fillStyle = tone;
          g.fillRect(px, py, TILE, TILE);
          if (hsh > 0.9) {
            g.fillStyle = shade(layer.accent, -18);
            g.fillRect(px + 2, py + 3, 3, 2);
          }
          continue;
        }

        if (mat === MAT.ROCK) {
          g.fillStyle = layer.rock;
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = shade(layer.rock, hsh > 0.5 ? 14 : -14);
          g.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
          continue;
        }

        if (mat === MAT.BOULDER) {
          g.fillStyle = shade(layer.rock, -22);
          g.fillRect(px, py, TILE, TILE);
          g.beginPath();
          g.arc(px + TILE / 2, py + TILE / 2, TILE * 0.52, 0, Math.PI * 2);
          g.fillStyle = shade(layer.rock, 10);
          g.fill();
          g.beginPath();
          g.arc(px + TILE * 0.35, py + TILE * 0.35, TILE * 0.18, 0, Math.PI * 2);
          g.fillStyle = 'rgba(255,255,255,0.16)';
          g.fill();
          continue;
        }

        if (mat === MAT.WATER) {
          g.fillStyle = 'rgba(66,150,220,0.75)';
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = 'rgba(150,220,255,0.25)';
          g.fillRect(px, py + 1, TILE, 2);
          continue;
        }

        if (mat === MAT.MAGMA) {
          g.fillStyle = 'rgba(255,92,32,0.92)';
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = 'rgba(255,220,120,0.55)';
          g.fillRect(px + 2, py + 2, 3, 3);
          continue;
        }

        if (mat === MAT.BEDROCK) {
          g.fillStyle = '#171a21';
          g.fillRect(px, py, TILE, TILE);
          g.fillStyle = '#232833';
          g.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
        }
      }
    }

    if (this.chunks.size > MAX_CACHED_CHUNKS) {
      const oldest = this.chunks.keys().next().value;
      this.chunks.delete(oldest);
    }
    this.chunks.set(key, c);
    return c;
  }

  spawnDigParticles(run, world, count = 3) {
    const cx = run.x + run.w / 2;
    const cy = run.y + run.h;
    const mat = world.cellAtPx(cx, cy + 4);
    const depth = (cy + 4) / DEPTH.pxPerMeter;
    const layer = DEPTH.layers[layerIndexAt(depth)];
    let color = layer.soilLight;
    if (mat === MAT.ROCK) color = layer.rock;
    if (mat === MAT.BOULDER) color = '#8a8a92';
    if (mat === MAT.MAGMA) color = '#ff7a35';
    if (mat === MAT.WATER) color = '#7fd0ff';
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: cx + (Math.random() - 0.5) * run.w,
        y: cy - 2,
        vx: (Math.random() - 0.5) * 60,
        vy: -40 - Math.random() * 70,
        life: 0.5 + Math.random() * 0.4,
        age: 0,
        size: 2 + Math.random() * 2,
        color,
      });
    }
    if (this.particles.length > 160) this.particles.splice(0, this.particles.length - 160);
  }

  floatText(x, y, text, color = '#ffe6a8') {
    this.floats.push({ x, y, text, color, age: 0, life: 1.1 });
    if (this.floats.length > 24) this.floats.shift();
  }

  draw(world, run, dt) {
    const g = this.ctx;
    const cam = this.cameraFor(world, run);
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 3);

    const depthCenter = (cam.y + this.h / 2) / DEPTH.pxPerMeter;
    const layer = DEPTH.layers[layerIndexAt(depthCenter)];

    // Фон по слою.
    const bg = g.createLinearGradient(0, 0, 0, this.h);
    bg.addColorStop(0, shade(layer.soilDark, -26));
    bg.addColorStop(1, shade(layer.soilDark, -44));
    g.fillStyle = bg;
    g.fillRect(0, 0, this.w, this.h);

    const shakeX = this.shake ? (Math.random() - 0.5) * this.shake * 4 : 0;
    const shakeY = this.shake ? (Math.random() - 0.5) * this.shake * 4 : 0;
    g.save();
    g.translate(-cam.x + shakeX, -cam.y + shakeY);

    // Чанки.
    const cx0 = Math.floor(cam.x / CHUNK_PX);
    const cx1 = Math.floor((cam.x + this.w) / CHUNK_PX);
    const cy0 = Math.floor(cam.y / CHUNK_PX);
    const cy1 = Math.floor((cam.y + this.h) / CHUNK_PX);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (cx < 0 || cy < 0) continue;
        const img = this.chunkCanvas(world, cx, cy);
        g.drawImage(img, cx * CHUNK_PX, cy * CHUNK_PX);
      }
    }

    this.drawSurface(g, world, cam);
    this.drawLayerMarks(g, cam);
    this.drawLoot(g, world, run, cam);
    this.drawMachine(g, run);
    this.drawParticles(g, dt);
    this.drawFloats(g, dt);
    g.restore();

    this.drawOverlay(g, run);
  }

  drawSurface(g, world, cam) {
    const y = world.surfaceY;
    if (cam.y > y + 40) return;

    // Небо над поверхностью — иначе верх экрана выглядит как сплошной грунт.
    const sky = g.createLinearGradient(0, cam.y, 0, y);
    sky.addColorStop(0, '#20344d');
    sky.addColorStop(0.55, '#3c6d94');
    sky.addColorStop(1, '#8fc6d8');
    g.fillStyle = sky;
    g.fillRect(cam.x, cam.y, this.w, y - cam.y);

    // Солнце и облака.
    g.fillStyle = 'rgba(255, 226, 150, 0.85)';
    g.beginPath();
    g.arc(cam.x + this.w * 0.78, y - 118, 26, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255, 255, 255, 0.16)';
    for (let i = 0; i < 3; i++) {
      const cxp = cam.x + ((this.w * 0.18 + i * 190 + this.time * 4) % (this.w + 200)) - 100;
      g.beginPath();
      g.ellipse(cxp, y - 92 - i * 14, 46, 14, 0, 0, Math.PI * 2);
      g.fill();
    }

    g.fillStyle = '#5aa34a';
    g.fillRect(0, y - 6, world.widthPx, 6);
    g.fillStyle = '#3f7c37';
    g.fillRect(0, y - 2, world.widthPx, 2);

    // Сарай фермы на поверхности — ориентир дома.
    const bx = world.widthPx / 2 - 90;
    g.fillStyle = '#8c3b2e';
    g.fillRect(bx, y - 54, 70, 48);
    g.beginPath();
    g.moveTo(bx - 8, y - 54);
    g.lineTo(bx + 35, y - 82);
    g.lineTo(bx + 78, y - 54);
    g.closePath();
    g.fillStyle = '#b04a38';
    g.fill();
    g.fillStyle = '#f6d58a';
    g.fillRect(bx + 26, y - 34, 18, 28);

    // Мельница.
    g.fillStyle = '#c9c3b0';
    g.fillRect(bx + 110, y - 70, 22, 64);
    g.fillStyle = '#7b4b2a';
    g.beginPath();
    g.arc(bx + 121, y - 74, 10, 0, Math.PI * 2);
    g.fill();
  }

  drawLayerMarks(g, cam) {
    const top = cam.y / DEPTH.pxPerMeter;
    const bottom = (cam.y + this.h) / DEPTH.pxPerMeter;
    g.font = '600 11px "Trebuchet MS", sans-serif';
    for (const layer of DEPTH.layers) {
      if (layer.from < top - 20 || layer.from > bottom + 20) continue;
      if (layer.from === 0) continue;
      const y = layer.from * DEPTH.pxPerMeter;
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.setLineDash([6, 8]);
      g.beginPath();
      g.moveTo(cam.x, y);
      g.lineTo(cam.x + this.w, y);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillText(`${layer.from} м · ${layer.name}`, cam.x + 10, y - 6);
    }
  }

  drawLoot(g, world, run, cam) {
    const items = world.lootInRect(cam.x - 40, cam.y - 40, cam.x + this.w + 40, cam.y + this.h + 40);
    for (const item of items) {
      if (item.taken) continue;
      const type = lootType(item.typeId);
      if (!type) continue;
      const x = item.col * TILE + TILE / 2;
      const y = item.row * TILE + TILE / 2;
      const pulse = 1 + Math.sin(this.time * 3 + x * 0.05) * 0.06;
      g.save();
      g.translate(x, y);
      g.scale(pulse, pulse);
      g.shadowColor = type.color;
      g.shadowBlur = 8;
      g.fillStyle = type.color;
      const s = TILE * 0.62;
      if (type.shape === 'gem' || type.shape === 'crystal') {
        g.beginPath();
        g.moveTo(0, -s);
        g.lineTo(s * 0.8, 0);
        g.lineTo(0, s);
        g.lineTo(-s * 0.8, 0);
        g.closePath();
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.beginPath();
        g.moveTo(0, -s * 0.7);
        g.lineTo(s * 0.3, -s * 0.05);
        g.lineTo(0, s * 0.1);
        g.closePath();
        g.fill();
      } else if (type.shape === 'coin') {
        g.beginPath();
        g.arc(0, 0, s * 0.9, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
        g.strokeStyle = 'rgba(120,80,0,0.6)';
        g.lineWidth = 1.4;
        g.beginPath();
        g.arc(0, 0, s * 0.55, 0, Math.PI * 2);
        g.stroke();
      } else if (type.shape === 'orb') {
        g.beginPath();
        g.arc(0, 0, s * 0.85, 0, Math.PI * 2);
        g.fill();
        g.shadowBlur = 0;
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.beginPath();
        g.arc(-s * 0.28, -s * 0.28, s * 0.28, 0, Math.PI * 2);
        g.fill();
      } else if (type.shape === 'bone') {
        g.beginPath();
        g.roundRect(-s, -s * 0.45, s * 2, s * 0.9, s * 0.45);
        g.fill();
      } else if (type.shape === 'shell') {
        g.beginPath();
        g.arc(0, 0, s * 0.9, Math.PI, 0);
        g.closePath();
        g.fill();
      } else if (type.shape === 'artifact') {
        g.beginPath();
        g.moveTo(0, -s);
        g.lineTo(s * 0.9, -s * 0.1);
        g.lineTo(s * 0.55, s);
        g.lineTo(-s * 0.55, s);
        g.lineTo(-s * 0.9, -s * 0.1);
        g.closePath();
        g.fill();
      } else {
        g.beginPath();
        g.roundRect(-s * 0.85, -s * 0.7, s * 1.7, s * 1.4, 3);
        g.fill();
      }
      g.restore();
    }
  }

  drawMachine(g, run) {
    const x = run.x;
    const y = run.y;
    const w = run.w;
    const h = run.h;
    // Поза по направлению бурения: вниз — бур снизу, влево/вправо — бур сбоку,
    // корпус развёрнут кабиной по ходу (см. src/render/machine-pose.mjs).
    const pose = machinePose(run.diggingDir, w, h);

    g.save();
    g.translate(x + w / 2, y + h / 2);

    // Тень/свечение топлива.
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(0, h / 2 + 2, w * 0.55, 4, 0, 0, Math.PI * 2);
    g.fill();

    // Корпус и кабина — в отражённом по горизонтали контексте для 'right'.
    g.save();
    g.scale(pose.mirror, 1);

    // Гусеницы.
    g.fillStyle = '#2a2f3a';
    g.beginPath();
    g.roundRect(-w / 2 - 1, h / 2 - 6, w + 2, 7, 3);
    g.fill();
    g.fillStyle = '#454c5c';
    for (let i = -2; i <= 2; i++) g.fillRect(i * 6 - 2, h / 2 - 5, 3, 5);

    // Корпус.
    const body = g.createLinearGradient(0, -h / 2, 0, h / 2);
    body.addColorStop(0, '#ffd27a');
    body.addColorStop(0.55, '#f0a13c');
    body.addColorStop(1, '#c9772a');
    g.fillStyle = body;
    g.beginPath();
    g.roundRect(-w / 2, -h / 2, w, h, 6);
    g.fill();
    g.strokeStyle = 'rgba(80,40,0,0.45)';
    g.lineWidth = 1.5;
    g.stroke();

    // Кабина.
    g.fillStyle = 'rgba(140,220,255,0.85)';
    g.beginPath();
    g.roundRect(-w / 2 + 4, -h / 2 + 3, w * 0.42, h * 0.45, 3);
    g.fill();

    g.restore();

    // Бур — отдельным контекстом, чтобы поворот не зеркалил его координаты.
    // Свой треугольник рисуется «вниз» и поворачивается углом позы.
    g.save();
    g.translate(pose.drill.x, pose.drill.y);
    g.rotate(pose.drill.angle);
    g.fillStyle = '#c9d2dd';
    g.beginPath();
    g.moveTo(-5, -1);
    g.lineTo(5, -1);
    g.lineTo(0, 8);
    g.closePath();
    g.fill();
    g.strokeStyle = '#7d8794';
    g.lineWidth = 1.5;
    if (pose.working) {
      g.beginPath();
      g.moveTo(-4, 1);
      g.lineTo(4, 5);
      g.moveTo(4, 1);
      g.lineTo(-4, 5);
      g.stroke();
    }
    g.restore();

    // Фара.
    if (run.depth > 3) {
      const grd = g.createRadialGradient(0, 0, 4, 0, 0, 70);
      grd.addColorStop(0, 'rgba(255,235,180,0.22)');
      grd.addColorStop(1, 'rgba(255,235,180,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.arc(0, 0, 70, 0, Math.PI * 2);
      g.fill();
    }

    // Пламя ракеты.
    if (run.rocketOn) {
      const flame = 10 + Math.random() * 8;
      const grd = g.createLinearGradient(0, h / 2, 0, h / 2 + flame);
      grd.addColorStop(0, 'rgba(255,240,150,0.95)');
      grd.addColorStop(1, 'rgba(255,90,30,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(-6, h / 2 + 2);
      g.lineTo(6, h / 2 + 2);
      g.lineTo(0, h / 2 + flame);
      g.closePath();
      g.fill();
    }

    // Капсула давления активна — щит.
    if (run.capsuleTimer > 0) {
      g.strokeStyle = 'rgba(120,220,255,0.75)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(0, 0, w * 0.85, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  drawParticles(g, dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 260 * dt;
      g.globalAlpha = 1 - p.age / p.life;
      g.fillStyle = p.color;
      g.fillRect(p.x, p.y, p.size, p.size);
    }
    g.globalAlpha = 1;
  }

  drawFloats(g, dt) {
    g.font = '700 12px "Trebuchet MS", sans-serif';
    g.textAlign = 'center';
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.floats.splice(i, 1);
        continue;
      }
      g.globalAlpha = 1 - f.age / f.life;
      g.fillStyle = f.color;
      g.fillText(f.text, f.x, f.y - f.age * 28);
    }
    g.globalAlpha = 1;
    g.textAlign = 'left';
  }

  drawOverlay(g, run) {
    // Виньетка давления/перегрева.
    if (run.pressureDps > 0) {
      const a = Math.min(0.45, 0.12 + run.pressureDps * 0.02);
      const grd = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.25, this.w / 2, this.h / 2, this.h * 0.7);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(220,40,40,${a})`);
      g.fillStyle = grd;
      g.fillRect(0, 0, this.w, this.h);
    }
    if (run.temp > 80) {
      const a = ((run.temp - 80) / 20) * 0.28;
      const grd = g.createRadialGradient(this.w / 2, this.h / 2, this.h * 0.2, this.w / 2, this.h / 2, this.h * 0.75);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, `rgba(255,110,20,${a})`);
      g.fillStyle = grd;
      g.fillRect(0, 0, this.w, this.h);
    }
  }
}
