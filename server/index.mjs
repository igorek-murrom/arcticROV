import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { Controller, ControlError } from './controller.mjs';
import { Simulator } from './simulator.mjs';

export const generateAccessPin = () => String(randomInt(0, 10));

export function createStation({ accessPin = '', cameraUrl = '', clock } = {}) {
  const controller = new Controller(clock); const adapter = new Simulator();
  const sessions = new Map(); const streams = new Map(); const attempts = new Map();
  const stationId = randomUUID(); let stateSeq = 0;
  let packet = controller.packet(); let previous = performance.now(); let broadcastCounter = 0;
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  async function json(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new ControlError('Требуется JSON', 415);
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 16384) throw new ControlError('Слишком большой запрос', 413); }
    let data;
    try { data = JSON.parse(body); } catch { throw new ControlError('Некорректный JSON', 400); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ControlError('Ожидается JSON-объект', 400);
    return data;
  }
  function state(id) { controller.tick(); return { ...controller.snapshot(id), stationId, stateSeq: ++stateSeq, packet: controller.packet(false), telemetry: adapter.telemetry(), cameraConfigured: !!cameraUrl }; }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    let authenticatedId;
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw new ControlError('Чужой источник запроса', 403);
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress; const attempt = attempts.get(ip) || { n: 0, time: Date.now() };
        if (Date.now() - attempt.time > 60000) { attempt.n = 0; attempt.time = Date.now(); }
        if (attempt.n >= 15) throw new ControlError('Слишком много попыток. Подождите минуту.', 429);
        const data = await json(req); attempt.n++; attempts.set(ip, attempt);
        const provided = Buffer.from(String(data.pin ?? '')); const expected = Buffer.from(accessPin);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new ControlError('Неверный код доступа', 401);
        if (typeof data.name !== 'string' || data.name.trim().length < 1 || data.name.trim().length > 40) throw new ControlError('Введите имя до 40 символов', 400);
        if (sessions.size >= 100) throw new ControlError('Достигнут лимит участников', 429);
        const token = randomBytes(32).toString('hex'); const id = randomBytes(8).toString('hex');
        const name = controller.addClient(id, data.name);
        sessions.set(token, { id, lastSeen: Date.now() });
        res.setHeader('Set-Cookie', `rov_camera=${token}; HttpOnly; SameSite=Strict; Path=/api/camera; Max-Age=43200`);
        return send(res, 200, { token, id, name });
      }
      if (url.pathname === '/api/info') return send(res, 200, { pinRequired: !!accessPin, pinLength: accessPin.length, mode: 'simulator' });
      if (url.pathname.startsWith('/api/')) {
        const cameraToken = url.pathname === '/api/camera' ? req.headers.cookie?.split('; ').find(c => c.startsWith('rov_camera='))?.slice(11) : null;
        const token = req.headers.authorization?.replace(/^Bearer /, '') || cameraToken; const session = sessions.get(token);
        if (!session) throw new ControlError('Войдите на станцию', 401);
        session.lastSeen = Date.now(); const id = session.id; authenticatedId = id; controller.touch(id);
        if (url.pathname === '/api/events' && req.method === 'GET') {
          if ([...streams.values()].some(s => s.id === id)) {
            return send(res, 409, { error: 'Сеанс уже открыт в другой вкладке. Войдите с отдельным именем.', code: 'session_in_use' });
          }
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('data: ' + JSON.stringify(state(id)) + '\n\n'); streams.set(res, { id });
          res.on('close', () => { streams.delete(res); if (![...streams.values()].some(s => s.id === id)) controller.streamClosed(id); });
          return;
        }
        if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, state(id));
        if (url.pathname === '/api/camera' && req.method === 'GET') {
          if (!cameraUrl) throw new ControlError('Камера не настроена', 404);
          const abort = new AbortController(); res.on('close', () => abort.abort());
          const timeout = setTimeout(() => abort.abort(), 5000);
          let upstream; try { upstream = await fetch(cameraUrl, { signal: abort.signal, redirect: 'error' }); } finally { clearTimeout(timeout); }
          if (!upstream.ok || !/^(multipart\/x-mixed-replace|image\/)/i.test(upstream.headers.get('content-type') || '')) throw new ControlError('Нужен поток MJPEG или JPEG', 502);
          res.writeHead(200, { 'Content-Type': upstream.headers.get('content-type') });
          const readable = Readable.fromWeb(upstream.body); readable.on('error', () => res.destroy()); readable.pipe(res); return;
        }
        if (req.method !== 'POST') throw new ControlError('Маршрут не найден', 404);
        const data = await json(req);
        if (['/api/release', '/api/respond', '/api/disarm', '/api/reset', '/api/mark'].includes(url.pathname)) controller.requireLease(id, data.epoch);
        switch (url.pathname) {
          case '/api/claim': controller.claim(id); break;
          case '/api/release': controller.release(id); break;
          case '/api/takeover': controller.takeover(id); break;
          case '/api/respond': if (typeof data.accept !== 'boolean') throw new ControlError('Ожидается accept', 400); controller.respond(id, data.accept, data.requestId); break;
          case '/api/cancel-takeover': controller.cancelTakeover(id, data.requestId); break;
          case '/api/heartbeat': controller.heartbeat(id, data.epoch); break;
          case '/api/command': controller.command(id, data); break;
          case '/api/arm': controller.arm(id, data.epoch, data.safetyEpoch); break;
          case '/api/disarm': controller.disarm(id); break;
          case '/api/estop': controller.emergency(id); break;
          case '/api/reset': controller.reset(id, data.safetyEpoch); break;
          case '/api/mark': {
            controller.requireOwner(id);
            if (typeof data.text !== 'string' || data.text.length > 200 || !data.text.trim()) throw new ControlError('Введите отметку до 200 символов', 400);
            controller.event('Отметка: ' + data.text.trim()); break;
          }
          case '/api/logout': for (const [stream, s] of streams) if (s.id === id) { streams.delete(stream); stream.end(); } controller.removeClient(id); sessions.delete(token); break;
          default: throw new ControlError('Маршрут не найден', 404);
        }
        return send(res, 200, state(id));
      }
      const files = { '/': ['public/index.html', 'text/html; charset=utf-8'], '/app.mjs': ['public/app.mjs', 'text/javascript'], '/scene.mjs': ['public/scene.mjs', 'text/javascript'], '/styles.css': ['public/styles.css', 'text/css'], '/shared/actions.mjs': ['shared/actions.mjs', 'text/javascript'], '/shared/input.mjs': ['shared/input.mjs', 'text/javascript'], '/shared/session.mjs': ['shared/session.mjs', 'text/javascript'] };
      const target = files[url.pathname]; if (!target || req.method !== 'GET') throw new ControlError('Страница не найдена', 404);
      const body = await readFile(new URL('../' + target[0], import.meta.url)); res.writeHead(200, { 'Content-Type': target[1] }); res.end(body);
    } catch (e) { if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Ошибка станции', ...(authenticatedId && controller.clients.has(authenticatedId) ? { state: state(authenticatedId) } : {}) }); else res.end(); }
  });
  const timer = setInterval(() => {
    const now = performance.now(); const dt = Math.min(0.1, (now - previous) / 1000); previous = now;
    controller.tick(); packet = controller.packet(); adapter.apply(packet); adapter.step(dt);
    if (++broadcastCounter % 2 === 0) for (const [res, s] of streams) {
      try { controller.touch(s.id); if (res.writableLength > 256000) res.destroy(); else res.write('data: ' + JSON.stringify(state(s.id)) + '\n\n'); } catch { res.end(); }
    }
    for (const [token, s] of sessions) if (!controller.clients.has(s.id) || Date.now() - s.lastSeen > 12 * 3600000) {
      for (const [stream, client] of streams) if (client.id === s.id) { streams.delete(stream); stream.end(); }
      controller.removeClient(s.id); sessions.delete(token);
    }
    for (const [ip, a] of attempts) if (Date.now() - a.time > 60000) attempts.delete(ip);
  }, 50);
  timer.unref();
  return { server, controller, adapter, close: async () => { clearInterval(timer); controller.stop('Станция выключена'); adapter.apply(controller.packet()); for (const res of streams.keys()) res.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT || 8080);
  const pin = process.env.ACCESS_PIN || (host !== '127.0.0.1' && host !== 'localhost' ? generateAccessPin() : '');
  const station = createStation({ accessPin: pin, cameraUrl: process.env.CAMERA_URL || '' });
  station.server.listen(port, host, () => {
    console.log(`\nАРКТИКА / Станция управления · СИМУЛЯТОР\nhttp://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
    if (pin) console.log('Код доступа для участников:', pin);
    console.log('Физический аппарат не подключён. Ctrl+C — завершить.');
  });
  station.server.on('error', e => { console.error('Не удалось запустить станцию:', e.message); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await station.close(); process.exit(0); });
}
