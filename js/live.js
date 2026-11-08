// Live / replay race dashboard powered by OpenF1, with an animated demo fallback
import { openf1, news } from './api.js';
import { createTrack } from './track3d.js';
import { esc, safeUrl, fmtLap, fmtGap, fmtTime, ytSearch, f1tvSearch, timeAgo, FALLBACK_GRID, teamColor } from './data.js';

const $ = (id) => document.getElementById(id);
const BIG = { ttl: 10 * 60_000, persist: false, timeout: 30_000 };

const S = {
  sessions: [],
  meetings: new Map(),
  session: null,
  demo: false,
  drivers: new Map(),
  data: { position: [], intervals: [], laps: [], stints: [], race_control: [], weather: [] },
  byDriver: { position: new Map(), intervals: new Map(), laps: new Map() },
  mode: 'replay', // replay | live
  t: 0,
  t0: 0,
  t1: 0,
  speed: 10,
  playing: false,
  liveTimer: null,
  selDriver: null,
  rows: new Map(), // driver -> <tr>
  lastRc: '',
};
let track;
let inited = false;
const ms = (d) => Date.parse(d);

function lastBefore(arr, t) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]._t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? arr[ans] : null;
}
function groupBy(rows, timeKey) {
  const m = new Map();
  for (const r of rows) {
    r._t ??= ms(r[timeKey]);
    if (!m.has(r.driver_number)) m.set(r.driver_number, []);
    m.get(r.driver_number).push(r);
  }
  for (const a of m.values()) a.sort((x, y) => x._t - y._t);
  return m;
}

export async function initLive() {
  if (inited) { track?.setActive(true); return; }
  inited = true;
  track = createTrack($('track-canvas'), $('track-tags'));
  $('replay-speed').value = String(S.speed);
  $('replay-speed').addEventListener('change', (e) => { S.speed = +e.target.value; });
  $('replay-toggle').addEventListener('click', togglePlay);
  $('session-select').addEventListener('change', (e) => loadSession(+e.target.value));
  $('lap-driver').addEventListener('change', (e) => selectDriver(+e.target.value));
  const seek = $('seek');
  seek.addEventListener('input', () => {
    if (S.mode === 'live') return;
    S.t = S.t0 + (S.t1 - S.t0) * (+seek.value / 1000);
    render();
  });
  loadNewsMini();
  requestAnimationFrame(tick);

  try {
    const year = new Date().getUTCFullYear();
    let [sessions, meetings] = await Promise.all([
      openf1('sessions', { year }, { ttl: 5 * 60_000 }),
      openf1('meetings', { year }, { ttl: 30 * 60_000 }).catch(() => []),
    ]);
    if (!sessions.length) {
      [sessions, meetings] = await Promise.all([openf1('sessions', { year: year - 1 }), openf1('meetings', { year: year - 1 }).catch(() => [])]);
    }
    meetings.forEach((m) => S.meetings.set(m.meeting_key, m));
    const now = Date.now();
    S.sessions = sessions.filter((s) => ms(s.date_start) < now).sort((a, b) => ms(b.date_start) - ms(a.date_start));
    if (!S.sessions.length) throw new Error('no sessions');
    $('session-select').innerHTML = S.sessions
      .map((s) => `<option value="${s.session_key}">${esc(meetingName(s))} — ${esc(s.session_name)}</option>`)
      .join('');
    const pick = S.sessions.find(isLive) || S.sessions.find((s) => s.session_type === 'Race') || S.sessions[0];
    $('session-select').value = pick.session_key;
    await loadSession(pick.session_key);
  } catch (err) {
    console.warn('OpenF1 unavailable, starting demo', err);
    startDemo();
  }
}

export function pauseLive() { track?.setActive(false); }

const meetingName = (s) => S.meetings.get(s.meeting_key)?.meeting_name || `${s.country_name} · ${s.circuit_short_name}`;
const isLive = (s) => {
  const now = Date.now();
  return ms(s.date_start) - 10 * 60_000 < now && now < ms(s.date_end) + 20 * 60_000;
};

