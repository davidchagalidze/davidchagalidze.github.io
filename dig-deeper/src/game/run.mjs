/**
 * Забег: физика буровой машины, копание, сбор, давление, перегрев, смерть.
 *
 * Все числа — из модели дизайнера (src/model/model-v1.mjs через config/economy.mjs):
 *   скорость   — AXES.engine.speedDown/speedUp (м/с),
 *   топливо    — ECONOMY.fuel.burnBase × тир двигателя (л/с),
 *   давление   — DEPTH.pressureK · Δбар² · (1 + t/40),
 *   тепло      — DEPTH.mineHeat + heatPerUnit·rate − coolRate·(T−Tфона)/coolTau,
 *   цена руды  — oreValuePerUnit(глубина) × слоты × множитель находки,
 *   ипотека    — 40% выручки забирается банком прямо при продаже.
 *
 * Модуль не трогает DOM: его гоняют юнит-тесты и игровой цикл.
 */

import {
  DEPTH,
  ECONOMY,
  ENGINE,
  ambientTemp,
  layerAt,
  layerIndexAt,
  layerFatigue,
  mineRateAt,
  oreValuePerUnit,
  pressureAt,
  ratingForTier,
  repairCostPerHp,
} from '../config/economy.mjs';
import { addCargo, cargoValue, cargoValueAt, cargoWeight, lootType, rollUnitFactor, rollUnitValue } from '../config/loot.mjs';
import { computeStats } from '../config/upgrades.mjs';
import { MAT, TILE, isSolidMat } from '../engine/world.mjs';

const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * «Забой сухой»: столько секунд без прироста руды — участок выработан.
 * То же число, которым играет замер design/engine-parity.mjs (DRY_SECONDS).
 */
export const DRY_SECONDS = 2;

export function createRun(state, world) {
  const stats = computeStats(state.tiers);
  const machine = state.machine || {};
  // Стартовое состояние машины — то, до которого её довели в мастерской:
  // полный бак/корпус в новой игре, остатки — после забега.
  const startFuel = clamp(num(machine.fuel, stats.tankLiters), 0, stats.tankLiters);
  const startHull = clamp(num(machine.hull, stats.hp), 0.01, stats.hp);
  const w = 26;
  const h = 20;
  return {
    seed: world.seed,
    mode: state.mode,
    x: world.widthPx / 2 - w / 2,
    y: world.surfaceY - h,
    w,
    h,
    vy: 0,
    fuel: round2(startFuel),
    hull: round2(startHull),
    maxHull: stats.hp,
    startFuel: round2(startFuel),
    startHull: round2(startHull),
    temp: ambientTemp(0),
    stats,
    cargo: [],
    consumables: state.inventory,
    // Расходники действуют весь забег — как в модели.
    capsuleTimer: 0,
    coolantActive: false,
    repairKitUsed: false,
    mineCredit: 0,
    pressureTimer: 0,
    depth: 0,
    maxDepth: 0,
    time: 0,
    cellsDug: 0,
    mined: 0,
    /** Сколько секунд на забое не поднимается руда (HUD «забой сухой»). */
    lastMined: 0,
    drySec: 0,
    /** Находки, раздробленные буров или ракетой: места в трюме не было (R2). */
    lostLoot: 0,
    /** Выработка этого забега — дельта к world.dug на старте (сейв, §6). */
    dugDelta: new Set(),
    dugStart: new Set(world.dug),
    fuelUsed: 0,
    active: true,
    deathReason: null,
    pressureDps: 0,
    rocketOn: false,
    diggingDir: null,
    warnings: { pressure: -99, heat: -99, cargo: -99 },
    events: [],
  };
}

/** Рейтинг давления с учётом капсулы (щит +0.55 бара). */
export function effectiveRating(run) {
  const bonus = run.capsuleTimer > 0 ? ECONOMY.consumables.capsule.ratingBonus : 0;
  return run.stats.pressureRating + bonus;
}

