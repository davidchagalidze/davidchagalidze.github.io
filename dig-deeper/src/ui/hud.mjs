/** HUD: цифры и шкалы, которые видны всегда. Значения — из модели дизайнера. */

import { ECONOMY, fuelNeeded, layerAt, money, pressureAt, safeDepthForRating } from '../config/economy.mjs';
import { DRY_SECONDS, cargoCapacity, cargoUnits, effectiveRating } from '../game/run.mjs';
import { runsUntilPayment } from '../game/day.mjs';

const el = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.nodes = {
      depth: el('hud-depth'),
      pressure: el('hud-pressure'),
      safe: el('hud-safe'),
      money: el('hud-money'),
      cargo: el('hud-cargo'),
      debt: el('hud-debt'),
      due: el('hud-due'),
      layer: el('hud-layer'),
      face: el('hud-face'),
      fuelBar: el('bar-fuel'),
      hullBar: el('bar-hull'),
      tempBar: el('bar-temp'),
      fuelVal: el('fuel-val'),
      hullVal: el('hull-val'),
      tempVal: el('temp-val'),
      warn: el('warn'),
      toasts: el('toasts'),
      dock: el('gear-dock'),
    };
    this.lastWarn = '';
    this.buildDock();
  }

  buildDock() {
    this.nodes.dock.innerHTML = '';
    const kinds = [
      { id: 'capsule', icon: '🜛', key: '1', name: 'Капсула давления' },
      { id: 'coolant', icon: '❄', key: '2', name: 'Охлаждающая смесь' },
      { id: 'repairKit', icon: '🔧', key: '3', name: 'Ремонтный набор' },
    ];
    this.dockButtons = {};
    for (const k of kinds) {
      const b = document.createElement('button');
      b.dataset.use = k.id;
      b.title = `${k.name} (клавиша ${k.key})`;
      b.innerHTML = `${k.icon}<b>0</b>`;
      this.nodes.dock.appendChild(b);
      this.dockButtons[k.id] = b;
    }
  }

  update(state, run) {
    const n = this.nodes;
    const depth = run.depth;
    const rating = effectiveRating(run);
    const bar = pressureAt(depth);
    const cap = cargoCapacity(run);
    const units = cargoUnits(run);

    n.depth.textContent = `${Math.round(depth)} м`;
    n.pressure.textContent = `${bar.toFixed(2)} / ${rating.toFixed(2)}`;
    n.pressure.classList.toggle('danger', bar > rating);
    // «держит до N м» — из фактического рейтинга: капсула давления тоже его поднимает.
    n.safe.textContent = `держит до ${Math.round(safeDepthForRating(rating))} м`;
    n.money.textContent = money(state.cash);
    n.cargo.textContent = `${units} / ${cap}`;

    if (state.mode === 'freeplay') {
      n.debt.textContent = 'свободный режим';
      n.due.textContent = `рекорд ${Math.round(state.records.freeDepth || 0)} м`;
    } else {
      n.debt.textContent = money(state.debt);
      n.due.textContent = `выписка через ${runsUntilPayment(state)}`;
    }
    n.layer.textContent = layerAt(depth).name;
    // «Забой сухой» (IDIGIT-13 §3): на забое нет руды дольше 2 с — участок
    // выработан, руду даст только новая порода вбок или глубже.
    if (n.face) {
      const dry = run.drySec || 0;
      n.face.textContent = run.diggingDir && dry >= DRY_SECONDS ? `забой сухой: ${Math.floor(dry)} с без руды` : '';
    }

    const fuelPct = Math.max(0, Math.min(1, run.fuel / run.stats.tankLiters));
    const hullPct = Math.max(0, Math.min(1, run.hull / run.maxHull));
    const tempPct = Math.max(0, Math.min(1, run.temp / run.stats.maxTemp));
    n.fuelBar.style.width = `${fuelPct * 100}%`;
    n.hullBar.style.width = `${hullPct * 100}%`;
    n.tempBar.style.width = `${tempPct * 100}%`;
    n.fuelVal.textContent = `${run.fuel.toFixed(1)} л`;
    n.hullVal.textContent = `${Math.round(run.hull)}`;
    n.tempVal.textContent = `${Math.round(run.temp)}°`;

    for (const [kind, btn] of Object.entries(this.dockButtons)) {
      const count = run.consumables[kind] || 0;
      btn.querySelector('b').textContent = String(count);
      btn.disabled = count <= 0;
    }

    let warn = '';
    const needFuel = fuelNeeded(depth, run.stats);
    if (run.temp > run.stats.maxTemp) warn = `ПЕРЕГРЕВ: ${Math.round(run.temp)}° выше предела ${run.stats.maxTemp}°`;
    else if (bar > rating) warn = 'ДАВЛЕНИЕ ВЫШЕ РЕЙТИНГА КОРПУСА';
    else if (units >= cap) warn = 'Трюм полон — ракета наверх или сброс дешёвого';
    else if (run.fuel <= needFuel) warn = 'Топлива не хватит на подъём — наверх!';
    else if (run.hull <= run.maxHull * 0.3) warn = 'Корпус еле держится';

    if (warn !== this.lastWarn) {
      this.lastWarn = warn;
      n.warn.textContent = warn;
      n.warn.classList.toggle('hidden', !warn);
    }
  }

  toast(text, ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    this.nodes.toasts.appendChild(t);
    while (this.nodes.toasts.children.length > 4) this.nodes.toasts.firstChild.remove();
    setTimeout(() => t.remove(), ms);
  }

  hideWarn() {
    this.lastWarn = '';
    this.nodes.warn.classList.add('hidden');
  }
}
