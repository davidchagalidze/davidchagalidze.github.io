/**
 * Точка входа: экраны, ввод, цикл, сохранение, сдача заказа.
 *
 * Механика — в src/game/*.mjs, здесь только склейка с DOM. Балансных чисел нет:
 * всё приходит из config.mjs (ECONOMY/RULES) через statsFor()/planOrder()/preview().
 */

import { ECONOMY, ENGINE, RULES } from './game/config.mjs';
import { createHud, money } from './ui/hud.mjs';
import { createShop } from './ui/shop.mjs';
import { createRenderer } from './render/renderer.mjs';
import { loadState, saveState, newGame, hopperCapacity } from './game/state.mjs';
import { createSession } from './game/session.mjs';
import { gridStats, serializeGrid } from './game/grid.mjs';
import { statsFor, nextPrice, levelOf, axisById } from './game/upgrades.mjs';
import { availableOrders, makeOrder, nextUnlock, normalizeOrder, classDef } from './game/orders.mjs';
import { getItem } from './game/shapes.mjs';
import { settleOffline } from './game/idle.mjs';
import { planOrder } from './game/pay.mjs';
import { runAutopilot } from './game/autopilot.mjs';

const $ = (id) => document.getElementById(id);

function safeStorage() {
  try {
    const probe = '__sand_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const storage = safeStorage();
const app = {
  save: null,
  session: null,
  screen: 'menu',
  lastFrame: 0,
  hudAt: 0,
  saveAt: 0,
  frames: 0,
  spraying: false,
  touch: null,
  renderer: null,
  hud: null,
  shop: null,
  offlineReport: null,
};

// ─── утилиты UI ──────────────────────────────────────────────────────────────

function toast(text, kind = '') {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity .25s';
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

let modalOnClose = null;

function openModal({ title, body, actions = [], onClose = null }) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = body;
  const box = $('modal-actions');
  box.innerHTML = '';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = `btn ${action.primary ? 'primary' : ''}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      if (!action.keepOpen) closeModal();
      action.onClick?.();
    });
    box.appendChild(btn);
  }
  modalOnClose = onClose;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
  const cb = modalOnClose;
  modalOnClose = null;
  cb?.();
}

// ─── состояние ───────────────────────────────────────────────────────────────

function persist() {
  if (!app.save) return;
  if (app.session) {
    app.save.hopperKg = app.session.hopperKg;
    app.save.current = { order: app.session.order, grid: serializeGrid(app.session.grid) };
  }
  // Без сессии current не трогаем: он мог быть восстановлен из сейва, а игрок ещё
  // не нажал «Продолжить». Иначе уход со страницы из меню стирал незакрытый заказ.
  saveState(storage, app.save);
}

function representativeOrder() {
  const list = availableOrders(app.save.completed, app.save.ordersDone);
  return list[list.length - 1] || makeOrder({ classId: 'class1', index: 0 });
}

function highestUnlockedClass() {
  const list = availableOrders(app.save.completed, app.save.ordersDone);
  return list.length ? list[list.length - 1].classId : 'class1';
}

function applyOffline() {
  const now = Date.now();
  const gap = now - (Number(app.save.lastSeen) || now);
  if (!(gap > 60_000) || levelOf(app.save.levels, 'hand') === 0) return;
  const report = settleOffline({ state: app.save, order: representativeOrder(), now });
  if (report.net > 0.5) {
    app.save.money += report.net;
    app.save.totalEarned += report.net;
    app.offlineReport = report;
  }
  app.save.lastSeen = now;
}

function startNewGame() {
  app.save = newGame({ now: Date.now() });
  app.session = null;
  persist();
}

// ─── экраны ──────────────────────────────────────────────────────────────────

function showMenu() {
  app.screen = 'menu';
  $('screen-menu').classList.remove('hidden');
  $('screen-game').classList.add('hidden');
  const s = app.save;
  const next = nextUnlock(s.completed);
  const rows = [
    ['Касса', money(s.money)],
    ['Заказов закрыто', String(s.ordersDone)],
    ['Класс', ECONOMY.orders[highestUnlockedClass()].label],
    ['Лучшая зачистка', `${s.bestClean.toFixed(1)}%`],
  ];
  if (next) rows.push([`Открыть «${classDef(next.classId).label}»`, `${next.have}/${next.need} заказов`]);
  $('menu-stats').innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('btn-continue').classList.toggle('hidden', !s.current);

  if (app.offlineReport) {
    const r = app.offlineReport;
    app.offlineReport = null;
    openModal({
      title: 'Пока вас не было',
      body: `
        <p class="hint">Наёмный рабочий брал сторонние заказы ${r.hours.toFixed(1)} ч${r.capped ? ' (потолок 8 ч)' : ''}.</p>
        <div class="kv"><span>Заказов сделано</span><b>${r.orders.toFixed(2)}</b></div>
        <div class="kv"><span>Выручка</span><b>${money(r.gross)}</b></div>
        <div class="kv minus"><span>Песок и свет</span><b>−${money(r.consumables)}</b></div>
        <div class="kv minus"><span>Аренда камеры</span><b>−${money(r.booth)}</b></div>
        <div class="kv minus"><span>Рабочему (${r.cellsPerSec} HP/с)</span><b>−${money(r.wage)}</b></div>
        <div class="kv minus"><span>Обслуживание</span><b>−${money(r.upkeep)}</b></div>
        <div class="kv total"><span>Чистыми</span><b>${money(r.net)}</b></div>
        <p class="hint small">Оффлайн ограничен одним заказом вашего класса: игра руками всё равно выгоднее.</p>`,
      actions: [{ label: 'В цех', primary: true }],
    });
  }
}

function showGame() {
  app.screen = 'game';
  $('screen-menu').classList.add('hidden');
  $('screen-game').classList.remove('hidden');
  app.renderer.resize();
}

// ─── заказы ──────────────────────────────────────────────────────────────────

function orderSelect() {
  const s = app.save;
  const list = availableOrders(s.completed, s.ordersDone);
  const next = nextUnlock(s.completed);
  const body = [
    '<p class="hint">Оплата — за процент зачистки; песок, свет, аренда камеры и обслуживание вычитаются при сдаче. Держать гашетку дольше нужного — платить аренду за воздух.</p>',
    '<div class="orders">',
    ...list.map((o, i) => {
      const plan = planOrder({ order: o, levels: s.levels });
      const mix = Object.entries(o.dirtMix)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${ECONOMY.dirt[k].label?.toLowerCase?.() || k} ${Math.round(v * 100)}%`)
        .join(' · ');
      return `<button class="order" data-order="${i}">
        <span class="o-title">${ECONOMY.orders[o.classId].label} · ${getItem(o.itemId).label}</span>
        <span class="o-pay"><b>${money(o.base)}</b><span>≈ ${plan.cycleSec.toFixed(0)} с · чистыми ${money(plan.net)}</span></span>
        <span class="o-meta">${mix} · ${ECONOMY.materials[o.material].label} · ${o.cells.toLocaleString('ru-RU')} клеток</span>
      </button>`;
    }),
    next
      ? `<div class="order locked"><span class="o-title">${classDef(next.classId).label}</span>
           <span class="o-pay"><b>🔒</b><span>после ${next.need} заказов</span></span>
           <span class="o-meta">закрыто ${next.have} из ${next.need} · откроется автоматически</span></div>`
      : '',
    '</div>',
  ].join('');

  openModal({ title: 'Доска заказов', body, actions: [{ label: 'Цех', onClick: openShop }] });
  $('modal-body')
    .querySelectorAll('[data-order]')
    .forEach((btn) =>
      btn.addEventListener('click', () => {
        const order = list[Number(btn.dataset.order)];
        closeModal();
        beginOrder(order);
      }),
    );
}

