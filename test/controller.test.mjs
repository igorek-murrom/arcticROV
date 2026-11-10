import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../server/controller.mjs';
import { neutral, defaultProfile, validateProfile, shape } from '../shared/actions.mjs';
import { mixThrusters } from '../server/vehicle.mjs';
import { Simulator } from '../server/simulator.mjs';

function fixture() {
  let now = 1000; const c = new Controller(() => now);
  c.addClient('alice', 'Алиса'); c.addClient('bob', 'Борис'); c.claim('alice'); let seq = 0;
  const command = (values = {}, extra = {}) => c.command('alice', { epoch: c.epoch, seq: ++seq, issuedAt: now, deadman: false, values: { ...neutral(), ...values }, ...extra });
  return { c, advance: ms => { now += ms; c.tick(); }, command, arm: () => { command(); c.arm('alice', c.epoch); } };
}
test('only one operator, spectator cannot arm or send thrust', () => {
  const { c } = fixture(); assert.throws(() => c.claim('bob'));
  assert.throws(() => c.arm('bob', c.epoch)); assert.throws(() => c.command('bob', {}));
  assert.equal(c.owner, 'alice'); assert.ok(c.packet().thrusters.every(x => x === 0));
});
test('outputs need neutral input, explicit arm and held deadman', () => {
  const { c, command, arm } = fixture(); assert.throws(() => c.arm('alice', c.epoch));
  command({ surge: .5 }, { deadman: true }); assert.throws(() => c.arm('alice', c.epoch));
  assert.ok(c.packet().thrusters.every(x => x === 0)); arm();
  command({ surge: 1 }); assert.ok(c.packet().thrusters.every(x => x === 0));
  command({ surge: 1 }, { deadman: true }); assert.deepEqual(c.packet().thrusters, [60, 60, 60, 60, 0, 0]);
  command({ surge: 1 }, { deadman: false }); assert.ok(c.packet().thrusters.every(x => x === 0));
});
test('stale commands disarm at 350 ms and recovery never automatically arms', () => {
  const { c, command, arm, advance } = fixture(); arm(); command({ surge: 1 }, { deadman: true });
  advance(351); assert.equal(c.armed, false); assert.equal(c.owner, 'alice');
  command({ surge: 1 }, { deadman: true }); assert.ok(c.packet().thrusters.every(x => x === 0));
});
test('lease timeout releases ownership and makes old credentials unusable', () => {
  const { c, advance } = fixture(); const old = c.epoch; advance(2001); assert.equal(c.owner, null);
  c.claim('bob'); assert.notEqual(c.epoch, old); assert.throws(() => c.command('alice', { epoch: old }));
});
test('takeover is requested, accepted by owner and starts disarmed with new epoch', () => {
  const { c, arm, command } = fixture(); arm(); command({ heave: 1 }, { deadman: true }); const epoch = c.epoch;
  c.takeover('bob'); assert.equal(c.owner, 'alice'); assert.throws(() => c.respond('bob', true));
  c.respond('alice', true); assert.equal(c.owner, 'bob'); assert.equal(c.armed, false); assert.notEqual(c.epoch, epoch);
  assert.ok(c.packet().thrusters.every(x => x === 0)); assert.throws(() => c.arm('bob', c.epoch));
});
test('declined and expired takeover cannot steal control', () => {
  const { c, command, advance } = fixture(); c.takeover('bob'); c.respond('alice', false); assert.equal(c.request, null);
  c.takeover('bob'); for (let i = 0; i < 16; i++) { command(); advance(1000); }
  assert.equal(c.request, null); assert.throws(() => c.respond('alice', true)); assert.equal(c.owner, 'alice');
});
test('any participant can latch emergency stop, only neutral operator can reset', () => {
  const { c, arm, command } = fixture(); arm(); command({ surge: 1 }, { deadman: true }); c.emergency('bob');
  assert.equal(c.estop, true); assert.equal(c.armed, false); assert.ok(c.packet().thrusters.every(x => x === 0));
  assert.throws(() => c.reset('bob')); assert.throws(() => c.reset('alice')); assert.throws(() => c.arm('alice', c.epoch));
  command(); c.reset('alice'); assert.equal(c.estop, false); assert.equal(c.armed, false);
});
test('missing epoch and packets from a previous lease are rejected', () => {
  const { c, command } = fixture(); const old = c.epoch; c.release('alice'); c.claim('alice');
  assert.throws(() => command({}, { epoch: old })); assert.throws(() => command({}, { epoch: undefined }));
  assert.throws(() => c.arm('alice')); command(); c.arm('alice', c.epoch); assert.equal(c.armed, true);
});
test('malformed, unknown, nonfinite, stale, future and replayed commands fail validation', () => {
  const { c, command } = fixture();
  for (const value of [NaN, Infinity, -Infinity, 1.01, -1.01, '1', null]) assert.throws(() => command({ surge: value }));
  assert.throws(() => command({ light: .5 })); assert.throws(() => command({ surprise: 1 }));
  assert.throws(() => command({}, { issuedAt: 0 })); assert.throws(() => command({}, { issuedAt: 999999 }));
  assert.throws(() => command({}, { deadman: 'true' })); assert.throws(() => command({}, { seq: .5 }));
  command({}, { seq: 100 }); assert.throws(() => command({}, { seq: 100 })); assert.throws(() => command({}, { seq: 99 }));
  assert.equal(c.seq, 100);
});
test('disconnect neutralizes output immediately', () => {
  const { c, arm, command } = fixture(); arm(); command({ wrist: 1, light: 1 }, { deadman: true });
  c.disconnect('alice'); assert.equal(c.owner, null); assert.deepEqual(c.packet().actions, neutral());
});
test('combined thrust is proportionally normalized and bounded by station limit', () => {
  const mixed = mixThrusters({ surge: 1, sway: 1, yaw: 1, heave: -1 });
  assert.deepEqual(mixed, [60, -20, 20, 20, -20, -20]); assert.ok(mixed.every(x => Math.abs(x) <= 60));
});
test('valid profiles survive round-trip, malformed import and dead zones are rejected', () => {
  const p = defaultProfile(); assert.deepEqual(validateProfile(JSON.parse(JSON.stringify(p))), p);
  assert.throws(() => validateProfile({ ...p, deadzone: 1 })); assert.throws(() => validateProfile({ ...p, deadmanButton: -1 }));
  assert.throws(() => validateProfile({ ...p, sensitivity: NaN })); assert.throws(() => validateProfile({ ...p, bindings: {} }));
  assert.equal(shape(.1, .12, .3), 0); assert.equal(shape(1, .12, .3), 1); assert.equal(shape(-1, .12, .3), -1);
});
test('simulated lower controller rejects expired or stopped packets independently', () => {
  const sim = new Simulator(); const packet = { armed: true, deadman: true, estop: false, ttlMs: 350, actions: { heave: -1 } };
  sim.apply(packet); sim.step(1); assert.equal(sim.telemetry().depth, .7);
  sim.received -= 1000; sim.step(1); assert.equal(sim.telemetry().depth, .7);
  sim.apply({ ...packet, estop: true }); sim.step(1); assert.equal(sim.telemetry().depth, .7);
});
