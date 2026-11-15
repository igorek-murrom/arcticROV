export function createDemoTransport() {
  const workerUrl = new URL('./demo-worker.mjs', import.meta.url);
  let shared = typeof SharedWorker !== 'undefined', worker;
  try { worker = shared ? new SharedWorker(workerUrl, { type: 'module', name: 'arctica-pages-v1' }) : new Worker(workerUrl, { type: 'module' }); }
  catch { shared = false; worker = new Worker(workerUrl, { type: 'module' }); }
  const port = shared ? worker.port : worker;
  const pending = new Map(), streams = new Map(); let sequence = 0;
  const encoder = new TextEncoder();
  port.onmessage = ({ data }) => {
    const { id, kind, body, status } = data;
    if (kind === 'event') { streams.get(id)?.enqueue(encoder.encode('data: ' + JSON.stringify(body) + '\n\n')); return; }
    if (kind === 'end') { streams.get(id)?.close(); streams.delete(id); return; }
    const task = pending.get(id); if (!task) return; pending.delete(id); task.cleanup?.();
    if (task.stream && status === 200) {
      const stream = new ReadableStream({
        start(controller) { streams.set(id, controller); },
        cancel() { streams.delete(id); port.postMessage({ id, kind: 'unsubscribe' }); }
      });
      task.signal?.addEventListener('abort', () => {
        streams.get(id)?.error(new DOMException('Соединение закрыто', 'AbortError')); streams.delete(id); port.postMessage({ id, kind: 'unsubscribe' });
      }, { once: true });
      task.resolve(new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    } else task.resolve(new Response(JSON.stringify(body || {}), { status, headers: { 'Content-Type': 'application/json' } }));
  };
  worker.onerror = () => {
    for (const task of pending.values()) { task.cleanup?.(); task.reject(Error('Не удалось запустить симулятор в браузере')); }
    pending.clear(); for (const stream of streams.values()) stream.error(Error('Симулятор остановлен')); streams.clear();
  };
  port.start?.();
  window.addEventListener('pagehide', () => { for (const id of streams.keys()) port.postMessage({ id, kind: 'unsubscribe' }); });
  return {
    shared,
    fetch(url, options = {}) {
      if (options.signal?.aborted) return Promise.reject(options.signal.reason);
      const path = new URL(url, location.href).pathname.split('/api/')[1];
      if (!path) return Promise.reject(Error('Неизвестный маршрут демонстрации'));
      const id = ++sequence, token = new Headers(options.headers).get('Authorization')?.replace(/^Bearer /, '');
      return new Promise((resolve, reject) => {
        const abort = () => { pending.delete(id); reject(new DOMException('Запрос отменён', 'AbortError')); };
        pending.set(id, { resolve, reject, stream: path === 'events', signal: options.signal,
          cleanup: () => options.signal?.removeEventListener('abort', abort) });
        options.signal?.addEventListener('abort', abort, { once: true });
        port.postMessage({ id, kind: path === 'events' ? 'subscribe' : 'request', path, token, body: options.body ? JSON.parse(options.body) : undefined });
      });
    }
  };
}
