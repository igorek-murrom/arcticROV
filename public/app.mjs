import { actions, defaultProfile, validateProfile } from '/shared/actions.mjs';
import { InputMapper } from '/shared/input.mjs';
import { createScene } from '/scene.mjs';

const $ = id => document.getElementById(id);
let profile = defaultProfile();
try { const saved = localStorage.getItem('arctica.profile'); if (saved) profile = validateProfile(JSON.parse(saved)); } catch { /* Invalid saved profiles fall back to safe defaults. */ }
let token = sessionStorage.getItem('arctica.token'); let state = null, connected = false, lastStateAt = 0, seq = 0;
let keys = new Set(), capture = null, sending = false, cameraConfigured = null;
const inputMapper = new InputMapper();
let currentTab = 'pilot', streamAbort = null, commandAbort = null, reconnectTimer = null, toastTimer;
const started = Date.now(), samples = [], depthHistory = [], recordedEvents = new Map();
const scene = createScene($('scene'));
function text(id, value) { $(id).textContent = value; }
function toast(message) { text('toast', message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5000); }
function isOwner() { return connected && state?.owner?.id === state?.me; }
function editable() { if (state?.armed && isOwner()) { toast('Сначала выключите выходы'); return false; } return true; }
function saveProfile() { try { localStorage.setItem('arctica.profile', JSON.stringify(profile)); } catch { toast('Браузер не разрешает сохранить профиль'); } }
function readableKey(code) { return code?.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→') || '—'; }
async function api(path, data, { quiet = false, signal } = {}) {
  const begin = performance.now();
  try {
    const response = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: data === undefined ? undefined : JSON.stringify(data), signal: signal || AbortSignal.timeout(2000) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 401 && path !== 'login') showLogin(); throw Error(result.error || 'Ошибка запроса'); }
    if (result.serverTime !== undefined) { receive(result); text('footer-status', 'СВЯЗЬ ' + Math.round(performance.now() - begin) + ' мс · ВЕРХНИЙ БЛОК'); }
    return result;
  } catch (error) { if (!quiet && error.name !== 'AbortError') toast(error.message); throw error; }
}
function receive(next) {
  if (state && next.serverTime < state.serverTime) return;
  const previousOwner = state?.owner?.id; const previousEpoch = state?.epoch;
  state = next; connected = true; lastStateAt = performance.now();
  if (previousOwner !== state.owner?.id || previousEpoch !== state.epoch) { keys.clear(); inputMapper.reset(); seq = 0; commandAbort?.abort(); }
  for (const event of state.events) recordedEvents.set(event.time + event.text, event);
  render();
}
function setConnection(value) {
  connected = value; $('connection-dot').style.background = value ? 'var(--accent)' : 'var(--red)';
  text('connection-text', value ? 'Станция на связи' : 'Нет связи'); $('connection-alert').hidden = value || !state;
  if (!value) text('footer-status', 'СВЯЗЬ ПОТЕРЯНА');
  else if ($('footer-status').textContent === 'СВЯЗЬ ПОТЕРЯНА' || $('footer-status').textContent === 'Ожидание подключения') text('footer-status', 'СВЯЗЬ АКТИВНА · ВЕРХНИЙ БЛОК');
  if (!value) { keys.clear(); inputMapper.reset(); $('arm').disabled = true; $('light-toggle').disabled = true; }
}
async function connect() {
  clearTimeout(reconnectTimer); streamAbort?.abort(); const abort = new AbortController(); streamAbort = abort;
  try {
    const response = await fetch('/api/events', { headers: { Authorization: 'Bearer ' + token }, signal: abort.signal });
    if (!response.ok) { if (response.status === 401) { token = null; sessionStorage.removeItem('arctica.token'); showLogin(); return; } throw Error('Станция недоступна'); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); let index;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const message = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (message.startsWith('data: ')) { receive(JSON.parse(message.slice(6))); setConnection(true); }
      }
    }
  } catch (error) { if (abort.signal.aborted) return; }
  if (!abort.signal.aborted && token) { setConnection(false); reconnectTimer = setTimeout(connect, 1500); }
}
async function showLogin() {
  streamAbort?.abort(); clearTimeout(reconnectTimer); setConnection(false);
  try { const info = await api('info', undefined, { quiet: true }); $('pin-field').hidden = !info.pinRequired; } catch { /* Login still allows retry. */ }
  if (!$('login-dialog').open) $('login-dialog').showModal();
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); text('login-error', '');
  try {
    const result = await api('login', { name: $('login-name').value, pin: $('login-pin').value }, { quiet: true });
    token = result.token; sessionStorage.setItem('arctica.token', token); $('login-pin').value = '';
    localStorage.setItem('arctica.name', $('login-name').value); text('user-button', $('login-name').value.slice(0, 1).toUpperCase());
    $('login-dialog').close(); state = null; cameraConfigured = null; connect();
  } catch (error) { text('login-error', error.message); }
});
$('login-dialog').addEventListener('cancel', event => event.preventDefault());
$('user-button').onclick = async () => { try { await api('logout', {}); } catch {} token = null; sessionStorage.removeItem('arctica.token'); showLogin(); };
try { const name = localStorage.getItem('arctica.name'); if (name) { $('login-name').value = name; text('user-button', name.slice(0, 1).toUpperCase()); } } catch {}

