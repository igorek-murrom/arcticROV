// Adapter boundary: apply(packet), step(dt), telemetry(). No physical I/O in this version.
export class Simulator {
  constructor() {
    this.state = { depth: 0, yaw: 0, pitch: 0, roll: 0, voltage: 16.8, current: 0.4, temperature: -0.8, x: 0, y: 0, cameraTilt: 0, grip: 0.5, wrist: 0, light: 0 };
  }
  apply(packet) { this.packet = structuredClone(packet); this.received = performance.now(); }
  step(dt) {
    const s = this.state; const p = this.packet;
    // Simulated lower-controller watchdog, independent of the upper controller.
    const a = p && p.armed && p.deadman && !p.estop && performance.now() - this.received < p.ttlMs ? p.actions : {};
    s.depth = Math.max(0, s.depth - (a.heave || 0) * dt * 0.7);
    s.yaw = (s.yaw + (a.yaw || 0) * dt * 40 + 360) % 360;
    const r = s.yaw * Math.PI / 180;
    s.x += ((a.surge || 0) * Math.sin(r) + (a.sway || 0) * Math.cos(r)) * dt * 0.8;
    s.y += ((a.surge || 0) * Math.cos(r) - (a.sway || 0) * Math.sin(r)) * dt * 0.8;
    s.cameraTilt = Math.max(-80, Math.min(80, s.cameraTilt + (a.cameraTilt || 0) * dt * 35));
    s.grip = Math.max(0, Math.min(1, s.grip + (a.grip || 0) * dt * 0.5));
    s.wrist = Math.max(-180, Math.min(180, s.wrist + (a.wrist || 0) * dt * 40));
    s.light = a.light || 0; s.current = 0.4 + Object.values(a).reduce((n, v) => n + Math.abs(v), 0) * 2;
    s.voltage = Math.max(12, s.voltage - s.current * dt / 30000);
    s.pitch += ((a.surge || 0) * 4 - s.pitch) * dt * 2;
    s.roll += ((a.sway || 0) * 5 - s.roll) * dt * 2;
  }
  telemetry() { return { mode: 'simulator', ...this.state }; }
}
