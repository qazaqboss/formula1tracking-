// Static reference data and small utilities

export const TEAM_COLORS = {
  red_bull: '#3671C6',
  ferrari: '#E8002D',
  mercedes: '#27F4D2',
  mclaren: '#FF8000',
  aston_martin: '#229971',
  alpine: '#0093CC',
  williams: '#64C4FF',
  rb: '#6692FF',
  haas: '#B6BABD',
  sauber: '#52E252',
  audi: '#F50537',
  cadillac: '#C9A227',
};

export function teamColor(constructorId, fallback = '#8a93a8') {
  return TEAM_COLORS[constructorId] || fallback;
}

// Offline grid, used only if the standings API is unreachable
export const FALLBACK_GRID = [
  ['max_verstappen', 'Max', 'Verstappen', 1, 'VER', 'red_bull', 'Red Bull', 'Dutch'],
  ['hadjar', 'Isack', 'Hadjar', 6, 'HAD', 'red_bull', 'Red Bull', 'French'],
  ['leclerc', 'Charles', 'Leclerc', 16, 'LEC', 'ferrari', 'Ferrari', 'Monegasque'],
  ['hamilton', 'Lewis', 'Hamilton', 44, 'HAM', 'ferrari', 'Ferrari', 'British'],
  ['russell', 'George', 'Russell', 63, 'RUS', 'mercedes', 'Mercedes', 'British'],
  ['antonelli', 'Andrea Kimi', 'Antonelli', 12, 'ANT', 'mercedes', 'Mercedes', 'Italian'],
  ['norris', 'Lando', 'Norris', 4, 'NOR', 'mclaren', 'McLaren', 'British'],
  ['piastri', 'Oscar', 'Piastri', 81, 'PIA', 'mclaren', 'McLaren', 'Australian'],
  ['alonso', 'Fernando', 'Alonso', 14, 'ALO', 'aston_martin', 'Aston Martin', 'Spanish'],
  ['stroll', 'Lance', 'Stroll', 18, 'STR', 'aston_martin', 'Aston Martin', 'Canadian'],
  ['gasly', 'Pierre', 'Gasly', 10, 'GAS', 'alpine', 'Alpine', 'French'],
  ['colapinto', 'Franco', 'Colapinto', 43, 'COL', 'alpine', 'Alpine', 'Argentine'],
  ['albon', 'Alexander', 'Albon', 23, 'ALB', 'williams', 'Williams', 'Thai'],
  ['sainz', 'Carlos', 'Sainz', 55, 'SAI', 'williams', 'Williams', 'Spanish'],
  ['lawson', 'Liam', 'Lawson', 30, 'LAW', 'rb', 'Racing Bulls', 'New Zealander'],
  ['lindblad', 'Arvid', 'Lindblad', 41, 'LIN', 'rb', 'Racing Bulls', 'British'],
  ['ocon', 'Esteban', 'Ocon', 31, 'OCO', 'haas', 'Haas', 'French'],
  ['bearman', 'Oliver', 'Bearman', 87, 'BEA', 'haas', 'Haas', 'British'],
  ['hulkenberg', 'Nico', 'Hülkenberg', 27, 'HUL', 'audi', 'Audi', 'German'],
  ['bortoleto', 'Gabriel', 'Bortoleto', 5, 'BOR', 'audi', 'Audi', 'Brazilian'],
  ['perez', 'Sergio', 'Pérez', 11, 'PER', 'cadillac', 'Cadillac', 'Mexican'],
  ['bottas', 'Valtteri', 'Bottas', 77, 'BOT', 'cadillac', 'Cadillac', 'Finnish'],
].map(([driverId, givenName, familyName, num, code, constructorId, team, nationality], i) => ({
  position: String(i + 1),
  points: '—',
  wins: '—',
  Driver: { driverId, givenName, familyName, permanentNumber: String(num), code, nationality },
  Constructors: [{ constructorId, name: team }],
}));

