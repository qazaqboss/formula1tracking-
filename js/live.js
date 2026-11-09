// Live / replay race dashboard powered by OpenF1, with an animated demo fallback
import { openf1, news, schedule, jolpica } from './api.js?v=202611090443';
import { createTrack } from './track3d.js?v=202611090443';
import { esc, safeUrl, fmtLap, fmtGap, fmtTime, ytSearch, f1tvSearch, timeAgo, FALLBACK_GRID, teamColor } from './data.js?v=202611090443';

const $ = (id) => document.getElementById(id);
const BIG = { ttl: 10 * 60_000, persist: false, timeout: 30_000 };

const S = {
  sessions: [],
  sheetFor: null,
  all: [],
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
  f1: false, // true while the dashboard is fed by the real-time F1 relay (/api/live)
  totalLaps: null,
  f1Out: new Set(),
  f1Track: null,
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
  initMobileUi();
  requestAnimationFrame(tick);

  // a session is running right now: OpenF1 is locked, read the official feed through our relay
  const f1 = await fetchF1Live().catch(() => null);
  if (f1?.live) { startF1Live(f1); return; }

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
    S.all = sessions.slice().sort((a, b) => ms(a.date_start) - ms(b.date_start));
    S.sessions = sessions.filter((s) => ms(s.date_start) < now).sort((a, b) => ms(b.date_start) - ms(a.date_start));
    if (!S.sessions.length) throw new Error('no sessions');
    $('session-select').innerHTML = S.sessions
      .map((s) => `<option value="${s.session_key}">${esc(meetingName(s))} — ${esc(sessionRu(s.session_name))}</option>`)
      .join('');
    // newest session first (today's qualifying beats last week's race); if OpenF1 has not
    // published it yet, step back to the previous session that has data
    const live = S.sessions.find(isLive);
    const order = live ? [live] : S.sessions.slice(0, 4);
    let ok = false;
    for (const cand of order) {
      $('session-select').value = cand.session_key;
      ok = await loadSession(cand.session_key, { quiet: cand !== order[order.length - 1] });
      if (ok) break;
    }
    if (!ok && !S.demo) startDemo();
    setInterval(renderWeekend, 30_000);
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
  S.f1 = false;
  S.totalLaps = null;
  S.f1Track = null;
  $('tower').querySelector('tbody').innerHTML = '';
  track.clearCars();
}

async function loadSession(key, { quiet = false } = {}) {
  resetView();
  S.demo = false;
  const s = S.sessions.find((x) => x.session_key === key);
  S.session = s;
  $('live-title').textContent = `${meetingName(s)} — ${sessionRu(s.session_name)}`;
  renderWeekend();
  renderKpis(null);
  $('quali-card').hidden = true;
  $('live-sub').textContent = `${s.circuit_short_name}, ${s.country_name} · ${new Date(s.date_start).toLocaleString('ru-RU')}`;
  setStatus('Загрузка телеметрии…', 'loading');
  renderLinks();

  const live = isLive(s);
  const opts = live ? { ttl: 0, timeout: 30_000 } : BIG;
  const p = { session_key: key };
  const names = ['drivers', 'laps', 'position', 'stints', 'race_control', 'weather', 'intervals'];
  const res = await Promise.allSettled(names.map((n) => openf1(n, p, n === 'drivers' ? { ttl: 60 * 60_000 } : opts)));
  const get = (n) => { const r = res[names.indexOf(n)]; return r.status === 'fulfilled' ? r.value : []; };
  if (S.session !== s) return true; // user switched meanwhile

  const drivers = get('drivers');
  if (!drivers.length || !get('laps').length) {
    if (live) {
      // OpenF1 is locked during a session: switch to the official feed via our relay
      const f1 = await fetchF1Live().catch(() => null);
      if (f1?.live) { startF1Live(f1); return true; }
      startDemo(true);
      S.session = s;
      $('live-title').textContent = `${meetingName(s)} — ${s.session_name}`;
      setStatus('<span class="dot"></span> Сессия идёт · реалтайм OpenF1 закрыт, показываем демо', 'live');
      S.liveTimer = setInterval(() => loadSession(key), 60_000);
      return true;
    }
    // not published yet (OpenF1 can lag after a session ends)
    if (quiet) return false;
    if (!drivers.length) { startDemo(); return false; }
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
    if (!isRace()) { S.speed = Math.max(S.speed, 30); $('replay-speed').value = String(S.speed); }
    setStatus(`▶ Повтор: ${esc(sessionRu(s.session_name))} · перематывайте шкалой`, 'replay');
  }
  updatePlayBtn();
  render();
  if (/qualifying|sprint/i.test(s.session_name)) loadQualiResults(s);
  return true;
}

