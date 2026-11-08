// Live / replay race dashboard powered by OpenF1
import { openf1, news } from './api.js';
import { createTrack } from './track3d.js';
import { esc, safeUrl, fmtLap, fmtGap, fmtTime, ytSearch, f1tvSearch, timeAgo } from './data.js';

const $ = (id) => document.getElementById(id);
const BIG = { ttl: 10 * 60_000, persist: false, timeout: 25_000 };

const S = {
  sessions: [],
  meetings: new Map(),
  session: null,
  drivers: new Map(),
  data: { position: [], intervals: [], laps: [], stints: [], race_control: [], weather: [] },
  byDriver: { position: new Map(), intervals: new Map(), laps: new Map() },
  outline: null,
  loc: new Map(), // chunk index -> Map(driver -> [{t,x,y}])
  locPending: new Set(),
  mode: 'final', // final | replay | live
  t: 0,
  speed: 4,
  playing: false,
  liveTimer: null,
  lastTick: 0,
  selDriver: null,
  prevOrder: '',
};
let track;
let inited = false;

const ms = (d) => Date.parse(d);

function lastBefore(arr, t, key = '_t') {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans >= 0 ? arr[ans] : null;
}

function groupBy(rows, timeKey) {
  const m = new Map();
  for (const r of rows) {
    r._t = ms(r[timeKey]);
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
  $('replay-speed').addEventListener('change', (e) => { S.speed = +e.target.value; });
  $('replay-toggle').addEventListener('click', toggleReplay);
  $('session-select').addEventListener('change', (e) => loadSession(+e.target.value));
  $('lap-driver').addEventListener('change', (e) => { S.selDriver = +e.target.value; drawLapChart(); });
  loadNewsMini();

  try {
    const year = new Date().getUTCFullYear();
    let [sessions, meetings] = await Promise.all([
      openf1('sessions', { year }, { ttl: 5 * 60_000 }),
      openf1('meetings', { year }, { ttl: 30 * 60_000 }),
    ]);
    if (!sessions.length) {
      [sessions, meetings] = await Promise.all([openf1('sessions', { year: year - 1 }), openf1('meetings', { year: year - 1 })]);
    }
    meetings.forEach((m) => S.meetings.set(m.meeting_key, m));
    const now = Date.now();
    S.sessions = sessions.filter((s) => ms(s.date_start) < now).sort((a, b) => ms(b.date_start) - ms(a.date_start));
    const sel = $('session-select');
    sel.innerHTML = S.sessions
      .map((s) => `<option value="${s.session_key}">${esc(meetingName(s))} — ${esc(s.session_name)}</option>`)
      .join('');
    // Prefer a race that is live or the most recent race; otherwise the most recent session
    const live = S.sessions.find(isLive);
    const pick = live || S.sessions.find((s) => s.session_type === 'Race') || S.sessions[0];
    if (!pick) throw new Error('no sessions');
    sel.value = pick.session_key;
    await loadSession(pick.session_key);
  } catch (err) {
    console.error(err);
    $('live-status').textContent = 'Нет соединения с OpenF1';
    $('live-sub').innerHTML = 'Не удалось загрузить данные сессии. Проверьте подключение и обновите страницу. Официальный тайминг: <a href="https://www.formula1.com/en/timing/f1-live" target="_blank" rel="noopener">F1 Live Timing</a>.';
    track.setOutlineFallback();
  }
  requestAnimationFrame(tick);
}

export function pauseLive() { track?.setActive(false); }

const meetingName = (s) => S.meetings.get(s.meeting_key)?.meeting_name || `${s.country_name} · ${s.circuit_short_name}`;
const isLive = (s) => {
  const now = Date.now();
  return ms(s.date_start) - 10 * 60_000 < now && now < ms(s.date_end) + 20 * 60_000;
};

async function loadSession(key) {
  stopLive();
  S.playing = false;
  $('replay-toggle').textContent = '▶ Повтор';
  const s = S.sessions.find((x) => x.session_key === key);
  S.session = s;
  S.loc.clear();
  S.locPending.clear();
  S.outline = null;
  S.prevOrder = '';
  track.clearCars();
  $('live-title').textContent = `${meetingName(s)} — ${s.session_name}`;
  $('live-sub').textContent = `${s.circuit_short_name}, ${s.country_name} · ${new Date(s.date_start).toLocaleString('ru-RU')}`;
  $('live-status').textContent = 'Загрузка данных…';
  renderLinks();

  const live = isLive(s);
  const opts = live ? { ttl: 0 } : BIG;
  const p = { session_key: key };
  const results = await Promise.allSettled([
    openf1('drivers', p, { ttl: 60 * 60_000 }),
    openf1('position', p, opts),
    openf1('intervals', p, opts),
    openf1('laps', p, opts),
    openf1('stints', p, opts),
    openf1('race_control', p, opts),
    openf1('weather', p, opts),
  ]);
  const [drivers, position, intervals, laps, stints, rc, weather] = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
  const restricted = live && results.slice(1).every((r) => r.status === 'rejected');

  S.drivers = new Map(drivers.map((d) => [d.driver_number, d]));
  S.data = { position, intervals, laps, stints, race_control: rc, weather };
  S.byDriver.position = groupBy(position, 'date');
  S.byDriver.intervals = groupBy(intervals, 'date');
  for (const l of laps) l._t = ms(l.date_start || s.date_start);
  S.byDriver.laps = new Map();
  for (const l of laps) {
    if (!S.byDriver.laps.has(l.driver_number)) S.byDriver.laps.set(l.driver_number, []);
    S.byDriver.laps.get(l.driver_number).push(l);
  }
  for (const a of S.byDriver.laps.values()) a.sort((x, y) => x.lap_number - y.lap_number);
  rc.forEach((r) => (r._t = ms(r.date)));
  rc.sort((a, b) => a._t - b._t);
  weather.forEach((w) => (w._t = ms(w.date)));
  weather.sort((a, b) => a._t - b._t);

  const sel = $('lap-driver');
  sel.innerHTML = [...S.drivers.values()]
    .map((d) => `<option value="${d.driver_number}">${esc(d.name_acronym)} — ${esc(d.full_name)}</option>`)
    .join('');

  if (restricted) {
    $('live-status').innerHTML = '<span class="dot" style="display:inline-block"></span> Сессия идёт прямо сейчас';
    $('live-sub').innerHTML += '<div class="notice">Реалтайм-поток OpenF1 сейчас закрыт для бесплатного доступа — данные появятся сразу после финиша сессии. Смотрите официальный <a href="https://www.formula1.com/en/timing/f1-live" target="_blank" rel="noopener">F1 Live Timing</a>; дашборд обновляется автоматически.</div>';
    S.mode = 'live';
    S.t = Date.now();
    startLive();
  } else if (live) {
    S.mode = 'live';
    S.t = Date.now();
    $('live-status').innerHTML = '<span class="dot" style="display:inline-block"></span> LIVE';
    startLive();
  } else {
    S.mode = 'final';
    S.t = sessionEnd();
    $('live-status').textContent = 'Итог сессии · нажмите «Повтор», чтобы воспроизвести гонку';
  }
  await buildOutline();
  render(true);
}

function sessionEnd() {
  const s = S.session;
  const end = ms(s.date_end);
  // the session window includes post-race time; stop at the last recorded activity instead
  const lastPos = S.data.position.reduce((m, r) => Math.max(m, r._t || 0), 0);
  const lastLap = S.data.laps.reduce((m, l) => Math.max(m, (l._t || 0) + (l.lap_duration || 0) * 1000), 0);
  const last = Math.max(lastPos, lastLap);
  return last ? Math.min(end, last + 1000) : end;
}
function sessionStart() {
  const s = S.session;
  // Start the replay at the first lap of the race rather than the formation period
  const first = S.data.laps.filter((l) => l.lap_number === 1 && l.date_start).map((l) => ms(l.date_start));
  return first.length ? Math.min(...first) - 5000 : ms(s.date_start);
}

async function buildOutline() {
  // Use a clean mid-session lap of any driver for the track shape
  const lap = S.data.laps.find((l) => l.lap_number >= 3 && l.lap_duration && !l.is_pit_out_lap && l.date_start);
  if (!lap) { track.setOutlineFallback(); return; }
  const start = new Date(ms(lap.date_start)).toISOString();
  const end = new Date(ms(lap.date_start) + lap.lap_duration * 1000).toISOString();
  try {
    const pts = await openf1('location', {
      session_key: S.session.session_key, driver_number: lap.driver_number, 'date>': start, 'date<': end,
    }, { ttl: 60 * 60_000 });
    const clean = pts.filter((p) => p.x || p.y);
    if (!track.setOutline(clean)) track.setOutlineFallback();
    else S.outline = clean;
  } catch {
    track.setOutlineFallback();
  }
}

// ---------- location chunks ----------
const CHUNK = 60_000;
async function ensureLoc(t) {
  const idx = Math.floor(t / CHUNK);
  for (const i of [idx, idx + 1]) {
    if (S.loc.has(i) || S.locPending.has(i) || !S.outline) continue;
    S.locPending.add(i);
    openf1('location', {
      session_key: S.session.session_key,
      'date>': new Date(i * CHUNK).toISOString(),
      'date<': new Date((i + 1) * CHUNK).toISOString(),
    }, { ttl: 10 * 60_000, persist: false, timeout: 25_000 })
      .then((rows) => {
        const m = new Map();
        for (const r of rows) {
          if (!r.x && !r.y) continue;
          if (!m.has(r.driver_number)) m.set(r.driver_number, []);
          m.get(r.driver_number).push({ _t: ms(r.date), x: r.x, y: r.y });
        }
        for (const a of m.values()) a.sort((x, y) => x._t - y._t);
        S.loc.set(i, m);
        if (S.loc.size > 6) S.loc.delete([...S.loc.keys()].sort((a, b) => Math.abs(a - idx) - Math.abs(b - idx)).pop());
      })
      .catch(() => S.loc.set(i, new Map()))
      .finally(() => S.locPending.delete(i));
  }
}

function carPositions(t) {
  const idx = Math.floor(t / CHUNK);
  const chunk = S.loc.get(idx);
  if (!chunk) return null;
  const prev = S.loc.get(idx - 1);
  const out = [];
  for (const [num, arr] of chunk) {
    const before = prev?.get(num);
    const p = lastBefore(arr, t) || (before && before[before.length - 1]);
    const d = S.drivers.get(num);
    if (p && d) out.push({ num, code: d.name_acronym, color: `#${d.team_colour || 'ffffff'}`, x: p.x, y: p.y });
  }
  return out;
}

// ---------- replay & live ----------
function toggleReplay() {
  if (!S.session) return;
  if (S.mode === 'live') return;
  if (!S.playing) {
    if (S.mode !== 'replay' || S.t >= sessionEnd()) S.t = sessionStart();
    S.mode = 'replay';
    S.playing = true;
    $('replay-toggle').textContent = '❚❚ Пауза';
    $('live-status').textContent = 'Повтор гонки';
  } else {
    S.playing = false;
    $('replay-toggle').textContent = '▶ Продолжить';
  }
}

function startLive() {
  stopLive();
  S.liveTimer = setInterval(pollLive, 6000);
}
function stopLive() { clearInterval(S.liveTimer); S.liveTimer = null; }

async function pollLive() {
  const key = S.session.session_key;
  const since = new Date(Date.now() - 90_000).toISOString();
  const p = { session_key: key, 'date>': since };
  const [pos, iv, rc, w, laps, stints] = await Promise.allSettled([
    openf1('position', p, { ttl: 0 }),
    openf1('intervals', p, { ttl: 0 }),
    openf1('race_control', p, { ttl: 0 }),
    openf1('weather', p, { ttl: 0 }),
    openf1('laps', { session_key: key }, { ttl: 0 }),
    openf1('stints', { session_key: key }, { ttl: 0 }),
  ]);
  const merge = (name, res, timeKey) => {
    if (res.status !== 'fulfilled') return;
    const seen = new Set(S.data[name].map((r) => `${r.driver_number}|${r[timeKey]}`));
    for (const r of res.value) {
      if (seen.has(`${r.driver_number}|${r[timeKey]}`)) continue;
      r._t = ms(r[timeKey]);
      S.data[name].push(r);
      if (S.byDriver[name]) {
        if (!S.byDriver[name].has(r.driver_number)) S.byDriver[name].set(r.driver_number, []);
        S.byDriver[name].get(r.driver_number).push(r);
      }
    }
    S.data[name].sort((a, b) => a._t - b._t);
  };
  merge('position', pos, 'date');
  merge('intervals', iv, 'date');
  merge('race_control', rc, 'date');
  merge('weather', w, 'date');
  if (laps.status === 'fulfilled' && laps.value.length) {
    S.data.laps = laps.value;
    for (const l of laps.value) l._t = ms(l.date_start || S.session.date_start);
    S.byDriver.laps = new Map();
    for (const l of laps.value) {
      if (!S.byDriver.laps.has(l.driver_number)) S.byDriver.laps.set(l.driver_number, []);
      S.byDriver.laps.get(l.driver_number).push(l);
    }
    if (!S.outline) buildOutline();
  }
  if (stints.status === 'fulfilled') S.data.stints = stints.value;
  // live location: small trailing window
  if (S.outline) {
    try {
      const rows = await openf1('location', { session_key: key, 'date>': new Date(Date.now() - 8000).toISOString() }, { ttl: 0 });
      const latest = new Map();
      for (const r of rows) latest.set(r.driver_number, r);
      track.setCars([...latest.values()].map((r) => {
        const d = S.drivers.get(r.driver_number);
        return d && { num: r.driver_number, code: d.name_acronym, color: `#${d.team_colour}`, x: r.x, y: r.y };
      }).filter(Boolean));
    } catch { /* live location unavailable */ }
  }
  if (!isLive(S.session)) {
    stopLive();
    S.mode = 'final';
    S.t = sessionEnd();
  } else {
    S.t = Date.now();
  }
  render(false);
}

let lastRender = 0;
function tick(now) {
  requestAnimationFrame(tick);
  const dt = S.lastTick ? now - S.lastTick : 0;
  S.lastTick = now;
  if (S.mode === 'replay' && S.playing) {
    S.t += dt * S.speed;
    if (S.t >= sessionEnd()) {
      S.t = sessionEnd();
      S.playing = false;
      $('replay-toggle').textContent = '▶ Повтор';
    }
    ensureLoc(S.t);
    const cars = carPositions(S.t);
    if (cars) track.setCars(cars);
    if (now - lastRender > 500) { lastRender = now; render(false); }
  }
}

// ---------- derived state ----------
function stateAt(t) {
  const rows = [];
  let bestLap = Infinity, bestLapNum = null;
  for (const [num, d] of S.drivers) {
    const pos = lastBefore(S.byDriver.position.get(num) || [], t);
    const iv = lastBefore(S.byDriver.intervals.get(num) || [], t);
    const laps = (S.byDriver.laps.get(num) || []).filter((l) => l._t + (l.lap_duration || 0) * 1000 <= t && l.lap_duration);
    const started = (S.byDriver.laps.get(num) || []).filter((l) => l._t <= t);
    const last = laps[laps.length - 1];
    const pb = laps.reduce((m, l) => Math.min(m, l.lap_duration), Infinity);
    if (pb < bestLap) { bestLap = pb; bestLapNum = num; }
    const lapNo = started.length ? started[started.length - 1].lap_number : 0;
    const stint = S.data.stints.find((st) => st.driver_number === num && st.lap_start <= Math.max(lapNo, 1) && (st.lap_end ?? 999) >= Math.max(lapNo, 1));
    rows.push({
      num, d, pos: pos?.position ?? 99, grid: (S.byDriver.position.get(num) || [])[0]?.position,
      gap: iv?.gap_to_leader, interval: iv?.interval, last, pb, laps, lapNo, stint,
    });
  }
  rows.sort((a, b) => a.pos - b.pos);
  rows.forEach((r) => (r.rating = rate(r, bestLap)));
  return { rows, bestLap, bestLapNum, lap: Math.max(0, ...rows.map((r) => r.lapNo)) };
}

// Driver rating 1..10: result, positions gained, pace vs. fastest lap, consistency
function rate(r, bestLap) {
  if (!r.laps.length) return null;
  const times = r.laps.filter((l) => !l.is_pit_out_lap).map((l) => l.lap_duration).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)] || 0;
  const clean = times.filter((x) => x < median * 1.04);
  const mean = clean.reduce((s, x) => s + x, 0) / (clean.length || 1);
  const std = Math.sqrt(clean.reduce((s, x) => s + (x - mean) ** 2, 0) / (clean.length || 1));
  let score = 8.6 - (r.pos - 1) * 0.22;
  if (r.grid) score += (r.grid - r.pos) * 0.18;
  if (isFinite(bestLap) && isFinite(r.pb)) score -= Math.min(2, (r.pb - bestLap) * 1.2);
  score -= Math.min(1.5, std * 0.6);
  return Math.max(1, Math.min(10, score));
}