// Legendary races for the History section
export const HISTORIC_RACES = [
  { year: 2024, round: 21, title: 'Гран-при Сан-Паулу 2024', tag: 'Ферстаппен с 17-го места', text: 'Ливень в Интерлагосе: Макс прорывается с 17-й позиции к одной из величайших побед в карьере.' },
  { year: 2021, round: 22, title: 'Гран-при Абу-Даби 2021', tag: 'Битва за титул', text: 'Ферстаппен и Хэмилтон приехали с равными очками. Финальный круг после машины безопасности решил всё.' },
  { year: 2021, round: 19, title: 'Гран-при Сан-Паулу 2021', tag: 'Хэмилтон с последнего ряда', text: 'Штрафы, спринт с 20-го места и обгон Ферстаппена — одна из лучших гонок Льюиса.' },
  { year: 2020, round: 14, title: 'Гран-при Турции 2020', tag: '7-й титул Хэмилтона', text: 'Скользкий как лёд асфальт Истанбул Парка и рекордный седьмой титул чемпиона мира.' },
  { year: 2019, round: 11, title: 'Гран-при Германии 2019', tag: 'Хаос под дождём', text: 'Сходы лидеров, пит-стопы каждые несколько кругов и подиум Квята на «Торо Россо».' },
  { year: 2016, round: 5, title: 'Гран-при Испании 2016', tag: 'Первая победа Макса', text: '18-летний Ферстаппен выигрывает в дебютной гонке за Red Bull после столкновения «Мерседесов».' },
  { year: 2012, round: 20, title: 'Гран-при Бразилии 2012', tag: 'Третий титул Феттеля', text: 'Разворот на первом круге, прорыв с последнего места и титул в непредсказуемом финале.' },
  { year: 2011, round: 7, title: 'Гран-при Канады 2011', tag: 'Баттон с последнего места', text: 'Самая длинная гонка в истории — более 4 часов, шесть пит-стопов и победа на последнем круге.' },
  { year: 2008, round: 18, title: 'Гран-при Бразилии 2008', tag: 'Титул в последнем повороте', text: 'Масса уже праздновал титул, пока Хэмилтон не обогнал Глока в последних поворотах.' },
  { year: 2005, round: 18, title: 'Гран-при Японии 2005', tag: 'Райкконен с 17-го места', text: 'Кими обгоняет Физикеллу на последнем круге Сузуки после фантастического прорыва.' },
  { year: 1993, round: 3, title: 'Гран-при Европы 1993', tag: 'Лучший круг Сенны', text: 'Донингтон, дождь: Айртон с пятого места выходит в лидеры по итогам первого круга.' },
  { year: 1988, round: 15, title: 'Гран-при Японии 1988', tag: 'Первый титул Сенны', text: 'Заглох на старте, упал в конец пелотона и всё равно выиграл гонку и чемпионат.' },
  { year: 1984, round: 6, title: 'Гран-при Монако 1984', tag: 'Сенна под дождём', text: 'Новичок на Toleman догоняет Проста, пока гонку не останавливают красным флагом.' },
  { year: 1976, round: 16, title: 'Гран-при Японии 1976', tag: 'Хант против Лауды', text: 'Ливень на Фудзи, Лауда сходит сам, Хант становится чемпионом с отрывом в одно очко.' },
];

// ---------- utils ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '#');

export const ytSearch = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
export const f1tvSearch = (q) => `https://f1tv.formula1.com/search?q=${encodeURIComponent(q)}`;

export function fmtLap(sec) {
  if (sec == null || !isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(3).padStart(6, '0');
  return m ? `${m}:${s}` : s;
}
export function fmtGap(v) {
  if (v == null) return '—';
  if (typeof v === 'string') return v; // "+1 LAP"
  return `+${v.toFixed(3)}`;
}
export const fmtDate = (d, opts = { day: 'numeric', month: 'long', year: 'numeric' }) =>
  new Date(d).toLocaleDateString('ru-RU', opts);
export const fmtTime = (d) => new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function timeAgo(date) {
  if (!date) return '';
  const s = Math.max(0, (Date.now() - date) / 1000);
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  if (s < 86400) return `${Math.round(s / 3600)} ч назад`;
  return `${Math.round(s / 86400)} дн назад`;
}

export function raceDate(race) {
  return new Date(`${race.date}T${race.time || '12:00:00Z'}`);
}

export function flagEmoji(nationality) {
  const map = {
    Dutch: 'nl', French: 'fr', Monegasque: 'mc', British: 'gb', Italian: 'it', Australian: 'au', Spanish: 'es',
    Canadian: 'ca', Argentine: 'ar', Thai: 'th', 'New Zealander': 'nz', German: 'de', Brazilian: 'br',
    Mexican: 'mx', Finnish: 'fi', Japanese: 'jp', Chinese: 'cn', Danish: 'dk', American: 'us', Austrian: 'at',
    Swiss: 'ch', Belgian: 'be', Swedish: 'se', Polish: 'pl', Russian: 'ru', Indian: 'in', Venezuelan: 've',
  };
  const cc = map[nationality];
  return cc ? cc.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))) : '🏁';
}