const isRace = () => !S.session || S.session.session_type === 'Race' || S.demo;
const RU = { 'Practice 1': 'Практика 1', 'Practice 2': 'Практика 2', 'Practice 3': 'Практика 3', Qualifying: 'Квалификация',
  'Sprint Qualifying': 'Спринт-квалификация', 'Sprint Shootout': 'Спринт-квалификация', Sprint: 'Спринт', Race: 'Гонка' };
const sessionRu = (n) => RU[n] || n;
const SHORT = { 'Practice 1': 'FP1', 'Practice 2': 'FP2', 'Practice 3': 'FP3', Qualifying: 'КВАЛ', 'Sprint Qualifying': 'SQ', 'Sprint Shootout': 'SQ', Sprint: 'СПРИНТ', Race: 'ГОНКА' };

// weekend strip: every session of the selected meeting with done / live / upcoming state
function renderWeekend() {
  const el = $('weekend');
  if (!S.session || S.demo || !S.all.length) { el.innerHTML = ''; return; }
  const now = Date.now();
  const list = S.all.filter((x) => x.meeting_key === S.session.meeting_key);
  el.innerHTML = list.map((x) => {
    const st = isLive(x) && ms(x.date_start) < now ? 'live' : ms(x.date_start) > now ? 'next' : 'done';
    const left = ms(x.date_start) - now;
    const sub = st === 'live' ? '● LIVE' : st === 'next'
      ? (left > 86400_000 ? `через ${Math.floor(left / 86400_000)} д` : `через ${Math.floor(left / 3600_000)} ч ${Math.floor((left % 3600_000) / 60_000)} м`)
      : new Date(x.date_start).toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    return `<button class="wk ${st} ${x.session_key === S.session.session_key ? 'cur' : ''}" data-k="${x.session_key}" ${st === 'next' ? 'disabled' : ''}>
      <b>${esc(SHORT[x.session_name] || x.session_name)}</b><span>${esc(sub)}</span></button>`;
  }).join('');
  el.querySelectorAll('button.wk:not([disabled])').forEach((b) => b.addEventListener('click', () => {
    $('session-select').value = b.dataset.k;
    loadSession(+b.dataset.k);
  }));
}

// KPI tiles at the top of the dashboard
function renderKpis(st) {
  const el = $('kpis');
  if (!st) { el.innerHTML = '<div class="kpi skel"></div>'.repeat(5); return; }
  const lead = st.rows[0];
  let fl = null;
  for (const r of st.rows) if (isFinite(r.pb) && (!fl || r.pb < fl.pb)) fl = r;
  const rc = S.data.race_control.filter((r) => r._t <= S.t && (r.flag || r.category === 'SafetyCar'));
  const lastFlag = rc[rc.length - 1];
  let flag = 'GREEN', flagText = 'Зелёный флаг';
  if (S.f1Track) [flag, flagText] = S.f1Track;
  else if (lastFlag) {
    if (lastFlag.category === 'SafetyCar' && !/ENDING|IN THIS LAP|WITHDRAWN/.test(lastFlag.message)) { flag = 'SC'; flagText = /VIRTUAL/.test(lastFlag.message) ? 'VSC' : 'Safety Car'; }
    else if (lastFlag.flag === 'RED') { flag = 'RED'; flagText = 'Красный флаг'; }
    else if (lastFlag.flag === 'CHEQUERED') { flag = 'CHEQUERED'; flagText = 'Финиш'; }
    else if (/YELLOW/.test(lastFlag.flag || '')) { flag = 'YELLOW'; flagText = 'Жёлтый флаг'; }
  }
  const total = S.totalLaps || Math.max(1, ...[...S.byDriver.laps.values()].map((a) => a.length));
  const pct = isRace() ? Math.min(100, (st.lap / total) * 100) : Math.min(100, ((S.t - S.t0) / Math.max(1, S.t1 - S.t0)) * 100);
  const w = lastBefore(S.data.weather, S.t);
  const tile = (label, value, sub, style = '') => `<div class="kpi" style="${style}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  el.innerHTML = [
    lead ? tile(isRace() ? 'Лидер' : 'Быстрейший', esc(lead.d.name_acronym), esc(lead.d.team_name || lead.d.full_name || ''), `--k:#${esc(lead.d.team_colour || 'fff')}`) : tile('Лидер', '—', ''),
    tile('Лучший круг', fl ? fmtLap(fl.pb) : '—', fl ? esc(fl.d.name_acronym) : 'ждём', '--k:var(--purple)'),
    `<div class="kpi prog" style="--pct:${pct}%"><span>${isRace() ? 'Прогресс' : 'Сессия'}</span><b>${isRace() ? `${st.lap}<em>/${total}</em>` : `${Math.round(pct)}%`}</b><small>${isRace() ? 'кругов' : 'времени прошло'}</small></div>`,
    tile('Трасса', esc(flagText), lastFlag ? fmtTime(lastFlag._t) : 'чистая', `--k:var(--flag-${flag})`),
    tile('Асфальт', w ? `${w.track_temperature}°` : '—', w ? `воздух ${w.air_temperature}° · ${w.rainfall ? 'дождь' : 'сухо'}` : '', '--k:var(--yellow)'),
  ].join('');
}