function setStatus(html, cls = '') {
  const el = $('live-status');
  el.className = `eyebrow status ${cls}`;
  el.innerHTML = html;
}

function resetView() {
  stopLive();
  S.playing = false;
  S.selDriver = null;
  S.rows.clear();
  S.lastRc = '';
  $('tower').querySelector('tbody').innerHTML = '';
  track.clearCars();
}

async function loadSession(key) {
  resetView();
  S.demo = false;
  const s = S.sessions.find((x) => x.session_key === key);
  S.session = s;
  $('live-title').textContent = `${meetingName(s)} — ${s.session_name}`;
  $('live-sub').textContent = `${s.circuit_short_name}, ${s.country_name} · ${new Date(s.date_start).toLocaleString('ru-RU')}`;
  setStatus('Загрузка телеметрии…', 'loading');
  renderLinks();

  const live = isLive(s);
  const opts = live ? { ttl: 0, timeout: 30_000 } : BIG;
  const p = { session_key: key };
  const names = ['drivers', 'laps', 'position', 'stints', 'race_control', 'weather', 'intervals'];
  const res = await Promise.allSettled(names.map((n) => openf1(n, p, n === 'drivers' ? { ttl: 60 * 60_000 } : opts)));
  const get = (n) => { const r = res[names.indexOf(n)]; return r.status === 'fulfilled' ? r.value : []; };
  if (S.session !== s) return; // user switched meanwhile

  const drivers = get('drivers');
  if (!drivers.length || !get('laps').length) {
    if (live) {
      // real-time feed is subscription-only on OpenF1: show the demo and retry every minute
      startDemo(true);
      S.session = s;
      $('live-title').textContent = `${meetingName(s)} — ${s.session_name}`;
      setStatus('<span class="dot"></span> Сессия идёт · реалтайм OpenF1 закрыт, показываем демо', 'live');
      S.liveTimer = setInterval(() => loadSession(key), 60_000);
      return;
    }
    if (!drivers.length) { startDemo(); return; }
  }

  ingest({
    drivers, laps: get('laps'), position: get('position'), intervals: get('intervals'),
    stints: get('stints'), race_control: get('race_control'), weather: get('weather'),
  });

  await buildOutline();
  if (live) {
    S.mode = 'live';
    S.t = Date.now();
    setStatus('<span class="dot"></span> LIVE', 'live');
    startLive();
  } else {
    S.mode = 'replay';
    S.t = S.t0;
    S.playing = true;
    setStatus('▶ Повтор гонки · перематывайте шкалой', 'replay');
  }
  updatePlayBtn();
  render();
}

function ingest({ drivers, laps, position, intervals, stints, race_control, weather }) {
  S.drivers = new Map(drivers.map((d) => [d.driver_number, d]));
  S.data = { position, intervals, laps, stints, race_control, weather };
  S.byDriver.position = groupBy(position, 'date');
  S.byDriver.intervals = groupBy(intervals, 'date');
  indexLaps(laps);
  race_control.forEach((r) => (r._t ??= ms(r.date)));
  race_control.sort((a, b) => a._t - b._t);
  weather.forEach((w) => (w._t ??= ms(w.date)));
  weather.sort((a, b) => a._t - b._t);
  computeWindow();
  $('lap-driver').innerHTML = [...S.drivers.values()]
    .map((d) => `<option value="${d.driver_number}">${esc(d.name_acronym)} — ${esc(d.full_name)}</option>`)
    .join('');
}

function indexLaps(laps) {
  S.data.laps = laps;
  S.byDriver.laps = new Map();
  for (const l of laps) {
    if (!S.byDriver.laps.has(l.driver_number)) S.byDriver.laps.set(l.driver_number, []);
    S.byDriver.laps.get(l.driver_number).push(l);
  }
  for (const arr of S.byDriver.laps.values()) {
    arr.sort((a, b) => a.lap_number - b.lap_number);
    const durs = arr.map((l) => l.lap_duration).filter(Boolean).sort((a, b) => a - b);
    const med = durs[Math.floor(durs.length / 2)] || 90;
    arr.forEach((l) => { l._t = l.date_start ? ms(l.date_start) : null; l._est = l.lap_duration || med; });
    // OpenF1 often omits the start time of lap 1: derive it from lap 2
    for (let i = arr.length - 2; i >= 0; i--) {
      if (arr[i]._t == null && arr[i + 1]._t != null) arr[i]._t = arr[i + 1]._t - arr[i]._est * 1000;
    }
    for (let i = 1; i < arr.length; i++) {
      if (arr[i]._t == null && arr[i - 1]._t != null) arr[i]._t = arr[i - 1]._t + arr[i - 1]._est * 1000;
    }
  }
}