export function consumableSlots(consumables) {
  return Object.values(consumables || {}).reduce((s, n) => s + Math.max(0, n || 0), 0);
}

/** Вместимость трюма под руду: слоты трюма минус занятые расходниками. */
export function cargoCapacity(run) {
  return Math.max(0, run.stats.cargoSlots - consumableSlots(run.consumables));
}

export function cargoUnits(run) {
  return cargoWeight(run.cargo);
}

export function isCargoFull(run) {
  return cargoUnits(run) >= cargoCapacity(run);
}

export function depthOf(run) {
  return Math.max(0, run.y + run.h) / DEPTH.pxPerMeter;
}

function bodyCols(run) {
  return [Math.floor((run.x + 1) / TILE), Math.floor((run.x + run.w - 1) / TILE)];
}

function bodyRows(run) {
  return [Math.floor((run.y + 1) / TILE), Math.floor((run.y + run.h - 1) / TILE)];
}

function canOccupy(world, x, y, w, h) {
  const c0 = Math.floor((x + 1) / TILE);
  const c1 = Math.floor((x + w - 1) / TILE);
  const r0 = Math.floor((y + 1) / TILE);
  const r1 = Math.floor((y + h - 1) / TILE);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (isSolidMat(world.getCell(c, r))) return false;
    }
  }
  return true;
}

function fluidContact(run, world) {
  let water = false;
  let magma = false;
  const [c0, c1] = bodyCols(run);
  const [r0, r1] = bodyRows(run);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const m = world.getCell(c, r);
      if (m === MAT.WATER) water = true;
      else if (m === MAT.MAGMA) magma = true;
    }
  }
  return { water, magma };
}

/**
 * Разрушить пачку ячеек. В модели копание не тратит топливо на ячейку — только время.
 * Каждая срезанная клетка попадает в дельту забега (для сейва) и в world.dug.
 */
function digCells(run, world, cells) {
  const out = [];
  for (const [c, r] of cells) {
    const mat = world.getCell(c, r);
    if (mat === MAT.BEDROCK || !isSolidMat(mat)) continue;
    const res = world.digCell(c, r);
    if (res.dug) {
      const id = c + ',' + r;
      run.dugDelta.add(id);
      out.push({ id, col: c, row: r, material: mat, loot: res.loot });
    }
  }
  run.cellsDug += out.length;
  return out;
}

/**
 * Находки из только что срезанных клеток: в трюм, если есть место, иначе
 * потеряны навсегда (R2: клетка отдаёт находку один раз). Раньше находка
 * оставалась лежать в чанке «неподобранной» и её можно было взять позже в том
 * же забеге — но после перезагрузки клетка уже воздух, и итог зависел от
 * перезагрузки. Цена считается как раньше: по глубине ячейки и усталости слоя.
 */
function collectDugLoot(run, world, dugOut, state, events) {
  for (const cell of dugOut) {
    const item = cell.loot;
    if (!item) continue;
    const type = lootType(item.typeId);
    if (!type) continue;
    if (cargoUnits(run) + type.slots > cargoCapacity(run)) {
      run.lostLoot += type.slots;
      events.push({ type: 'loot-lost', lootId: type.id, name: type.name });
      continue;
    }
    const depth = (item.row * TILE) / DEPTH.pxPerMeter;
    const layerIndex = layerIndexAt(depth);
    const layer = DEPTH.layers[layerIndex];
    const gap = Math.max(0, (layer?.hardness ?? 1) - run.stats.hardness);
    const quality = Math.max(DEPTH.hardnessQualityFloor, 1 - DEPTH.hardnessQuality * gap);
    const value = rollUnitValue(type, depth, world.seed, item.col, item.row, layerFatigue(state, layerIndex) * quality);
    // Множитель единицы (слоты × mult × разброс × жила) — цена глубины начислится
    // при продаже, по забойной глубине забега (см. sellCargo).
    const factor = rollUnitFactor(type, world.seed, item.col, item.row);

    run.mined += type.slots;
    addCargo(run.cargo, type.id, value, factor);
    events.push({ type: 'pickup', lootId: type.id, name: type.name, price: value });
  }
}