function beginOrder(order) {
  const s = app.save;
  const saved = s.current && s.current.order && s.current.order.classId === order.classId && s.current.order.seed === order.seed ? s.current : null;
  const session = createSession({ order, save: { levels: s.levels, hopperKg: s.hopperKg } });
  if (saved) session.restore(saved.grid);
  app.session = session;
  app.renderer.prepareOrder(session);
  app.renderer.drawMask(session);
  showGame();
  app.hud.update({ session, save: s });
  persist();
}

// ─── сдача заказа ────────────────────────────────────────────────────────────

function openDelivery() {
  const session = app.session;
  if (!session) return;
  const b = session.preview();
  if (!b.deliverable) {
    toast(`Нужно ≥${ENGINE.minDeliverPct}% зачистки`, 'bad');
    return;
  }
  const rows = [
    ['База заказа', money(b.base)],
    [`Зачистка ${b.cleanPct.toFixed(1)}% · кривая ^${ECONOMY.pay.curve}`, money(b.gross)],
    b.bonus > 0 ? [`Бонус за 100% (+${Math.round(ECONOMY.pay.bonus100 * 100)}%)`, `+${money(b.bonus)}`] : null,
    b.penalty > 0.005 ? ['Штраф за вмятины', `−${money(b.penalty)}`] : null,
    [`Песок ${b.abrasiveKg.toFixed(1)} кг`, `−${money(b.sandCost)}`],
    [`Свет ${b.kwh.toFixed(2)} кВт·ч`, `−${money(b.powerCost)}`],
    [`Аренда камеры ${b.cycleSec.toFixed(0)} с`, `−${money(b.boothCost)}`],
    b.wageCost > 0 ? ['Наёмный рабочий', `−${money(b.wageCost)}`] : null,
    [`Обслуживание (${b.upkeep.toFixed(2)})`, `−${money(b.upkeep)}`],
  ].filter(Boolean);

  const body = `
    <div class="kv head"><span>Статья</span><b>Сумма</b></div>
    ${rows.map(([k, v]) => `<div class="kv ${String(v).startsWith('−') ? 'minus' : ''}"><span>${k}</span><b>${v}</b></div>`).join('')}
    <div class="kv total"><span>Чистыми на кассу</span><b>${money(b.net)}</b></div>
    <p class="hint small">Струя ${b.elapsed.toFixed(0)} с, смета ${b.planSeconds.toFixed(0)} с.${
      b.damageRatio > 0.01 ? ` Вмятины: ${(b.damageRatio * 100).toFixed(0)}% нормы.` : ''
    } ${b.cleanPct >= ENGINE.cleanFullPct ? 'Идеальная зачистка: бонус уже в сумме.' : `До 100% осталось ${(100 - b.cleanPct).toFixed(1)}% — добор стоит дороже, чем платит.`}</p>`;

  openModal({
    title: 'Сдать заказ',
    body,
    actions: [{ label: 'Ещё почистить' }, { label: `Подтвердить · ${money(b.net)}`, primary: true, onClick: () => applyDelivery(b) }],
  });
}

