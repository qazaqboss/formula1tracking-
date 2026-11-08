// Vercel serverless function: real-time F1 timing relay.
//
// OpenF1 locks its whole API while a session is running, so during a session the site reads
// the official F1 live timing SignalR feed itself (the same feed the open-source OpenF1
// ingestor and FastF1 record). Each call connects, subscribes, takes the full-state snapshot
// the server returns for the subscription, disconnects and replies with a compact JSON.
// Responses are cached at the edge for a few seconds, so many viewers share one upstream call.

const BASE = 'https://livetiming.formula1.com/signalrcore';
const RS = '\x1e';
const TOPICS = [
  'Heartbeat', 'SessionInfo', 'SessionStatus', 'DriverList', 'TimingData', 'TimingAppData', 'TimingStats',
  'LapCount', 'TrackStatus', 'RaceControlMessages', 'WeatherData', 'ExtrapolatedClock',
];

async function snapshot(timeoutMs = 8000) {
  const neg = await fetch(`${BASE}/negotiate?negotiateVersion=1`, { method: 'POST' });
  if (!neg.ok) throw new Error(`negotiate ${neg.status}`);
  const cookie = (neg.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const { connectionToken } = await neg.json();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://livetiming.formula1.com/signalrcore?id=${encodeURIComponent(connectionToken)}`, { headers: { Cookie: cookie } });
    const done = (fn, v) => { clearTimeout(timer); try { ws.close(); } catch { /* already closed */ } fn(v); };
    const timer = setTimeout(() => done(reject, new Error('timeout')), timeoutMs);
    ws.onopen = () => {
      ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RS);
      ws.send(JSON.stringify({ type: 1, invocationId: '0', target: 'Subscribe', arguments: [TOPICS] }) + RS);
    };
    ws.onmessage = (e) => {
      for (const frame of String(e.data).split(RS)) {
        if (!frame) continue;
        let m;
        try { m = JSON.parse(frame); } catch { continue; }
        if (m.type === 3 && m.invocationId === '0') return m.error ? done(reject, new Error(m.error)) : done(resolve, m.result || {});
        if (m.type === 7) return done(reject, new Error(m.error || 'closed by server'));
      }
    };
    ws.onerror = () => done(reject, new Error('websocket error'));
  });
}

// "1:27.224" -> 87.224, "41.377" -> 41.377
const secs = (v) => {
  if (!v || typeof v !== 'string') return null;
  const p = v.split(':').map(Number);
  const s = p.length === 2 ? p[0] * 60 + p[1] : p[0];
  return Number.isFinite(s) && s > 0 ? s : null;
};
// "+1.234" -> 1.234, "LAP 63" (leader) -> 0, "1L" / "+1 LAP" stay strings, "" -> null
const gap = (v) => {
  if (v == null || v === '') return null;
  if (/^LAP/i.test(v)) return 0;
  const n = Number(String(v).replace('+', ''));
  return Number.isFinite(n) ? n : String(v).replace(/^\+/, '+');
};
// local session time + "-03:00:00" offset -> ISO UTC
const utc = (local, off = '00:00:00') => {
  if (!local) return null;
  const neg = off.startsWith('-');
  const [h, m] = off.replace('-', '').split(':').map(Number);
  return new Date(Date.parse(`${local}Z`) - (neg ? -1 : 1) * (h * 60 + m) * 60_000).toISOString();
};