export function stepRun(run, world, state, dtRaw, input = {}) {
  const events = [];
  if (!run.active) return events;
  const dt = clamp(Number(dtRaw) || 0, 0, 0.05);
  if (dt === 0) return events;
  run.time += dt;

  const depth = depthOf(run);
  run.depth = depth;
  run.maxDepth = Math.max(run.maxDepth, depth);
  const layerIndex = layerIndexAt(depth);
  const layer = layerAt(depth);
  const touch = fluidContact(run, world);
  const full = isCargoFull(run);
  const dirX = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  const moving = !!input.down || dirX !== 0 || !!input.rocket;
  const mining = !!input.down || dirX !== 0;
  /** Сколько клеток срезано за этот шаг: только они и греют машину (IDIGIT-14). */
  let dugCellsStep = 0;

  // ── топливо: расход по времени, как в модели ────────────────────────────
  if (moving && run.fuel > 0) {
    const burn = run.stats.burnPerSec * (1 + (depth / 1000) * ECONOMY.fuel.depthBurnPer1000m);
    const used = burn * dt;
    run.fuel = Math.max(0, run.fuel - used);
    run.fuelUsed += used;
  }

  if (run.capsuleTimer > 0) run.capsuleTimer = Math.max(0, run.capsuleTimer - dt);

  // ── скорость: тир двигателя, вес трюма, твёрдость породы ───────────────
  const hardGap = Math.max(0, (layer?.hardness ?? 1) - run.stats.hardness);
  const hardPenalty = hardGap > 0 ? DEPTH.hardnessPenalty : 1;
  const downPx = run.stats.speedDown * DEPTH.pxPerMeter * hardPenalty;
  const upPx = run.stats.speedUp * DEPTH.pxPerMeter;

  run.rocketOn = !!input.rocket && run.fuel > 0;
  run.diggingDir = input.down ? 'down' : dirX > 0 ? 'right' : dirX < 0 ? 'left' : null;

  // ── бур: пока копаем, идёт счётчик работы бура (HUD/статистика) ────────
  // На сбор не влияет: находку отдаёт срезанная клетка (см. collectDugLoot).
  if (mining && !full) {
    run.mineCredit = Math.min(12, run.mineCredit + mineRateAt(run.stats, layer) * dt);
  }

  if (input.rocket) {
    if (run.fuel > 0) {
      const dy = upPx * dt;
      const ny = run.y - dy;
      const row = Math.floor(ny / TILE);
      const [c0, c1] = bodyCols(run);
      const cells = [];
      for (let c = c0; c <= c1; c++) cells.push([c, row]);
      const blocked = cells.some(([c]) => world.getCell(c, row) === MAT.BEDROCK);
      if (!blocked) {
        const dugUp = digCells(run, world, cells);
        dugCellsStep += dugUp.length;
        // Ракета режет породу, а не аккуратно поднимает груз: находки в её
        // пути раздроблены (R2/IDIGIT-13). В трюм попадёт только то, на что
        // хватило места.
        collectDugLoot(run, world, dugUp, state, events);
        run.y = ny;
      }
      run.vy = 0;
      if (run.y + run.h <= world.surfaceY) {
        run.y = world.surfaceY - run.h;
        run.active = false;
        events.push({ type: 'surface' });
      }
    }
  } else if (input.down) {
    if (full) {
      if (run.time - run.warnings.cargo > 1.2) {
        run.warnings.cargo = run.time;
        events.push({ type: 'cargo-full' });
      }
    } else {
      const dy = downPx * dt;
      const row = Math.floor((run.y + run.h + dy) / TILE);
      const [c0, c1] = bodyCols(run);
      const cells = [];
      for (let c = c0; c <= c1; c++) cells.push([c, row]);
      const blocked = cells.some(([c]) => world.getCell(c, row) === MAT.BEDROCK);
      if (!blocked) {
        const dugOut = digCells(run, world, cells);
        dugCellsStep += dugOut.length;
        collectDugLoot(run, world, dugOut, state, events);
        run.y += dy;
        if (dugOut.length) events.push({ type: 'dig', cells: dugOut.length });
      }
    }
    run.vy = 0;
  } else {
    run.vy = Math.min(420, run.vy + 900 * dt);
    const ny = run.y + run.vy * dt;
    if (canOccupy(world, run.x, ny, run.w, run.h)) run.y = ny;
    else run.vy = 0;
  }

  // ── горизонталь ────────────────────────────────────────────────────────
  if (dirX !== 0) {
    const speed = (run.stats.speedDown * DEPTH.pxPerMeter * hardPenalty) * (touch.water ? 0.6 : 1);
    const dx = dirX * speed * dt;
    const nx = clamp(run.x + dx, 2 * TILE, world.widthPx - 2 * TILE - run.w);
    const col = dirX > 0 ? Math.floor((nx + run.w) / TILE) : Math.floor(nx / TILE);
    const [r0, r1] = bodyRows(run);
    const cells = [];
    for (let r = r0; r <= r1; r++) cells.push([col, r]);
    const blocked = cells.some(([c, r]) => world.getCell(c, r) === MAT.BEDROCK);
    if (!blocked) {
      if (!full) {
        const dugOut = digCells(run, world, cells);
        dugCellsStep += dugOut.length;
        collectDugLoot(run, world, dugOut, state, events);
        if (dugOut.length) events.push({ type: 'dig', cells: dugOut.length });
      }
      run.x = nx;
    }
  }

  // ── забой сухой: сколько времени на забое нет прироста руды ────────────
  if (run.mined > run.lastMined) {
    run.lastMined = run.mined;
    run.drySec = 0;
  } else {
    run.drySec += dt;
  }

  // ── тепло: ODE модели. Греет СРЕЗАННАЯ ПОРОДА, а не нажатие «вниз»:
  // спуск по уже пробитому стволу не должен перегревать машину
  // (постоянный мир делает это видимым — IDIGIT-14, баг движка №1).
  const coolMult = run.coolantActive ? ECONOMY.consumables.coolant.coolMult : 1;
  const coolRate = run.stats.coolRate * coolMult;
  const ambient = ambientTemp(depth);
  const heatIn = dugCellsStep > 0 ? DEPTH.mineHeat + DEPTH.heatPerUnit * run.stats.rate : 0;
  let tempFlow = heatIn - (coolRate * (run.temp - ambient)) / DEPTH.coolTau;
  if (touch.water) tempFlow -= DEPTH.waterCoolPerSec;
  if (touch.magma) tempFlow += DEPTH.magmaHeatPerSec;
  run.temp = Math.max(-20, run.temp + tempFlow * dt);

  // ── давление: формула модели с усталостью корпуса ──────────────────────
  const rating = effectiveRating(run);
  const bar = pressureAt(depth);
  let dps = 0;
  if (bar > rating) {
    run.pressureTimer += dt;
    dps = DEPTH.pressureK * Math.pow(bar - rating, DEPTH.pressureExp) * (1 + run.pressureTimer / DEPTH.pressureFatigueTau);
    run.hull = Math.max(0, run.hull - dps * dt);
    if (run.time - run.warnings.pressure > 1.5) {
      run.warnings.pressure = run.time;
      events.push({ type: 'pressure-high', dps });
    }
  } else if (run.pressureTimer > 0) {
    run.pressureTimer = Math.max(0, run.pressureTimer - 3 * dt);
  }
  run.pressureDps = dps;

  // ── перегрев ───────────────────────────────────────────────────────────
  if (run.temp > run.stats.maxTemp) {
    const dmg = DEPTH.overheatDps * (run.temp - run.stats.maxTemp);
    run.hull = Math.max(0, run.hull - dmg * dt);
    if (run.time - run.warnings.heat > 1.5) {
      run.warnings.heat = run.time;
      events.push({ type: 'overheat' });
    }
  }
  if (touch.magma && run.time - run.warnings.heat > 1.5) {
    run.warnings.heat = run.time;
    events.push({ type: 'magma' });
  }

  // ── смерть ─────────────────────────────────────────────────────────────
  if (run.hull <= 0) {
    run.hull = 0;
    run.active = false;
    run.deathReason = run.temp > run.stats.maxTemp ? 'heat' : 'pressure';
    events.push({ type: 'death', reason: run.deathReason });
  } else if (run.fuel <= 0 && depth > 1) {
    run.active = false;
    run.deathReason = 'fuel';
    events.push({ type: 'death', reason: 'fuel' });
  }

  run.events.push(...events);
  return events;
}