// official Q1/Q2/Q3 classification from Jolpica for qualifying sessions
async function loadQualiResults(s) {
  const card = $('quali-card');
  try {
    const races = await schedule(s.year);
    const d = ms(s.date_start);
    const race = races.find((r) => Math.abs(Date.parse(`${r.date}T12:00:00Z`) - d) < 4 * 86400_000);
    if (!race) return;
    const sprint = /sprint/i.test(s.session_name);
    const data = await jolpica(`${s.year}/${race.round}/${sprint ? 'sprint' : 'qualifying'}.json`, { ttl: 5 * 60_000 });
    const R = data.MRData.RaceTable.Races[0];
    const rows = sprint ? R?.SprintResults : R?.QualifyingResults;
    if (!rows?.length || S.session !== s) return;
    $('quali-title').textContent = sprint ? 'Итоги спринта' : 'Итоги квалификации';
    $('quali-body').innerHTML = `<table class="tower"><thead><tr><th>#</th><th>Пилот</th>${sprint ? '<th>Время</th><th>Очки</th>' : '<th>Q1</th><th>Q2</th><th>Q3</th>'}</tr></thead><tbody>
      ${rows.map((r) => `<tr style="--tc:${teamColor(r.Constructor.constructorId)}"><td class="p">${esc(r.position)}</td>
        <td class="drv"><span class="bar"></span>${esc(r.Driver.code || r.Driver.familyName)}</td>
        ${sprint ? `<td>${esc(r.Time?.time || r.status)}</td><td>${esc(r.points)}</td>` : `<td>${esc(r.Q1 || '—')}</td><td>${esc(r.Q2 || '—')}</td><td class="${r.position === '1' ? 'fl' : ''}">${esc(r.Q3 || '—')}</td>`}</tr>`).join('')}
      </tbody></table>`;
    card.hidden = false;
  } catch { /* official classification not published yet */ }
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
function gridPos(num) { return S.f1 ? undefined : (S.byDriver.position.get(num) || [])[0]?.position; }

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
    const out = S.f1 ? S.f1Out.has(num) : !carProgress(num, t) && started.length > 0;
    rows.push({ num, d, pos: pos?.position ?? 99, grid: gridPos(num), gap: iv?.gap_to_leader, interval: iv?.interval, last, pb, laps, lapNo, stint, out });
  }
  if (isRace()) rows.sort((a, b) => a.pos - b.pos);
  else {
    rows.sort((a, b) => (isFinite(a.pb) ? a.pb : 1e9) - (isFinite(b.pb) ? b.pb : 1e9) || a.pos - b.pos);
    rows.forEach((r, i) => { if (isFinite(r.pb)) r.pos = i + 1; });
  }
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
  if (isRace() && r.grid && r.pos !== 99) score += (r.grid - r.pos) * 0.18;
  if (isFinite(bestLap) && isFinite(r.pb)) score -= Math.min(2, (r.pb - bestLap) * 1.2);
  score -= Math.min(1.5, std * 0.6);
  if (r.out) score -= 2;
  return Math.max(1, Math.min(10, score));
}

