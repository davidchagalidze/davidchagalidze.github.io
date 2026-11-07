/**
 * Поза машины: куда смотрит бур и как развёрнут корпус при движении.
 *
 * Раньше `run.diggingDir` доезжал до рендера, но использовался только для
 * «крестика» при бурении вниз: корпус и бур всегда смотрели вниз, поэтому
 * движение влево/вправо визуально не читалось (жалоба IDIGIT-10). Теперь
 * направление превращается в явную позу:
 *
 *   'down'  — бур снизу, кабина слева (как раньше);
 *   'left'  — бур вынесен влево, кабина слева (кабина по ходу движения);
 *   'right' — бур вынесен вправо, корпус отражён: кабина справа;
 *   null    — нейтральная поза: как 'down', но без «работающего» крестика.
 *
 * Чистая функция без canvas: юнит-тесты проверяют её напрямую.
 */

/** Угол поворота бура в радианах; 0 — бур смотрит вниз. */
export const DRILL_ANGLE = Object.freeze({
  down: 0,
  // rotate(+90°) переводит вектор «вниз» в «влево», rotate(-90°) — «вправо».
  left: Math.PI / 2,
  right: -Math.PI / 2,
});

/**
 * @param {'down'|'left'|'right'|null|undefined} diggingDir
 * @param {number} w ширина корпуса, px
 * @param {number} h высота корпуса, px
 * @returns {{dir: string|null, working: boolean, mirror: 1|-1,
 *            drill: {x: number, y: number, angle: number}}}
 */
export function machinePose(diggingDir, w = 26, h = 20) {
  const dir = diggingDir === 'down' || diggingDir === 'left' || diggingDir === 'right' ? diggingDir : null;
  const halfW = w / 2;
  const halfH = h / 2;

  if (dir === 'left') {
    return {
      dir,
      working: true,
      mirror: 1, // кабина остаётся слева — по ходу движения
      drill: { x: -halfW - 2, y: 0, angle: DRILL_ANGLE.left },
    };
  }

  if (dir === 'right') {
    return {
      dir,
      working: true,
      mirror: -1, // корпус отражён: кабина уходит вправо, вперёд по ходу
      drill: { x: halfW + 2, y: 0, angle: DRILL_ANGLE.right },
    };
  }

  return {
    dir,
    working: dir === 'down',
    mirror: 1,
    drill: { x: 0, y: halfH, angle: DRILL_ANGLE.down },
  };
}