/** Использовать расходник. Возвращает { ok, reason? }. */
export function useConsumable(run, kind) {
  const cfg = ECONOMY.consumables[kind];
  if (!cfg) return { ok: false, reason: 'unknown' };
  if (!run.consumables[kind] || run.consumables[kind] <= 0) return { ok: false, reason: 'empty' };
  if (kind === 'capsule' && run.capsuleTimer > 0) return { ok: false, reason: 'active' };
  if (kind === 'coolant' && run.coolantActive) return { ok: false, reason: 'active' };
  if (kind === 'repairKit' && (run.repairKitUsed || run.hull > run.maxHull * 0.35)) {
    return { ok: false, reason: run.repairKitUsed ? 'used' : 'healthy' };
  }
  run.consumables[kind] -= 1;
  if (kind === 'capsule') run.capsuleTimer = DEPTH.maxRunSeconds;
  if (kind === 'coolant') run.coolantActive = true;
  if (kind === 'repairKit') {
    run.hull = Math.min(run.maxHull, run.hull + run.maxHull * cfg.healFrac);
    run.repairKitUsed = true;
  }
  return { ok: true };
}

/**
 * Цена единицы руды на забое забега — по глубине, до которой дошли (run.maxDepth),
 * а не по глубине ячейки, из которой руда выкопана. Ровно как в модели дизайнера
 * (simulateRun: priceUnit = oreValuePerUnit(targetDepth)); карточка IDIGIT-11.
 */