// ---------- rendering ----------
function render(full) {
  if (!S.session) return;
  const st = stateAt(S.t);
  $('lap-badge').textContent = st.lap ? `Круг ${st.lap}` : S.session.session_name;
  $('track-clock').textContent = S.mode === 'live' ? `LIVE · ${fmtTime(Date.now())}` : fmtTime(S.t);

  const order = st.rows.map((r) => r.num).join(',');
  const prevIdx = new Map(S.prevOrder.split(',').map((n, i) => [+n, i]));
  const tb = $('tower').querySelector('tbody');
  tb.innerHTML = st.rows
    .filter((r) => r.pos !== 99 || r.laps.length)
    .map((r, i) => {
      const moved = S.prevOrder && prevIdx.get(r.num) !== i;
      const lastCls = r.last && r.last.lap_duration === st.bestLap ? 'fl' : r.last && r.last.lap_duration === r.pb ? 'pb' : '';
      const comp = r.stint?.compound || '';
      const age = r.stint ? (r.stint.tyre_age_at_start || 0) + Math.max(0, r.lapNo - r.stint.lap_start) : '';
      const ratingColor = r.rating == null ? '' : r.rating > 7.5 ? 'var(--green)' : r.rating > 5 ? 'var(--yellow)' : 'var(--red)';
      return `<tr class="${moved ? 'flash' : ''}" data-num="${r.num}">
        <td>${r.pos === 99 ? '—' : r.pos}</td>
        <td class="drv"><span class="bar" style="background:#${esc(r.d.team_colour)}"></span>${esc(r.d.name_acronym)}</td>
        <td>${i === 0 ? 'LEADER' : fmtGap(r.interval)}</td>
        <td>${i === 0 ? '—' : fmtGap(r.gap)}</td>
        <td class="${lastCls}">${fmtLap(r.last?.lap_duration)}</td>
        <td>${comp ? `<span class="tyre ${esc(comp)}" title="${esc(comp)}">${esc(comp[0])}</span> <small>${age}</small>` : '—'}</td>
        <td class="score" style="color:${ratingColor}">${r.rating == null ? '—' : r.rating.toFixed(1)}</td>
      </tr>`;
    })
    .join('');
  S.prevOrder = order;
  tb.querySelectorAll('tr').forEach((tr) => tr.addEventListener('click', () => {
    S.selDriver = +tr.dataset.num;
    $('lap-driver').value = S.selDriver;
    drawLapChart();
  }));

  // ratings bars
  const rated = st.rows.filter((r) => r.rating != null).sort((a, b) => b.rating - a.rating).slice(0, 10);
  $('ratings').innerHTML = rated.length
    ? rated.map((r) => `<div class="rating-row"><b>${esc(r.d.name_acronym)}</b>
        <div class="track"><div class="fill" style="width:${r.rating * 10}%;background:#${esc(r.d.team_colour)}"></div></div>
        <span class="score">${r.rating.toFixed(1)}</span></div>`).join('')
      + '<p class="muted" style="font-size:.72rem;margin:8px 0 0">Учитываются позиция, отыгранные места, темп относительно лучшего круга и стабильность.</p>'
    : '<p class="muted">Оценки появятся после первых завершённых кругов.</p>';

  // race control
  const rc = S.data.race_control.filter((r) => r._t <= S.t).slice(-40).reverse();
  $('race-control').innerHTML = rc.length
    ? rc.map((r) => {
        const f = r.flag || (r.category === 'SafetyCar' ? 'SC' : 'INFO');
        return `<li><time>${fmtTime(r.date)}</time><span class="flag ${esc(f.split(' ')[0])}">${esc(f)}</span>${esc(r.message)}</li>`;
      }).join('')
    : '<li class="muted">Сообщений пока нет</li>';

  // weather
  const w = lastBefore(S.data.weather, S.t);
  $('weather').innerHTML = w
    ? `<span>Воздух <b>${w.air_temperature}°C</b></span><span>Трасса <b>${w.track_temperature}°C</b></span>
       <span>Влажность <b>${w.humidity}%</b></span><span>Ветер <b>${w.wind_speed} м/с</b></span>
       <span>Дождь <b>${w.rainfall ? 'да' : 'нет'}</b></span>`
    : '';

  if (full || S.mode !== 'replay') {
    if (!S.selDriver && st.rows[0]) { S.selDriver = st.rows[0].num; $('lap-driver').value = S.selDriver; }
    if (S.mode === 'final') {
      // show final car positions near the end of the session
      ensureLoc(S.t - 5000);
      setTimeout(() => { const c = carPositions(S.t - 5000); if (c) track.setCars(c); }, 2500);
    }
  }
  drawLapChart(st);
}

