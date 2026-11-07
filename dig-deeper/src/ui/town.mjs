/**
 * Город: обслуживание машины, шесть осей прокачки, снаряжение, ипотека.
 * Числа — из модели (src/model/model-v1.mjs через config/economy.mjs и game/machine.mjs).
 */

import { ECONOMY, money, statsFor } from '../config/economy.mjs';
import { AXES, CONSUMABLES } from '../config/upgrades.mjs';
import { dugStats } from '../engine/world.mjs';
import { paymentDue, runsUntilDeadline, runsUntilPayment } from '../game/day.mjs';
import { serviceQuote } from '../game/machine.mjs';
import { totalConsumables } from '../game/upgrades.mjs';

const $ = (id) => document.getElementById(id);

export function renderTown(state, handlers, report) {
  $('town-money').textContent = money(state.cash);
  const free = state.mode === 'freeplay';
  $('town-day').textContent = free
    ? `Свободная игра · день ${state.day} · рекорд ${Math.round(state.records.freeDepth || 0)} м`
    : `День ${state.day} из ${ECONOMY.mortgage.deadlineDays} · выписка через ${runsUntilPayment(
        state,
      )} забегов · долг ${money(state.debt)}`;

  // «ствол: N м · выработано M клеток» — состояние шахты между спусками
  // (IDIGIT-13 §3). Считается из карты выработки в сейве, без генерации мира.
  const mineNode = $('town-mine');
  if (mineNode) {
    const mine = dugStats(state.mine?.dug);
    mineNode.textContent = mine.cells > 0 ? `ствол: ${Math.round(mine.depth)} м · выработано ${mine.cells} клеток` : 'ствол: 0 м · шахта не тронута';
  }

  renderReport(state, report);
  renderService(state, handlers);
  renderUpgrades(state, handlers);
  renderGear(state, handlers);
  renderDebt(state, handlers);
  renderDive(state);
}

function renderReport(state, report) {
  const box = $('town-report');
  if (!report) {
    box.innerHTML = `<h3>Готов к забою</h3><p class="hint">Копай вниз, собирай руду, возвращайся ракетой. Давление и жара не прощают жадности.</p>`;
    return;
  }
  const parts = [`<h3>${report.title}</h3>`];
  if (report.lines && report.lines.length) {
    for (const line of report.lines) {
      parts.push(
        `<div class="row"><span class="nm">${line.name} × ${line.count} <i style="color:${line.color}">◆</i></span><span>${money(
          line.sum,
        )}</span></div>`,
      );
    }
    parts.push(`<div class="row total"><span>Выручка</span><span>+${money(report.total)}</span></div>`);
    if (report.bankShare > 0) {
      parts.push(`<div class="row"><span>Банку (40% выручки)</span><span>−${money(report.bankShare)}</span></div>`);
    }
    parts.push(`<div class="row"><span>На руки</span><span>${money(report.cash)}</span></div>`);
  }
  if (report.lost && report.lost.length) {
    parts.push(`<div class="row died"><span>Потеряно в глубине</span><span>${money(report.lostValue)}</span></div>`);
  }
  for (const note of report.notes || []) parts.push(`<p class="hint">${note}</p>`);
  box.innerHTML = parts.join('');
}

/**
 * Мастерская. Показывает остаток бака/корпуса после забега, цену обслуживания
 * и списывает деньги. Без этого «продал → заправился → нырнул» не работает:
 * каждый забег стартовал бы с бесплатным полным баком.
 */
function renderService(state, handlers) {
  const box = $('town-service');
  const q = serviceQuote(state);
  const m = state.machine;
  const fuelPct = Math.round((m.fuel / q.stats.tankLiters) * 100);
  const hullPct = Math.round((m.hull / q.stats.hp) * 100);
  const emptyTank = m.fuel <= 0.01;
  const canEmergency = emptyTank && state.cash < q.minFuelCost;
  const canRefuel = (q.liters > 0 && state.cash >= q.minFuelCost) || canEmergency;
  const canRepair = q.hp > 0 && state.cash >= 1;

  const refuelLabel = canEmergency
    ? `Аварийная канистра ${q.minFuelLiters} л`
    : q.liters > 0
      ? `Заправить ${q.liters} л — ${money(q.fuelCost)}`
      : 'Бак полный';
  const repairLabel = q.hp > 0 ? `Починить ${q.hp} HP — ${money(q.hpCost)}` : 'Корпус целый';

  box.innerHTML = `
    <div class="service-head">
      <h3>Обслуживание машины</h3>
      <span class="hint">${m.depth > 0 ? `после забега на ${m.depth} м` : 'перед первым забоем'}</span>
    </div>
    <div class="service-row">
      <div><span class="k">Бак</span><b>${m.fuel.toFixed(1)} / ${q.stats.tankLiters} л</b><i class="hint">${fuelPct}%</i></div>
      <button id="btn-refuel" class="svc" ${canRefuel ? '' : 'disabled'}>${refuelLabel}</button>
    </div>
    <div class="service-row">
      <div><span class="k">Корпус</span><b>${Math.round(m.hull)} / ${q.stats.hp} HP</b><i class="hint">${hullPct}%</i></div>
      <button id="btn-repair" class="svc" ${canRepair ? '' : 'disabled'}>${repairLabel}</button>
    </div>
    ${
      q.liters > 0 && state.cash < q.fuelCost && !canEmergency
        ? `<p class="hint">Денег не хватает на полный бак — заправка зальёт столько, на сколько хватит (не меньше минимального чека ${money(
            q.minFuelCost,
          )}).</p>`
        : ''
    }
    ${
      canEmergency
        ? `<p class="hint bad">Бак пуст, а на минимальный чек не хватает. Аварийная канистра ${q.minFuelLiters} л: ${
            state.mode === 'campaign' ? 'в долг банку' : 'бесплатно, свободная игра'
          }.</p>`
        : emptyTank
          ? '<p class="hint bad">Бак пуст: без заправки в забой не выпустят.</p>'
          : ''
    }
  `;
  const rf = $('btn-refuel');
  const rp = $('btn-repair');
  if (rf) rf.onclick = handlers.onRefuel;
  if (rp) rp.onclick = handlers.onRepair;
}