function computeWindow() {
  let first = Infinity, last = 0;
  for (const arr of S.byDriver.laps.values()) {
    for (const l of arr) {
      if (l._t == null) continue;
      first = Math.min(first, l._t);
      last = Math.max(last, l._t + (l.lap_duration || 0) * 1000);
    }
  }
  const lastPos = S.data.position.reduce((m, r) => Math.max(m, r._t || 0), 0);
  if (!isFinite(first)) first = S.session ? ms(S.session.date_start) : Date.now();
  S.t0 = first - 8000;
  S.t1 = Math.max(last, lastPos) + 3000;
}

async function buildOutline() {
  const lap = S.data.laps.find((l) => l.lap_number >= 3 && l.lap_duration && !l.is_pit_out_lap && l.date_start && l.lap_duration < 200);
  if (!lap) { track.setOutlineFallback(); return; }
  try {
    const pts = await openf1('location', {
      session_key: S.session.session_key, driver_number: lap.driver_number,
      'date>': new Date(ms(lap.date_start)).toISOString(),
      'date<': new Date(ms(lap.date_start) + lap.lap_duration * 1000).toISOString(),
    }, { ttl: 60 * 60_000, timeout: 30_000 });
    if (!track.setOutline(pts.filter((p) => p.x || p.y))) track.setOutlineFallback();
  } catch {
    track.setOutlineFallback();
  }
}

// ---------- car placement from lap timing ----------
function carProgress(num, t) {
  const arr = S.byDriver.laps.get(num);
  if (!arr?.length) return null;
  const first = arr.find((l) => l._t != null);
  if (!first) return null;
  if (t < first._t) return { lap: 0, frac: -0.004 * (gridPos(num) || 10) }; // lined up on the grid
  let cur = null;
  for (const l of arr) { if (l._t != null && l._t <= t) cur = l; else if (l._t > t) break; }
  const dur = (cur.lap_duration || cur._est) * 1000;
  const into = t - cur._t;
  if (into > dur) {
    // after the driver's last recorded lap: retired, or finished (park after the line)
    const isLast = cur === arr[arr.length - 1];
    if (!isLast || into > dur * 2.5) return isLast && cur.lap_duration ? { lap: cur.lap_number, frac: 0.02, done: true } : null;
    return { lap: cur.lap_number, frac: Math.min(1.3, into / dur) };
  }
  return { lap: cur.lap_number, frac: into / dur };
}
function gridPos(num) { return (S.byDriver.position.get(num) || [])[0]?.position; }

function placeCars(st) {
  if (!track.hasOutline()) return;
  const posBy = new Map(st.rows.map((r) => [r.num, r.pos]));
  const out = [];
  for (const [num, d] of S.drivers) {
    const pr = carProgress(num, S.t);
    if (!pr) continue;
    const p = track.pointAt(pr.frac);
    if (!p) continue;
    out.push({
      num, code: d.name_acronym, color: `#${d.team_colour || 'ffffff'}`, x: p.x, y: p.y,
      pos: posBy.get(num) !== 99 ? posBy.get(num) : null, selected: num === S.selDriver,
    });
  }
  track.setCars(out);
}

// ---------- playback ----------
function togglePlay() {
  if (S.mode === 'live' || !S.drivers.size) return;
  if (!S.playing && S.t >= S.t1 - 1) S.t = S.t0;
  S.playing = !S.playing;
  updatePlayBtn();
}
function updatePlayBtn() {
  const b = $('replay-toggle');
  b.disabled = S.mode === 'live';
  b.textContent = S.mode === 'live' ? '● LIVE' : S.playing ? '❚❚ Пауза' : S.t >= S.t1 - 1 ? '↺ Заново' : '▶ Играть';
}