function drawLapChart(st = stateAt(S.t)) {
  const cv = $('lap-chart');
  const ctx = cv.getContext('2d');
  const W = (cv.width = cv.clientWidth * devicePixelRatio);
  const H = (cv.height = 220 * devicePixelRatio);
  ctx.scale(devicePixelRatio, devicePixelRatio);
  const w = W / devicePixelRatio, h = 220;
  ctx.clearRect(0, 0, w, h);
  const sel = st.rows.find((r) => r.num === S.selDriver) || st.rows[0];
  const leader = st.rows[0];
  const series = [sel, leader !== sel ? leader : null].filter(Boolean);
  const all = series.flatMap((r) => r.laps.filter((l) => !l.is_pit_out_lap).map((l) => l.lap_duration));
  if (all.length < 2) {
    ctx.fillStyle = '#8a93a8';
    ctx.font = '13px Inter';
    ctx.fillText('Недостаточно кругов для графика', 12, 30);
    return;
  }
  all.sort((a, b) => a - b);
  const lo = all[0] - 0.5;
  const hi = Math.min(all[all.length - 1], all[Math.floor(all.length * 0.9)] * 1.03) + 0.5;
  const maxLap = Math.max(...series.flatMap((r) => r.laps.map((l) => l.lap_number)));
  const pad = { l: 52, r: 10, t: 10, b: 22 };
  const X = (n) => pad.l + ((n - 1) / Math.max(1, maxLap - 1)) * (w - pad.l - pad.r);
  const Y = (v) => pad.t + ((Math.min(v, hi) - lo) / (hi - lo)) * (h - pad.t - pad.b);
  ctx.strokeStyle = 'rgba(120,140,190,0.15)';
  ctx.fillStyle = '#8a93a8';
  ctx.font = '10px JetBrains Mono';
  for (let i = 0; i <= 4; i++) {
    const v = lo + ((hi - lo) * i) / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, Y(v)); ctx.lineTo(w - pad.r, Y(v)); ctx.stroke();
    ctx.fillText(fmtLap(v), 2, Y(v) + 3);
  }
  ctx.fillText(`круг ${maxLap}`, w - 60, h - 6);
  series.forEach((r, si) => {
    ctx.strokeStyle = `#${r.d.team_colour}`;
    ctx.globalAlpha = si ? 0.45 : 1;
    ctx.lineWidth = si ? 1.5 : 2.5;
    ctx.beginPath();
    let first = true;
    for (const l of r.laps) {
      if (l.is_pit_out_lap || l.lap_duration > hi) { first = true; continue; }
      const x = X(l.lap_number), y = Y(l.lap_duration);
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = `#${r.d.team_colour}`;
    ctx.font = '600 11px Inter';
    ctx.fillText(`${r.d.name_acronym}${si ? ' (лидер)' : ''}  лучший ${fmtLap(r.pb)}`, pad.l + 6 + si * 190, pad.t + 12);
  });
}

function renderLinks() {
  const s = S.session;
  const name = meetingName(s);
  const wikiTitle = `${s.year}_${name.replace(/\s+/g, '_')}`;
  const links = [
    ['Официальный F1 Live Timing', 'https://www.formula1.com/en/timing/f1-live'],
    [`Календарь и результаты ${s.year} — formula1.com`, `https://www.formula1.com/en/racing/${s.year}`],
    [`Хайлайты: ${name} ${s.year}`, ytSearch(`F1 ${s.year} ${name} ${s.session_name} highlights`)],
    ['Смотреть в F1 TV', f1tvSearch(`${s.year} ${name}`)],
    ['Статья в Википедии', `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`],
    ['Сырые данные сессии (OpenF1)', `https://api.openf1.org/v1/sessions?session_key=${s.session_key}`],
  ];
  $('race-links').innerHTML = links
    .map(([t, u]) => `<a href="${esc(safeUrl(u))}" target="_blank" rel="noopener"><span>${esc(t)}</span><span>↗</span></a>`)
    .join('');
}

async function loadNewsMini() {
  const ul = $('live-news');
  ul.innerHTML = '<li class="muted">Загрузка…</li>';
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
