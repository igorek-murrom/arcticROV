import test from 'node:test';
import assert from 'node:assert/strict';
import { createStation } from '../server/index.mjs';
import { neutral } from '../shared/actions.mjs';

test('HTTP: authenticated clients, arbitration, commands, emergency stop and static files', async t => {
  const station = createStation({ accessPin: 'test-pin' });
  await new Promise(resolve => station.server.listen(0, '127.0.0.1', resolve)); t.after(() => station.close());
  const base = 'http://127.0.0.1:' + station.server.address().port;
  async function request(path, data, token, extraHeaders = {}) {
    const res = await fetch(base + '/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extraHeaders }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: await res.json() };
  }
  assert.equal((await request('state')).status, 401);
  assert.equal((await request('login', null)).status, 400);
  assert.equal((await request('login', [])).status, 400);
  assert.equal((await request('login', { name: 'A', pin: 'wrong' })).status, 401);
  assert.equal((await request('login', { name: 'A', pin: 'test-pin' }, null, { Origin: 'https://evil.example' })).status, 403);
  const a = (await request('login', { name: 'A', pin: 'test-pin' })).body;
  const b = (await request('login', { name: '<script>alert(1)</script>', pin: 'test-pin' })).body;
  let state = (await request('claim', {}, a.token)).body;
  assert.equal(state.owner.id, a.id); assert.equal((await request('claim', {}, b.token)).status, 409);
  assert.equal((await request('arm', { epoch: state.epoch }, b.token)).status, 403);
  assert.equal((await request('arm', { epoch: state.epoch }, a.token)).status, 409);
  const epoch = state.epoch;
  assert.equal((await request('command', { seq: 1, epoch, safetyEpoch: state.safetyEpoch, issuedAt: state.serverTime, deadman: false, values: neutral() }, a.token)).status, 200);
  assert.equal((await request('arm', { epoch, safetyEpoch: state.safetyEpoch }, a.token)).status, 200);
  state = (await request('state', undefined, a.token)).body;
  assert.equal((await request('command', { seq: 2, epoch, safetyEpoch: state.safetyEpoch, issuedAt: state.serverTime, deadman: true, values: { ...neutral(), surge: .5 } }, a.token)).status, 200);
  assert.equal((await request('command', { seq: 3, epoch, safetyEpoch: state.safetyEpoch, issuedAt: state.serverTime, deadman: true, values: { ...neutral(), surge: 99 } }, a.token)).status, 400);
  const pending = await request('takeover', {}, b.token); assert.equal(pending.status, 200);
  state = (await request('respond', { accept: true, epoch, requestId: pending.body.request.requestId }, a.token)).body;
  assert.equal(state.owner.id, b.id); assert.equal(state.armed, false); assert.equal(state.epoch, null);
  assert.equal((await request('estop', {}, a.token)).body.estop, true);
  assert.equal((await request('reset', {}, a.token)).status, 403);
  assert.equal((await request('camera', undefined, a.token)).status, 404);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /АРКТИКА/);
  for (const asset of ['/app.mjs', '/scene.mjs', '/styles.css', '/shared/actions.mjs', '/shared/input.mjs', '/shared/session.mjs']) assert.equal((await fetch(base + asset)).status, 200);
  assert.equal((await fetch(base + '/server/index.mjs')).status, 404);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('HTTP: mobile stream reconnect preserves ownership, stops output and finally expires without heartbeat', async t => {
  let now = 1000;
  const station = createStation({ clock: () => now }); await new Promise(resolve => station.server.listen(0, '127.0.0.1', resolve)); t.after(() => station.close());
  const base = 'http://127.0.0.1:' + station.server.address().port;
  const headers = { 'Content-Type': 'application/json' };
  const session = await (await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ name: 'Stream' }) })).json();
  headers.Authorization = 'Bearer ' + session.token;
  const stream = await fetch(base + '/api/events', { headers }); const reader = stream.body.getReader(); await reader.read();
  await fetch(base + '/api/claim', { method: 'POST', headers, body: '{}' }); assert.equal(station.controller.owner, session.id);
  await reader.cancel();
  // Wait for the socket close to disarm, but do not discard the mobile operator.
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(station.controller.owner, session.id); assert.equal(station.controller.armed, false);
  const restored = await fetch(base + '/api/events', { headers }); const restoredReader = restored.body.getReader(); await restoredReader.read();
  const state = await (await fetch(base + '/api/state', { headers })).json();
  const heartbeat = await fetch(base + '/api/heartbeat', { method: 'POST', headers, body: JSON.stringify({ epoch: state.epoch }) });
  assert.equal(heartbeat.status, 200);
  await restoredReader.cancel(); now += 2001; station.controller.tick();
  assert.equal(station.controller.owner, null);
});
