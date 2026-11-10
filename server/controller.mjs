import { randomUUID } from 'node:crypto';
import { actions, axisActions, neutral } from '../shared/actions.mjs';
import { vehicle, mixThrusters } from './vehicle.mjs';

export class ControlError extends Error { constructor(message, status = 409) { super(message); this.status = status; } }
export class Controller {
  constructor(now = () => performance.now()) {
    this.now = now; this.clients = new Map(); this.owner = null; this.epoch = null; this.request = null;
    this.armed = false; this.estop = false; this.values = neutral(); this.seq = -1; this.lastCommand = 0;
    this.events = []; this.packetSeq = 0; this.reason = 'Ожидание оператора';
    this.event('Станция запущена · симулятор');
  }
  event(text) { this.events.unshift({ time: new Date().toISOString(), text }); this.events.length = Math.min(100, this.events.length); }
  addClient(id, name) { this.clients.set(id, { id, name, lastSeen: this.now() }); }
  touch(id) { const c = this.clients.get(id); if (!c) throw new ControlError('Сеанс завершён', 401); c.lastSeen = this.now(); }
  stop(reason) { this.armed = false; this.values = neutral(); this.lastDeadman = false; this.inputNeutral = false; this.reason = reason; }
  requireOwner(id, epoch) {
    if (this.owner !== id || (epoch !== undefined && this.epoch !== epoch)) throw new ControlError('Управление принадлежит другому оператору', 403);
  }
  claim(id) {
    this.tick(); this.touch(id);
    if (this.owner && this.owner !== id) throw new ControlError('Аппаратом уже управляют. Запросите передачу.');
    if (this.owner === id) return;
    this.assign(id);
  }
  assign(id) {
    this.stop('Получено управление · выходы выключены'); this.owner = id; this.epoch = randomUUID(); this.seq = -1;
    this.lastCommand = this.now(); this.leaseUntil = this.now() + 2000; this.request = null;
    this.event('Управление: ' + this.clients.get(id).name);
  }
  release(id) {
    this.requireOwner(id); this.stop('Управление свободно'); this.owner = null; this.epoch = null; this.request = null;
    this.event('Оператор освободил управление');
  }
  disconnect(id) { if (this.owner === id) this.release(id); if (this.request?.id === id) this.request = null; }
  takeover(id) {
    this.tick(); this.touch(id);
    if (!this.owner) return this.claim(id);
    if (this.owner === id) throw new ControlError('Вы уже оператор');
    if (this.request && this.request.id !== id) throw new ControlError('Уже есть запрос от другого участника');
    this.request = { id, name: this.clients.get(id).name, until: this.now() + 15000 };
  }
  respond(id, accept) {
    this.tick(); this.requireOwner(id);
    if (!this.request) throw new ControlError('Запрос истёк');
    if (accept) this.assign(this.request.id); else this.request = null;
  }
  validateCommand(data) {
    if (!data || !Number.isSafeInteger(data.seq) || data.seq < 0 || typeof data.deadman !== 'boolean' || typeof data.issuedAt !== 'number' || !Number.isFinite(data.issuedAt)) throw new ControlError('Неверный пакет', 400);
    if (!data.values || Object.keys(data.values).length !== actions.length) throw new ControlError('Неверный набор действий', 400);
    for (const a of actions) {
      const v = data.values[a.id];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1 || v > 1 || (a.kind === 'toggle' && v !== 0 && v !== 1)) throw new ControlError('Неверное значение ' + a.id, 400);
    }
    if (this.now() - data.issuedAt > 400 || data.issuedAt > this.now() + 100) throw new ControlError('Пакет устарел');
    if (data.seq <= this.seq) throw new ControlError('Повторный или переставленный пакет');
  }
  command(id, data) {
    this.tick(); this.requireOwner(id);
    if (!data || typeof data.epoch !== 'string' || this.epoch !== data.epoch) throw new ControlError('Устаревшее право управления', 403);
    this.validateCommand(data); this.touch(id);
    this.seq = data.seq; this.lastCommand = this.now(); this.leaseUntil = this.now() + 2000;
    this.inputNeutral = axisActions.every(a => Math.abs(data.values[a.id]) < 0.02) && !data.deadman;
    this.values = this.armed && !this.estop && data.deadman ? { ...data.values } : neutral();
    this.lastDeadman = data.deadman;
  }
  arm(id, epoch) {
    this.tick(); this.requireOwner(id);
    if (typeof epoch !== 'string' || epoch !== this.epoch) throw new ControlError('Устаревшее право управления', 403);
    if (this.estop) throw new ControlError('Сначала сбросьте аварийную остановку');
    if (!this.inputNeutral || this.now() - this.lastCommand > 350) throw new ControlError('Отпустите клавиши, стики и кнопку разрешения');
    this.armed = true; this.reason = 'Готов · удерживайте разрешение движения'; this.event('Выходы разрешены');
  }
  disarm(id) { this.requireOwner(id); this.stop('Выходы выключены'); this.event('Выходы выключены'); }
  emergency(id) { this.touch(id); this.estop = true; this.stop('Аварийная остановка'); this.event('Аварийная остановка: ' + this.clients.get(id).name); }
  reset(id) {
    this.requireOwner(id);
    if (!this.inputNeutral || this.now() - this.lastCommand > 350) throw new ControlError('Для сброса отпустите управление');
    this.estop = false; this.stop('Остановка сброшена · включите выходы заново'); this.event('Аварийная остановка сброшена');
  }
  tick() {
    const now = this.now();
    if (this.owner && now > this.leaseUntil) { this.stop('Оператор потерял связь'); this.owner = null; this.epoch = null; this.request = null; this.event('Управление освобождено по тайм-ауту'); }
    if (this.armed && now - this.lastCommand > 350) { this.stop('Нет свежих команд · выходы выключены'); this.event('Защита: потеря команд'); }
    if (this.request && now > this.request.until) this.request = null;
    for (const [id, c] of this.clients) if (now - c.lastSeen > 60_000 && this.owner !== id) this.clients.delete(id);
  }
  packet() {
    this.tick();
    return { protocol: 'rov-control', version: 1, seq: ++this.packetSeq, serverTime: this.now(), ttlMs: 350,
      armed: this.armed, estop: this.estop, deadman: this.armed && !!this.lastDeadman && !this.estop,
      thrusters: mixThrusters(this.values), actions: { ...this.values } };
  }
  snapshot(id) {
    return { serverTime: this.now(), me: id, owner: this.owner ? { id: this.owner, name: this.clients.get(this.owner)?.name } : null,
      epoch: id === this.owner ? this.epoch : null, armed: this.armed, estop: this.estop, reason: this.reason,
      request: this.request ? { id: this.request.id, name: this.request.name } : null,
      clients: [...this.clients.values()].filter(c => this.now() - c.lastSeen < 5000).map(c => ({ id: c.id, name: c.name })),
      events: this.events, vehicle };
  }
}
