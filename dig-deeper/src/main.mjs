/**
 * Точка входа: меню → забег → город → снова забег.
 * Держит состояние (state из модели дизайнера), мир и забег, крутит rAF-цикл,
 * обрабатывает ввод, автосохранение и PWA.
 */

import { ECONOMY, money, statsFor } from './config/economy.mjs';
import { clearSave, loadState, memoryStorage, mineWorld, newGame, restoreRun, saveMine, saveState, snapshotRun } from './game/state.mjs';
import { advanceDay, payDebt } from './game/day.mjs';
import { buyConsumable, buyUpgrade } from './game/upgrades.mjs';
import { ensureFuelForDive, emergencyRefuel, refuel, repair, syncMachine } from './game/machine.mjs';
import { settleRun } from './game/settlement.mjs';
import { createRun, dumpCheapest, stepRun, useConsumable } from './game/run.mjs';
import { Renderer } from './render/renderer.mjs';
import { Hud } from './ui/hud.mjs';
import { renderTown } from './ui/town.mjs';
import { bindHoldButton, createHoldState } from './ui/hold.mjs';

const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), game: $('game'), town: $('town') };

function makeStorage() {
  try {
    const probe = '__dig_deeper_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return memoryStorage();
  }
}

const storage = makeStorage();
let state = null;
let world = null;
let run = null;
let screen = 'menu';
let report = null;
let lastTs = 0;
let saveAcc = 0;
let hudAcc = 0;

const renderer = new Renderer($('canvas'));
const hud = new Hud();

const input = { left: false, right: false, down: false, rocket: false };
const keys = new Set();
// Тач-пад и большие кнопки держат состояние наборами указателей:
// pointerleave больше не снимает нажатие (см. src/ui/hold.mjs).
const holds = createHoldState();
const touch = holds.keys;

// ─── экраны ────────────────────────────────────────────────────────────────
function show(name) {
  screen = name;
  for (const [key, node] of Object.entries(screens)) node.classList.toggle('hidden', key !== name);
  if (name === 'game') renderer.resize();
}

