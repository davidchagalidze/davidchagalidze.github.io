/**
 * Удержание кнопок управления (тач-пад и большие кнопки).
 *
 * Почему отдельный модуль. В IDIGIT-10 владелец жаловался «нажал ◀ — не поехало».
 * Причина в старом обработчике: `pointerleave` снимал нажатие, поэтому палец,
 * чуть сползший с кнопки (на телефоне это норма), гасил движение через доли
 * секунды. Второй источник — отсутствие `setPointerCapture`: уход пальца за
 * границу кнопки и второй палец рвали жест, а `pointercancel` от браузера
 * срабатывал так же, как `pointerup`.
 *
 * Правила, которые держит этот модуль:
 *   1. нажатие ставится на `pointerdown` (с захватом указателя на кнопке);
 *   2. `pointerleave` НЕ отменяет нажатие (обработчика на него просто нет);
 *   3. снимается только на `pointerup`, `pointercancel` и `lostpointercapture`;
 *   4. мультитач и две кнопки на одно действие (▼ и БУР) считаются наборами
 *      токенов: состояние живо, пока жив хотя бы один указатель.
 *
 * DOM не требуется: подходит любой объект с `addEventListener`,
 * `classList.add/remove`, `setPointerCapture` — поэтому логика покрыта
 * юнит-тестами без браузера (tests/hold.test.mjs).
 */

/** Все клавиши удержания. `rocket` — это подъём (▲ и ВВЕРХ). */
export const HOLD_KEYS = ['left', 'right', 'down', 'rocket'];

/**
 * Общее состояние удержания.
 * `keys` — объект, который читает игровой цикл (input.left и т.д.).
 */
export function createHoldState() {
  const holders = new Map(HOLD_KEYS.map((key) => [key, new Set()]));
  const keys = Object.fromEntries(HOLD_KEYS.map((key) => [key, false]));

  const sync = (key) => {
    keys[key] = holders.get(key).size > 0;
  };

  return {
    keys,
    /** Нажать: token — уникальный владелец (кнопка + pointerId). */
    press(key, token) {
      const set = holders.get(key);
      if (!set) return false;
      set.add(token);
      sync(key);
      return true;
    },
    /** Отпустить конкретный указатель; нажатие живо, пока живы другие. */
    release(key, token) {
      const set = holders.get(key);
      if (!set) return false;
      set.delete(token);
      sync(key);
      return true;
    },
    /** Отпустить всё (уход со экрана, пауза, потеря фокуса). */
    releaseAll() {
      for (const [key, set] of holders) {
        set.clear();
        sync(key);
      }
    },
    isHeld(key) {
      return !!keys[key];
    },
  };
}

let buttonSeq = 0;

/**
 * Повесить удержание на элемент кнопки.
 * @param {object} el  элемент (или его тестовый двойник)
 * @param {string} key одно из HOLD_KEYS
 * @param {object} holds состояние из createHoldState()
 * @returns {{key: string, detach: () => void}}
 */
export function bindHoldButton(el, key, holds) {
  if (!HOLD_KEYS.includes(key)) throw new Error(`неизвестная клавиша удержания: ${key}`);
  const tokens = new Map(); // pointerId -> token
  const buttonId = ++buttonSeq;

  const onDown = (e) => {
    e.preventDefault?.();
    const pid = e.pointerId ?? 0;
    if (tokens.has(pid)) return;
    const token = `${buttonId}:${pid}`;
    tokens.set(pid, token);
    holds.press(key, token);
    el.classList?.add('on');
    // Захват указателя — главная защита от pointerleave/ухода за кнопку.
    // На синтетических событиях браузер бросает NotFoundError — это не ошибка.
    try {
      el.setPointerCapture?.(pid);
    } catch {
      /* нет активного указателя — событие синтетическое */
    }
  };

  const onRelease = (e) => {
    const pid = e.pointerId ?? 0;
    const token = tokens.get(pid);
    if (!token) return;
    tokens.delete(pid);
    holds.release(key, token);
    try {
      el.releasePointerCapture?.(pid);
    } catch {
      /* захвата уже нет */
    }
    if (tokens.size === 0) el.classList?.remove('on');
  };

  // Долгое нажатие на телефоне не должно открывать контекстное меню.
  const onContextMenu = (e) => e.preventDefault?.();

  const listeners = {
    pointerdown: onDown,
    pointerup: onRelease,
    pointercancel: onRelease,
    lostpointercapture: onRelease,
    contextmenu: onContextMenu,
  };
  for (const [type, fn] of Object.entries(listeners)) el.addEventListener(type, fn);

  return {
    key,
    /** Снять обработчики (нужно при пересборке экрана). */
    detach() {
      for (const [type, fn] of Object.entries(listeners)) el.removeEventListener?.(type, fn);
      for (const [pid, token] of tokens) {
        holds.release(key, token);
        tokens.delete(pid);
      }
      el.classList?.remove('on');
    },
  };
}
