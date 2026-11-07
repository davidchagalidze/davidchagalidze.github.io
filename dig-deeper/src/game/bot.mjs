/**
 * Бот-игрок для дымовых прогонов баланса и тестов.
 * Играет «на свою глубину»: идёт к цели, по дороге выбрасывает дешёвую руду
 * (иначе мелкий трюм заполняется у поверхности — ровно та тактика, которую
 * модель дизайнера описывает как «добыча на глубине»), набирает полный трюм
 * на целевой глубине и уходит ракетой.
 */

import { ECONOMY, fuelNeeded, oreValuePerUnit, safeDepthForRating } from '../config/economy.mjs';
import { cargoValue, lootType } from '../config/loot.mjs';
import { MAT, TILE } from '../engine/world.mjs';
import { DRY_SECONDS, dumpCheapest, isCargoFull, stepRun } from './run.mjs';

export function botTarget(run, { caution = 0.9 } = {}) {
  const safe = safeDepthForRating(run.stats.pressureRating);
  return Math.max(10, safe * caution);
}

/** Самая дешёвая единица груза: множитель за слот (цена глубины у всех одна — забойная). */
function cheapestPerSlot(run) {
  let worst = null;
  for (const item of run.cargo) {
    const type = lootType(item.typeId);
    if (!type) continue;
    // На продаже единица стоит facePrice × factor, а facePrice у всего трюма
    // общий, поэтому «дешёвая» = меньший factor на слот. Старое сравнение по
    // unitValue (цена ячейки) после перехода на забойную цену врало.
    const perSlot = item.factor != null
      ? item.factor / Math.max(1, type.slots)
      : (item.unitValue || 0) / Math.max(1, type.slots);
    if (!worst || perSlot < worst.perSlot) worst = { item, perSlot };
  }
  return worst;
}

/** Пора наверх? Топливо на обратный путь, перегрев, корпус, полный трюм у цели. */
export function mustSurface(run, policy = {}) {
  if (!run.active) return false;
  const { heatRatio = 0.92, hullFloor = 0.35, cargoCare = true, dumpJunk = true } = policy;
  const target = botTarget(run, policy);
  // Ресурсы проверяются на ЛЮБОЙ глубине. Раньше стояли после early-return
  // «дошёл до цели» — и бот на своей глубине игнорировал перегрев и умирал.
  if (run.fuel <= fuelNeeded(run.depth, run.stats) * 1.05) return true;
  if (run.temp >= run.stats.maxTemp * heatRatio) return true;
  if (run.hull <= run.maxHull * hullFloor) return true;
  if (run.depth >= target) {
    if (cargoCare && isCargoFull(run)) return true;
    return false;
  }
  if (cargoCare && isCargoFull(run)) {
    // Трюм полон, но цель ещё не достигнута: выбрасываем дешёвое, если оно
    // заметно дешевле руды на текущей глубине.
    if (!dumpJunk) return true;
    const worst = cheapestPerSlot(run);
    const here = oreValuePerUnit(run.depth);
    // factor-единицы сравниваются со средним множителем 1.0, старый груз без
    // factor (сохранения до v3, тесты) — с ценой текущей глубины.
    const reference = worst && worst.item.factor != null ? 1 : here;
    if (!worst || worst.perSlot < reference * 0.95) return false; // будем выбрасывать
    return true;
  }
  return false;
}

export function botInput(run, policy = {}) {
  const input = { down: false, left: false, right: false, rocket: false };
  if (!run.active) return input;
  if (mustSurface(run, policy)) input.rocket = true;
  else input.down = true;
  return input;
}

/**
 * Полный забег до поверхности/смерти.
 *
 * Правила забоя — те же, что в замере design/engine-parity.mjs (IDIGIT-13 §8 п.17):
 *   • цель достигнута → проходка вбок; упёрся в стену участка → разворот, а не бур вниз;
 *   • 2 с без руды на забое → шаг бура вниз на 0.2 с и разворот (забой идёт вглубь);
 *   • магма в корпусе на спуске → 0.4 с вбок (иначе один карман запирает ствол).
 * Без этого на постоянной шахте бот спускается по пустому стволу, не набирает
 * трюм и не возвращается — то есть меряет не ту игру.
 */
export function playRun(run, world, state, { dt = 1 / 60, maxSeconds = 1200, policy = {} } = {}) {
  const events = [];
  let t = 0;
  let dumped = 0;
  let dir = 1;
  let drill = 0;
  let bypass = 0;
  let bypasses = 0;
  let dry = 0;
  let lastMined = run.mined;
  const target = botTarget(run, policy);
  const magmaInBody = () => {
    const c0 = Math.floor((run.x + 1) / TILE);
    const c1 = Math.floor((run.x + run.w - 1) / TILE);
    const r0 = Math.floor((run.y + 1) / TILE);
    const r1 = Math.floor((run.y + run.h - 1) / TILE);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (world.getCell(c, r) === MAT.MAGMA) return true;
    return false;
  };

  while (run.active && t < maxSeconds) {
    if (isCargoFull(run) && !mustSurface(run, policy)) {
      const drop = dumpCheapest(run);
      if (drop) {
        dumped++;
        events.push({ type: 'dump', name: drop.name, value: drop.value });
      }
    }

    const input = { down: false, left: false, right: false, rocket: false };
    if (mustSurface(run, policy)) {
      input.rocket = true;
    } else {
      const atFace = run.depth >= target - 0.5;
      if (atFace) {
        if (run.mined > lastMined + 1e-9) {
          lastMined = run.mined;
          dry = 0;
        } else dry += dt;
        if (dry >= DRY_SECONDS && !isCargoFull(run)) {
          drill = 0.2;
          dry = 0;
          dir = -dir;
        }
      }
      if (!atFace && bypass <= 0 && bypasses < 6 && magmaInBody()) {
        bypass = 0.4;
        bypasses++;
      }
      if (drill > 0) {
        input.down = true;
        drill -= dt;
      } else if (bypass > 0) {
        bypass -= dt;
        if (dir > 0) input.right = true;
        else input.left = true;
      } else if (!atFace) {
        input.down = true;
      } else if (dir > 0) input.right = true;
      else input.left = true;
    }

    const x0 = run.x;
    events.push(...stepRun(run, world, state, dt, input));
    // Упёрся в стену участка (или в монолит) — развернуться, а не долбить её.
    if (!input.rocket && !input.down && (input.left || input.right) && Math.abs(run.x - x0) < 1e-9) dir = -dir;
    t += dt;
  }
  run.dumped = dumped;
  return events;
}

export { cargoValue, ECONOMY };
