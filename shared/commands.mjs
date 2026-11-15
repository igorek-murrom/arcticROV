import { ControlError } from './controller.mjs';

export function applyStationCommand(controller, id, path, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ControlError('Ожидается JSON-объект', 400);
  if (['release', 'respond', 'disarm', 'reset', 'mark'].includes(path)) controller.requireLease(id, data.epoch);
  switch (path) {
    case 'claim': controller.claim(id); break;
    case 'release': controller.release(id); break;
    case 'takeover': controller.takeover(id); break;
    case 'respond':
      if (typeof data.accept !== 'boolean') throw new ControlError('Ожидается accept', 400);
      controller.respond(id, data.accept, data.requestId); break;
    case 'cancel-takeover': controller.cancelTakeover(id, data.requestId); break;
    case 'heartbeat': controller.heartbeat(id, data.epoch); break;
    case 'command': controller.command(id, data); break;
    case 'arm': controller.arm(id, data.epoch, data.safetyEpoch); break;
    case 'disarm': controller.disarm(id); break;
    case 'estop': controller.emergency(id); break;
    case 'reset': controller.reset(id, data.safetyEpoch); break;
    case 'mark':
      controller.requireOwner(id);
      if (typeof data.text !== 'string' || data.text.length > 200 || !data.text.trim()) throw new ControlError('Введите отметку до 200 символов', 400);
      controller.event('Отметка: ' + data.text.trim()); break;
    default: throw new ControlError('Маршрут не найден', 404);
  }
}