function go(tab) {
  keys.clear(); currentTab = tab;
  if (isOwner() && state.armed) void safeDisarm();
  for (const element of document.querySelectorAll('.tab-panel')) element.hidden = element.id !== tab;
  for (const element of document.querySelectorAll('[data-tab]')) element.classList.toggle('active', element.dataset.tab === tab);
  text('page-title', { pilot: 'Пилотирование', controls: 'Управление', system: 'Аппарат и пакеты', journal: 'Журнал' }[tab]);
  scene.setActive(tab === 'pilot' && !state?.cameraConfigured);
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => go(button.dataset.tab));
document.querySelectorAll('[data-go]').forEach(button => button.onclick = () => go(button.dataset.go));
function download(name, data, mime = 'application/json') { const blob = new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: mime }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
const timestamp = () => new Date().toISOString().replaceAll(':', '-').slice(0, 19);
function exportSession() { download('arctica-session-' + timestamp() + '.json', { version: 1, mode: 'simulator', started: new Date(started).toISOString(), exported: new Date().toISOString(), vehicle: state?.vehicle, profile, events: [...recordedEvents.values()], samples }); toast('Скачан журнал с телеметрией и пакетами. Видео в экспорт не входит.'); }
$('export-session').onclick = exportSession;
$('export-log').onclick = () => download('arctica-events-' + timestamp() + '.json', [...recordedEvents.values()]);
$('mark-button').onclick = () => { if (!isOwner()) return toast('Отметки добавляет оператор'); $('mark-dialog').showModal(); $('mark-text').focus(); };
$('cancel-mark').onclick = () => $('mark-dialog').close();
$('mark-form').onsubmit = async event => { event.preventDefault(); try { await api('mark', { text: $('mark-text').value }); $('mark-dialog').close(); $('mark-text').value = ''; toast('Отметка добавлена'); } catch {} };
$('claim').onclick = async () => { try { await api(isOwner() ? 'release' : state?.owner ? 'takeover' : 'claim', {}); if (!isOwner() && state?.owner) toast('Запрос отправлен текущему оператору'); } catch {} };
$('accept-takeover').onclick = () => api('respond', { accept: true }).catch(() => {});
$('reject-takeover').onclick = () => api('respond', { accept: false }).catch(() => {});
async function safeDisarm() { keys.clear(); inputMapper.reset(); commandAbort?.abort(); try { await api('disarm', {}, { quiet: true }); } catch {} }
$('arm').onclick = async () => {
  if (state?.armed) return safeDisarm();
  if (!isOwner()) return;
  keys.clear(); inputMapper.reset();
  try {
    // Do not clear a physically held gamepad input to pretend it is neutral.
    const input = readInput();
    await api('command', { seq: ++seq, epoch: state.epoch, issuedAt: state.serverTime, ...input });
    await api('arm', { epoch: state.epoch });
  } catch {}
};
$('reset').onclick = async () => { try { await api('reset', {}); } catch {} };
async function emergency() { keys.clear(); inputMapper.reset(); commandAbort?.abort(); try { await api('estop', {}); } catch {} }
$('estop').onclick = emergency;
$('light-toggle').onclick = () => { if (isOwner() && state.armed) inputMapper.toggle('light'); };
$('fullscreen').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else $('viewport').requestFullscreen().catch(() => toast('Полный экран недоступен')); };
$('camera-image').onerror = () => { text('stream-status', 'Нет изображения с камеры'); toast('Поток камеры недоступен. Проверьте CAMERA_URL на верхнем блоке.'); };

