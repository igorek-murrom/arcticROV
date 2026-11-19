import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInput } from '../shared/touch-input.mjs';
import { InputMapper } from '../shared/input.mjs';
import { defaultProfile, neutral, validateProfile } from '../shared/actions.mjs';
import { DemoStation } from '../shared/demo-station.mjs';
import { commandContext } from '../shared/session.mjs';

test('two fingers control independent sticks and lifting one preserves the other', () => {
  const touch = new TouchInput();
  touch.press(11, 'move'); touch.move(11, 0, -1);
  touch.press(22, 'turn'); touch.move(22, 1, 0);
  assert.deepEqual(touch.sample(), { values: { ...neutral(), surge: 1, yaw: 1 }, deadman: true });
  touch.release(11);
  assert.deepEqual(touch.sample(), { values: { ...neutral(), yaw: 1 }, deadman: true });
  touch.release(22);
  assert.deepEqual(touch.sample(), { values: neutral(), deadman: false });
});

test('touch travel stays bounded and contacts cannot steal an occupied control', () => {
  const touch = new TouchInput();
  assert.equal(touch.press(1, 'move'), true);
  assert.equal(touch.press(2, 'move'), false);
  assert.equal(touch.press(1, 'turn'), false);
  assert.equal(touch.press(3, 'unknown'), false);
  touch.move(1, 4, -3);
  assert.equal(touch.sample().values.sway, .8); assert.equal(touch.sample().values.surge, .6);
  touch.move(1, NaN, Infinity); assert.equal(touch.sample().values.sway, .8);
  touch.move(99, 1, 1); touch.release(99); assert.equal(touch.sample().deadman, true);
});

test('equipment holds cancel opposing directions and reset invalidates all old contacts', () => {
  const touch = new TouchInput();
  touch.press(1, 'cameraTilt:1'); touch.press(2, 'grip:-1'); touch.press(3, 'wrist:1');
  assert.deepEqual(touch.sample().values, { ...neutral(), cameraTilt: 1, grip: -1, wrist: 1 });
  touch.press(4, 'grip:1'); assert.equal(touch.sample().values.grip, 0);
  touch.reset(); touch.move(1, 1, -1); touch.release(2);
  assert.deepEqual(touch.sample(), { values: neutral(), deadman: false });
  touch.press(5, 'turn'); touch.move(5, 0, 1); assert.equal(touch.sample().values.heave, -1);
});

test('touch profiles round-trip and mapping applies sensitivity, dead zone and expo without other devices', () => {
  const profile = defaultProfile(); profile.device = 'touch';
  assert.equal(validateProfile(JSON.parse(JSON.stringify(profile))).device, 'touch');
  assert.equal(validateProfile(defaultProfile()).device, 'keyboard');
  const touch = new TouchInput(), mapper = new InputMapper();
  touch.press(1, 'move'); touch.move(1, .04, 0);
  let result = mapper.sample(profile, { touch: touch.sample(), keys: new Set(['Space', 'KeyW', 'KeyL']), pad: { axes: [1] } });
  assert.equal(result.values.sway, 0); assert.equal(result.values.surge, 0); assert.equal(result.values.light, 0);
  touch.move(1, .5, 0); result = mapper.sample(profile, { touch: touch.sample() });
  assert.ok(result.values.sway > 0 && result.values.sway < .3);
  touch.move(1, 0, -1); assert.equal(mapper.sample(profile, { touch: touch.sample() }).values.surge, .6);
  assert.deepEqual(mapper.sample(profile, { touch: touch.sample(), active: false }), { values: neutral(), deadman: false });
  touch.reset(); assert.deepEqual(mapper.sample(profile, { touch: touch.sample() }), { values: neutral(), deadman: false });
});

test('light contact authorizes equipment only while held; disabled toggles and reset clear it', () => {
  const touch = new TouchInput(), mapper = new InputMapper(), profile = defaultProfile(); profile.device = 'touch';
  touch.press(1, 'light'); mapper.toggle('light');
  assert.deepEqual(mapper.sample(profile, { touch: touch.sample() }), { values: { ...neutral(), light: 1 }, deadman: true });
  touch.release(1); assert.equal(mapper.sample(profile, { touch: touch.sample() }).deadman, false);
  assert.equal(mapper.sample(profile, { touch: touch.sample(), allowToggles: false }).values.light, 0);
  mapper.reset(); assert.equal(mapper.sample(profile, { touch: touch.sample() }).values.light, 0);
});

test('touch drives the same station, refuses arming while held, and stop preserves the operator', () => {
  let now = 1000, seq = 0;
  const demo = new DemoStation(() => now), touch = new TouchInput(), mapper = new InputMapper(), profile = defaultProfile();
  profile.device = 'touch';
  const user = demo.request('login', { name: 'Телефон', pin: 1 }).body;
  const request = (path, data = {}) => demo.request(path, data, user.token);
  const state = () => request('state').body;
  const command = () => request('command', { ...commandContext(state(), ++seq), ...mapper.sample(profile, { touch: touch.sample() }) });
  const operation = path => request(path, { epoch: state().epoch, safetyEpoch: state().safetyEpoch });
  request('claim'); touch.press(1, 'turn'); touch.move(1, 0, 1); command();
  assert.equal(operation('arm').status, 409);
  touch.reset(); command(); assert.equal(operation('arm').status, 200);
  touch.press(2, 'move'); touch.move(2, 0, -1); touch.press(3, 'turn'); touch.move(3, 0, 1); command();
  now += 100; demo.step(.1);
  assert.ok(state().telemetry.depth > 0); assert.ok(state().telemetry.y > 0);
  touch.reset(); command(); demo.step(.05);
  assert.ok(state().packet.thrusters.every(v => v === 0));
  request('estop'); assert.equal(state().owner.id, user.id);
  touch.reset(); mapper.reset(); command(); assert.equal(operation('reset').status, 200);
  assert.equal(state().armed, false);
});
