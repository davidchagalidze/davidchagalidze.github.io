/**
 * Вписать мир (320×240 клеток) в canvas любого размера и перевести экранные координаты
 * в мировые. Вынесено из рендера отдельным модулем, чтобы это можно было проверить
 * тестом: промах прицела на телефоне — это ошибка в этой арифметике, а не в CSS.
 */

export function fitView(cssW, cssH, worldW, worldH) {
  const w = Math.max(1, cssW);
  const h = Math.max(1, cssH);
  const scale = Math.min(w / worldW, h / worldH);
  return {
    scale,
    offsetX: (w - worldW * scale) / 2,
    offsetY: (h - worldH * scale) / 2,
    w,
    h,
    worldW,
    worldH,
  };
}

/**
 * @param {{left:number, top:number}} rect — getBoundingClientRect() канвы
 * @param {{scale:number, offsetX:number, offsetY:number}} view
 * @returns {{x:number, y:number, inside:boolean}}
 */
export function clientToWorld(rect, view, clientX, clientY) {
  const x = (clientX - rect.left - view.offsetX) / view.scale;
  const y = (clientY - rect.top - view.offsetY) / view.scale;
  return {
    x: Math.max(0, Math.min(view.worldW, x)),
    y: Math.max(0, Math.min(view.worldH, y)),
    inside: x >= 0 && y >= 0 && x <= view.worldW && y <= view.worldH,
  };
}

/** Обратное преобразование — нужно тестам и отладке. */
export function worldToClient(rect, view, x, y) {
  return { clientX: rect.left + view.offsetX + x * view.scale, clientY: rect.top + view.offsetY + y * view.scale };
}