function applyDelivery(b) {
  const s = app.save;
  const session = app.session;
  if (!s || !session) return;
  const classId = session.order.classId;
  s.money = Math.max(0, s.money + b.net);
  s.completed[classId] = (s.completed[classId] || 0) + 1;
  s.ordersDone += 1;
  s.totalEarned += Math.max(0, b.net);
  s.bestClean = Math.max(s.bestClean, b.cleanPct);
  s.hopperKg = Math.min(session.stats.capacityKg, session.hopperKg + b.abrasiveKg * session.stats.returnPct);
  s.lifetime.spraySeconds += b.elapsed || 0;
  s.lifetime.abrasiveKg += b.abrasiveKg;
  s.lifetime.energyKwh += b.kwh;
  s.lifetime.dents += b.damageRatio || 0;
  const unlockedBefore = availableOrders({ ...s.completed, [classId]: s.completed[classId] - 1 }, s.ordersDone - 1).length;
  const unlockedAfter = availableOrders(s.completed, s.ordersDone).length;
  app.session = null;
  s.current = null;
  persist();

  const newClass = unlockedAfter > unlockedBefore ? availableOrders(s.completed, s.ordersDone).slice(-1)[0]?.classId : null;
  openModal({
    title: b.cleanPct >= ENGINE.cleanFullPct ? 'Идеально' : 'Заказ закрыт',
    body: `
      <div class="kv"><span>Зачистка</span><b>${b.cleanPct.toFixed(1)}%</b></div>
      <div class="kv"><span>Чистыми за заказ</span><b>${money(b.net)}</b></div>
      <div class="kv"><span>В кассе</span><b>${money(s.money)}</b></div>
      ${newClass ? `<p class="hint">Открыт новый класс заказов: <b>${classDef(newClass).label}</b>.</p>` : ''}
      <p class="hint small">Пора в цех: апгрейд окупается за пару заказов, если брать его под следующий класс.</p>`,
    actions: [
      { label: 'Цех', onClick: openShop },
      { label: 'Следующий заказ', primary: true, onClick: orderSelect },
    ],
  });
}

