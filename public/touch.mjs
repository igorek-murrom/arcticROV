import { TouchInput } from './shared/touch-input.mjs';

export function createTouchControls(root, { allowed, onCancel }) {
  const input = new TouchInput(), held = new Map();
  const controls = [...root.querySelectorAll('[data-touch-control]')];
  function paint(element, x = 0, y = 0) {
    element.classList.toggle('held', [...held.values()].includes(element));
    element.style.setProperty('--stick-x', x + 'px'); element.style.setProperty('--stick-y', y + 'px');
  }
  function move(event, element) {
    if (!element.classList.contains('touch-stick')) return;
    const box = element.getBoundingClientRect(), radius = Math.max(1, box.width / 2 - 28);
    input.move(event.pointerId, (event.clientX - box.left - box.width / 2) / radius, (event.clientY - box.top - box.height / 2) / radius);
    const c = input.contacts.get(event.pointerId);
    paint(element, c.x * radius, c.y * radius);
  }
  function reset() {
    input.reset(); const previous = [...held]; held.clear();
    for (const [pointer, element] of previous) {
      if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
      paint(element);
    }
  }
  for (const element of controls) {
    element.addEventListener('contextmenu', event => event.preventDefault());
    element.addEventListener('pointerdown', event => {
      if ((event.pointerType === 'mouse' && event.button !== 0) || !allowed()) return;
      event.preventDefault();
      if (!input.press(event.pointerId, element.dataset.touchControl)) return;
      held.set(event.pointerId, element); element.setPointerCapture(event.pointerId); move(event, element);
      if (!element.classList.contains('touch-stick')) paint(element);
    });
    element.addEventListener('pointermove', event => {
      if (held.get(event.pointerId) !== element) return;
      if (!allowed()) return reset();
      event.preventDefault(); move(event, element);
    });
    element.addEventListener('pointerup', event => {
      if (held.get(event.pointerId) !== element) return;
      event.preventDefault(); held.delete(event.pointerId); input.release(event.pointerId);
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      paint(element);
    });
    for (const type of ['pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
      if (!held.has(event.pointerId)) return;
      reset(); onCancel();
    });
  }
  return {
    reset,
    sample: () => input.sample(),
    setEnabled(enabled) {
      for (const element of controls) element.disabled = !enabled;
      if (!enabled) reset();
    }
  };
}