function bindCapture(button, apply) {
  button.onclick = () => {
    if (!editable()) return;
    if (capture) { capture.button.classList.remove('capturing'); renderProfile(); }
    keys.clear(); capture = { button, apply }; button.textContent = 'Нажмите…'; button.classList.add('capturing');
  };
}
function renderProfile() {
  $('device').value = profile.device; $('sensitivity').value = profile.sensitivity * 100;
  text('sensitivity-value', Math.round(profile.sensitivity * 100) + '%');
  $('deadzone').value = profile.deadzone * 100; text('deadzone-value', Math.round(profile.deadzone * 100) + '%');
  $('expo').value = profile.expo * 100; text('expo-value', Math.round(profile.expo * 100) + '%');
  text('deadman-key', readableKey(profile.deadmanKey)); $('deadman-button').value = profile.deadmanButton;
  const body = $('bindings'); body.replaceChildren(); let group = '';
  for (const action of actions) {
    if (group !== action.group) { group = action.group; const row = document.createElement('tr'); row.className = 'map-group'; const cell = document.createElement('td'); cell.colSpan = 7; cell.textContent = group.toUpperCase(); row.append(cell); body.append(row); }
    const row = document.createElement('tr'); const label = document.createElement('td'); label.textContent = action.label; row.append(label);
    const binding = profile.bindings[action.id];
    for (const key of ['negative', 'positive']) {
      const td = document.createElement('td'), button = document.createElement('button'); button.className = 'key-bind'; button.textContent = readableKey(binding[key]);
      button.setAttribute('aria-label', action.label + ' клавиша ' + key); button.disabled = action.kind === 'toggle' && key === 'negative';
      bindCapture(button, code => { binding[key] = code; saveProfile(); renderProfile(); }); td.append(button); row.append(td);
    }
    for (const key of ['axis', 'buttonNegative', 'buttonPositive']) {
      const td = document.createElement('td'), input = document.createElement('input'); input.type = 'number'; input.min = -1; input.max = 63; input.value = binding[key]; input.setAttribute('aria-label', action.label + ' ' + key);
      input.disabled = action.kind === 'toggle' && key !== 'buttonPositive'; input.onchange = () => { if (!editable()) return renderProfile(); const n = Number(input.value); if (!Number.isInteger(n) || n < -1 || n > 63) { toast('Укажите целое число от −1 до 63'); return renderProfile(); } binding[key] = n; saveProfile(); }; td.append(input); row.append(td);
    }
    const td = document.createElement('td'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = binding.invert; input.disabled = action.kind === 'toggle'; input.setAttribute('aria-label', action.label + ' инверсия оси');
    input.onchange = () => { if (!editable()) return renderProfile(); binding.invert = input.checked; saveProfile(); }; td.append(input); row.append(td); body.append(row);
  }
  bindCapture($('deadman-key'), code => { if (!code) return toast('Кнопка разрешения обязательна'); profile.deadmanKey = code; saveProfile(); renderProfile(); });
  renderHints();
}
function renderHints() {
  const hints = document.querySelector('.keyboard-hints'); hints.replaceChildren();
  for (const [id, label] of [['surge', 'Вперёд / назад'], ['sway', 'Вправо / влево'], ['yaw', 'Разворот'], ['heave', 'Вниз / вверх']]) {
    const span = document.createElement('span');
    for (const key of ['negative', 'positive']) { const k = document.createElement('kbd'); k.textContent = readableKey(profile.bindings[id][key]); span.append(k); }
    span.append(' ' + label); hints.append(span);
  }
  text('deadman-label', profile.device === 'keyboard' ? readableKey(profile.deadmanKey) : 'B' + profile.deadmanButton);
}
for (const [id, key] of [['sensitivity', 'sensitivity'], ['deadzone', 'deadzone'], ['expo', 'expo']]) $(id).oninput = () => { if (!editable()) return renderProfile(); profile[key] = Number($(id).value) / 100; saveProfile(); text(id + '-value', Math.round(profile[key] * 100) + '%'); };
$('device').onchange = () => { if (!editable()) return renderProfile(); profile.device = $('device').value; keys.clear(); inputMapper.reset(); saveProfile(); renderHints(); };
$('deadman-button').onchange = () => { if (!editable()) return renderProfile(); const n = Number($('deadman-button').value); if (!Number.isInteger(n) || n < 0 || n > 63) { toast('Укажите индекс 0–63'); return renderProfile(); } profile.deadmanButton = n; saveProfile(); };
$('export-profile').onclick = () => download('arctica-controls.json', profile);
$('import-profile').onclick = () => { if (editable()) $('profile-file').click(); };
$('profile-file').onchange = async () => {
  try { if (!editable()) return; const file = $('profile-file').files[0]; if (!file) return; if (file.size > 30000) throw Error('Профиль слишком большой'); profile = validateProfile(JSON.parse(await file.text())); saveProfile(); renderProfile(); toast('Профиль импортирован'); } catch (error) { toast(error.message); } finally { $('profile-file').value = ''; }
};
$('default-profile').onclick = () => { if (!editable()) return; profile = defaultProfile(); saveProfile(); renderProfile(); toast('Восстановлены стандартные привязки'); };
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { if (token && !$('login-dialog').open) { event.preventDefault(); void emergency(); } if (capture) { capture = null; renderProfile(); } return; }
  if (capture) {
    event.preventDefault(); const c = capture; capture = null; c.button.classList.remove('capturing');
    const code = event.code === 'Backspace' ? '' : event.code;
    try { const test = structuredClone(profile); test.deadmanKey = code || 'Space'; validateProfile(test); c.apply(code); } catch { toast('Эта клавиша не поддерживается'); renderProfile(); } return;
  }
  if (currentTab !== 'pilot' || !isOwner() || document.querySelector('dialog[open]') || /INPUT|SELECT|TEXTAREA/.test(event.target.tagName)) return;
  const used = event.code === profile.deadmanKey || actions.some(a => [profile.bindings[a.id].negative, profile.bindings[a.id].positive].includes(event.code));
  if (used && !event.repeat) keys.add(event.code);
  if (used) event.preventDefault();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); if (isOwner() && state.armed) void safeDisarm(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); if (isOwner()) void safeDisarm(); } });
