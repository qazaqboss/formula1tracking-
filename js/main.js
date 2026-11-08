import * as api from './api.js';
import { initCar } from './car3d.js';
import { initLive, pauseLive } from './live.js';
import { initBackground } from './bg.js';
import {
  FALLBACK_GRID, HISTORIC_RACES, teamColor, esc, safeUrl, ytSearch, f1tvSearch, fmtDate, raceDate, timeAgo, flagEmoji,
} from './data.js';

const $ = (id) => document.getElementById(id);
const ROUTES = ['live', 'home', 'drivers', 'constructors', 'races', 'history', 'news'];
const loaded = new Set();

// ---------- router ----------
function route() {
  const r = ROUTES.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'live';
  for (const id of ROUTES) $(`view-${id}`).hidden = id !== r;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === r));
  $('nav').classList.remove('open');
  $('drawer').hidden = true;
  if (r === 'live') initLive(); else pauseLive();
  if (!loaded.has(r)) {
    loaded.add(r);
    ({ home: loadHome, drivers: loadDrivers, constructors: loadConstructors, races: loadRaces, history: loadHistory, news: loadNews }[r])?.();
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
$('burger').addEventListener('click', () => $('nav').classList.toggle('open'));

// ---------- drawer ----------
function openDrawer(html) {
  $('drawer-body').innerHTML = html;
  $('drawer').hidden = false;
}
$('drawer-close').addEventListener('click', () => ($('drawer').hidden = true));
$('drawer').addEventListener('click', (e) => { if (e.target.id === 'drawer') $('drawer').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('drawer').hidden = true; });

// ---------- shared data ----------
let standingsP;
function getStandings() {
  standingsP ??= Promise.all([
    api.driverStandings().catch(() => null),
    api.constructorStandings().catch(() => null),
  ]).then(([d, c]) => ({ d, c }));
  return standingsP;
}
let headshotsP;
function getHeadshots() {
  headshotsP ??= api.openf1('drivers', { session_key: 'latest' }, { ttl: 60 * 60_000 })
    .then((rows) => new Map(rows.map((r) => [r.name_acronym, r])))
    .catch(() => new Map());
  return headshotsP;
}

// ---------- HOME ----------
async function loadHome() {
  const nr = $('next-race');
  try {
    const races = await api.schedule();
    const now = Date.now();
    const next = races.find((r) => raceDate(r) > now - 2 * 3600_000);
    const last = [...races].reverse().find((r) => raceDate(r) < now);
    if (next) {
      nr.innerHTML = `
        <div>
          <p class="eyebrow">Следующий Гран-при · этап ${esc(next.round)}</p>
          <h2>${flagEmoji(countryNat(next.Circuit.Location.country))} ${esc(next.raceName)}</h2>
          <p class="muted">${esc(next.Circuit.circuitName)}, ${esc(next.Circuit.Location.locality)} · ${fmtDate(raceDate(next), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</p>
          <div class="tagrow">
            <a class="tag" href="#live">Лайв-дашборд</a>
            <a class="tag" href="${esc(safeUrl(next.url))}" target="_blank" rel="noopener">Википедия</a>
            <a class="tag" href="${ytSearch(`F1 ${next.season} ${next.raceName} preview`)}" target="_blank" rel="noopener">Превью</a>
          </div>
        </div>
        <div class="countdown" id="countdown"></div>`;
      const target = raceDate(next);
      const cd = () => {
        const s = Math.max(0, (target - Date.now()) / 1000);
        const el = $('countdown');
        if (!el) return;
        el.innerHTML = s === 0
          ? '<div><b>LIVE</b><span>гонка идёт</span></div>'
          : [[Math.floor(s / 86400), 'дней'], [Math.floor((s % 86400) / 3600), 'часов'], [Math.floor((s % 3600) / 60), 'минут'], [Math.floor(s % 60), 'секунд']]
              .map(([v, l]) => `<div><b>${String(v).padStart(2, '0')}</b><span>${l}</span></div>`).join('');
      };
      cd();
      setInterval(cd, 1000);
    } else {
      nr.innerHTML = `<div><p class="eyebrow">Сезон завершён</p><h2>До встречи в следующем сезоне</h2><p class="muted">Смотрите итоги в разделе <a href="#races">Гонки</a>.</p></div>`;
    }
    if (last) renderLastResult(last);
  } catch {
    nr.innerHTML = '<div class="skeleton">Календарь недоступен — проверьте подключение.</div>';
  }

  const { d, c } = await getStandings();
  const tops = $('home-tops');
  const drv = (d?.rows || FALLBACK_GRID).slice(0, 5);
  const cons = (c?.rows || []).slice(0, 5);
  tops.insertAdjacentHTML('afterbegin', `
    <div class="card"><div class="card-head"><h3>Пилоты</h3><a href="#drivers" class="muted">все →</a></div>
      <table class="mini-table">${drv.map((r) => `<tr><td>${esc(r.position)}. <span class="bar" style="display:inline-block;width:4px;height:12px;background:${teamColor(r.Constructors[0]?.constructorId)}"></span> ${esc(r.Driver.givenName)} <b>${esc(r.Driver.familyName)}</b></td><td>${esc(r.points)}</td></tr>`).join('')}</table></div>
    <div class="card"><div class="card-head"><h3>Конструкторы</h3><a href="#constructors" class="muted">все →</a></div>
      <table class="mini-table">${cons.length ? cons.map((r) => `<tr><td>${esc(r.position)}. <span style="display:inline-block;width:4px;height:12px;background:${teamColor(r.Constructor.constructorId)}"></span> <b>${esc(r.Constructor.name)}</b></td><td>${esc(r.points)}</td></tr>`).join('') : '<tr><td class="muted">Нет данных</td></tr>'}</table></div>`);
}

async function renderLastResult(race) {
  try {
    const res = await api.raceResults(race.season, race.round);
    if (!res) return;
    $('home-tops').insertAdjacentHTML('beforeend', `
      <div class="card"><div class="card-head"><h3>Последняя гонка</h3><a href="#races" class="muted">все →</a></div>
        <p style="margin:0 0 8px"><b>${esc(res.raceName)}</b> <span class="muted">${fmtDate(res.date)}</span></p>
        <table class="mini-table">${res.Results.slice(0, 3).map((r) => `<tr><td>${['🥇', '🥈', '🥉'][r.position - 1]} ${esc(r.Driver.familyName)} <span class="muted">${esc(r.Constructor.name)}</span></td><td>${esc(r.Time?.time || r.status)}</td></tr>`).join('')}</table>
        <div class="tagrow">
          <a class="tag" href="${ytSearch(`F1 ${res.season} ${res.raceName} race highlights`)}" target="_blank" rel="noopener">▶ Хайлайты</a>
          <a class="tag" href="${esc(safeUrl(res.url))}" target="_blank" rel="noopener">Википедия</a>
        </div></div>`);
  } catch { /* optional card */ }
}

function countryNat(country) {
  const m = {
    Netherlands: 'Dutch', France: 'French', Monaco: 'Monegasque', UK: 'British', Italy: 'Italian', Australia: 'Australian',
    Spain: 'Spanish', Canada: 'Canadian', Brazil: 'Brazilian', Mexico: 'Mexican', Japan: 'Japanese', China: 'Chinese',
    USA: 'American', 'United States': 'American', Austria: 'Austrian', Belgium: 'Belgian', Hungary: 'Hungarian',
  };
  return m[country] || country;
}

// ---------- DRIVERS ----------
async function loadDrivers() {
  const grid = $('driver-grid');
  grid.innerHTML = '<div class="skeleton">Загрузка пилотов…</div>';
  const [{ d }, shots] = await Promise.all([getStandings(), getHeadshots()]);
  const rows = d?.rows || FALLBACK_GRID;
  $('drivers-season').textContent = d ? `· сезон ${d.season}, после ${d.round} этапа` : '· офлайн-состав';
  grid.innerHTML = rows.map((r, i) => {
    const D = r.Driver;
    const team = r.Constructors[0] || {};
    const shot = shots.get(D.code)?.headshot_url;
    const tc = teamColor(team.constructorId, shots.get(D.code)?.team_colour ? `#${shots.get(D.code).team_colour}` : undefined);
    return `<div class="card driver-card" style="--tc:${tc}" data-i="${i}">
      <div class="photo">
        <span class="num">${esc(D.permanentNumber || '')}</span><span class="pos">P${esc(r.position)}</span>
        ${shot ? `<img src="${esc(safeUrl(shot))}" alt="${esc(D.familyName)}" loading="lazy" onerror="this.style.display='none'">` : `<span class="initials">${esc(D.code || D.familyName.slice(0, 3).toUpperCase())}</span>`}
      </div>
      <div class="info">
        <div class="name">${flagEmoji(D.nationality)} ${esc(D.givenName)} ${esc(D.familyName)}</div>
        <div class="meta"><span>${esc(team.name || '')}</span><span class="pts">${esc(r.points)} <small class="muted">очк.</small></span></div>
        <div class="meta"><span>Победы: ${esc(r.wins)}</span><span>${esc(D.code || '')}</span></div>
      </div></div>`;
  }).join('');
  grid.querySelectorAll('.driver-card').forEach((el) =>
    el.addEventListener('click', () => driverDrawer(rows[+el.dataset.i], d?.season, shots)));
}

async function driverDrawer(r, season, shots) {
  const D = r.Driver;
  const team = r.Constructors[0] || {};
  const tc = teamColor(team.constructorId);
  const shot = shots.get(D.code)?.headshot_url;
  openDrawer(`
    <div style="display:flex;gap:16px;align-items:center;border-bottom:3px solid ${tc};padding-bottom:12px">
      ${shot ? `<img src="${esc(safeUrl(shot))}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:50%;background:${tc}">` : ''}
      <div><p class="eyebrow">#${esc(D.permanentNumber || '')} · ${esc(team.name || '')}</p><h2 style="margin:0">${esc(D.givenName)} ${esc(D.familyName)}</h2>
      <p class="muted" style="margin:0">${flagEmoji(D.nationality)} ${esc(D.nationality)}${D.dateOfBirth ? ` · род. ${fmtDate(D.dateOfBirth)}` : ''}</p></div>
    </div>
    <div class="stat-grid">
      <div class="stat"><b>${esc(r.position)}</b><span>Позиция</span></div>
      <div class="stat"><b>${esc(r.points)}</b><span>Очки</span></div>
      <div class="stat"><b>${esc(r.wins)}</b><span>Победы ${esc(season || '')}</span></div>
    </div>
    <div class="stat-grid" id="career"><div class="stat"><b>…</b><span>Карьера</span></div></div>
    <div class="links" style="margin-bottom:16px">
      ${D.url ? `<a href="${esc(safeUrl(D.url))}" target="_blank" rel="noopener"><span>Биография (Википедия)</span><span>↗</span></a>` : ''}
      <a href="${ytSearch(`${D.givenName} ${D.familyName} F1 best moments`)}" target="_blank" rel="noopener"><span>Лучшие моменты — видео</span><span>↗</span></a>
    </div>
    <h3>Результаты сезона</h3><div id="drv-results" class="muted">Загрузка…</div>`);
  if (!season) { $('drv-results').textContent = 'Нет данных.'; $('career').innerHTML = ''; return; }
  api.driverCareer(D.driverId).then((c) => {
    $('career').innerHTML = `<div class="stat"><b>${c.titles}</b><span>Титулы</span></div><div class="stat"><b>${c.wins}</b><span>Победы</span></div><div class="stat"><b>${c.poles}</b><span>Поулы</span></div>`;
  }).catch(() => ($('career').innerHTML = ''));
  try {
    const races = await api.driverSeasonResults(season, D.driverId);
    $('drv-results').innerHTML = `<table class="mini-table">${races.map((x) => {
      const res = x.Results[0];
      return `<tr><td>${esc(x.round)}. ${esc(x.raceName.replace(' Grand Prix', ''))}</td><td>${res.positionText === 'R' ? 'DNF' : `P${esc(res.position)}`} · ${esc(res.points)}</td></tr>`;
    }).join('')}</table>`;
  } catch { $('drv-results').textContent = 'Нет данных.'; }
}

// ---------- CONSTRUCTORS ----------
async function loadConstructors() {
  const list = $('cons-list');
  const [{ c, d }] = await Promise.all([getStandings()]);
  if (!c) { list.innerHTML = '<div class="notice">Таблица конструкторов недоступна.</div>'; return; }
  $('cons-season').textContent = `· сезон ${c.season}`;
  const max = Math.max(...c.rows.map((r) => +r.points), 1);
  const driversBy = new Map();
  for (const r of d?.rows || []) {
    const id = r.Constructors.at(-1)?.constructorId;
    if (!driversBy.has(id)) driversBy.set(id, []);
    driversBy.get(id).push(`${r.Driver.familyName} (${r.points})`);
  }
  list.innerHTML = c.rows.map((r) => {
    const col = teamColor(r.Constructor.constructorId);
    return `<div class="card cons-row" style="border-left:4px solid ${col}">
      <span class="p">${esc(r.position)}</span>
      <div><div class="team">${flagEmoji(r.Constructor.nationality)} ${esc(r.Constructor.name)}</div>
        <div class="drivers">${esc((driversBy.get(r.Constructor.constructorId) || []).join(' · '))} · побед: ${esc(r.wins)}</div></div>
      <div class="bar-wrap"><div class="bar-fill" style="width:${(+r.points / max) * 100}%;background:linear-gradient(90deg,${col},${col}55)"></div></div>
      <span class="pts">${esc(r.points)}</span>
    </div>`;
  }).join('');
}

// ---------- RACES ----------
async function loadRaces() {
  const sel = $('season-select');
  const thisYear = new Date().getUTCFullYear();
  sel.innerHTML = Array.from({ length: thisYear - 1949 }, (_, i) => thisYear - i).map((y) => `<option>${y}</option>`).join('');
  sel.addEventListener('change', () => renderSeason(sel.value));
  renderSeason(thisYear);
}

async function renderSeason(season) {
  const list = $('race-list');
  list.innerHTML = '<div class="skeleton">Загрузка календаря…</div>';
  try {
    let [races, wins] = await Promise.all([api.schedule(season), api.winners(season).catch(() => [])]);
    if (!races.length && +season === new Date().getUTCFullYear()) {
      $('season-select').value = season - 1;
      return renderSeason(season - 1);
    }
    const winBy = new Map(wins.map((w) => [w.round, w.Results[0]]));
    const now = Date.now();
    list.innerHTML = races.map((r) => {
      const w = winBy.get(r.round);
      const done = raceDate(r) < now;
      const q = `F1 ${r.season} ${r.raceName}`;
      return `<div class="card race-item ${done ? 'done' : ''}" data-round="${esc(r.round)}">
        <span class="rnd">${String(r.round).padStart(2, '0')}</span>
        <div><b>${esc(r.raceName)}</b> <span class="muted">· ${fmtDate(raceDate(r))}</span>
          <div class="winner">${esc(r.Circuit.circuitName)}, ${esc(r.Circuit.Location.country)}${w ? ` · 🏆 ${esc(w.Driver.givenName)} ${esc(w.Driver.familyName)} (${esc(w.Constructor.name)})` : ''}</div></div>
        <div class="tags">
          ${done ? `<a class="tag" href="${ytSearch(`${q} race highlights`)}" target="_blank" rel="noopener">▶ Видео</a>` : '<span class="tag">Скоро</span>'}
          <a class="tag" href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Wiki</a>
          ${+r.season >= 2018 ? `<a class="tag" href="${f1tvSearch(`${r.season} ${r.raceName}`)}" target="_blank" rel="noopener">F1 TV</a>` : ''}
        </div></div><div class="race-detail" hidden></div>`;
    }).join('') || '<div class="notice">Календарь пуст.</div>';
    list.querySelectorAll('.race-item').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      toggleResults(el, season, el.dataset.round);
    }));
  } catch {
    list.innerHTML = '<div class="notice">Не удалось загрузить календарь. Попробуйте позже.</div>';
  }
}

