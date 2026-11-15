import { Controller, ControlError } from './controller.mjs';
import { Simulator } from './simulator.mjs';
import { applyStationCommand } from './commands.mjs';

// One SharedWorker owns one simulated ROV for all demo tabs in this browser.
// There is deliberately no network or physical transport here.
export class DemoStation {
  constructor(clock) {
    this.controller = new Controller(clock); this.simulator = new Simulator();
    this.sessions = new Map(); this.stationId = crypto.randomUUID(); this.stateSeq = 0;
    this.controller.events = []; this.controller.event('GitHub Pages · автономная демонстрация');
  }
  session(token) {
    const session = this.sessions.get(token);
    if (!session || !this.controller.clients.has(session.id)) throw new ControlError('Войдите в демонстрацию', 401);
    this.controller.touch(session.id); return session;
  }
  snapshot(id) {
    this.controller.tick();
    return { ...this.controller.snapshot(id), stationId: this.stationId, stateSeq: ++this.stateSeq,
      packet: this.controller.packet(false), telemetry: this.simulator.telemetry(), cameraConfigured: false, demo: true };
  }
  request(path, data, token) {
    let session;
    try {
      if (path === 'info') return { status: 200, body: { pinRequired: true, pinLength: 1, mode: 'demo' } };
      if (path === 'login') {
        if (!data || typeof data.name !== 'string') throw new ControlError('Введите имя', 400);
        if (String(data.pin ?? '') !== '1') throw new ControlError('Демонстрационный код: 1', 401);
        if (this.sessions.size >= 100) throw new ControlError('Достигнут лимит участников', 429);
        const id = crypto.randomUUID(), token = crypto.randomUUID();
        const name = this.controller.addClient(id, data.name);
        this.sessions.set(token, { id }); return { status: 200, body: { id, token, name } };
      }
      session = this.session(token);
      if (path === 'logout') { this.controller.removeClient(session.id); this.sessions.delete(token); }
      else if (path !== 'state') applyStationCommand(this.controller, session.id, path, data);
      return { status: 200, body: this.snapshot(session.id) };
    } catch (error) {
      return { status: error.status || 500, body: { error: error.status ? error.message : 'Ошибка демонстрации',
        ...(session && this.controller.clients.has(session.id) ? { state: this.snapshot(session.id) } : {}) } };
    }
  }
  step(dt) {
    const packet = this.controller.packet(); this.simulator.apply(packet); this.simulator.step(dt);
    for (const [token, session] of this.sessions) if (!this.controller.clients.has(session.id)) this.sessions.delete(token);
  }
}
