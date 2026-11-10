// Registry shared by the browser, validator, packet builder and profile editor.
export const actions = [
  { id: 'surge', label: 'Вперёд / назад', kind: 'axis', negative: 'KeyS', positive: 'KeyW', padAxis: 1, invert: true, group: 'Движение' },
  { id: 'sway', label: 'Вправо / влево', kind: 'axis', negative: 'KeyA', positive: 'KeyD', padAxis: 0, group: 'Движение' },
  { id: 'heave', label: 'Вниз / вверх', kind: 'axis', negative: 'KeyF', positive: 'KeyR', padNegative: 6, padPositive: 7, group: 'Движение' },
  { id: 'yaw', label: 'Разворот', kind: 'axis', negative: 'KeyQ', positive: 'KeyE', padAxis: 2, group: 'Движение' },
  { id: 'cameraTilt', label: 'Наклон камеры', kind: 'axis', negative: 'ArrowDown', positive: 'ArrowUp', padAxis: 3, invert: true, group: 'Оборудование' },
  { id: 'grip', label: 'Закрыть / открыть захват', kind: 'axis', negative: 'KeyJ', positive: 'KeyK', padNegative: 0, padPositive: 1, group: 'Оборудование' },
  { id: 'wrist', label: 'Поворот манипулятора', kind: 'axis', negative: 'KeyU', positive: 'KeyI', padNegative: 2, padPositive: 3, group: 'Оборудование' },
  { id: 'light', label: 'Освещение', kind: 'toggle', positive: 'KeyL', padPositive: 4, group: 'Оборудование' }
];
export const axisActions = actions.filter(a => a.kind === 'axis');
export const neutral = () => Object.fromEntries(actions.map(a => [a.id, 0]));
export function defaultProfile() {
  return { version: 1, device: 'keyboard', deadzone: 0.12, sensitivity: 0.6, expo: 0.3, deadmanKey: 'Space', deadmanButton: 5,
    bindings: Object.fromEntries(actions.map(a => [a.id, { negative: a.negative || '', positive: a.positive || '', axis: a.padAxis ?? -1, buttonNegative: a.padNegative ?? -1, buttonPositive: a.padPositive ?? -1, invert: !!a.invert }])) };
}
export function validateProfile(p) {
  if (!p || p.version !== 1 || !['keyboard', 'gamepad'].includes(p.device)) throw Error('Неизвестный формат профиля');
  for (const [key, low, high] of [['deadzone', 0, 0.5], ['sensitivity', 0.1, 1], ['expo', 0, 1]])
    if (typeof p[key] !== 'number' || !Number.isFinite(p[key]) || p[key] < low || p[key] > high) throw Error('Недопустимый параметр ' + key);
  if (!validKey(p.deadmanKey) || !Number.isInteger(p.deadmanButton) || p.deadmanButton < 0 || p.deadmanButton > 63) throw Error('Неверная кнопка разрешения');
  for (const a of actions) {
    const b = p.bindings?.[a.id];
    if (!b || !validKey(b.positive) || !validKey(b.negative) || typeof b.invert !== 'boolean') throw Error('Неверная привязка ' + a.label);
    for (const k of ['axis', 'buttonNegative', 'buttonPositive']) if (!Number.isInteger(b[k]) || b[k] < -1 || b[k] > 63) throw Error('Неверный индекс привязки');
  }
  return p;
}
function validKey(s) { return typeof s === 'string' && /^(|Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Bracket(Left|Right)|Comma|Period|Slash|Minus|Equal|Backspace|Tab|Enter|Escape)$/.test(s); }
export function shape(value, deadzone, expo) {
  if (!Number.isFinite(value) || Math.abs(value) <= deadzone) return 0;
  const n = Math.min(1, (Math.abs(value) - deadzone) / (1 - deadzone));
  return Math.sign(value) * ((1 - expo) * n + expo * n ** 3);
}