function normalize(r) {
  const si = r.SessionInfo || {};
  const start = utc(si.StartDate, si.GmtOffset);
  const end = utc(si.EndDate, si.GmtOffset);
  const status = r.SessionStatus?.Status || si.SessionStatus || 'Unknown';
  const now = Date.now();
  const inWindow = start && end && now > Date.parse(start) - 30 * 60_000 && now < Date.parse(end) + 90 * 60_000;
  const lines = r.TimingData?.Lines || {};
  const app = r.TimingAppData?.Lines || {};
  const stats = r.TimingStats?.Lines || {};
  const drivers = Object.entries(r.DriverList || {}).filter(([k]) => /^\d+$/.test(k)).map(([num, d]) => {
    const t = lines[num] || {};
    const sectors = Array.isArray(t.Sectors) ? t.Sectors : Object.values(t.Sectors || {});
    // time spent in the current lap: completed sectors + a share of the next one
    let into = 0, k = 0;
    while (k < sectors.length && secs(sectors[k]?.Value)) into += secs(sectors[k++].Value);
    if (k < sectors.length) into += 0.4 * (secs(sectors[k]?.PreviousValue) || 0);
    const stints = (app[num]?.Stints ? Object.values(app[num].Stints) : []).map((s) => ({
      compound: s.Compound || 'UNKNOWN', isNew: s.New === 'true', startLaps: +s.StartLaps || 0, totalLaps: +s.TotalLaps || 0,
    }));
    return {
      num: +num, tla: d.Tla, name: d.FullName || `${d.FirstName || ''} ${d.LastName || ''}`.trim(), team: d.TeamName,
      colour: d.TeamColour || '888888', headshot: d.HeadshotUrl || null,
      pos: +t.Position || +d.Line || 99, line: +t.Line || +d.Line || 99,
      gap: gap(t.GapToLeader ?? t.TimeDiffToFastest), interval: gap(t.IntervalToPositionAhead?.Value ?? t.TimeDiffToPositionAhead),
      laps: +t.NumberOfLaps || 0, last: secs(t.LastLapTime?.Value), best: secs(t.BestLapTime?.Value ?? stats[num]?.PersonalBestLapTime?.Value),
      bestLap: +(t.BestLapTime?.Lap ?? stats[num]?.PersonalBestLapTime?.Lap) || null,
      pits: +t.NumberOfPitStops || 0, inPit: !!t.InPit, pitOut: !!t.PitOut,
      out: !!(t.Retired || t.Stopped || t.KnockedOut), into: Math.round(into * 10) / 10, stints,
    };
  });
  const msgs = Object.values(r.RaceControlMessages?.Messages || {}).slice(-60).map((m) => ({
    date: m.Utc ? `${m.Utc}Z` : null, category: m.Category, flag: m.Flag || null, message: m.Message, lap: m.Lap || null,
  }));
  const w = r.WeatherData || {};
  return {
    live: !!inWindow && !['Finalised', 'Ends'].includes(status),
    status,
    serverTime: r.Heartbeat?.Utc || new Date().toISOString(),
    session: {
      key: si.Key, type: si.Type, name: si.Name, start, end, path: si.Path,
      meeting: si.Meeting?.Name, official: si.Meeting?.OfficialName, location: si.Meeting?.Location,
      country: si.Meeting?.Country?.Name, circuit: si.Meeting?.Circuit?.ShortName, circuitKey: si.Meeting?.Circuit?.Key,
      year: start ? new Date(start).getUTCFullYear() : null,
    },
    lap: r.LapCount?.CurrentLap ?? null, totalLaps: r.LapCount?.TotalLaps ?? null,
    remaining: r.ExtrapolatedClock?.Remaining ?? null,
    track: { status: r.TrackStatus?.Status ?? null, message: r.TrackStatus?.Message ?? null },
    weather: w.AirTemp ? { air: +w.AirTemp, track: +w.TrackTemp, humidity: +w.Humidity, wind: +w.WindSpeed, rain: w.Rainfall !== '0' } : null,
    drivers,
    raceControl: msgs,
  };
}

export default async function handler(req, res) {
  try {
    const data = normalize(await snapshot());
    res.setHeader('Cache-Control', `public, s-maxage=${data.live ? 4 : 60}, stale-while-revalidate=${data.live ? 6 : 120}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'public, s-maxage=5');
    res.status(502).json({ live: false, error: String(e.message || e) });
  }
}