let lastFrame = 0, lastRender = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = lastFrame ? Math.min(now - lastFrame, 100) : 0;
  lastFrame = now;
  if (!S.drivers.size || document.hidden) return;
  if (S.mode === 'live') S.t = Date.now() - 4000; // small delay for smoother interpolation
  else if (S.playing) {
    S.t += dt * S.speed;
    if (S.t >= S.t1) {
      S.t = S.t1;
      S.playing = false;
      updatePlayBtn();
      if (S.demo) setTimeout(() => { if (S.demo && !S.playing) { S.t = S.t0; S.playing = true; updatePlayBtn(); } }, 6000);
    }
  }
  const st = stateAt(S.t);
  placeCars(st);
  if (now - lastRender > 400) { lastRender = now; render(st); }
}

// ---------- live polling ----------
function startLive() {
  stopLive();
  S.liveTimer = setInterval(pollLive, 15_000);
}
function stopLive() { clearInterval(S.liveTimer); S.liveTimer = null; }

let pollN = 0;
async function pollLive() {
  const key = S.session.session_key;
  const since = new Date(Date.now() - 120_000).toISOString();
  const p = { session_key: key, 'date>': since };
  const slow = pollN++ % 4 === 0;
  const [pos, iv, rc, laps, w, stints] = await Promise.allSettled([
    openf1('position', p, { ttl: 0 }),
    openf1('intervals', p, { ttl: 0 }),
    openf1('race_control', p, { ttl: 0 }),
    openf1('laps', { session_key: key }, { ttl: 0 }),
    slow ? openf1('weather', p, { ttl: 0 }) : Promise.reject(),
    slow ? openf1('stints', { session_key: key }, { ttl: 0 }) : Promise.reject(),
  ]);
  const merge = (name, r) => {
    if (r.status !== 'fulfilled') return;
    const seen = new Set(S.data[name].map((x) => `${x.driver_number}|${x.date}`));
    for (const x of r.value) {
      if (seen.has(`${x.driver_number}|${x.date}`)) continue;
      x._t = ms(x.date);
      S.data[name].push(x);
    }
    S.data[name].sort((a, b) => a._t - b._t);
  };
  merge('position', pos);
  merge('intervals', iv);
  merge('race_control', rc);
  merge('weather', w);
  S.byDriver.position = groupBy(S.data.position, 'date');
  S.byDriver.intervals = groupBy(S.data.intervals, 'date');
  if (laps.status === 'fulfilled' && laps.value.length) {
    indexLaps(laps.value);
    if (!track.hasOutline()) buildOutline();
  }
  if (stints.status === 'fulfilled') S.data.stints = stints.value;
  computeWindow();
  if (!isLive(S.session)) {
    stopLive();
    S.mode = 'replay';
    S.t = S.t1;
    setStatus('Сессия завершена · доступен повтор', 'replay');
    updatePlayBtn();
  }
}

// ---------- derived state ----------
function stateAt(t) {
  const rows = [];
  let bestLap = Infinity;
  for (const [num, d] of S.drivers) {
    const pos = lastBefore(S.byDriver.position.get(num) || [], t);
    const iv = lastBefore(S.byDriver.intervals.get(num) || [], t);
    const all = S.byDriver.laps.get(num) || [];
    const laps = all.filter((l) => l._t != null && l.lap_duration && l._t + l.lap_duration * 1000 <= t);
    const started = all.filter((l) => l._t != null && l._t <= t);
    const last = laps[laps.length - 1];
    const pb = laps.reduce((m, l) => Math.min(m, l.lap_duration), Infinity);
    bestLap = Math.min(bestLap, pb);
    const lapNo = started.length ? started[started.length - 1].lap_number : 0;
    const L = Math.max(lapNo, 1);
    const stint = S.data.stints.find((x) => x.driver_number === num && x.lap_start <= L && (x.lap_end ?? 999) >= L);
    const out = !carProgress(num, t) && started.length > 0;
    rows.push({ num, d, pos: pos?.position ?? 99, grid: gridPos(num), gap: iv?.gap_to_leader, interval: iv?.interval, last, pb, laps, lapNo, stint, out });
  }
  rows.sort((a, b) => a.pos - b.pos);
  rows.forEach((r) => (r.rating = rate(r, bestLap)));
  return { rows, bestLap, lap: Math.max(0, ...rows.map((r) => r.lapNo)) };
}

