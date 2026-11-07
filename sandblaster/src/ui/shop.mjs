/** Цех: 6 осей, состояние склада и оценка окупаемости. Логики покупки здесь нет. */

import { LABELS, RULES } from '../game/config.mjs';
import { AXES, levelOf, describeAxis, statsFor } from '../game/upgrades.mjs';
import { roiForUpgrade, planOrder, sandPrice } from '../game/pay.mjs';
import { money } from './hud.mjs';

export function createShop(doc, { onBuy }) {
  const axesBox = doc.getElementById('shop-axes');
  const stockBox = doc.getElementById('stock-rows');
  const moneyEl = doc.getElementById('sheet-money');
  const subEl = doc.getElementById('sheet-sub');
  const noteEl = doc.getElementById('shop-note');

  function render({ save, order, hopperKg }) {
    moneyEl.textContent = money(save.money);
    subEl.textContent = order ? `${LABELS.classes[order.classId] || order.classId} · ${order.base ? money(order.base) : ''}` : 'Апгрейды и склад';

    const stats = statsFor(save.levels);
    const plan = order ? planOrder({ order, levels: save.levels }) : null;
    noteEl.textContent = plan
      ? `Смета по текущему заказу: цикл ${plan.cycleSec.toFixed(0)} с, чистыми ${money(plan.net)} (${plan.marginPct.toFixed(0)}% от gross). Обслуживание ${money(stats.upkeep)} за заказ уже включено.`
      : 'Возьмите заказ, чтобы видеть оценку окупаемости по нему.';

    axesBox.innerHTML = AXES.map((axis) => {
      const lvl = levelOf(save.levels, axis.id);
      const max = lvl >= axis.table.length - 1;
      const price = max ? null : axis.id === 'abrasive' ? axis.table[lvl + 1].unlockPrice : axis.table[lvl + 1].price;
      const affordable = price != null && save.money >= price;
      const pips = axis.table.map((_, i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('');
      let roi = '';
      if (!max && order) {
        const est = roiForUpgrade({ axisId: axis.id, levels: save.levels, order });
        roi = est.orders ? `окупится за ${est.orders.toFixed(1)} зак.` : 'окупаемость низкая';
      }
      return `
        <div class="axis ${lvl > 0 ? 'bought' : ''}" data-axis="${axis.id}">
          <div class="axis-name">${axis.label}<span class="pips">${pips}</span></div>
          <div class="axis-effect">${describeAxis(axis.id, save.levels)}</div>
          <div class="axis-buy">
            ${
              max
                ? '<span class="axis.max">макс</span>'
                : `<button class="btn tiny ${affordable ? 'primary' : ''}" data-buy="${axis.id}" ${affordable ? '' : 'disabled'}>${money(price)}</button>`
            }
            <span class="axis-roi ${roi && !roi.includes('низкая') ? 'good' : ''}">${roi}</span>
          </div>
        </div>`;
    }).join('');

    stockBox.innerHTML = `
      <div class="stock">
        <b>Бак ${hopperKg.toFixed(1)} / ${stats.capacityKg} кг</b>
        <span>${stats.gradeName} · ${money(sandPrice(save.levels))}/кг · доливка ${RULES.refillSec} с простоя</span>
      </div>
      <div class="stock">
        <b>Песок за заказ</b>
        <span>${plan ? `${plan.kg.toFixed(1)} кг · ${money(plan.sandCost)}` : '—'} · скидка бункера ${Math.round(stats.bulkDiscount * 100)}%</span>
      </div>
      <div class="stock">
        <b>Камера и свет</b>
        <span>аренда ${money(RULES.boothPerHour)}/ч · ${RULES.kwhPrice.toFixed(2)} $/кВт·ч · ${stats.kW} кВт</span>
      </div>`;
  }

  axesBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-buy]');
    if (!btn) return;
    onBuy(btn.dataset.buy);
  });

  return { render };
}
