import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildPages } from '../scripts/build-pages.mjs';
import { DemoStation } from '../shared/demo-station.mjs';
import { neutral } from '../shared/actions.mjs';
import { commandContext } from '../shared/session.mjs';

function demoFixture() {
  let time = 1000, seq = 0; const demo = new DemoStation(() => time);
  const login = name => demo.request('login', { name, pin: 1 }).body;
  const a = login('Оператор'), b = login('Оператор');
  const request = (path, data = {}, token = a.token) => demo.request(path, data, token);
  request('claim');
  const state = () => request('state').body;
  const command = (values = {}, extra = {}) => request('command', { ...commandContext(state(), ++seq), values: { ...neutral(), ...values }, deadman: false, ...extra });
  return { demo, a, b, request, state, command, advance: ms => { time += ms; demo.step(ms / 1000); } };
}
test('Pages demo supports unique logins, authorization and shared operator handover', () => {
  const { demo, a, b, request, state } = demoFixture();
  assert.equal(a.name, 'Оператор'); assert.equal(b.name, 'Оператор 2');
  assert.equal(demo.request('login', { name: 'Test', pin: '0' }).status, 401);
  assert.equal(demo.request('state', undefined, 'wrong-token').status, 401);
  assert.equal(request('claim', {}, b.token).status, 409);
  const pending = request('takeover', {}, b.token).body;
  const result = request('respond', { epoch: state().epoch, requestId: pending.request.requestId, accept: true });
  assert.equal(result.status, 200); assert.equal(result.body.owner.id, b.id); assert.equal(result.body.armed, false);
  assert.equal(demo.snapshot(b.id).epoch !== null, true);
});
test('Pages demo moves the simulated vehicle and stops independently of heartbeat', () => {
  const { request, state, command, advance } = demoFixture();
  assert.equal(command().status, 200);
  assert.equal(request('arm', { epoch: state().epoch, safetyEpoch: state().safetyEpoch }).status, 200);
  assert.equal(command({ heave: -1, surge: .5, light: 1 }, { deadman: true }).status, 200);
  advance(100); const moved = state();
  assert.ok(moved.telemetry.depth > 0); assert.ok(moved.telemetry.y > 0); assert.equal(moved.telemetry.light, 1);
  assert.ok(moved.packet.thrusters.some(x => x !== 0));
  advance(400); request('heartbeat', { epoch: state().epoch });
  assert.equal(state().armed, false); assert.ok(state().packet.thrusters.every(x => x === 0));
});
test('Pages demo supports emergency stop, reset, equipment, marks and logout', () => {
  const { demo, a, b, request, state, command } = demoFixture();
  assert.equal(request('estop', {}, b.token).status, 200); assert.equal(state().owner.id, a.id);
  command(); assert.equal(request('reset', { epoch: state().epoch, safetyEpoch: state().safetyEpoch }).status, 200);
  assert.equal(state().armed, false);
  assert.equal(request('mark', { epoch: state().epoch, text: 'Тестовая отметка' }).status, 200);
  assert.ok(state().events.some(e => e.text.includes('Тестовая отметка')));
  assert.equal(request('logout').status, 200); assert.equal(demo.controller.owner, null);
  assert.equal(demo.request('state', undefined, a.token).status, 401);
});
test('Pages build runs from a project subpath, contains browser-only imports and preserves local mode', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'arctica-pages-')); t.after(() => rm(directory, { recursive: true, force: true }));
  await buildPages(pathToFileURL(directory + '/'));
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  assert.match(html, /src="\.\/app\.mjs"/); assert.match(html, /href="\.\/styles\.css"/); assert.match(html, /href="\.\/"/);
  assert.match(await readFile(join(directory, 'runtime.mjs'), 'utf8'), /demoMode = true/);
  assert.match(await readFile(new URL('../public/runtime.mjs', import.meta.url), 'utf8'), /demoMode = false/);
  await access(join(directory, '.nojekyll')); await assert.rejects(access(join(directory, 'server')));
  async function verify(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await verify(path);
      else if (entry.name.endsWith('.mjs')) {
        const source = await readFile(path, 'utf8'); assert.doesNotMatch(source, /from\s+['"](?:node:|\/)/, entry.name);
        for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) await access(new URL(match[1], pathToFileURL(path)));
      }
    }
  }
  await verify(directory);
});