// ---------- rendering ----------
function render(st = stateAt(S.t)) {
  if (!S.drivers.size) return;
  const total = S.totalLaps || Math.max(...[...S.byDriver.laps.values()].map((a) => a.length));
  $('lap-badge').textContent = !isRace() ? sessionRu(S.session.session_name) : st.lap ? `Круг ${st.lap}/${total}` : 'Старт';
  $('track-clock').textContent = S.mode === 'live' ? `LIVE · ${fmtTime(Date.now())}` : fmtTime(S.t);
  const seek = $('seek');
  const pct = (S.t - S.t0) / Math.max(1, S.t1 - S.t0);
  if (document.activeElement !== seek) seek.value = String(Math.round(pct * 1000));
  seek.style.setProperty('--p', `${Math.min(100, pct * 100)}%`);
  $('seek-label').textContent = S.mode === 'live' ? 'LIVE' : `${Math.round(pct * 100)}%`;
  renderKpis(st);
  renderMiniTower(st);
  if (S.sheetFor != null) renderSheet(st);
  renderTower(st);
  renderRatings(st);
  renderRaceControl();
  renderWeather();
  drawLapChart(st);
}

function renderTower(st) {
  const tb = $('tower').querySelector('tbody');
  const ths = $('tower').querySelectorAll('thead th');
  ths[2].textContent = isRace() ? 'Интервал' : 'Лучший';
  ths[3].textContent = isRace() ? 'Лидер' : 'Отрыв';
  const visible = st.rows.filter((r) => r.pos !== 99 || r.laps.length);
  const before = new Map();
  for (const [num, tr] of S.rows) before.set(num, tr.getBoundingClientRect().top);
  visible.forEach((r, i) => {
    let tr = S.rows.get(r.num);
    if (!tr) {
      tr = document.createElement('tr');
      tr.addEventListener('click', () => { selectDriver(r.num); if (isPhone()) openSheet(r.num); });
      S.rows.set(r.num, tr);
    }
    const lastCls = r.last && r.last.lap_duration === st.bestLap ? 'fl' : r.last && r.last.lap_duration === r.pb ? 'pb' : '';
    const comp = r.stint?.compound || '';
    const age = r.stint ? (r.stint.tyre_age_at_start || 0) + Math.max(0, r.lapNo - r.stint.lap_start) : '';
    const delta = isRace() && r.grid && r.pos !== 99 ? r.grid - r.pos : 0;
    const ratingCls = r.rating == null ? '' : r.rating > 7.5 ? 'hi' : r.rating > 5 ? 'mid' : 'lo';
    const race = isRace();
    const drs = race && i > 0 && typeof r.interval === 'number' && r.interval < 1;
    const best = visible[0] && isFinite(visible[0].pb) ? visible[0].pb : null;
    const c3 = race ? (r.out ? 'OUT' : i === 0 ? 'ЛИДЕР' : fmtGap(r.interval)) : (isFinite(r.pb) ? fmtLap(r.pb) : '—');
    const c4 = race ? (i === 0 ? '—' : fmtGap(r.gap)) : (isFinite(r.pb) && best && i ? `+${(r.pb - best).toFixed(3)}` : '—');
    tr.className = `${r.num === S.selDriver ? 'sel' : ''} ${r.out ? 'out' : ''}`;
    tr.style.setProperty('--tc', `#${r.d.team_colour || '888'}`);
    const html = `
      <td class="p">${r.pos === 99 ? '—' : r.pos}</td>
      <td class="drv"><span class="bar"></span>${esc(r.d.name_acronym)}${delta ? `<small class="${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}</small>` : ''}</td>
      <td class="${drs ? 'drs' : ''} ${!race && r.pb === st.bestLap ? 'fl' : ''}">${c3}</td>
      <td class="c-gap">${c4}</td>
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

// ---------- phone UI: tabs, swipe, driver sheet ----------
const phoneMq = matchMedia('(max-width: 760px)');
const isPhone = () => phoneMq.matches;
const PANELS = ['race', 'timing', 'laps', 'ratings', 'info'];
let panel = 'race';
try { panel = localStorage.getItem('f1p-panel') || 'race'; } catch { /* storage blocked */ }

function setPanel(p, { scroll = true } = {}) {
  if (!PANELS.includes(p)) p = 'race';
  panel = p;
  try { localStorage.setItem('f1p-panel', p); } catch { /* storage blocked */ }
  $('dash-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.panel === p));
  $('live-grid').querySelectorAll(':scope > .card').forEach((c) => c.classList.toggle('on', c.dataset.panel === p));
  if (scroll && isPhone()) {
    const top = $('dash-tabs').getBoundingClientRect().top + scrollY - 58;
    if (scrollY > top) scrollTo({ top, behavior: 'smooth' });
  }
  if (S.drivers.size) render();
}

function applyLayout() {
  $('live-grid').classList.toggle('tabbed', isPhone());
  document.body.classList.toggle('has-player', isPhone() && !$('view-live').hidden);
  setPanel(panel, { scroll: false });
}

function initMobileUi() {
  $('dash-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-panel]');
    if (b) setPanel(b.dataset.panel);
  });
  phoneMq.addEventListener('change', applyLayout);
  new MutationObserver(applyLayout).observe($('view-live'), { attributes: true, attributeFilter: ['hidden'] });
  // horizontal swipe on the dashboard switches tabs (ignored on the 3D track, which uses drags)
  let sx = 0, sy = 0, st = 0;
  const grid = $('live-grid');
  grid.addEventListener('touchstart', (e) => {
    if (e.target.closest('.track-wrap, canvas')) { st = 0; return; }
    sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now();
  }, { passive: true });
  grid.addEventListener('touchend', (e) => {
    if (!st || !isPhone()) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Date.now() - st < 600 && Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
      const i = PANELS.indexOf(panel) + (dx < 0 ? 1 : -1);
      if (i >= 0 && i < PANELS.length) setPanel(PANELS[i]);
    }
  }, { passive: true });
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
  applyLayout();
}

function renderMiniTower(st) {
  const top = st.rows.filter((r) => r.pos !== 99).slice(0, 5);
  $('mini-tower').innerHTML = top.map((r, i) => `<button class="mt" data-num="${r.num}" style="--tc:#${esc(r.d.team_colour || '888')}">
      <b>${r.pos}</b>${esc(r.d.name_acronym)}<small>${i === 0 ? (isRace() ? 'лидер' : fmtLap(r.pb)) : isRace() ? fmtGap(r.gap) : isFinite(r.pb) && isFinite(top[0].pb) ? `+${(r.pb - top[0].pb).toFixed(3)}` : '—'}</small></button>`).join('')
    + (st.rows.length > 5 ? '<button class="mt more" data-more="1">все →</button>' : '');
  $('mini-tower').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.more) { setPanel('timing'); return; }
    selectDriver(+b.dataset.num);
    if (isPhone()) openSheet(+b.dataset.num);
  }));
}