window.addEventListener('gamepaddisconnected', () => { if (profile.device === 'gamepad' && isOwner()) void safeDisarm(); });
function gamepad() { try { return [...(navigator.getGamepads?.() || [])].find(Boolean); } catch { return null; } }
function readInput() {
  return inputMapper.sample(profile, { keys, pad: gamepad(),
    active: currentTab === 'pilot' && !document.hidden && document.hasFocus() && !capture && !document.querySelector('dialog[open]'),
    allowToggles: isOwner() && state.armed });
}
function setMeter(id, value) {
  const bar = $(id); if (!bar) return; bar.style.left = (value < 0 ? 50 + value / 2 : 50) + '%'; bar.style.width = Math.abs(value) / 2 + '%';
}
for (const [id, label] of [['surge', 'Вперёд'], ['sway', 'Вбок'], ['heave', 'Вертикаль'], ['yaw', 'Разворот']]) {
  const row = document.createElement('div'); row.className = 'axis-meter'; row.innerHTML = `<span>${label}</span><div class="axis-track"><i class="axis-fill" id="axis-${id}"></i></div><b id="axis-value-${id}">0</b>`; $('axis-meters').append(row);
}
for (let i = 0; i < 6; i++) { const row = document.createElement('div'); row.className = 'thruster'; row.innerHTML = `<span>T${i + 1}</span><div class="axis-track"><i class="axis-fill" id="thruster-${i}"></i></div><b id="thruster-value-${i}">0</b>`; $('thrusters').append(row); }
function render() {
  if (!state) return;
  const t = state.telemetry, owner = isOwner(), ready = state.armed && owner;
  for (const id of ['depth', 'pitch', 'roll', 'voltage', 'current', 'temperature']) text(id, t[id].toFixed(id === 'depth' ? 2 : 1));
  text('yaw', String(Math.round(t.yaw) % 360).padStart(3, '0')); $('compass').querySelector('i').style.transform = `rotate(${t.yaw}deg)`;
  $('battery-fill').style.width = Math.max(0, Math.min(100, (t.voltage - 12) / 4.8 * 100)) + '%';
  text('hud-heading', String(Math.round(t.yaw) % 360).padStart(3, '0') + '°'); text('hud-depth', t.depth.toFixed(1) + ' м');
  text('hud-position', `X ${t.x.toFixed(1)} / Y ${t.y.toFixed(1)}`); text('hud-tilt', 'КАМЕРА ' + Math.round(t.cameraTilt) + '°');
  text('camera-tilt', Math.round(t.cameraTilt) + '°'); text('grip', Math.round(t.grip * 100) + '%'); text('wrist', Math.round(t.wrist) + '°');
  $('light-toggle').classList.toggle('on', !!t.light); $('light-toggle').setAttribute('aria-pressed', String(!!t.light)); $('light-toggle').disabled = !ready;
  text('participant-count', state.clients.length + ' в сети');
  text('ownership-title', owner ? 'Вы управляете аппаратом' : state.owner ? 'Идёт управление · ' + state.owner.name : 'Управление свободно');
  text('ownership-description', owner ? state.reason : state.owner ? 'Вы наблюдаете. Можно запросить передачу управления.' : 'Получите управление для начала работы');
  text('claim', owner ? 'Освободить управление' : state.owner ? (state.request?.id === state.me ? 'Запрос отправлен' : 'Забрать управление ↗') : 'Получить управление ↗');
  $('claim').disabled = !connected || state.request?.id === state.me;
  $('arm').disabled = !owner || state.estop; text('arm', state.armed ? '○ Выключить выходы' : '◉ Включить выходы');
  text('armed-badge', state.estop ? 'АВАРИЙНЫЙ СТОП' : state.armed ? 'ВЫХОДЫ ВКЛ.' : 'ВЫКЛЮЧЕН'); $('armed-badge').className = 'badge ' + (state.armed ? 'green-badge' : 'muted-badge');
  $('reset').hidden = !state.estop || !owner; $('estop-overlay').hidden = !state.estop;
  $('mark-button').disabled = !owner;
  $('takeover-banner').hidden = !owner || !state.request; if (state.request) text('takeover-text', state.request.name + ' запрашивает управление. При передаче выходы выключатся.');
  $('device').disabled = ready; $('sensitivity').disabled = ready;
  for (let i = 0; i < state.packet.thrusters.length; i++) { const power = state.packet.thrusters[i]; setMeter('thruster-' + i, power); text('thruster-value-' + i, power > 0 ? '+' + power : power); }
  if (currentTab === 'system') text('packet-preview', JSON.stringify(state.packet, null, 2));
  text('camera-config', state.cameraConfigured ? 'MJPEG / JPEG с верхнего блока' : 'Виртуальная');
  if (cameraConfigured !== state.cameraConfigured) {
    cameraConfigured = state.cameraConfigured; $('camera-image').hidden = !cameraConfigured; $('scene').hidden = cameraConfigured;
    document.querySelector('.scene-caption').hidden = cameraConfigured;
    text('camera-label', cameraConfigured ? 'КАМЕРА АППАРАТА' : 'ВИРТУАЛЬНАЯ КАМЕРА'); text('scene-mode', cameraConfigured ? 'ТЕЛЕМЕТРИЯ: SIM' : 'СИНТЕТИЧЕСКАЯ СЦЕНА');
    text('stream-status', cameraConfigured ? 'Внешняя камера · телеметрия SIM' : 'Симулятор активен');
    if (cameraConfigured) $('camera-image').src = '/api/camera'; scene.setActive(!cameraConfigured && currentTab === 'pilot');
  }
  scene.update(t);
  const log = $('event-log'); if (log.dataset.latest !== state.events[0]?.time + state.events[0]?.text) {
    log.dataset.latest = state.events[0]?.time + state.events[0]?.text; log.replaceChildren();
    for (const event of state.events) { const row = document.createElement('div'); row.className = 'event-row'; const time = document.createElement('time'); time.textContent = new Date(event.time).toLocaleTimeString('ru-RU'); time.dateTime = event.time; const label = document.createElement('span'); label.textContent = event.text; row.append(time, label); log.append(row); }
  }
}
setInterval(async () => {
  const input = readInput();
  for (const id of ['surge', 'sway', 'heave', 'yaw']) { const value = isOwner() ? Math.round(input.values[id] * 100) : 0; setMeter('axis-' + id, value); text('axis-value-' + id, value); }
  $('deadman-state').classList.toggle('active', isOwner() && state.armed && input.deadman);
  if (sending || !isOwner() || document.hidden || performance.now() - lastStateAt > 350) return;
  sending = true; commandAbort = new AbortController(); const timeout = setTimeout(() => commandAbort?.abort(), 300);
  try { await api('command', { seq: ++seq, epoch: state.epoch, issuedAt: state.serverTime, ...input }, { quiet: true, signal: commandAbort.signal }); }
  catch {} finally { sending = false; clearTimeout(timeout); }
}, 50);
setInterval(() => {
  if (connected && performance.now() - lastStateAt > 500) { setConnection(false); streamAbort?.abort(); reconnectTimer = setTimeout(connect, 100); }
  const pad = gamepad(); text('device-status', profile.device === 'keyboard' ? 'Клавиатура готова' : pad ? 'Геймпад подключён' : !window.isSecureContext ? 'Для геймпада нужен HTTPS или localhost' : 'Подключите геймпад и нажмите кнопку');
  text('pad-name', pad ? pad.id : 'Подключите геймпад и нажмите на нём кнопку.');
  text('pad-values', pad ? 'Оси: ' + pad.axes.map((n, i) => `A${i} ${n.toFixed(2)}`).join(' · ') + '\nКнопки: ' + pad.buttons.map((b, i) => b.pressed ? 'B' + i : '').filter(Boolean).join(', ') : '');
  const elapsed = Math.floor((Date.now() - started) / 1000); const time = [Math.floor(elapsed / 3600), Math.floor(elapsed / 60) % 60, elapsed % 60].map(v => String(v).padStart(2, '0')).join(':');
  text('session-timer', time); text('hud-time', time); text('clock', new Date().toLocaleTimeString('ru-RU', { timeZoneName: 'short' }));
  if (state && connected) {
    if (samples.length >= 7200) samples.shift(); samples.push({ time: new Date().toISOString(), telemetry: structuredClone(state.telemetry), packet: structuredClone(state.packet) });
    depthHistory.push(state.telemetry.depth); if (depthHistory.length > 60) depthHistory.shift();
    const max = Math.max(1, ...depthHistory); $('depth-spark').setAttribute('d', depthHistory.map((v, i) => `${i ? 'L' : 'M'}${i / 59 * 220} ${27 - v / max * 23}`).join(' '));
    text('recording-label', 'Телеметрия: ' + samples.length + ' с · экспорт в JSON');
  }
}, 1000);
renderProfile(); if (token) connect(); else showLogin();
