import { actions, axisActions, neutral, shape } from './actions.mjs';

// No browser globals: the same mapping can be checked with recorded device samples.
export class InputMapper {
  constructor() { this.reset(); }
  reset() { this.toggles = {}; this.held = {}; }
  toggle(id) { this.toggles[id] = this.toggles[id] ? 0 : 1; }
  sample(profile, { keys = new Set(), pad = null, active = true, allowToggles = true } = {}) {
    const values = neutral(); let deadman = false;
    if (!active) return { values, deadman };
    if (profile.device === 'keyboard') {
      deadman = keys.has(profile.deadmanKey);
      for (const a of axisActions) {
        const b = profile.bindings[a.id];
        values[a.id] = (Number(keys.has(b.positive)) - Number(keys.has(b.negative))) * profile.sensitivity;
      }
    } else if (pad) {
      deadman = !!pad.buttons[profile.deadmanButton]?.pressed;
      for (const a of axisActions) {
        const b = profile.bindings[a.id];
        const raw = b.axis >= 0 ? (pad.axes[b.axis] || 0) * (b.invert ? -1 : 1) : (pad.buttons[b.buttonPositive]?.value || 0) - (pad.buttons[b.buttonNegative]?.value || 0);
        values[a.id] = shape(raw, profile.deadzone, profile.expo) * profile.sensitivity;
      }
    }
    for (const a of actions.filter(a => a.kind === 'toggle')) {
      const b = profile.bindings[a.id];
      const pressed = profile.device === 'keyboard' ? keys.has(b.positive) : !!pad?.buttons[b.buttonPositive]?.pressed;
      if (pressed && !this.held[a.id] && allowToggles) this.toggle(a.id);
      this.held[a.id] = pressed; values[a.id] = allowToggles ? (this.toggles[a.id] || 0) : 0;
    }
    return { values, deadman };
  }
}
