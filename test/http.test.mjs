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
  assert.equal((await request('command', { seq: 1, epoch, issuedAt: state.serverTime, deadman: false, values: neutral() }, a.token)).status, 200);
  assert.equal((await request('arm', { epoch }, a.token)).status, 200);
  state = (await request('state', undefined, a.token)).body;
  assert.equal((await request('command', { seq: 2, epoch, issuedAt: state.serverTime, deadman: true, values: { ...neutral(), surge: .5 } }, a.token)).status, 200);
  assert.equal((await request('command', { seq: 3, epoch, issuedAt: state.serverTime, deadman: true, values: { ...neutral(), surge: 99 } }, a.token)).status, 400);
  assert.equal((await request('takeover', {}, b.token)).status, 200);
  state = (await request('respond', { accept: true }, a.token)).body;
  assert.equal(state.owner.id, b.id); assert.equal(state.armed, false); assert.equal(state.epoch, null);
  assert.equal((await request('estop', {}, a.token)).body.estop, true);
  assert.equal((await request('reset', {}, a.token)).status, 403);
  assert.equal((await request('camera', undefined, a.token)).status, 404);
  const page = await fetch(base); assert.equal(page.status, 200); assert.match(await page.text(), /АРКТИКА/);
  for (const asset of ['/app.mjs', '/scene.mjs', '/styles.css', '/shared/actions.mjs', '/shared/input.mjs']) assert.equal((await fetch(base + asset)).status, 200);
  assert.equal((await fetch(base + '/server/index.mjs')).status, 404);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});

test('HTTP: closing operator event stream immediately releases control', async t => {
  const station = createStation(); await new Promise(resolve => station.server.listen(0, '127.0.0.1', resolve)); t.after(() => station.close());
  const base = 'http://127.0.0.1:' + station.server.address().port;
  const headers = { 'Content-Type': 'application/json' };
  const session = await (await fetch(base + '/api/login', { method: 'POST', headers, body: JSON.stringify({ name: 'Stream' }) })).json();
  headers.Authorization = 'Bearer ' + session.token;
  const stream = await fetch(base + '/api/events', { headers }); const reader = stream.body.getReader(); await reader.read();
  await fetch(base + '/api/claim', { method: 'POST', headers, body: '{}' }); assert.equal(station.controller.owner, session.id);
  await reader.cancel();
  // Wait for the socket's close event, bounded to 500 ms.
  for (let i = 0; i < 50 && station.controller.owner; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(station.controller.owner, null); assert.equal(station.controller.armed, false);
});