export function facePriceFor(state, run) {
  const face = Math.max(0, Number(run.maxDepth) || 0);
  const faceLayerIndex = layerIndexAt(face);
  const faceLayer = DEPTH.layers[faceLayerIndex];
  const faceGap = Math.max(0, (faceLayer?.hardness ?? 1) - (run.stats?.hardness ?? 1));
  const faceQuality = Math.max(DEPTH.hardnessQualityFloor, 1 - DEPTH.hardnessQuality * faceGap);
  return oreValuePerUnit(face) * faceQuality * layerFatigue(state, faceLayerIndex);
}

/**
 * Продажа груза: цена по забою (см. facePriceFor), банк сразу забирает 40%
 * выручки (не больше остатка долга) — как в playDay модели.
 */
export function sellCargo(state, run) {
  const { total, lines } = cargoValueAt(run.cargo, facePriceFor(state, run));
  if (total <= 0) return { total: 0, lines: [], bankShare: 0, cash: 0 };
  const share =
    state.mode === 'freeplay' ? 0 : round2(Math.min(total * ECONOMY.mortgage.share, Math.max(0, state.debt)));
  state.debt = round2(Math.max(0, state.debt - share));
  state.debtPaid = round2((state.debtPaid || 0) + share);
  state.windowPaid = round2((state.windowPaid || 0) + share);
  state.totalBank = round2((state.totalBank || 0) + share);
  const cash = round2(total - share);
  state.cash = round2((state.cash || 0) + cash);
  state.totalIncome = round2((state.totalIncome || 0) + total);
  state.lastFiveGross = [...(state.lastFiveGross || []), total].slice(-ECONOMY.mortgage.paymentEveryRuns);
  const layerIndex = layerIndexAt(run.maxDepth || 0);
  // Истощение слоя считается по ПРОДАННЫМ единицам: сброшенная в шахте руда
  // слой не обедняет, иначе цена падает до пола вдвое быстрее, чем игрок зарабатывает.
  state.layerMined[layerIndex] = round2((state.layerMined[layerIndex] || 0) + cargoWeight(run.cargo));
  run.cargo = [];
  return { total, lines, bankShare: share, cash };
}