// Driver rating 1..10: result, positions gained, pace vs. fastest lap, consistency
function rate(r, bestLap) {
  if (!r.laps.length) return null;
  const times = r.laps.filter((l) => !l.is_pit_out_lap).map((l) => l.lap_duration).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] || 0;
  const clean = times.filter((x) => x < median * 1.04);
  const mean = clean.reduce((s, x) => s + x, 0) / (clean.length || 1);
  const std = Math.sqrt(clean.reduce((s, x) => s + (x - mean) ** 2, 0) / (clean.length || 1));
  let score = 8.6 - (Math.min(r.pos, 20) - 1) * 0.22;
  if (r.grid && r.pos !== 99) score += (r.grid - r.pos) * 0.18;
  if (isFinite(bestLap) && isFinite(r.pb)) score -= Math.min(2, (r.pb - bestLap) * 1.2);
  score -= Math.min(1.5, std * 0.6);
  if (r.out) score -= 2;
  return Math.max(1, Math.min(10, score));
}

// ---------- rendering ----------
function render(st = stateAt(S.t)) {
  if (!S.drivers.size) return;
  const total = Math.max(...[...S.byDriver.laps.values()].map((a) => a.length));
  $('lap-badge').textContent = st.lap ? `Круг ${st.lap}/${total}` : 'Старт';
  $('track-clock').textContent = S.mode === 'live' ? `LIVE · ${fmtTime(Date.now())}` : fmtTime(S.t);
  const seek = $('seek');
  const pct = (S.t - S.t0) / Math.max(1, S.t1 - S.t0);
  if (document.activeElement !== seek) seek.value = String(Math.round(pct * 1000));
  seek.style.setProperty('--p', `${Math.min(100, pct * 100)}%`);
  $('seek-label').textContent = S.mode === 'live' ? 'LIVE' : `${Math.round(pct * 100)}%`;
  renderTower(st);
  renderRatings(st);
  renderRaceControl();
  renderWeather();
  drawLapChart(st);
}

