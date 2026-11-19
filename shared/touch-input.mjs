import { neutral } from './actions.mjs';

const sticks = { move: ['sway', 'surge'], turn: ['yaw', 'heave'] };
const equipment = new Set(['cameraTilt', 'grip', 'wrist']);

// Each contact owns one control. Lifting a finger never releases another finger.
export class TouchInput {
  constructor() { this.reset(); }
  reset() { this.contacts = new Map(); }
  press(pointer, control) {
    if (this.contacts.has(pointer) || [...this.contacts.values()].some(c => c.control === control)) return false;
    const [axis, sign] = control.split(':');
    if (control !== 'light' && !sticks[control] && !(equipment.has(axis) && ['-1', '1'].includes(sign))) return false;
    this.contacts.set(pointer, { control, x: 0, y: 0 });
    return true;
  }
  move(pointer, x, y) {
    const contact = this.contacts.get(pointer);
    if (!contact || !sticks[contact.control] || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const length = Math.max(1, Math.hypot(x, y));
    contact.x = x / length; contact.y = y / length;
  }
  release(pointer) { this.contacts.delete(pointer); }
  sample() {
    const values = neutral();
    for (const c of this.contacts.values()) {
      if (sticks[c.control]) {
        const [horizontal, vertical] = sticks[c.control];
        values[horizontal] = c.x; values[vertical] = -c.y || 0;
      } else if (c.control !== 'light') {
        const [axis, sign] = c.control.split(':'); values[axis] += Number(sign);
      }
    }
    return { values, deadman: this.contacts.size > 0 };
  }
}