function openSheet(num) {
  S.sheetFor = num;
  $('sheet').hidden = false;
  renderSheet(stateAt(S.t));
}
function closeSheet() { S.sheetFor = null; $('sheet').hidden = true; }

function renderSheet(st) {
  const r = st.rows.find((x) => x.num === S.sheetFor);
  if (!r) return;
  const comp = r.stint?.compound;
  const age = r.stint ? (r.stint.tyre_age_at_start || 0) + Math.max(0, r.lapNo - r.stint.lap_start) : null;
  const recent = r.laps.slice(-6).reverse();
  const stat = (v, l, cls = '') => `<div class="stat"><b class="${cls}">${v}</b><span>${l}</span></div>`;
  $('sheet-body').innerHTML = `
    <div class="sheet-head" style="--tc:#${esc(r.d.team_colour || '888')}">
      ${r.d.headshot_url ? `<img src="${esc(safeUrl(r.d.headshot_url))}" alt="" onerror="this.remove()">` : ''}
      <div><p class="eyebrow">P${r.pos === 99 ? '—' : r.pos} · ${esc(r.d.team_name || '')}</p><h3>${esc(r.d.full_name || r.d.name_acronym)}</h3></div>
    </div>
    <div class="stat-grid">
      ${stat(r.pos === 99 ? '—' : r.pos, 'позиция')}
      ${stat(st.rows[0] === r ? 'ЛИДЕР' : isRace() ? fmtGap(r.gap) : isFinite(r.pb) && isFinite(st.rows[0].pb) ? `+${(r.pb - st.rows[0].pb).toFixed(3)}` : '—', isRace() ? 'до лидера' : 'до быстрейшего')}
      ${stat(r.rating == null ? '—' : r.rating.toFixed(1), 'оценка', r.rating > 7.5 ? 'up' : r.rating > 5 ? '' : 'down')}
      ${stat(fmtLap(r.last?.lap_duration), 'последний')}
      ${stat(isFinite(r.pb) ? fmtLap(r.pb) : '—', 'лучший круг', r.pb === st.bestLap ? 'fl' : '')}
      ${stat(comp ? `<span class="tyre ${esc(comp)}">${esc(comp[0])}</span>${age}` : '—', 'шины · круги')}
    </div>
    ${recent.length ? `<h3>Последние круги</h3><table class="mini-table">${recent.map((l) => `<tr><td>Круг ${l.lap_number}${l.is_pit_out_lap ? ' · пит' : ''}</td><td class="${l.lap_duration === r.pb ? 'pb' : ''}">${fmtLap(l.lap_duration)}</td></tr>`).join('')}</table>` : '<p class="muted">Кругов пока нет.</p>'}
    <button class="btn small neon" id="sheet-laps" style="margin-top:14px;width:100%">График кругов</button>`;
  $('sheet-laps').onclick = () => { closeSheet(); setPanel('laps'); };
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

// ---------- real-time F1 feed (via /api/live) ----------
// The relay returns the official live-timing state; it is converted into the same OpenF1-shaped
// arrays the dashboard already renders (positions, intervals, laps, stints, race control, weather).
const F1 = { hist: new Map(), tc: new Map(), pitOut: new Map(), lastPos: new Map(), lastGap: new Map() };
async function fetchF1Live() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch('/api/live', { cache: 'no-store', signal: ctl.signal });
    if (!r.ok) throw new Error(`relay ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

const TRACK = { 1: ['GREEN', 'Зелёный флаг'], 2: ['YELLOW', 'Жёлтый флаг'], 4: ['SC', 'Safety Car'], 5: ['RED', 'Красный флаг'], 6: ['SC', 'VSC'], 7: ['SC', 'VSC заканчивается'] };

function startF1Live(f) {
  resetView();
  S.demo = false;
  S.f1 = true;
  for (const m of Object.values(F1)) m.clear();
  const s = f.session;
  S.meetings.set('f1', { meeting_name: s.meeting });
  S.session = {
    session_key: `f1-${s.key}`, session_name: s.name, session_type: s.type, year: s.year, meeting_key: 'f1',
    country_name: s.country, circuit_short_name: s.circuit, date_start: s.start, date_end: s.end,
  };
  $('session-select').innerHTML = `<option>${esc(s.meeting)} — ${esc(sessionRu(s.name))} · LIVE</option>`;
  $('live-title').textContent = `${s.meeting} — ${sessionRu(s.name)}`;
  $('live-sub').textContent = `${s.circuit}, ${s.country} · прямой эфир · официальный тайминг F1`;
  $('quali-card').hidden = true;
  renderWeekend();
  renderLinks();
  S.drivers = new Map();
  S.data = { position: [], intervals: [], laps: [], stints: [], race_control: [], weather: [] };
  applyF1(f, true);
  loadCircuit(s.circuitKey, s.year);
  S.mode = 'live';
  S.t = Date.now();
  updatePlayBtn();
  render();
  S.liveTimer = setInterval(pollF1, 5_000);
}

async function pollF1() {
  if (document.hidden) return;
  try {
    const f = await fetchF1Live();
    if (!S.f1 || !f.drivers) return;
    if (`f1-${f.session?.key}` !== S.session.session_key) { if (f.live) startF1Live(f); return; }
    applyF1(f);
    if (!f.live) {
      // session over: keep the final classification on screen, stop polling
      stopLive();
      setStatus('🏁 Сессия завершена · итоговая классификация (официальный тайминг)', 'replay');
    }
  } catch { /* transient relay error: keep the last state */ }
}

// circuit outline (public MultiViewer API), else the generic fallback shape
async function loadCircuit(key, year) {
  try {
    const r = await fetch(`https://api.multiviewer.app/api/v1/circuits/${encodeURIComponent(key)}/${encodeURIComponent(year)}`);
    const c = await r.json();
    const pts = (c.x || []).map((x, i) => ({ x, y: c.y[i] }));
    if (pts.length > 20 && track.setOutline(pts)) return;
  } catch { /* no outline available */ }
  track.setOutlineFallback();
}