function renderTower(st) {
  const tb = $('tower').querySelector('tbody');
  const visible = st.rows.filter((r) => r.pos !== 99 || r.laps.length);
  const before = new Map();
  for (const [num, tr] of S.rows) before.set(num, tr.getBoundingClientRect().top);
  visible.forEach((r, i) => {
    let tr = S.rows.get(r.num);
    if (!tr) {
      tr = document.createElement('tr');
      tr.addEventListener('click', () => selectDriver(r.num));
      S.rows.set(r.num, tr);
    }
    const lastCls = r.last && r.last.lap_duration === st.bestLap ? 'fl' : r.last && r.last.lap_duration === r.pb ? 'pb' : '';
    const comp = r.stint?.compound || '';
    const age = r.stint ? (r.stint.tyre_age_at_start || 0) + Math.max(0, r.lapNo - r.stint.lap_start) : '';
    const delta = r.grid && r.pos !== 99 ? r.grid - r.pos : 0;
    const ratingCls = r.rating == null ? '' : r.rating > 7.5 ? 'hi' : r.rating > 5 ? 'mid' : 'lo';
    const drs = i > 0 && typeof r.interval === 'number' && r.interval < 1;
    tr.className = `${r.num === S.selDriver ? 'sel' : ''} ${r.out ? 'out' : ''}`;
    tr.style.setProperty('--tc', `#${r.d.team_colour || '888'}`);
    const html = `
      <td class="p">${r.pos === 99 ? '—' : r.pos}</td>
      <td class="drv"><span class="bar"></span>${esc(r.d.name_acronym)}${delta ? `<small class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</small>` : ''}</td>
      <td class="${drs ? 'drs' : ''}">${r.out ? 'OUT' : i === 0 ? 'ЛИДЕР' : fmtGap(r.interval)}</td>
      <td class="c-gap">${i === 0 ? '—' : fmtGap(r.gap)}</td>
      <td class="${lastCls}">${fmtLap(r.last?.lap_duration)}</td>
      <td class="c-tyre">${comp ? `<span class="tyre ${esc(comp)}" title="${esc(comp)}">${esc(comp[0])}</span><small>${age}</small>` : '—'}</td>
      <td class="score ${ratingCls}">${r.rating == null ? '—' : r.rating.toFixed(1)}</td>`;
    if (tr._html !== html) { tr.innerHTML = html; tr._html = html; }
    if (tb.children[i] !== tr) tb.insertBefore(tr, tb.children[i] || null);
  });
  // FLIP: animate rows that changed place
  for (const [num, tr] of S.rows) {
    const old = before.get(num);
    if (old == null || !tr.isConnected) continue;
    const dy = old - tr.getBoundingClientRect().top;
    if (Math.abs(dy) > 2 && Math.abs(dy) < 600) {
      tr.animate([{ transform: `translateY(${dy}px)`, background: 'rgba(0,240,255,.18)' }, { transform: 'none', background: 'transparent' }],
        { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
  }
}

function renderRatings(st) {
  const rated = st.rows.filter((r) => r.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 10);
  $('ratings').innerHTML = rated.length
    ? rated.map((r, i) => `<div class="rating-row"><b>${i + 1}. ${esc(r.d.name_acronym)}</b>
        <div class="track"><div class="fill" style="width:${r.rating * 10}%;--c:#${esc(r.d.team_colour)}"></div></div>
        <span class="score">${r.rating.toFixed(1)}</span></div>`).join('')
      + '<p class="muted small">Учитываются позиция, отыгранные места, темп относительно лучшего круга и стабильность.</p>'
    : '<p class="muted">Оценки появятся после первых завершённых кругов.</p>';
}

function renderRaceControl() {
  const rc = S.data.race_control.filter((r) => r._t <= S.t).slice(-40).reverse();
  const key = rc.length ? `${rc.length}|${rc[0]._t}` : 'empty';
  if (key === S.lastRc) return;
  S.lastRc = key;
  const item = (r) => {
    const f = r.flag || (r.category === 'SafetyCar' ? 'SC' : r.category === 'Drs' ? 'DRS' : 'INFO');
    return `<span class="flag ${esc(f.split(' ')[0])}">${esc(f)}</span>${esc(r.message)}`;
  };
  $('race-control').innerHTML = rc.length
    ? rc.map((r) => `<li><time>${fmtTime(r._t)}</time>${item(r)}</li>`).join('')
    : '<li class="muted">Сообщений пока нет</li>';
  const tick = rc.slice(0, 8).map((r) => `<span>${item(r)}</span>`).join('');
  $('ticker-track').innerHTML = tick ? tick + tick : '<span>Ожидание сообщений дирекции гонки…</span>';
}

function renderWeather() {
  const w = lastBefore(S.data.weather, S.t);
  $('weather').innerHTML = w
    ? `<span>Воздух <b>${w.air_temperature}°C</b></span><span>Трасса <b>${w.track_temperature}°C</b></span>
       <span>Влажн. <b>${w.humidity}%</b></span><span>Ветер <b>${w.wind_speed} м/с</b></span>
       <span>Дождь <b>${w.rainfall ? 'да' : 'нет'}</b></span>`
    : '';
}

function selectDriver(num) {
  S.selDriver = num;
  $('lap-driver').value = num;
  render();
}

function drawLapChart(st) {
  const cv = $('lap-chart');
  const dpr = devicePixelRatio || 1;
  const w = cv.clientWidth, h = 220;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = h * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const sel = st.rows.find((r) => r.num === S.selDriver) || st.rows[0];
  if (!S.selDriver && sel) { S.selDriver = sel.num; $('lap-driver').value = sel.num; }
  const leader = st.rows[0];
  const series = [sel, leader !== sel ? leader : null].filter(Boolean);
  const all = series.flatMap((r) => r.laps.filter((l) => !l.is_pit_out_lap).map((l) => l.lap_duration)).sort((a, b) => a - b);
  if (all.length < 2) {
    ctx.fillStyle = '#7d86a8';
    ctx.font = '13px "JetBrains Mono"';
    ctx.fillText('> ожидание завершённых кругов_', 12, 30);
    return;
  }
  const lo = all[0] - 0.4;
  const hi = Math.min(all[all.length - 1], all[Math.floor(all.length * 0.85)] * 1.03) + 0.4;
  const maxLap = Math.max(5, ...series.flatMap((r) => r.laps.map((l) => l.lap_number)));
  const pad = { l: 50, r: 10, t: 26, b: 18 };
  const X = (n) => pad.l + ((n - 1) / Math.max(1, maxLap - 1)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + ((Math.min(v, hi) - lo) / (hi - lo)) * (h - pad.t - pad.b);
  ctx.strokeStyle = 'rgba(0,240,255,0.1)';
  ctx.fillStyle = '#7d86a8';
  ctx.font = '10px "JetBrains Mono"';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(fmtLap(v), 2, Y(v) + 3);
  }
  series.forEach((r, si) => {
    const col = `#${r.d.team_colour || 'ffffff'}`;
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    ctx.shadowBlur = si ? 0 : 10;
    ctx.globalAlpha = si ? 0.4 : 1;
    ctx.lineWidth = si ? 1.5 : 2.5;
    ctx.beginPath();
    let first = true;
    let lastPt = null;
    for (const l of r.laps) {
      if (l.is_pit_out_lap || l.lap_duration > hi) { first = true; continue; }
      const x = X(l.lap_number), y = Y(l.lap_duration);
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
      lastPt = [x, y];
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    if (lastPt && !si) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(lastPt[0], lastPt[1], 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = col;
    ctx.font = '600 11px "JetBrains Mono"';
    ctx.fillText(`${r.d.name_acronym}${si ? ' лидер' : ''} ${fmtLap(r.pb)}`, pad.l + si * 150, 14);
  });
}

function renderLinks() {
  const s = S.session;
  if (!s) return;
  const name = meetingName(s);
  const links = [
    ['Официальный F1 Live Timing', 'https://www.formula1.com/en/timing/f1-live'],
    [`Календарь и результаты ${s.year}`, `https://www.formula1.com/en/racing/${s.year}`],
    [`Хайлайты: ${name}`, ytSearch(`F1 ${s.year} ${name} ${s.session_name} highlights`)],
    ['Смотреть в F1 TV', f1tvSearch(`${s.year} ${name}`)],
    ['Статья в Википедии', `https://en.wikipedia.org/wiki/${encodeURIComponent(`${s.year}_${name.replace(/\s+/g, '_')}`)}`],
  ];
  $('race-links').innerHTML = links
    .map(([t, u]) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener"><span>${esc(t)}</span><span>↗</span></a>`)
    .join('');
}

async function loadNewsMini() {
  const ul = $('live-news');
  try {
    const items = (await news()).slice(0, 8);
    ul.innerHTML = items.length
      ? items.map((n) => `<li><time>${esc(timeAgo(n.date))}</time><a href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">· ${esc(n.source)}</span></li>`).join('')
      : '<li class="muted">Новости недоступны</li>';
  } catch {
    ul.innerHTML = '<li class="muted">Новости недоступны</li>';
  }
  setTimeout(loadNewsMini, 5 * 60_000);
}

// ---------- demo race (used when OpenF1 is unreachable) ----------
function startDemo(keepSession = false) {
  resetView();
  S.demo = true;
  if (!keepSession) {
    S.session = { session_key: 0, session_name: 'Демо-гонка', year: new Date().getFullYear(), country_name: 'Симуляция', circuit_short_name: 'Neon Circuit', meeting_key: 0 };
    $('live-title').textContent = 'Neon City Grand Prix — демо';
    $('live-sub').textContent = 'Нет связи с OpenF1 — показана симуляция гонки на составе текущего сезона.';
    setStatus('◆ Демо-режим · симуляция', 'demo');
    $('session-select').innerHTML = '<option>Демо-гонка</option>';
  }
  renderLinks();
  const LAPS = 30;
  const start = Date.now();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const drivers = FALLBACK_GRID.map((g) => ({
    driver_number: +g.Driver.permanentNumber, name_acronym: g.Driver.code,
    full_name: `${g.Driver.givenName} ${g.Driver.familyName}`, team_colour: teamColor(g.Constructors[0].constructorId).slice(1),
  }));
  const order = drivers.map((d) => d.driver_number).sort(() => rnd() - 0.5);
  const pace = new Map(drivers.map((d, i) => [d.driver_number, 78 + rnd() * 1.6 + i * 0.02]));
  const laps = [], stints = [], cum = new Map();
  order.forEach((num, gi) => {
    let t = start + gi * 250;
    const pit = 12 + Math.floor(rnd() * 10);
    for (let n = 1; n <= LAPS; n++) {
      const dur = pace.get(num) + (rnd() - 0.5) * 0.9 + (n === 1 ? 4 + gi * 0.15 : 0) + (n === pit ? 21 : 0) - n * 0.02 + (n > pit ? -0.4 : 0);
      laps.push({ driver_number: num, lap_number: n, lap_duration: +dur.toFixed(3), is_pit_out_lap: n === pit + 1, date_start: new Date(t).toISOString() });
      t += dur * 1000;
      if (!cum.has(n)) cum.set(n, []);
      cum.get(n).push({ num, t });
    }
    stints.push({ driver_number: num, lap_start: 1, lap_end: pit, compound: rnd() > 0.5 ? 'MEDIUM' : 'SOFT', tyre_age_at_start: 0 });
    stints.push({ driver_number: num, lap_start: pit + 1, lap_end: LAPS, compound: 'HARD', tyre_age_at_start: 0 });
  });
  const position = order.map((num, i) => ({ driver_number: num, position: i + 1, date: new Date(start - 60_000).toISOString() }));
  const intervals = [];
  for (let n = 1; n <= LAPS; n++) {
    const list = cum.get(n).sort((a, b) => a.t - b.t);
    list.forEach((x, i) => {
      // each driver's standing is published as they cross the line
      position.push({ driver_number: x.num, position: i + 1, date: new Date(x.t).toISOString() });
      intervals.push({ driver_number: x.num, gap_to_leader: (x.t - list[0].t) / 1000, interval: i ? (x.t - list[i - 1].t) / 1000 : 0, date: new Date(x.t).toISOString() });
    });
  }
  const lapT = (n) => cum.get(n).reduce((m, x) => Math.min(m, x.t), Infinity);
  const race_control = [
    [start - 30_000, 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'],
    [lapT(2), null, 'DRS ENABLED', 'Drs'],
    [lapT(6), 'YELLOW', 'YELLOW IN TRACK SECTOR 7'],
    [lapT(6) + 20_000, 'GREEN', 'TRACK CLEAR'],
    [lapT(11), null, 'FASTEST LAP 1:17.902', 'Other'],
    [lapT(17), null, 'VIRTUAL SAFETY CAR DEPLOYED', 'SafetyCar'],
    [lapT(18), null, 'VIRTUAL SAFETY CAR ENDING', 'SafetyCar'],
    [lapT(24), null, 'TURN 4 INCIDENT NOTED - CARS 16 AND 81', 'Other'],
    [lapT(LAPS), 'CHEQUERED', 'CHEQUERED FLAG'],
  ].map(([t, flag, message, category = 'Flag']) => ({ date: new Date(t).toISOString(), flag, message, category }));
  const weather = [{ date: new Date(start - 60_000).toISOString(), air_temperature: 24.1, track_temperature: 38.6, humidity: 51, wind_speed: 2.3, rainfall: 0 }];
  ingest({ drivers, laps, position, intervals, stints, race_control, weather });
  track.setOutlineFallback();
  S.mode = 'replay';
  S.speed = Math.max(S.speed, 10);
  $('replay-speed').value = String(S.speed);
  S.t = S.t0;
  S.playing = true;
  updatePlayBtn();
  render();
}
