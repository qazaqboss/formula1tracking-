// Selectable cars shared by the 3D showroom (car3d.js) and the racing game (game.js).
// 2026 grid: one driver per team on the shared chassis (models/car.glb) with a livery per team
// (colour schemes only, no sponsor or team marks); plus the 2019 Ferrari SF90 as its own model.
export const TEAMS = [
  { id: 'mclaren', name: 'McLaren', driver: 'Ландо Норрис', short: 'Норрис', num: '1', accent: 0xff8000, colours: 'папайя · антрацит' },
  { id: 'ferrari', name: 'Ferrari', driver: 'Шарль Леклер', short: 'Леклер', num: '16', accent: 0xff1e1e, colours: 'красный · чёрный · белый' },
  { id: 'redbull', name: 'Red Bull', driver: 'Макс Ферстаппен', short: 'Ферстаппен', num: '3', accent: 0x3d6ff0, colours: 'тёмно-синий · красный · жёлтый' },
  { id: 'mercedes', name: 'Mercedes', driver: 'Андреа Кими Антонелли', short: 'Антонелли', num: '12', accent: 0x00d2be, colours: 'чёрный · серебро · бирюза' },
  { id: 'astonmartin', name: 'Aston Martin', driver: 'Фернандо Алонсо', short: 'Алонсо', num: '14', accent: 0xcedc00, colours: 'британский зелёный · лайм' },
  { id: 'alpine', name: 'Alpine', driver: 'Пьер Гасли', short: 'Гасли', num: '10', accent: 0xff6eb4, colours: 'синий · розовый' },
  { id: 'williams', name: 'Williams', driver: 'Александр Албон', short: 'Албон', num: '23', accent: 0x1f7dff, colours: 'тёмно-синий · голубой' },
  { id: 'racingbulls', name: 'Racing Bulls', driver: 'Лиам Лоусон', short: 'Лоусон', num: '30', accent: 0x6c98ff, colours: 'белый · синий · красный' },
  { id: 'haas', name: 'Haas', driver: 'Оливер Берман', short: 'Берман', num: '87', accent: 0xe0141e, colours: 'белый · чёрный · красный' },
  { id: 'audi', name: 'Audi', driver: 'Габриэл Бортолето', short: 'Бортолето', num: '5', accent: 0xf50537, colours: 'титан · чёрный · красный' },
  { id: 'cadillac', name: 'Cadillac', driver: 'Валттери Боттас', short: 'Боттас', num: '77', accent: 0xc8a55a, colours: 'чёрный · белый · золото' },
  {
    id: 'sf90', model: 'sf90', name: 'SF90', label: 'SF90 · 2019', driver: 'Себастьян Феттель', short: 'Феттель', num: '5', accent: 0xff2a1a,
    lead: 'Болид Ferrari сезона 2019 — отдельная детализированная модель. Разберите его на узлы — кузов, кокпит, колёса — или включите рентген.',
  },
];

// model key -> GLB file; `livery` = textures are swapped per team on this model
export const MODEL_FILES = { car: { file: 'car.glb', livery: true }, sf90: { file: 'sf90.glb', livery: false } };

export const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