function modal({ title, body, actions }) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = body;
  const box = $('modal-actions');
  box.innerHTML = '';
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.primary ? 'primary' : ''} big`;
    b.textContent = a.label;
    b.onclick = () => {
      $('modal').classList.add('hidden');
      a.onClick?.();
    };
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden');
}

const hideModal = () => $('modal').classList.add('hidden');

// ─── сохранение ────────────────────────────────────────────────────────────
function persist(now = Date.now()) {
  if (!state) return;
  state.updatedAt = now;
  if (run && run.active && screen === 'play') state.run = snapshotRun(run, world);
  saveState(state, storage, now);
}

function exposeDebug() {
  Object.defineProperty(window, 'dd', {
    configurable: true,
    get: () => ({ state, run, world, renderer, screen, save: () => persist() }),
  });
}

// ─── забег ─────────────────────────────────────────────────────────────────
function makeRun({ silent = false } = {}) {
  if (state.status !== 'playing') return false;
  const fuel = ensureFuelForDive(state);
  if (!fuel.ok) {
    hud.toast('Бак пуст и денег на заправку нет', 2400);
    return false;
  }
  if (fuel.emergency && !silent) {
    hud.toast(
      fuel.emergency.credit > 0
        ? `Аварийная канистра: ${fuel.emergency.liters} л, ${money(fuel.emergency.credit)} ушло в долг банку`
        : `Аварийная канистра: ${fuel.emergency.liters} л бесплатно`,
      3000,
    );
  }
  // Мир — из сейва кампании (R1): тот же сид и та же выработка, что остались
  // после прошлого спуска. Случайного мира здесь больше нет (IDIGIT-14).
  world = mineWorld(state);
  run = createRun(state, world);
  renderer.particles.length = 0;
  renderer.floats.length = 0;
  state.run = null;
  hud.hideWarn();
  show('game');
  screen = 'play';
  return true;
}

function startNewGame(mode, hardcore) {
  // Одно место выбора сида на всю игру: он же становится сидом шахты (R1).
  // «Заново» вызывает эту функцию, поэтому новый мир — только здесь.
  const seed = (Math.random() * 0x7fffffff) | 0;
  state = newGame({ mode, hardcore, seed, now: Date.now() });
  clearSave(storage);
  report = null;
  hideModal();
  makeRun({ silent: true });
  hud.toast(
    mode === 'free' ? 'Свободная игра: долга нет, только личные рекорды' : 'Ипотека 100 000 $. Копай и плати.',
    2800,
  );
  persist();
}

function resume() {
  const restored = state?.run ? restoreRun(state) : null;
  if (!restored) {
    makeRun();
    return;
  }
  world = restored.world;
  run = restored.run;
  renderer.particles.length = 0;
  show('game');
  screen = 'play';
  hud.toast('Забег восстановлен', 1800);
}

// ─── город ────────────────────────────────────────────────────────────────
function townHandlers() {
  return {
    onBuyUpgrade(axis) {
      const res = buyUpgrade(state, axis);
      if (!res.ok) {
        hud.toast(res.reason === 'max' ? 'Это максимум' : `Не хватает ${money(res.missing)}`, 2000);
      } else hud.toast(`Куплено: тир ${res.tier} за ${money(res.price)}`, 1800);
      persist();
      refreshTown();
    },
    onBuyConsumable(kind) {
      const res = buyConsumable(state, kind);
      if (!res.ok) {
        hud.toast(res.reason === 'slots' ? 'Все слоты трюма заняты' : `Не хватает ${money(res.price - state.cash)}`, 2000);
      } else hud.toast('Снаряжение куплено', 1600);
      persist();
      refreshTown();
    },
    onRefuel() {
      const res = refuel(state);
      if (res.ok) {
        hud.toast(
          res.full
            ? `Заправка: ${res.liters} л за ${money(res.cost)}`
            : `Залито ${res.liters} л за ${money(res.cost)} — бак не полный`,
          2000,
        );
      } else if (res.reason === 'money') {
        const em = emergencyRefuel(state);
        if (em.ok) {
          hud.toast(
            em.credit > 0
              ? `Аварийная канистра: ${em.liters} л, ${money(em.credit)} в долг банку`
              : `Аварийная канистра: ${em.liters} л бесплатно`,
            3000,
          );
        } else hud.toast(`Не хватает ${money(res.missing)}`, 2000);
      } else hud.toast('Бак полный', 1400);
      persist();
      refreshTown();
    },
    onRepair() {
      const res = repair(state);
      if (res.ok) {
        hud.toast(
          res.full
            ? `Ремонт: ${res.hp} HP за ${money(res.cost)}`
            : `Залатано ${res.hp} HP за ${money(res.cost)} — корпус не целый`,
          2000,
        );
      } else if (res.reason === 'money') hud.toast(`Не хватает ${money(res.missing)}`, 2000);
      else hud.toast('Корпус целый', 1400);
      persist();
      refreshTown();
    },
    onPayDebt() {
      const res = payDebt(state, state.debt);
      if (res.ok) hud.toast(`Погашено ${money(res.paid)}`, 2000);
      persist();
      if (state.status === 'won') return showVictory();
      refreshTown();
    },
    onDive() {
      if (makeRun()) persist();
    },
  };
}

function refreshTown() {
  renderTown(state, townHandlers(), report);
}

function showTown(newReport) {
  report = newReport;
  screen = 'town';
  show('town');
  refreshTown();
  persist();
}

// ─── завершение забега ────────────────────────────────────────────────────
function endRun() {
  const settled = settleRun(state, run);
  // Выработка забега уходит в шахту ДО расчёта дня и до persist: расчёт и
  // выработка должны попасть в один сейв, иначе перезагрузка станет откатом
  // (анти-эксплойт 3, IDIGIT-13 §7).
  saveMine(state, world);
  let rep;

  if (settled.died) {
    rep = {
      title: run.deathReason === 'fuel' ? 'Машина заглохла в глубине' : 'Корпус не выдержал',
      lost: settled.lost.lines,
      lostValue: settled.lost.total,
      notes: [
        `Эвакуация: ${money(ECONOMY.death.towFee)}. Груз потерян, банк и прокачка на месте.`,
        'Корпус отремонтирован в мастерской, бак пустой — заправься перед выходом.',
      ],
    };
  } else {
    rep = {
      title: `Вернулся с ${settled.depth} м`,
      lines: settled.sale.lines,
      total: settled.sale.total,
      bankShare: settled.sale.bankShare,
      cash: settled.sale.cash,
      notes: [
        `Сожжено ${settled.fuelUsed.toFixed(1)} л топлива · корпус ${settled.hullLeft} из ${settled.maxHull} HP · добыто ${settled.mined.toFixed(
          1,
        )} ед.`,
        `В баке осталось ${settled.fuelLeft.toFixed(1)} л. Обслуживание машины — в мастерской, перед следующим забоем.`,
      ],
    };
  }

  const loanEvents = advanceDay(state);
  const notes = [...(rep.notes || [])];
  for (const e of loanEvents) {
    if (e.type === 'statement') notes.push(`Выписка банка: за окно ушло ${money(e.paid)}, остаток долга ${money(e.debt)}.`);
    if (e.type === 'miss')
      notes.push(
        `Банк недополучил ${money(e.shortfall)} за 5 забегов — пропуск №${e.streak}. Ещё ${
          ECONOMY.mortgage.warningsBeforeSeize - e.streak
        } — и ферму отберут.`,
      );
    if (e.type === 'repo-tier') notes.push('Банк забрал один тир прокачки.');
    if (e.type === 'seized') notes.push('Ферма отчуждена.');
    if (e.type === 'win') notes.push('Ипотека закрыта!');
    if (e.type === 'deadline') notes.push('Дедлайн кампании истёк.');
  }
  rep.notes = notes;

  run = null;
  state.run = null;
  persist();

  if (state.status === 'won') return showVictory();
  if (state.status === 'seized') return showForeclosed();
  showTown(rep);
}

function score() {
  const s = ECONOMY.scoring || { perMeter: 2, perMoney: 0.05, perRun: 25 };
  return Math.round(
    (state.records.totalEarnings || 0) * (s.perMoney || 0.05) +
      (state.records.bestDepth || 0) * (s.perMeter || 2) +
      (state.records.totalRuns || 0) * (s.perRun || 25),
  );
}

function showVictory() {
  screen = 'end';
  modal({
    title: 'Ипотека закрыта!',
    body: `<p class="hint">Ферма снова ваша. Льюис выдохнул и пошёл пить чай.</p>
      <div class="row"><span>Забегов</span><b>${state.runs || state.day}</b></div>
      <div class="row"><span>Лучшая глубина</span><b>${Math.round(state.bestDepth || 0)} м</b></div>
      <div class="row"><span>Заработано всего</span><b>${money(state.totalIncome || 0)}</b></div>
      <div class="row"><span>Счёт</span><b>${money(score())}</b></div>`,
    actions: [
      {
        label: 'Свободная игра',
        primary: true,
        onClick: () => {
          state.mode = 'freeplay';
          state.status = 'playing';
          state.debt = 0;
          state.cash = newGame({ mode: 'free' }).cash;
          makeRun();
          persist();
        },
      },
      { label: 'Заново', onClick: () => startNewGame('campaign', state.hardcore) },
      { label: 'В меню', onClick: () => openMenu() },
    ],
  });
}

function showForeclosed() {
  screen = 'end';
  modal({
    title: 'Ферма отчуждена',
    body: `<p class="hint">Три пропуска подряд — банк забрал участок вместе с буровой.</p>
      <div class="row"><span>Забегов</span><b>${state.runs || state.day}</b></div>
      <div class="row"><span>Лучшая глубина</span><b>${Math.round(state.bestDepth || 0)} м</b></div>
      <div class="row"><span>Заработано всего</span><b>${money(state.totalIncome || 0)}</b></div>
      <div class="row"><span>Долг на момент отчуждения</span><b>${money(state.debt)}</b></div>
      <div class="row"><span>Счёт</span><b>${money(score())}</b></div>`,
    actions: [
      { label: 'Заново', primary: true, onClick: () => startNewGame('campaign', false) },
      { label: 'В меню', onClick: () => openMenu() },
    ],
  });
}

function openMenu() {
  screen = 'menu';
  run = null;
  show('menu');
  updateMenu();
}

/**
 * «Продолжить»: сначала статус партии. Отчуждённая ферма и закрытая ипотека
 * показывают свой финальный экран, а не город — иначе после перезагрузки
 * можно было бы спокойно копать дальше (баг ревью №2).
 */
function continueGame() {
  if (!state) state = loadState(storage);
  if (!state) return startNewGame('campaign', false);
  if (state.status === 'won') return showVictory();
  if (state.status === 'seized') return showForeclosed();
  if (state.run) return resume();
  // В городе мир не нужен до спуска, но он должен быть один и тот же: берём
  // его из сейва (IDIGIT-14), а не случайный.
  world = mineWorld(state);
  run = null;
  showTown(null);
}

function updateMenu() {
  const saved = loadState(storage);
  const cont = $('btn-continue');
  cont.classList.toggle('hidden', !saved);
  const stats = $('menu-stats');
  if (!saved) {
    stats.textContent = 'Сохранений нет. Начните новую игру.';
    return;
  }
  cont.textContent =
    saved.status === 'won' ? 'Итог: ипотека закрыта' : saved.status === 'seized' ? 'Итог: ферма отчуждена' : 'Продолжить';
  const modeName = saved.mode === 'freeplay' ? 'Свободная игра' : 'Кампания';
  stats.textContent = `${modeName} · день ${saved.day} · ${money(saved.cash)} · долг ${money(
    saved.debt,
  )} · лучшая глубина ${Math.round(saved.bestDepth || 0)} м${saved.run ? ' · есть незаконченный забег' : ''}`;
}

// ─── игровой цикл ─────────────────────────────────────────────────────────
function readInput() {
  input.left = touch.left || keys.has('ArrowLeft') || keys.has('a') || keys.has('ф');
  input.right = touch.right || keys.has('ArrowRight') || keys.has('d') || keys.has('в');
  input.down = touch.down || keys.has('ArrowDown') || keys.has('s') || keys.has('ы');
  input.rocket = touch.rocket || keys.has(' ') || keys.has('ArrowUp') || keys.has('w') || keys.has('ц');
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'pickup') {
      renderer.floatText(run.x + run.w / 2, run.y - 6, `+${money(e.price)}`, '#ffe6a8');
      hud.toast(`${e.name} в трюме (+${money(e.price)})`, 1400);
    } else if (e.type === 'dig') {
      renderer.spawnDigParticles(run, world, 2);
      renderer.shake = Math.min(1, renderer.shake + 0.12);
    } else if (e.type === 'cargo-full') {
      hud.toast('Трюм полон — жми ВВЕРХ (▲) или «Сброс»', 2600);
    } else if (e.type === 'pressure-high') {
      hud.toast('Давление выше рейтинга корпуса!', 2400);
    } else if (e.type === 'overheat') {
      hud.toast('Перегрев! Корпус плавится', 2200);
    } else if (e.type === 'death') {
      renderer.shake = 1;
    }
  }
}

function loop(ts) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000 || 0));
  lastTs = ts;

  if (screen === 'play' && run && world) {
    readInput();
    const events = stepRun(run, world, state, dt, input);
    handleEvents(events);
    renderer.invalidate(world.consumeDirty());
    renderer.draw(world, run, dt);

    hudAcc += dt;
    if (hudAcc > 0.1) {
      hudAcc = 0;
      hud.update(state, run);
    }

    saveAcc += dt;
    if (saveAcc > 4) {
      saveAcc = 0;
      persist();
    }

    if (!run.active) {
      hud.hideWarn();
      endRun();
    }
  }
}

// ─── ввод ─────────────────────────────────────────────────────────────────
function bindControls() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (screen === 'play') pauseToMenu();
      return;
    }
    if (screen !== 'play') return;
    if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
    keys.add(e.key);
    if (e.key === '1') useGear('capsule');
    if (e.key === '2') useGear('coolant');
    if (e.key === '3') useGear('repairKit');
    if (e.key === 'r' || e.key === 'R') dropCheapest();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key));
  window.addEventListener('blur', () => {
    keys.clear();
    holds.releaseAll();
    for (const btn of document.querySelectorAll('[data-hold]')) btn.classList.remove('on');
  });

  // Все кнопки удержания (▲◀▼▶ и БУР/ВВЕРХ) вешаются одинаково:
  // захват указателя на pointerdown, снятие только на pointerup/pointercancel/
  // lostpointercapture. pointerleave намеренно не слушаем — из-за него палец,
  // сползший с кнопки, обрывал движение (баг IDIGIT-10).
  for (const btn of document.querySelectorAll('[data-hold]')) {
    bindHoldButton(btn, btn.dataset.hold, holds);
  }

  $('gear-dock').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-use]');
    if (btn) useGear(btn.dataset.use);
  });
  $('btn-dump').onclick = dropCheapest;

  $('btn-pause').onclick = pauseToMenu;
  window.addEventListener('resize', () => {
    renderer.resize();
    if (screen === 'play' && run) renderer.draw(world, run, 0);
  });
  window.addEventListener('orientationchange', () => setTimeout(() => renderer.resize(), 250));
}

function useGear(kind) {
  if (!run || screen !== 'play') return;
  const res = useConsumable(run, kind);
  if (!res.ok) {
    const msg = {
      empty: 'Этого расходника нет',
      active: kind === 'capsule' ? 'Капсула уже работает' : 'Смесь уже залита',
      used: 'Ремонтный набор уже израсходован',
      healthy: 'Корпус ещё крепкий (набор нужен ниже 35% HP)',
    }[res.reason];
    if (msg) hud.toast(msg, 1800);
    return;
  }
  hud.toast(
    kind === 'capsule'
      ? 'Капсула давления: +0.55 бара'
      : kind === 'coolant'
        ? 'Смесь залита: теплоотвод ×1.9'
        : 'Корпус залатан на 40%',
    1800,
  );
}

function dropCheapest() {
  if (!run || screen !== 'play') return;
  const dropped = dumpCheapest(run);
  if (dropped) hud.toast(`Сброшено: ${dropped.name} (${money(dropped.value)})`, 1600);
  else hud.toast('Трюм пуст', 1200);
}

function pauseToMenu() {
  persist();
  keys.clear();
  holds.releaseAll();
  for (const btn of document.querySelectorAll('[data-hold]')) btn.classList.remove('on');
  openMenu();
}

// ─── отладка (для тестера: ?debug=1) ──────────────────────────────────────
function devActions() {
  const bar = $('devbar');
  const visible = new URLSearchParams(location.search).get('debug') === '1';
  bar.classList.toggle('hidden', !visible);
  $('btn-dev').classList.toggle('hidden', !visible);
  $('btn-dev').onclick = () => bar.classList.toggle('hidden');

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-dev]');
    if (!btn || screen !== 'play' || !run) return;
    const act = btn.dataset.dev;
    if (act === 'money') state.cash += 5000;
    if (act === 'tiers') {
      for (const id of Object.keys(state.tiers)) state.tiers[id] = Math.min(4, state.tiers[id] + 1);
      const after = statsFor(state.tiers);
      run.stats = after;
      run.maxHull = after.hp;
      run.hull = after.hp;
      run.fuel = after.tankLiters;
      state.machine = { fuel: after.tankLiters, hull: after.hp, depth: state.machine?.depth || 0 };
      syncMachine(state);
    }
    if (act === 'deep') {
      run.y = 1400 * 12 - run.h;
      for (let c = Math.floor(run.x / 8) - 2; c <= Math.floor(run.x / 8) + 4; c++) {
        for (let r = Math.floor(run.y / 8); r <= Math.floor((run.y + run.h + 12) / 8); r++) {
          world.digCell(c, r);
        }
      }
      renderer.invalidate(world.consumeDirty());
    }
    if (act === 'debt') {
      state.debt = 0;
      state.status = 'won';
      showVictory();
      return;
    }
    if (act === 'die') run.hull = 0;
    persist();
    hud.toast('Отладка применена', 1200);
  });
}

// ─── старт ────────────────────────────────────────────────────────────────
function boot() {
  state = loadState(storage);
  bindControls();
  devActions();
  exposeDebug();

  $('btn-new').onclick = () => startNewGame('campaign', $('chk-hardcore').checked);
  $('btn-free').onclick = () => startNewGame('free', $('chk-hardcore').checked);
  $('btn-continue').onclick = continueGame;
  $('btn-dive').onclick = () => {
    if (makeRun()) persist();
  };

  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tab-btn').forEach((x) => x.classList.toggle('active', x === b));
      for (const t of ['upgrades', 'gear', 'debt']) $('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
    };
  });

  openMenu();
  // Финальные статусы видно сразу при загрузке, а не только после «Продолжить»:
  // отчуждённая ферма и закрытая ипотека не должны выглядеть как обычная партия.
  if (state && state.status === 'seized') showForeclosed();
  else if (state && state.status === 'won') showVictory();
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