// ─── цех ─────────────────────────────────────────────────────────────────────

function openShop() {
  app.shop.render({ save: app.save, order: app.session?.order || representativeOrder(), hopperKg: app.session?.hopperKg ?? app.save.hopperKg });
  $('sheet').classList.remove('hidden');
}

function closeShop() {
  $('sheet').classList.add('hidden');
}

function buyAxis(id) {
  const s = app.save;
  const price = nextPrice(s.levels, id);
  if (price == null) return;
  if (s.money < price) {
    toast('Не хватает денег', 'bad');
    return;
  }
  s.money -= price;
  s.levels[id] = levelOf(s.levels, id) + 1;
  if (id === 'hopper') s.hopperKg = Math.min(s.hopperKg, hopperCapacity(s));
  if (app.session) app.session.refreshStats(s.levels);
  persist();
  app.shop.render({ save: s, order: app.session?.order || representativeOrder(), hopperKg: app.session?.hopperKg ?? s.hopperKg });
  if (app.session) app.hud.update({ session: app.session, save: s });
  toast(`${axisById(id).label}: тир ${s.levels[id]}`, 'ok');
}

function refillTank() {
  if (!app.session) return;
  const res = app.session.refill();
  if (res.added <= 0) {
    toast('Бак полон', 'bad');
    return;
  }
  persist();
  app.hud.update({ session: app.session, save: app.save });
  toast(`+${res.added.toFixed(1)} кг · простой ${res.downtime} с`, 'ok');
}

// ─── ввод ────────────────────────────────────────────────────────────────────

function applyPointerAim(ev) {
  const session = app.session;
  if (!session) return;
  const renderer = app.renderer;
  if (ev.pointerType === 'touch') {
    if (!app.touch) return;
    const dx = ev.clientX - app.touch.startClientX;
    const dy = ev.clientY - app.touch.startClientY;
    const gain = 1.35; // палец тянет прицел быстрее — пятно уходит из-под пальца
    const start = app.touch.aimStart;
    session.setAim(start.x + dx * gain, start.y + dy * gain);
  } else {
    const p = renderer.worldFromClient(ev.clientX, ev.clientY);
    session.setAim(p.x, p.y);
    renderer.setHover(p.x, p.y);
  }
}