async function toggleResults(el, season, round) {
  const box = el.nextElementSibling;
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="card skeleton">Загрузка результатов…</div>';
  try {
    const res = await api.raceResults(season, round);
    box.innerHTML = res ? resultsTable(res) : '<div class="card muted">Результатов пока нет.</div>';
  } catch {
    box.innerHTML = '<div class="card muted">Результаты недоступны.</div>';
  }
}

function resultsTable(res) {
  return `<div class="card"><table><thead><tr><th>Поз</th><th>Пилот</th><th>Команда</th><th>Старт</th><th>Время/статус</th><th>Очки</th></tr></thead><tbody>
    ${res.Results.map((r) => `<tr>
      <td>${esc(r.positionText)}</td>
      <td><span style="display:inline-block;width:4px;height:12px;background:${teamColor(r.Constructor.constructorId)}"></span> ${esc(r.Driver.givenName)} <b>${esc(r.Driver.familyName)}</b>${r.FastestLap?.rank === '1' ? ' <span class="fl" title="Лучший круг">⏱</span>' : ''}</td>
      <td>${esc(r.Constructor.name)}</td><td>${esc(r.grid)}</td><td>${esc(r.Time?.time || r.status)}</td><td>${esc(r.points)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

// ---------- HISTORY ----------
function loadHistory() {
  const grid = $('history-grid');
  grid.innerHTML = HISTORIC_RACES.map((h, i) => {
    const hue = (i * 47) % 360;
    const q = `F1 ${h.year} ${h.title}`;
    return `<div class="card hist-card">
      <a class="hist-thumb" href="${ytSearch(`${h.year} ${h.title.replace(/\s\d{4}$/, '')} F1 highlights`)}" target="_blank" rel="noopener"
         style="background:linear-gradient(135deg,hsl(${hue} 80% 30%),#07080c 75%)">
        <span class="yr">${h.year}</span><span class="play">▶</span>
      </a>
      <div class="hist-body">
        <p class="eyebrow">${esc(h.tag)}</p><h3 style="text-transform:none;letter-spacing:0">${esc(h.title)}</h3>
        <p>${esc(h.text)}</p>
        <div class="tagrow">
          <a class="tag" href="${ytSearch(`${q} full race`)}" target="_blank" rel="noopener">▶ Полная гонка</a>
          <button class="tag" data-i="${i}" style="background:none;cursor:pointer">Результаты</button>
          <a class="tag" href="https://en.wikipedia.org/wiki/${h.year}_${encodeURIComponent(wikiName(h))}" target="_blank" rel="noopener">Wiki</a>
        </div>
      </div></div>`;
  }).join('');
  grid.querySelectorAll('button[data-i]').forEach((b) => b.addEventListener('click', async () => {
    const h = HISTORIC_RACES[+b.dataset.i];
    openDrawer(`<p class="eyebrow">${esc(h.tag)}</p><h2>${esc(h.title)}</h2><p class="muted">${esc(h.text)}</p><div id="hist-res" class="muted">Загрузка…</div>`);
    try {
      const res = await api.raceResults(h.year, h.round);
      $('hist-res').innerHTML = res
        ? `<p class="muted">${esc(res.Circuit.circuitName)} · ${fmtDate(res.date)}</p>${resultsTable(res)}`
        : 'Нет данных.';
    } catch { $('hist-res').textContent = 'Результаты недоступны.'; }
  }));
}
function wikiName(h) {
  const map = {
    'Сан-Паулу': 'São_Paulo_Grand_Prix', 'Абу-Даби': 'Abu_Dhabi_Grand_Prix', 'Турции': 'Turkish_Grand_Prix',
    'Германии': 'German_Grand_Prix', 'Испании': 'Spanish_Grand_Prix', 'Бразилии': 'Brazilian_Grand_Prix',
    'Канады': 'Canadian_Grand_Prix', 'Японии': 'Japanese_Grand_Prix', 'Европы': 'European_Grand_Prix', 'Монако': 'Monaco_Grand_Prix',
  };
  const key = Object.keys(map).find((k) => h.title.includes(k));
  return key ? map[key] : 'Formula_One';
}

// ---------- NEWS ----------
async function loadNews() {
  const grid = $('news-grid');
  grid.innerHTML = '<div class="skeleton">Загрузка новостей…</div>';
  const sources = `<div class="card" style="grid-column:1/-1"><div class="card-head"><h3>Источники</h3></div><div class="tagrow">
    ${api.NEWS_SOURCES.map((s) => `<a class="tag" href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join('')}</div></div>`;
  try {
    const items = await api.news();
    grid.innerHTML = sources + (items.length
      ? items.slice(0, 40).map((n) => `<a class="card news-card" href="${esc(safeUrl(n.link))}" target="_blank" rel="noopener">
          ${n.image ? `<img src="${esc(safeUrl(n.image))}" alt="" loading="lazy" onerror="this.remove()">` : ''}
          <div class="nb"><span class="src">${esc(n.source)} · ${esc(timeAgo(n.date))}</span><h4>${esc(n.title)}</h4><p class="muted" style="font-size:.82rem;margin:0">${esc(n.summary)}</p></div></a>`).join('')
      : '<div class="notice">Ленты новостей сейчас недоступны — откройте источники выше.</div>');
  } catch {
    grid.innerHTML = sources + '<div class="notice">Ленты новостей сейчас недоступны — откройте источники выше.</div>';
  }
}

// ---------- boot ----------
initBackground($('bg-dots'));
initCar($('car-canvas'), $('car-labels'), $('explode-btn'));
route();
