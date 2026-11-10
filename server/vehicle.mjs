// Placeholder geometry: replace signs and coefficients after a propeller-free bench test.
export const vehicle = {
  name: 'АРКТИКА · ROV 01', maxPower: 0.6,
  thrusters: [
    { id: 'T1', label: 'Передний левый', mix: { surge: 1, sway: 1, yaw: 1 } },
    { id: 'T2', label: 'Передний правый', mix: { surge: 1, sway: -1, yaw: -1 } },
    { id: 'T3', label: 'Задний левый', mix: { surge: 1, sway: -1, yaw: 1 } },
    { id: 'T4', label: 'Задний правый', mix: { surge: 1, sway: 1, yaw: -1 } },
    { id: 'T5', label: 'Вертикальный левый', mix: { heave: 1 } },
    { id: 'T6', label: 'Вертикальный правый', mix: { heave: 1 } }
  ]
};
export function mixThrusters(values, config = vehicle) {
  const raw = config.thrusters.map(t => Object.entries(t.mix).reduce((sum, [axis, gain]) => sum + (values[axis] || 0) * gain, 0));
  const scale = Math.max(1, ...raw.map(Math.abs));
  return raw.map(x => Math.round(x / scale * config.maxPower * 100));
}