function pips(tier, total = 5) {
  let out = '<div class="pips">';
  for (let i = 0; i < total; i++) out += `<i class="${i < tier ? 'on' : ''}"></i>`;
  return out + '</div>';
}

function renderUpgrades(state, handlers) {
  const box = $('tab-upgrades');
  const stats = statsFor(state.tiers);
  box.innerHTML = '';
  for (const axis of AXES) {
    const tier = state.tiers[axis.id] || 0;
    const price = axis.tiers[tier + 1] ? axis.tiers[tier + 1].cost : null;
    const current = axis.tiers[tier];
    const next = tier + 1 < axis.tiers.length ? axis.tiers[tier + 1] : null;
    const affordable = price !== null && state.cash >= price;

    const row = document.createElement('div');
    row.className = 'upgrade';
    row.innerHTML = `
      <div class="ic">${axis.icon}</div>
      <div>
        <div class="nm">${axis.name} <span class="hint">${axis.what}</span></div>
        <div class="eff">сейчас: ${axis.effect(current)}${next ? ` → ${axis.effect(next)}` : ''}</div>
        ${pips(tier)}
      </div>
      <div class="buy">
        <button ${affordable ? '' : 'disabled'}>${price !== null ? money(price) : 'макс'}</button>
        ${price !== null && !affordable ? `<small>не хватает ${money(price - state.cash)}</small>` : ''}
      </div>
      <div class="why">${axis.why}</div>
    `;
    const btn = row.querySelector('button');
    if (btn && affordable) btn.onclick = () => handlers.onBuyUpgrade(axis.id);
    box.appendChild(row);
  }
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = `Корпус держит до ${stats.safeDepth} м · трюм ${stats.cargoSlots} ед. · бур ${stats.rate.toFixed(
    2,
  )} ед/с · бак ${stats.tankLiters} л · ход ${stats.speedDown.toFixed(1)} м/с`;
  box.appendChild(hint);
}

function renderGear(state, handlers) {
  const box = $('tab-gear');
  const stats = statsFor(state.tiers);
  const used = totalConsumables(state.inventory);
  box.innerHTML = '';

  const head = document.createElement('p');
  head.className = 'hint';
  head.textContent = `Снаряжение занимает слоты трюма: ${used} из ${stats.cargoSlots}. Взять капсулу — значит не взять ${used} единиц руды.`;
  box.appendChild(head);

  for (const item of CONSUMABLES) {
    const cfg = ECONOMY.consumables[item.id];
    const count = state.inventory[item.id] || 0;
    const canBuy = state.cash >= cfg.price && used < stats.cargoSlots;
    const row = document.createElement('div');
    row.className = 'gear-item';
    row.innerHTML = `
      <div class="info"><b>${item.icon} ${item.name} × ${count}</b><span>${item.hint} · ${money(cfg.price)}</span></div>
      <button ${canBuy ? '' : 'disabled'}>Купить</button>
    `;
    const btn = row.querySelector('button');
    if (canBuy) btn.onclick = () => handlers.onBuyConsumable(item.id);
    else {
      const s = document.createElement('small');
      s.style.color = 'var(--red)';
      s.textContent = used >= stats.cargoSlots ? 'все слоты трюма заняты' : `не хватает ${money(cfg.price - state.cash)}`;
      row.querySelector('.info').appendChild(s);
    }
    box.appendChild(row);
  }
}

function renderDebt(state, handlers) {
  const box = $('tab-debt');
  box.innerHTML = '';
  if (state.mode === 'freeplay') {
    box.innerHTML = `<div class="debt-box"><b>Свободная игра</b><span class="hint">Долга нет. Рекорд глубины: ${Math.round(
      state.records.freeDepth || 0,
    )} м, рекорд заработка: ${money(state.records.freeEarnings || 0)}.</span></div>`;
    return;
  }
  const div = document.createElement('div');
  div.className = 'debt-box';
  div.innerHTML = `
    <div>Остаток ипотеки</div>
    <div class="big">${money(state.debt)}</div>
    <div class="hint">Банк забирает ${Math.round(ECONOMY.mortgage.share * 100)}% каждой выручки сразу.
      Выписка каждые ${ECONOMY.mortgage.paymentEveryRuns} забегов; если за окно банку не досталось
      ${money(paymentDue(state))} — это пропуск. Два пропуска подряд снимают тир, три — отчуждение.
      До дедлайна: ${runsUntilDeadline(state)} забегов.</div>
    <div class="hint">Долг уменьшается сам с каждой продажи. Досрочное погашение ниже — просто быстрее.</div>
  `;
  const btn = document.createElement('button');
  btn.className = 'btn primary';
  btn.textContent = `Погасить из банка (${money(Math.min(state.cash, state.debt))})`;
  btn.disabled = state.cash <= 0 || state.debt <= 0;
  btn.onclick = handlers.onPayDebt;
  div.appendChild(btn);
  box.appendChild(div);
}

/** «В забой» доступен только когда партия играется и в баке есть топливо. */
function renderDive(state) {
  const btn = $('btn-dive');
  const noFuel = state.machine.fuel <= 0.01;
  btn.disabled = state.status !== 'playing' || noFuel;
  btn.textContent = noFuel ? 'Нужна заправка' : 'В забой';
}
