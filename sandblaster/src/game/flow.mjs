/**
 * Экраны игры и переходы между ними — без DOM.
 *
 * Экранов три: меню, доска заказов и игровой экран. Доска — не отдельная секция
 * DOM, а модалка поверх меню, но для логики это полноценный экран: именно туда
 * возвращается игрок после сдачи заказа и при закрытии цеха без активного заказа.
 *
 * Правила перехода (регресс SAND-3: после сдачи игрок оставался на мёртвом
 * игровом экране с session = null и устаревшим HUD):
 *   • beginOrder() — берём заказ: сессия есть, экран игровой;
 *   • deliver()    — заказ закрыт: сессии нет, экран ВСЕГДА доска, не игра;
 *   • closeShop()  — без активного заказа цех возвращает на доску, с заказом — в игру.
 */

export const SCREEN = Object.freeze({ MENU: 'menu', BOARD: 'board', GAME: 'game' });

const KNOWN = new Set(Object.values(SCREEN));

/**
 * Маленький автомат экранов. Хранит только screen и session; деньги и сетку
 * считает delivery.mjs/session.mjs — здесь их нет, чтобы переходы тестировались
 * без DOM и без браузера.
 */
export function createShell({ screen = SCREEN.MENU, session = null } = {}) {
  const state = { screen: KNOWN.has(screen) ? screen : SCREEN.MENU, session: session || null };

  const shell = {
    get screen() {
      return state.screen;
    },
    get session() {
      return state.session;
    },
    hasSession() {
      return Boolean(state.session);
    },
    setScreen(screen) {
      if (!KNOWN.has(screen)) throw new Error(`неизвестный экран: ${screen}`);
      state.screen = screen;
      return state.screen;
    },
    setSession(session) {
      state.session = session || null;
      return state.session;
    },
    toMenu() {
      state.screen = SCREEN.MENU;
      return state.screen;
    },
    toBoard() {
      state.screen = SCREEN.BOARD;
      return state.screen;
    },
    toGame() {
      state.screen = SCREEN.GAME;
      return state.screen;
    },
    /** Взяли заказ: сессия активна, играем. */
    beginOrder(session) {
      state.session = session || null;
      state.screen = SCREEN.GAME;
      return state.screen;
    },
    /**
     * Заказ сдан (деньги уже начислены в delivery.mjs): сессии больше нет,
     * игрок возвращается туда, откуда брал заказ, — на доску.
     */
    deliver() {
      const closed = Boolean(state.session);
      state.session = null;
      state.screen = SCREEN.BOARD;
      return { screen: state.screen, closed };
    },
    /** Закрыли цех: с заказом — назад в игру, без заказа — на доску заказов. */
    closeShop() {
      state.screen = state.session ? SCREEN.GAME : SCREEN.BOARD;
      return state.screen;
    },
  };

  return shell;
}