function applyF1(f, first = false) {
  const now = Date.now();
  const iso = (t) => new Date(t).toISOString();
  const stamp = first ? now - 60_000 : now;
  S.totalLaps = f.totalLaps || null;
  S.f1Out = new Set(f.drivers.filter((d) => d.out).map((d) => d.num));
  S.f1Track = f.status === 'Finished' || f.status === 'Finalised' ? ['CHEQUERED', 'Финиш'] : TRACK[f.track?.status] || null;

  const drivers = f.drivers.map((d) => ({
    driver_number: d.num, name_acronym: d.tla, full_name: d.name, team_name: d.team, team_colour: d.colour, headshot_url: d.headshot,
  }));
  const changed = drivers.length !== S.drivers.size || drivers.some((d) => !S.drivers.has(d.driver_number));
  drivers.forEach((d) => S.drivers.set(d.driver_number, d));
  if (changed) {
    $('lap-driver').innerHTML = drivers
      .map((d) => `<option value="${d.driver_number}">${esc(d.name_acronym)} — ${esc(d.full_name)}</option>`).join('');
    if (S.selDriver) $('lap-driver').value = S.selDriver;
  }

  const laps = [], stints = [];
  for (const d of f.drivers) {
    if (F1.lastPos.get(d.num) !== d.pos) {
      F1.lastPos.set(d.num, d.pos);
      S.data.position.push({ driver_number: d.num, position: d.pos, date: iso(stamp), _t: stamp });
    }
    const gk = `${d.gap}|${d.interval}`;
    if (F1.lastGap.get(d.num) !== gk) {
      F1.lastGap.set(d.num, gk);
      S.data.intervals.push({ driver_number: d.num, gap_to_leader: d.gap, interval: d.interval, date: iso(stamp), _t: stamp });
    }
    // lap history: every lap time seen while the page is open, plus the personal best
    const hist = F1.hist.get(d.num) || new Map();
    F1.hist.set(d.num, hist);
    if (d.laps && d.last) hist.set(d.laps, d.last);
    if (d.bestLap && d.best && !hist.has(d.bestLap)) hist.set(d.bestLap, d.best);
    const pits = F1.pitOut.get(d.num) || new Set();
    F1.pitOut.set(d.num, pits);
    if (d.pitOut) pits.add(d.laps + 1);
    const known = [...hist.values()].sort((a, b) => a - b);
    const med = known[Math.floor(known.length / 2)] || d.last || 90;
    // when did the current lap start: smoothed estimate from completed sectors
    const est = now - Math.min(d.into || 0, d.last || med) * 1000;
    const prev = F1.tc.get(d.num);
    const tc = !prev || prev.lap !== d.laps ? est : prev.t * 0.7 + est * 0.3;
    F1.tc.set(d.num, { lap: d.laps, t: tc });
    let start = tc;
    if (!d.out && (d.laps > 0 || !d.inPit)) laps.push({ driver_number: d.num, lap_number: d.laps + 1, lap_duration: null, is_pit_out_lap: pits.has(d.laps + 1), date_start: iso(tc) });
    for (let n = d.laps; n >= 1; n--) {
      const dur = hist.get(n) || med;
      start -= dur * 1000;
      laps.push({ driver_number: d.num, lap_number: n, lap_duration: hist.get(n) || null, is_pit_out_lap: pits.has(n), date_start: iso(start) });
    }
    let lapStart = 1;
    d.stints.forEach((x, i) => {
      const len = Math.max(0, x.totalLaps - x.startLaps);
      const last = i === d.stints.length - 1;
      stints.push({ driver_number: d.num, compound: x.compound, tyre_age_at_start: x.startLaps, lap_start: lapStart, lap_end: last ? null : lapStart + len - 1 });
      lapStart += len;
    });
  }
  S.byDriver.position = groupBy(S.data.position, 'date');
  S.byDriver.intervals = groupBy(S.data.intervals, 'date');
  indexLaps(laps);
  S.data.stints = stints;
  S.data.race_control = f.raceControl.filter((r) => r.date).map((r) => ({ ...r, _t: ms(r.date) })).sort((a, b) => a._t - b._t);
  if (f.weather) {
    const w = f.weather;
    S.data.weather = [{ date: iso(stamp - 5000), _t: stamp - 5000, air_temperature: w.air, track_temperature: w.track, humidity: w.humidity, wind_speed: w.wind, rainfall: w.rain ? 1 : 0 }];
  }
  computeWindow();
  const lapTxt = f.lap && f.totalLaps ? ` · круг ${f.lap}/${f.totalLaps}` : f.remaining ? ` · осталось ${f.remaining}` : '';
  if (f.live) setStatus(`<span class="dot"></span> LIVE${esc(lapTxt)} · официальный тайминг F1`, 'live');
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