function setupInput() {
  const canvas = $('canvas');

  canvas.addEventListener('pointerdown', (ev) => {
    if (!app.session) return;
    ev.preventDefault();
    canvas.setPointerCapture?.(ev.pointerId);
    const p = app.renderer.worldFromClient(ev.clientX, ev.clientY);
    if (ev.pointerType === 'touch') {
      const lift = 62 / (app.renderer.view.scale || 1);
      app.touch = { startClientX: ev.clientX, startClientY: ev.clientY, aimStart: { x: p.x, y: Math.max(2, p.y - lift) } };
      app.session.setAim(p.x, Math.max(2, p.y - lift));
      app.renderer.setHover(p.x, Math.max(2, p.y - lift));
    } else {
      app.session.setAim(p.x, p.y);
      app.renderer.setHover(p.x, p.y);
    }
    app.spraying = true;
    app.session.setSpraying(true);
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!app.session) return;
    if (ev.pointerType === 'touch' && !app.spraying) return;
    ev.preventDefault?.();
    applyPointerAim(ev);
  });

  const stop = (ev) => {
    app.spraying = false;
    app.touch = null;
    app.session?.setSpraying(false);
    if (ev && ev.pointerId != null) {
      try {
        canvas.releasePointerCapture?.(ev.pointerId);
      } catch {
        /* указатель уже отпущен */
      }
    }
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('pointerleave', (ev) => {
    if (ev.pointerType === 'mouse') stop(ev);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      closeShop();
      if (!$('modal').classList.contains('hidden')) closeModal();
    }
    if (ev.key === ' ' && app.session) {
      ev.preventDefault();
      app.session.setSpraying(!app.session.sprayed);
    }
  });

  $('btn-play').addEventListener('click', orderSelect);
  $('btn-continue').addEventListener('click', () => {
    const cur = normalizeOrder(app.save.current?.order);
    if (cur) beginOrder(cur);
    else orderSelect();
  });
  $('btn-reset').addEventListener('click', () => {
    openModal({
      title: 'Сбросить прогресс?',
      body: '<p class="hint">Касса, апгрейды и открытые классы обнулятся.</p>',
      actions: [
        { label: 'Отмена' },
        {
          label: 'Сбросить',
          primary: true,
          onClick: () => {
            startNewGame();
            showMenu();
            toast('Прогресс сброшен');
          },
        },
      ],
    });
  });
  $('btn-shop-top').addEventListener('click', openShop);
  $('btn-sheet-close').addEventListener('click', closeShop);
  $('sheet').addEventListener('click', (e) => {
    if (e.target === $('sheet')) closeShop();
  });
  $('btn-deliver').addEventListener('click', openDelivery);
  $('btn-refill').addEventListener('click', refillTank);

  window.addEventListener('resize', () => app.renderer.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => app.renderer.resize(), 120));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persist();
    else {
      applyOffline();
      app.hud.update({ session: app.session, save: app.save });
    }
  });
  window.addEventListener('beforeunload', persist);
}

// ─── цикл ────────────────────────────────────────────────────────────────────

function frame(ts) {
  const dt = app.lastFrame ? Math.min(0.05, (ts - app.lastFrame) / 1000) : 1 / 60;
  app.lastFrame = ts;
  app.frames += 1;
  if (app.session && app.screen === 'game') {
    app.session.tick(dt, { now: ts });
    app.renderer.drawMask(app.session);
    app.renderer.draw(app.session, dt);
    if (ts - app.hudAt > 110) {
      app.hudAt = ts;
      app.hud.update({ session: app.session, save: app.save });
    }
    if (ts - app.saveAt > ENGINE.autosaveMs) {
      app.saveAt = ts;
      persist();
    }
  }
  requestAnimationFrame(frame);
}

// ─── отладочный доступ для приёмки ───────────────────────────────────────────

