import test from 'node:test';
import assert from 'node:assert/strict';
import { Controller } from '../server/controller.mjs';
import { createStation, generateAccessPin } from '../server/index.mjs';
import { neutral } from '../shared/actions.mjs';
import { ownsControl, acceptsState, commandContext } from '../shared/session.mjs';

function fixture() {
  let now = 1000, seq = 0; const c = new Controller(() => now);
  c.addClient('phone', 'Оператор'); c.addClient('laptop', 'Оператор'); c.claim('phone');
  const command = (extra = {}) => c.command('phone', { ...commandContext(c.snapshot('phone'), ++seq), values: neutral(), deadman: false, ...extra });
  return { c, command, advance: ms => { now += ms; c.tick(); } };
}
test('mobile operator keeps its lease through emergency stop and resets it without another-operator error', () => {
  const { c, command, advance } = fixture(); command(); c.arm('phone', c.epoch, c.safetyEpoch);
  c.emergency('phone'); const epoch = c.epoch;
  for (let i = 0; i < 12; i++) { advance(500); c.heartbeat('phone', epoch); }
  assert.equal(c.owner, 'phone'); assert.equal(c.estop, true); assert.equal(c.armed, false);
  command(); c.reset('phone', c.safetyEpoch); assert.equal(c.owner, 'phone'); assert.equal(c.estop, false); assert.equal(c.armed, false);
});
test('heartbeat keeps ownership but never refreshes thrust or automatically rearms', () => {
  const { c, command, advance } = fixture(); command(); c.arm('phone', c.epoch, c.safetyEpoch);
  command({ deadman: true, values: { ...neutral(), surge: 1 } });
  for (let i = 0; i < 12; i++) { advance(500); c.heartbeat('phone', c.epoch); }
  assert.equal(c.owner, 'phone'); assert.equal(c.armed, false); assert.ok(c.packet().thrusters.every(x => x === 0));
});
test('transient mobile stream loss is immediately neutral and preserves the same owner', () => {
  const { c, command, advance } = fixture(); command(); c.arm('phone', c.epoch, c.safetyEpoch);
  const epoch = c.epoch; c.streamClosed('phone'); assert.equal(c.owner, 'phone'); assert.equal(c.epoch, epoch); assert.equal(c.armed, false);
  advance(500); c.heartbeat('phone', epoch); assert.equal(c.owner, 'phone');
  advance(2001); assert.equal(c.owner, null);
});
test('late reset, arm and motion from before another emergency stop are rejected', () => {
  const { c, command } = fixture(); command(); const oldSafety = c.safetyEpoch;
  c.emergency('phone'); const stopSafety = c.safetyEpoch; command();
  assert.throws(() => c.arm('phone', c.epoch, oldSafety)); assert.throws(() => command({ safetyEpoch: oldSafety }));
  c.emergency('laptop'); command(); assert.throws(() => c.reset('phone', stopSafety)); assert.equal(c.estop, true);
  c.reset('phone', c.safetyEpoch); assert.equal(c.armed, false);
});
test('names are unique after case, whitespace and Unicode normalization and reusable after logout', () => {
  const c = new Controller(() => 1000);
  assert.equal(c.addClient('a', '  Игорь  '), 'Игорь'); assert.equal(c.addClient('b', 'игорь'), 'игорь 2');
  assert.equal(c.addClient('c', 'ИГОРЬ'), 'ИГОРЬ 3');
  assert.equal(c.addClient('d', 'Ａlice'), 'Alice'); assert.equal(c.addClient('e', 'Alice'), 'Alice 2');
  c.removeClient('a'); assert.equal(c.addClient('f', 'Игорь'), 'Игорь');
  const long = 'Я'.repeat(40); c.addClient('g', long); assert.equal(c.addClient('h', long).length, 40);
});
test('takeover cancellation, stale confirmation, repeated request and disconnected requester are handled', () => {
  const { c } = fixture(); c.takeover('laptop'); const first = c.request.requestId;
  c.takeover('laptop'); assert.equal(c.request.requestId, first);
  c.cancelTakeover('laptop', first); c.takeover('laptop'); const second = c.request.requestId;
  assert.notEqual(first, second); assert.throws(() => c.respond('phone', true, first)); assert.equal(c.owner, 'phone');
  c.streamClosed('laptop'); assert.equal(c.request, null); assert.throws(() => c.respond('phone', true, second));
});
test('ownership cannot be modified by a delayed action from an older lease', () => {
  const { c } = fixture(); const old = c.epoch; c.release('phone'); c.claim('phone');
  assert.throws(() => c.requireLease('phone', old)); assert.throws(() => c.heartbeat('phone', old));
  assert.equal(c.owner, 'phone'); c.takeover('laptop'); c.respond('phone', true, c.request.requestId);
  assert.equal(c.owner, 'laptop'); assert.throws(() => c.requireLease('phone', old));
});
test('browser rejects reordered state and does not confuse empty identities with an operator', () => {
  const { c } = fixture(); const current = { ...c.snapshot('phone'), stationId: 's', stateSeq: 10 };
  assert.equal(ownsControl(current), true); assert.equal(ownsControl(current, false), false);
  assert.equal(ownsControl({}), false); assert.equal(ownsControl({ me: null, owner: null }), false);
  assert.equal(acceptsState(current, { ...current, stateSeq: 9 }), false);
  assert.equal(acceptsState(current, { ...current, stateSeq: 10 }), false);
  assert.equal(acceptsState(current, { ...current, stateSeq: 11 }), true);
  assert.equal(acceptsState(current, { ...current, me: 'laptop', stateSeq: 11 }), false);
});
test('default access PIN is exactly one decimal digit, including zero-compatible input', () => {
  for (let i = 0; i < 100; i++) assert.match(generateAccessPin(), /^\d$/);
});
test('HTTP: zero PIN, unique concurrent names, state on errors, stale transfer and duplicate stream', async t => {
  const station = createStation({ accessPin: '0' }); await new Promise(resolve => station.server.listen(0, '127.0.0.1', resolve)); t.after(() => station.close());
  const base = 'http://127.0.0.1:' + station.server.address().port;
  async function api(path, data, token) {
    const res = await fetch(base + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  const names = await Promise.all(Array.from({ length: 3 }, () => api('login', { name: 'Оператор', pin: 0 })));
  assert.ok(names.every(n => n.status === 200)); assert.equal(new Set(names.map(n => n.body.name)).size, 3);
  const [phone, laptop] = names.map(n => n.body);
  const claimed = (await api('claim', {}, phone.token)).body; const epoch = claimed.epoch;
  const stopped = (await api('estop', {}, phone.token)).body;
  assert.equal(stopped.owner.id, phone.id); assert.equal(stopped.me, phone.id); assert.equal(stopped.packet.armed, false); assert.ok(stopped.packet.thrusters.every(v => v === 0));
  const conflict = await api('reset', { epoch }, laptop.token);
  assert.equal(conflict.status, 403); assert.equal(conflict.body.state.owner.id, phone.id); assert.equal(conflict.body.state.me, laptop.id);
  const pending = (await api('takeover', {}, laptop.token)).body;
  assert.equal((await api('respond', { epoch, accept: true, requestId: 'obsolete' }, phone.token)).status, 409);
  assert.equal((await api('respond', { epoch, accept: true, requestId: pending.request.requestId }, phone.token)).body.owner.id, laptop.id);
  assert.equal((await api('release', { epoch }, phone.token)).status, 403);
  const stream = await fetch(base + '/api/events', { headers: { Authorization: 'Bearer ' + laptop.token } }); const reader = stream.body.getReader(); await reader.read();
  const duplicate = await fetch(base + '/api/events', { headers: { Authorization: 'Bearer ' + laptop.token } });
  assert.equal(duplicate.status, 409); assert.equal((await duplicate.json()).code, 'session_in_use');
  await reader.cancel();
});
