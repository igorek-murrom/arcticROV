export function createScene(canvas) {
  const ctx = canvas.getContext('2d');
  let telemetry = { x: 0, y: 0, yaw: 0, depth: 0, cameraTilt: 0, light: 0 }; let active = true;
  let seed = 287; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rocks = Array.from({ length: 90 }, () => ({ x: (rand() - .5) * 90, z: (rand() - .5) * 100, size: .15 + rand() * 1.2, shade: rand() }));
  const particles = Array.from({ length: 100 }, () => ({ x: rand(), y: rand(), z: .2 + rand() * .8, speed: rand() }));
  function render(t) {
    requestAnimationFrame(render); if (!active || document.hidden || !canvas.clientWidth) return;
    const dpr = Math.min(2, devicePixelRatio || 1); const width = Math.round(canvas.clientWidth * dpr); const height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const w = width, h = height, s = telemetry; const horizon = h * (.38 + s.cameraTilt / 240); const focal = w * .9;
    const water = ctx.createLinearGradient(0, 0, 0, h); water.addColorStop(0, '#122f38'); water.addColorStop(.45, '#123b43'); water.addColorStop(1, '#0b272f');
    ctx.fillStyle = water; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalAlpha = .1;
    for (let i = 0; i < 7; i++) {
      const x = w * (i / 7 + .05); const beam = ctx.createLinearGradient(x, 0, x + w * .22, h);
      beam.addColorStop(0, '#a4c7bc'); beam.addColorStop(1, '#32575a00'); ctx.fillStyle = beam;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * .08, 0); ctx.lineTo(x + w * .4, h); ctx.lineTo(x + w * .15, h); ctx.fill();
    }
    ctx.restore();
    const floor = ctx.createLinearGradient(0, horizon, 0, h); floor.addColorStop(0, '#183d41'); floor.addColorStop(1, '#254449');
    ctx.fillStyle = floor; ctx.fillRect(0, Math.max(0, horizon), w, h);
    const angle = s.yaw * Math.PI / 180; const ca = Math.cos(angle), sa = Math.sin(angle);
    const cameraHeight = Math.max(1.1, 8 - s.depth * .4);
    function project(x, z, y = 0) {
      const dx = x - s.x, dz = z - s.y; const rx = dx * ca - dz * sa, rz = dx * sa + dz * ca;
      if (rz < .5) return null;
      return { x: w / 2 + rx / rz * focal, y: horizon + (cameraHeight - y) / rz * focal, scale: focal / rz, z: rz };
    }
    // A faint floor grid makes motion visible without pretending to be real video.
    ctx.strokeStyle = '#84aea41a'; ctx.lineWidth = dpr * .7;
    for (let i = -50; i <= 50; i += 2) {
      for (const endpoints of [[[i, -50], [i, 70]], [[-50, i], [50, i]]]) {
        const points = [];
        for (let j = 0; j <= 40; j++) { const a = j / 40; const p = project(endpoints[0][0] * (1 - a) + endpoints[1][0] * a, endpoints[0][1] * (1 - a) + endpoints[1][1] * a); if (p) points.push(p); }
        ctx.beginPath(); points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
      }
    }
    const visible = rocks.map(rock => ({ ...rock, p: project(rock.x, rock.z) })).filter(r => r.p && r.p.y < h * 1.3).sort((a, b) => b.p.z - a.p.z);
    for (const rock of visible) {
      const p = rock.p, size = rock.size * p.scale;
      if (p.x < -size || p.x > w + size) continue;
      ctx.fillStyle = '#071f252b'; ctx.beginPath(); ctx.ellipse(p.x + size * .3, p.y, size * 1.3, size * .25, 0, 0, Math.PI * 2); ctx.fill();
      const shade = Math.round(45 + rock.shade * 20); ctx.fillStyle = `rgb(${shade},${shade + 25},${shade + 26})`;
      ctx.beginPath(); ctx.moveTo(p.x - size, p.y); ctx.lineTo(p.x - size * .7, p.y - size * .57); ctx.lineTo(p.x - size * .15, p.y - size * .85); ctx.lineTo(p.x + size * .7, p.y - size * .5); ctx.lineTo(p.x + size, p.y); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#77948b22'; ctx.beginPath(); ctx.moveTo(p.x - size * .7, p.y - size * .57); ctx.lineTo(p.x - size * .15, p.y - size * .85); ctx.lineTo(p.x + size * .7, p.y - size * .5); ctx.lineTo(p.x, p.y - size * .35); ctx.fill();
    }
    // Reference survey target at a fixed position in the simulated world.
    const target = project(0, 16, .05);
    if (target) {
      const scale = target.scale; ctx.save(); ctx.translate(target.x, target.y);
      ctx.strokeStyle = '#b5c7a58a'; ctx.lineWidth = Math.max(1, scale * .03); ctx.beginPath(); ctx.ellipse(0, 0, scale * 1.2, scale * .38, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#c3d2b77a'; ctx.beginPath(); ctx.moveTo(-scale * 1.5, 0); ctx.lineTo(scale * 1.5, 0); ctx.moveTo(0, -scale * .5); ctx.lineTo(0, scale * .5); ctx.stroke();
      if (scale > 8) { ctx.font = `${Math.max(8 * dpr, scale * .15)}px monospace`; ctx.fillStyle = '#b1cdb18c'; ctx.textAlign = 'center'; ctx.fillText('SIM / TARGET 01', 0, -scale * .75); } ctx.restore();
    }
    const fog = ctx.createLinearGradient(0, horizon - h * .12, 0, horizon + h * .38); fog.addColorStop(0, '#16424a00'); fog.addColorStop(.3, '#16424ab0'); fog.addColorStop(1, '#16424a00'); ctx.fillStyle = fog; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#b0d4ce';
    for (const p of particles) {
      const x = ((p.x + t * .000004 * p.z - s.yaw / 400 * p.z - s.x * .01 * p.z) % 1 + 1) % 1 * w;
      const y = ((p.y - t * .000009 * p.speed + s.depth * .03 * p.z) % 1 + 1) % 1 * h;
      ctx.globalAlpha = p.z * .25; ctx.beginPath(); ctx.arc(x, y, dpr * p.z * 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (s.light) { const light = ctx.createRadialGradient(w / 2, h * .6, 0, w / 2, h * .6, w * .5); light.addColorStop(0, '#d6e6b92a'); light.addColorStop(1, '#d6e6b900'); ctx.fillStyle = light; ctx.fillRect(0, 0, w, h); }
    const vignette = ctx.createRadialGradient(w / 2, h / 2, w * .12, w / 2, h / 2, w * .65); vignette.addColorStop(0, '#020f1900'); vignette.addColorStop(1, '#020f19b8'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
  }
  requestAnimationFrame(render);
  return { update: t => { telemetry = t; }, setActive: value => { active = value; } };
}
