// Data layer: OpenF1 (live/session telemetry) + Jolpica (Ergast-compatible standings & results)
const OPENF1 = 'https://api.openf1.org/v1';
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';

const memCache = new Map();

function cacheGet(key, ttl) {
  const m = memCache.get(key);
  if (m && Date.now() - m.t < ttl) return m.v;
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const s = JSON.parse(raw);
      if (Date.now() - s.t < ttl) return s.v;
    }
  } catch { /* storage unavailable */ }
  return undefined;
}
function cacheSet(key, v) {
  memCache.set(key, { t: Date.now(), v });
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* quota or blocked */ }
}

async function getJSON(url, { ttl = 60_000, timeout = 12_000, persist = true } = {}) {
  const hit = ttl > 0 ? cacheGet(url, ttl) : undefined;
  if (hit !== undefined) return hit;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const data = await res.json();
    if (ttl > 0) persist ? cacheSet(url, data) : memCache.set(url, { t: Date.now(), v: data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function qs(params) {
  // OpenF1 supports operators in keys like "date>" — keep them unescaped
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

export const openf1 = (path, params = {}, opts = {}) => getJSON(`${OPENF1}/${path}?${qs(params)}`, opts);

export const jolpica = (path, opts = {}) => getJSON(`${JOLPICA}/${path}`, { ttl: 10 * 60_000, ...opts });

// ---------- Jolpica helpers ----------
export async function driverStandings(season = 'current') {
  const d = await jolpica(`${season}/driverStandings.json`);
  const list = d.MRData.StandingsTable.StandingsLists[0];
  return list ? { season: list.season, round: list.round, rows: list.DriverStandings } : null;
}
export async function constructorStandings(season = 'current') {
  const d = await jolpica(`${season}/constructorStandings.json`);
  const list = d.MRData.StandingsTable.StandingsLists[0];
  return list ? { season: list.season, round: list.round, rows: list.ConstructorStandings } : null;
}
export async function schedule(season = 'current') {
  const d = await jolpica(`${season}.json?limit=100`);
  return d.MRData.RaceTable.Races;
}
export async function winners(season = 'current') {
  const d = await jolpica(`${season}/results/1.json?limit=100`);
  return d.MRData.RaceTable.Races;
}
export async function raceResults(season, round) {
  const d = await jolpica(`${season}/${round}/results.json`);
  return d.MRData.RaceTable.Races[0];
}
export async function driverSeasonResults(season, driverId) {
  const d = await jolpica(`${season}/drivers/${driverId}/results.json?limit=100`);
  return d.MRData.RaceTable.Races;
}
export async function driverCareer(driverId) {
  const [wins, poles, champs] = await Promise.all([
    jolpica(`drivers/${driverId}/results/1.json?limit=1`),
    jolpica(`drivers/${driverId}/qualifying/1.json?limit=1`),
    jolpica(`drivers/${driverId}/driverStandings/1.json?limit=1`),
  ]);
  return {
    wins: +wins.MRData.total,
    poles: +poles.MRData.total,
    titles: +champs.MRData.total,
  };
}

// ---------- News (RSS via rss2json, CORS-friendly) ----------
const FEEDS = [
  { name: 'Motorsport.com', url: 'https://www.motorsport.com/rss/f1/news/' },
  { name: 'Autosport', url: 'https://www.autosport.com/rss/f1/news/' },
  { name: 'RaceFans', url: 'https://www.racefans.net/feed/' },
  { name: 'The Race', url: 'https://www.the-race.com/formula-1/feed/' },
];
export async function news() {
  const results = await Promise.allSettled(
    FEEDS.map((f) =>
      getJSON(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(f.url)}`, { ttl: 5 * 60_000 }).then((d) =>
        (d.items || []).map((it) => ({
          source: f.name,
          title: it.title,
          link: it.link,
          date: it.pubDate ? new Date(it.pubDate.replace(' ', 'T') + 'Z') : null,
          image: it.thumbnail || it.enclosure?.link || extractImg(it.description),
          summary: stripHtml(it.description || '').slice(0, 180),
        })),
      ),
    ),
  );
  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .sort((a, b) => (b.date || 0) - (a.date || 0));
}
export const NEWS_SOURCES = [
  { name: 'Formula1.com — Latest', url: 'https://www.formula1.com/en/latest' },
  ...FEEDS.map((f) => ({ name: f.name, url: f.url.replace(/rss\/|feed\/?$/g, '') })),
];
function stripHtml(s) {
  // DOMParser does not execute scripts or load images from untrusted feed HTML
  const doc = new DOMParser().parseFromString(s, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
function extractImg(html = '') {
  const m = html.match(/<img[^>]+src="([^"]+)"/i);
  return m ? m[1] : '';
}
