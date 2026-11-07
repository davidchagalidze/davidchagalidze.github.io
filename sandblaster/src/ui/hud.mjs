/** HUD: приборы, прогресс по типам грязи, техстрока. Только чтение состояния сессии. */

import { ENGINE, LABELS, PALETTE, RULES } from '../game/config.mjs';
import { gridStats } from '../game/grid.mjs';

export const money = (v) =>
  `${v < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('ru-RU').replace(/\u00a0/g, ' ')}`;

export const money2 = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;

const DIRT_SHORT = LABELS.dirt;

export function createHud(doc = document) {
  const el = (id) => doc.getElementById(id);
  const refs = {
    money: el('hud-money'),
    cls: el('hud-class'),
    item: el('hud-item'),
    base: el('hud-base'),
    clean: el('g-clean'),
    cleanBar: el('g-clean-bar'),
    abrasive: el('g-abrasive'),
    abrasiveBar: el('g-abrasive-bar'),
    energy: el('g-energy'),
    energyBar: el('g-energy-bar'),
    refill: el('refill-label'),
    refillBtn: el('btn-refill'),
    deliver: el('btn-deliver'),
    techline: el('techline'),
    types: el('type-breakdown'),
    dry: el('dry-warn'),
  };

  let lastTypes = '';

  function update({ session, save }) {
    if (!save) return;
    refs.money.textContent = money(save.money);
    if (!session) {
      // Заказа нет (только что сдали или ещё не брали): приборы не держат
      // прошлые проценты и кнопки не остаются активными.
      refs.cls.textContent = '—';
      refs.item.textContent = '—';
      refs.base.textContent = money(0);
      refs.clean.textContent = '0.0%';
      refs.cleanBar.style.width = '0%';
      refs.cleanBar.classList.remove('low');
      refs.abrasive.textContent = `${Number(save.hopperKg || 0).toFixed(1)} кг`;
      refs.abrasiveBar.style.width = '0%';
      refs.energy.textContent = money2(0);
      refs.energyBar.style.width = '0%';
      refs.deliver.disabled = true;
      refs.deliver.textContent = 'Сдать заказ';
      refs.refillBtn.disabled = true;
      refs.refill.textContent = 'Долить';
      refs.dry.classList.add('hidden');
      refs.techline.innerHTML = '';
      refs.types.innerHTML = '';
      lastTypes = '';
      return;
    }

    const s = gridStats(session.grid);
    const stats = session.stats;
    refs.cls.textContent = LABELS.classes[session.order.classId] || session.order.classId;
    refs.item.textContent = session.item.label;
    refs.base.textContent = money(session.order.base);

    refs.clean.textContent = `${s.cleanPct.toFixed(1)}%`;
    refs.cleanBar.style.width = `${Math.min(100, s.cleanPct)}%`;
    refs.cleanBar.classList.toggle('low', s.cleanPct < ENGINE.minDeliverPct && s.cleanPct < 60);

    refs.abrasive.textContent = `${session.hopperKg.toFixed(1)} / ${stats.capacityKg} кг`;
    refs.abrasiveBar.style.width = `${(session.hopperKg / stats.capacityKg) * 100}%`;
    refs.abrasiveBar.classList.toggle('low', session.hopperKg < 1);

    refs.energy.textContent = money2(session.energyCost);
    refs.energyBar.style.width = `${Math.min(100, (session.energyKwh / 1.2) * 100)}%`;

    const can = session.canDeliver();
    refs.deliver.disabled = !can;
    refs.deliver.textContent = can ? `Сдать заказ · ${s.cleanPct.toFixed(0)}%` : `Сдать · нужен ≥${ENGINE.minDeliverPct}%`;

    const room = stats.capacityKg - session.hopperKg;
    refs.refill.textContent = room > 0.05 ? `Долить · +${room.toFixed(1)} кг / ${RULES.refillSec} с` : 'бак полон';
    refs.refillBtn.disabled = room <= 0.05;

    const dry = session.dry && session.sprayed;
    refs.dry.classList.toggle('hidden', !dry);

    refs.techline.innerHTML = [
      `<span>пятно Ø <b>${((session.spotRadius ?? stats.radiusCells) * 2).toFixed(1)} кл</b></span>`,
      `<span>давление <b>${stats.pressure.toFixed(1)} бар</b></span>`,
      `<span>песок <b>${session.sandPerSec.toFixed(2)} кг/с</b></span>`,
      `<span>${stats.kW} кВт</span>`,
      `<span>${stats.gradeName} <b>×${stats.damageMult.toFixed(2)}</b></span>`,
      `<span>возврат <b>${Math.round(stats.returnPct * 100)}%</b></span>`,
      `<span>обслуживание <b>$${stats.upkeep.toFixed(2)}/заказ</b></span>`,
      stats.handCellsPerSec > 0 ? `<span>рабочий <b>${stats.handCellsPerSec} HP/с</b></span>` : '',
      session.order.material === 'thin' ? `<span>лист: порог <b>${session.order.thinLimit.toFixed(2)} бар</b></span>` : '',
      dry ? '<span class="dry">СУХО — нет абразива</span>' : '',
    ]
      .filter(Boolean)
      .join('');

    const key = Object.entries(s.byType)
      .map(([k, v]) => `${k}:${v.dirt}:${Math.round(v.pct)}`)
      .join('|');
    if (key !== lastTypes) {
      lastTypes = key;
      refs.types.innerHTML = Object.entries(s.byType)
        .filter(([, v]) => v.dirt > 0)
        .map(
          ([k, v]) =>
            `<span class="dirtchip"><i style="background:${PALETTE.dirt[k] || '#808080'}"></i>${DIRT_SHORT[k] || k} ${Math.round(v.pct)}% <span style="opacity:.55">(${v.dirt})</span></span>`,
        )
        .join('');
    }
  }

  return { refs, update };
}
