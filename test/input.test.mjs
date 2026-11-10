import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProfile, neutral } from '../shared/actions.mjs';
import { InputMapper } from '../shared/input.mjs';

test('keyboard maps physical codes and opposing inputs cancel', () => {
  const mapper = new InputMapper(), p = defaultProfile();
  let result = mapper.sample(p, { keys: new Set(['Space', 'KeyW', 'KeyD']) });
  assert.equal(result.deadman, true); assert.equal(result.values.surge, .6); assert.equal(result.values.sway, .6);
  result = mapper.sample(p, { keys: new Set(['KeyW', 'KeyS']) }); assert.equal(result.values.surge, 0); assert.equal(result.deadman, false);
  p.bindings.surge.positive = 'KeyX'; result = mapper.sample(p, { keys: new Set(['KeyX']) }); assert.equal(result.values.surge, .6);
});
test('gamepad applies inversion, dead zone, sensitivity and analog trigger mapping', () => {
  const mapper = new InputMapper(), p = defaultProfile(); p.device = 'gamepad';
  const pad = { axes: [.04, -1, .5, 0], buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })) };
  pad.buttons[5] = { pressed: true, value: 1 }; pad.buttons[6] = { pressed: true, value: 1 };
  const result = mapper.sample(p, { pad }); assert.equal(result.deadman, true); assert.equal(result.values.surge, .6);
  assert.equal(result.values.sway, 0); assert.equal(result.values.heave, -.6); assert.ok(result.values.yaw > 0 && result.values.yaw < .3);
  assert.deepEqual(mapper.sample(p, { pad: null }).values, neutral());
});
test('toggle responds once per press and inactive page never issues movement', () => {
  const mapper = new InputMapper(), p = defaultProfile(); const keys = new Set(['KeyL', 'Space', 'KeyW']);
  assert.equal(mapper.sample(p, { keys }).values.light, 1); assert.equal(mapper.sample(p, { keys }).values.light, 1);
  mapper.sample(p, { keys: new Set() }); assert.equal(mapper.sample(p, { keys }).values.light, 0);
  assert.deepEqual(mapper.sample(p, { keys, active: false }), { values: neutral(), deadman: false });
  mapper.reset(); assert.equal(mapper.sample(p, { keys, allowToggles: false }).values.light, 0);
});
