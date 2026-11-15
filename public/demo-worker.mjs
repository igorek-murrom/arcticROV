import { DemoStation } from './shared/demo-station.mjs';

const station = new DemoStation();
const subscribers = new Map(); let previous = performance.now(), tick = 0;
function attach(port) {
  const send = message => port.postMessage(message);
  port.onmessage = ({ data }) => {
    const { id, kind, path, body, token } = data;
    if (kind === 'unsubscribe') {
      const sub = subscribers.get(port);
      if (sub?.id === id) { subscribers.delete(port); station.controller.streamClosed(sub.clientId); }
      return;
    }
    if (kind === 'subscribe') {
      try {
        const session = station.session(token);
        if ([...subscribers.values()].some(s => s.clientId === session.id)) {
          send({ id, kind: 'result', status: 409, body: { error: 'Сеанс открыт в другой вкладке', code: 'session_in_use' } }); return;
        }
        subscribers.set(port, { id, clientId: session.id, token });
        send({ id, kind: 'result', status: 200 }); send({ id, kind: 'event', body: station.snapshot(session.id) });
      } catch (e) { send({ id, kind: 'result', status: e.status || 500, body: { error: e.message } }); }
      return;
    }
    const result = station.request(path, body, token); send({ id, kind: 'result', ...result });
    if (path === 'logout' && result.status === 200) {
      const sub = subscribers.get(port); if (sub) { send({ id: sub.id, kind: 'end' }); subscribers.delete(port); }
    }
  };
  port.start?.();
}
if ('onconnect' in globalThis) globalThis.onconnect = event => attach(event.ports[0]);
else attach(globalThis);
setInterval(() => {
  const now = performance.now(); station.step(Math.min(.1, (now - previous) / 1000)); previous = now;
  if (++tick % 2) return;
  for (const [port, sub] of subscribers) {
    try { station.session(sub.token); port.postMessage({ id: sub.id, kind: 'event', body: station.snapshot(sub.clientId) }); }
    catch { try { port.postMessage({ id: sub.id, kind: 'end' }); } catch {} subscribers.delete(port); }
  }
}, 50);