export function missingFuel(run) {
  return Math.max(0, Math.ceil(run.stats.tankLiters - run.fuel));
}

export function missingHull(run) {
  return Math.max(0, Math.ceil(run.maxHull - run.hull));
}

/**
 * Смерть: груз теряется, банк и апгрейды остаются, корпус ремонтируют,
 * за эвакуацию берут towFee (нехватка уходит в долг, в минус не уходим).
 */
export function applyDeath(state, run) {
  // Потерянный груз оцениваем по забою — по той же цене, по которой он был бы продан.
  const lost = cargoValueAt(run.cargo, facePriceFor(state, run));
  run.cargo = [];
  const fee = ECONOMY.death.towFee;
  state.totalTow = round2((state.totalTow || 0) + fee);
  if (state.cash >= fee) {
    state.cash = round2(state.cash - fee);
  } else {
    const deficit = round2(fee - state.cash);
    state.cash = 0;
    if (state.mode === 'campaign') state.debt = round2(state.debt + deficit);
  }
  if (state.hardcore) {
    const axes = Object.entries(state.tiers).filter(([, t]) => t > 0);
    if (axes.length) {
      axes.sort((a, b) => b[1] - a[1]);
      state.tiers[axes[0][0]] = Math.max(0, axes[0][1] - 1);
    }
  }
  run.hull = run.maxHull;
  run.fuel = 0;
  run.temp = ambientTemp(0);
  run.capsuleTimer = 0;
  run.coolantActive = false;
  run.repairKitUsed = false;
  run.pressureTimer = 0;
  run.y = world_surface(run);
  run.depth = 0;
  state.records.deaths = (state.records.deaths || 0) + 1;
  return lost;
}

function world_surface(run) {
  return DEPTH.tile - run.h;
}

export function runReport(run) {
  const value = cargoValue(run.cargo);
  return {
    depth: Math.round(run.maxDepth),
    cargoValue: value.total,
    cargoLines: value.lines,
    cellsDug: run.cellsDug,
    fuelLeft: Math.round(run.fuel),
    hullLeft: Math.round(run.hull),
    died: !!run.deathReason,
    deathReason: run.deathReason,
    mined: Math.round(run.mined * 10) / 10,
  };
}

/**
 * Сбросить самый дешёвый стек — освободить трюм в глубине.
 * Сравнение историческое, по цене ячейки (unitValue): выбор «что выбросить»
 * в политике бота — отдельная тема, карточка IDIGIT-11 её не трогает.
 */
export function dumpCheapest(run) {
  if (!run.cargo.length) return null;
  let worst = null;
  for (const item of run.cargo) {
    const value = (item.unitValue || 0) * item.count;
    if (!worst || value < worst.value) worst = { item, value };
  }
  if (!worst) return null;
  const type = lootType(worst.item.typeId);
  run.cargo = run.cargo.filter((c) => c !== worst.item);
  return { typeId: worst.item.typeId, count: worst.item.count, name: type ? type.name : '?', value: worst.value };
}

export { cargoValue, cargoWeight, ratingForTier, repairCostPerHp, ENGINE };