function installDebug() {
  window.__sand = {
    get version() {
      return 2;
    },
    get screen() {
      return app.screen;
    },
    get money() {
      return app.save.money;
    },
    get levels() {
      return { ...app.save.levels };
    },
    get stats() {
      const s = app.session ? app.session.stats : statsFor(app.save.levels);
      return {
        radiusCells: s.radiusCells,
        area: s.area,
        pressure: s.pressure,
        kW: s.kW,
        kgPerSec: s.kgPerSec,
        gradePrice: s.gradePrice,
        damageMult: s.damageMult,
        capacityKg: s.capacityKg,
        bulkDiscount: s.bulkDiscount,
        returnPct: s.returnPct,
        handCellsPerSec: s.handCellsPerSec,
        upkeep: s.upkeep,
        hpPerSec: s.hpPerSec(),
        kgPerHPAt: s.kgPerHPAt(),
      };
    },
    get order() {
      return app.session ? { ...app.session.order } : null;
    },
    get cleanPct() {
      return app.session ? gridStats(app.session.grid).cleanPct : 0;
    },
    get byType() {
      return app.session ? gridStats(app.session.grid).byType : null;
    },
    get hopperKg() {
      return app.session ? app.session.hopperKg : app.save.hopperKg;
    },
    get sandKg() {
      return app.session ? app.session.sandKg : 0;
    },
    get energyKwh() {
      return app.session ? app.session.energyKwh : 0;
    },
    get damageRatio() {
      return app.session ? app.session.damageRatio : 0;
    },
    get aim() {
      return app.session ? { ...app.session.aim } : null;
    },
    get beamAim() {
      return app.session ? { ...app.session.beamAim } : null;
    },
    get dry() {
      return app.session ? app.session.dry : false;
    },
    get view() {
      return { ...app.renderer.view };
    },
    get frames() {
      return app.frames;
    },
    get save() {
      return JSON.parse(JSON.stringify(app.save));
    },
    resize() {
      app.renderer.resize();
      return { ...app.renderer.view };
    },
    worldFromClient(x, y) {
      return app.renderer.worldFromClient(x, y);
    },
    plan(order = app.session?.order || representativeOrder()) {
      return planOrder({ order, levels: app.save.levels });
    },
    preview() {
      return app.session ? app.session.preview() : null;
    },
    takeOrder(classId = highestUnlockedClass(), index = app.save.ordersDone) {
      const order = makeOrder({ classId, index, salt: 'debug' });
      beginOrder(order);
      return order;
    },
    deliver() {
      if (!app.session) return { ok: false, error: 'нет заказа' };
      const res = app.session.deliver();
      if (res.ok) applyDelivery(res.breakdown);
      return res;
    },
    autoClean(targetPct = 95) {
      if (!app.session) return null;
      const res = runAutopilot(app.session, { targetPct, maxSeconds: 900 });
      app.renderer.drawMask(app.session);
      app.hud.update({ session: app.session, save: app.save });
      persist();
      return { seconds: res.seconds, cleanPct: res.cleanPct, reached: res.reached };
    },
    debug: {
      grant(amount) {
        app.save.money = Math.max(0, app.save.money + Number(amount || 0));
        persist();
        app.hud.update({ session: app.session, save: app.save });
        return app.save.money;
      },
      setHopper(kg) {
        if (app.session) app.session.hopperKg = Math.max(0, Math.min(app.session.stats.capacityKg, Number(kg)));
        else app.save.hopperKg = Math.max(0, Math.min(hopperCapacity(app.save), Number(kg)));
        persist();
        return app.session ? app.session.hopperKg : app.save.hopperKg;
      },
      setAim(x, y) {
        app.session?.setAim(Number(x), Number(y));
      },
      spray(on) {
        app.spraying = !!on;
        app.session?.setSpraying(!!on);
      },
      wipe() {
        for (const k of Object.keys(localStorage)) if (k.startsWith('sandblaster.')) localStorage.removeItem(k);
        location.reload();
      },
    },
  };
}

// ─── старт ───────────────────────────────────────────────────────────────────

let booted = false;

function boot() {
  if (booted) return;
  booted = true;
  const loaded = loadState(storage);
  app.save = loaded.state || newGame({ now: Date.now() });
  if (loaded.migrated && loaded.from) console.info(`[sandblaster] сейв мигрирован v${loaded.from} → v${app.save.save_version}`);
  if (!loaded.state) persist();

  app.renderer = createRenderer($('canvas'));
  app.hud = createHud(document);
  app.shop = createShop(document, { onBuy: buyAxis });

  applyOffline();
  setupInput();
  installDebug();
  showMenu();
  app.renderer.resize();
  requestAnimationFrame(frame);
  persist();

  if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[sandblaster] sw:', err.message));
  }
}

document.addEventListener('DOMContentLoaded', boot);
if (document.readyState === 'interactive' || document.readyState === 'complete') boot();
