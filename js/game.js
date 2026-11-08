// F1 Pulse GP — a 3D racing game built on the site's car models.
// Original circuit (procedural), grandstands with crowd, pit building, start lights, kerbs, gravel,
// barriers; a tyre-model car (bicycle model, Pacejka-style lateral grip, downforce, friction circle,
// brakes, drag, 8-speed auto gearbox); AI rivals on a racing line with a speed profile;
// chase / cockpit (3D steering wheel) / TV-orbit cameras; feedback: camera shake, gamepad rumble,
// phone vibration, sparks, engine and tyre audio; keyboard, gamepad and touch (wheel + pedals).
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from './vendor/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { TEAMS, MODEL_FILES, hex } from './teams.js?v=202611090459';
import { createBloom, lowPower } from './fx.js?v=202611090459';

const VER = new URL(import.meta.url).search;
const asset = (p) => new URL(`../models/${p}${VER}`, import.meta.url).href;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const touch = matchMedia('(pointer: coarse)').matches;

// ---------- vehicle constants (SI units) ----------
const CAR_LEN = 5.6;
const M = 800, G = 9.81, IZ = 1050;
const K_DF = 3.0;             // downforce N per (m/s)^2
const P_MAX = 760e3;          // W
const F_TRACT = 16000;        // N, traction-limited launch
const CD = 0.86;              // drag N per (m/s)^2  -> ~345 km/h top speed
const ROLL = 150;
const BRAKE_BASE = 14000, BRAKE_DF = 3.0;
const TIRE_B = 16, TIRE_C = 1.45;
const REAR_GRIP = 1.08;        // slightly more rear grip: stable, mild understeer
const GEAR_TOP = [82, 122, 158, 192, 226, 262, 300, 350]; // km/h per gear
const HALF_W = 7;              // track half width
const KERB_W = 1.4, RUNOFF = 5, WALL = 19;

const SURF = {
  asphalt: { mu: 1.75, drag: 0, shake: 0 },
  kerb: { mu: 1.55, drag: 0, shake: 0.5 },
  runoff: { mu: 1.3, drag: 20, shake: 0.08 },
  grass: { mu: 0.62, drag: 260, shake: 0.6 },
  gravel: { mu: 0.45, drag: 900, shake: 1 },
};

// original circuit layout (metres, x/z)
const LAYOUT = [[-260, 0], [0, 0], [260, 0], [400, 8], [470, 60], [480, 140], [430, 200], [350, 215], [280, 190], [215, 215],
  [190, 290], [230, 370], [330, 400], [430, 385], [530, 410], [575, 490], [530, 575], [400, 610], [240, 600], [80, 565],
  [-70, 520], [-190, 455], [-250, 370], [-225, 290], [-150, 250], [-130, 180], [-205, 130], [-320, 105], [-385, 55], [-350, 8]];

let game = null;
export function startGame() { if (!game) game = createGame(); game.resume(); }
export function pauseGame() { game?.pause(); }

function createGame() {
  const root = document.getElementById('view-race');
  const canvas = document.getElementById('race-canvas');
  const ui = document.getElementById('race-ui');

  // ---------- renderer / scene ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = !lowPower;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const HORIZON = new THREE.Color(0xf0a070);
  scene.fog = new THREE.FogExp2(0xd9a078, 0.0011);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;

  const camera = new THREE.PerspectiveCamera(62, 1, 0.08, 4000);
  camera.position.set(0, 30, -60);
  const fx = lowPower ? null : createBloom(renderer, scene, camera, { strength: 0.35, radius: 0.3, threshold: 0.92 });
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false;
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.49;
  orbit.minDistance = 4;
  orbit.maxDistance = 80;

  // sky: sunset gradient with a sun disc
  const SUN_DIR = new THREE.Vector3(-0.55, 0.16, -0.82).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = vDir.y;
        vec3 top = vec3(0.035, 0.07, 0.19), mid = vec3(0.32, 0.27, 0.42), hor = vec3(1.0, 0.52, 0.27), gnd = vec3(0.09, 0.07, 0.07);
        vec3 c = h > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.18, h)), top, smoothstep(0.18, 0.75, h)) : mix(hor, gnd, smoothstep(0.0, -0.12, h));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.75, 0.45) * (pow(s, 900.0) * 12.0 + pow(s, 12.0) * 0.45);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  scene.add(sky);

  scene.add(new THREE.HemisphereLight(0x9cbcff, 0x3b2a1e, 0.75));
  const sun = new THREE.DirectionalLight(0xffcf9e, 2.6);
  sun.castShadow = !lowPower;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  // ---------- procedural textures ----------
  const canvasTex = (w, h, draw, { repeat, srgb = true } = {}) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    return t;
  };
  const noise = (g, w, h, n, colors) => {
    for (let i = 0; i < n; i++) {
      g.fillStyle = colors[(Math.random() * colors.length) | 0];
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  };
  const asphaltTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#3b3e44'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 9000, ['#2e3136', '#474a50', '#34373c', '#55585e']);
  });
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  const grassTex = canvasTex(512, 512, (g, w, h) => {
    for (let y = 0; y < h; y += 64) { g.fillStyle = (y / 64) % 2 ? '#3d6a2c' : '#447332'; g.fillRect(0, y, w, 64); }
    noise(g, w, h, 30000, ['#38602a', '#4a7a37', '#335a26', '#4f8139']);
  }, { repeat: [200, 200] });
  const gravelTex = canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#b59a72'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 4000, ['#a08660', '#c9b089', '#8f7754', '#d6c29c']);
  });
  gravelTex.wrapS = gravelTex.wrapT = THREE.RepeatWrapping;
  const wallTex = canvasTex(512, 128, (g, w, h) => {
    g.fillStyle = '#e9edf2'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1b2440'; g.fillRect(0, h * 0.62, w, h * 0.38);
    g.fillStyle = '#ff2bd6'; g.fillRect(0, h * 0.58, w, h * 0.05);
    g.font = '900 54px Orbitron, Arial Black, sans-serif'; g.textBaseline = 'middle';
    g.fillStyle = '#10131c'; g.fillText('F1 PULSE', 24, h * 0.3);
    g.fillStyle = '#00b8c8'; g.fillText('GP', 330, h * 0.3);
  });
  wallTex.wrapS = THREE.RepeatWrapping;
  const checkerTex = canvasTex(256, 64, (g, w, h) => {
    const s = 16;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) { g.fillStyle = ((x + y) / s) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x, y, s, s); }
  });
  const boardTex = canvasTex(1024, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#0a0c16'); gr.addColorStop(1, '#151a33');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.font = '900 120px Orbitron, Arial Black, sans-serif'; g.textBaseline = 'middle';
    g.shadowColor = '#ff2bd6'; g.shadowBlur = 30; g.fillStyle = '#ff5be0'; g.fillText('F1', 40, h / 2);
    g.shadowColor = '#00f0ff'; g.fillStyle = '#d8fbff'; g.fillText('PULSE', 230, h / 2);
    g.shadowBlur = 0; g.font = '700 46px Orbitron, Arial, sans-serif'; g.fillStyle = '#fcee0a'; g.fillText('GRAND PRIX', 700, h / 2);
  });

  // ---------- track ----------
  const curve = new THREE.CatmullRomCurve3(LAYOUT.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  const LEN = curve.getLength();
  const N = Math.round(LEN / 2);
  const DS = LEN / N;
  const pts = curve.getSpacedPoints(N); // N + 1 points, last == first
  const T = { px: new Float32Array(N), pz: new Float32Array(N), tx: new Float32Array(N), tz: new Float32Array(N), k: new Float32Array(N) };
  for (let i = 0; i < N; i++) {
    T.px[i] = pts[i].x; T.pz[i] = pts[i].z;
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    T.tx[i] = dx / l; T.tz[i] = dz / l;
  }
  // signed curvature (+ = left turn), smoothed
  const ang = (i) => Math.atan2(T.tx[(i + N) % N], T.tz[(i + N) % N]);
  const rawK = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let d = ang(i + 1) - ang(i - 1);
    d = Math.atan2(Math.sin(d), Math.cos(d));
    rawK[i] = d / (2 * DS);
  }
  const smooth = (arr, r) => {
    const out = new Float32Array(N);
    for (let i = 0; i < N; i++) { let s = 0; for (let j = -r; j <= r; j++) s += arr[(i + j + N) % N]; out[i] = s / (2 * r + 1); }
    return out;
  };
  T.k = smooth(rawK, 3);
  const leftX = (i) => T.tz[i], leftZ = (i) => -T.tx[i];
  // start line at the layout's (0,0)
  let START = 0, bd = 1e9;
  for (let i = 0; i < N; i++) { const d = T.px[i] ** 2 + T.pz[i] ** 2; if (d < bd) { bd = d; START = i; } }

  // racing line: inside of corners, eased in/out
  const lineRaw = new Float32Array(N);
  for (let i = 0; i < N; i++) lineRaw[i] = Math.tanh(T.k[i] * 70) * (HALF_W - 2.2);
  const LINE = smooth(smooth(lineRaw, 14), 10);
  // AI speed profile (grip + downforce, braking and acceleration passes)
  const VMAX = new Float32Array(N);
  const muAI = 1.62;
  for (let i = 0; i < N; i++) {
    const k = Math.abs(T.k[i]) + 1e-5, den = k - (muAI * K_DF) / M;
    VMAX[i] = den <= 0 ? 93 : Math.min(93, Math.sqrt((muAI * G) / den));
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = N - 1; i >= 0; i--) VMAX[i] = Math.min(VMAX[i], Math.sqrt(VMAX[(i + 1) % N] ** 2 + 2 * 27 * DS));
    for (let i = 0; i < N; i++) { const v = VMAX[(i - 1 + N) % N]; VMAX[i] = Math.min(VMAX[i], Math.sqrt(v * v + 2 * Math.max(3, 11 - v * 0.09) * DS)); }
  }

  // kerb / gravel masks per side (+1 left, -1 right)
  const kerbL = new Uint8Array(N), kerbR = new Uint8Array(N), gravL = new Uint8Array(N), gravR = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const k = T.k[i], ak = Math.abs(k);
    if (ak > 1 / 140) { if (k > 0) kerbL[i] = 1; else kerbR[i] = 1; }
    if (ak > 1 / 70) { if (k > 0) kerbR[i] = 1; else kerbL[i] = 1; }
    if (ak > 1 / 95) { if (k > 0) gravR[i] = 1; else gravL[i] = 1; }
  }
  const grow = (m, r) => { const o = new Uint8Array(N); for (let i = 0; i < N; i++) if (m[i]) for (let j = -r; j <= r; j++) o[(i + j + N) % N] = 1; return o; };
  const KL = grow(kerbL, 4), KR = grow(kerbR, 4), GL = grow(gravL, 12), GR = grow(gravR, 12);

  // ribbon builder between two lateral offsets (positive = left), optional per-sample mask
  function ribbon(o0, o1, y, mat, { mask, vMul = 1, uScale = 10, colorAt, step = 1 } = {}) {
    const pos = [], uv = [], col = [];
    const P = (i, o) => [T.px[i] + leftX(i) * o, y, T.pz[i] + leftZ(i) * o];
    for (let s = 0; s < N; s += step) {
      const i = s % N, j = (s + step) % N;
      if (mask && !(mask[i] && mask[j])) continue;
      const a = P(i, o0), b = P(i, o1), c = P(j, o1), d = P(j, o0);
      // counter-clockwise seen from above, so the surface faces up
      pos.push(...a, ...c, ...b, ...a, ...d, ...c);
      const u0 = (s * DS) / uScale, u1 = ((s + step) * DS) / uScale;
      uv.push(u0, 0, u1, vMul, u0, vMul, u0, 0, u1, 0, u1, vMul);
      if (colorAt) { const cc = colorAt(s); for (let q = 0; q < 6; q++) col.push(...cc); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    if (colorAt) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }
  const layer = (mat, n) => { mat.polygonOffset = true; mat.polygonOffsetFactor = -n; mat.polygonOffsetUnits = -n * 4; return mat; };
  const asphaltMat = layer(new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 }), 3);
  asphaltTex.repeat.set(1, 1);
  ribbon(-HALF_W, HALF_W, 0.02, asphaltMat, { vMul: 2.2, uScale: 15 });
  const runoffMat = layer(new THREE.MeshStandardMaterial({ map: asphaltTex, color: 0x9aa0a8, roughness: 0.95 }), 2);
  ribbon(HALF_W, HALF_W + RUNOFF, 0.015, runoffMat, { vMul: 0.8, uScale: 15 });
  ribbon(-HALF_W - RUNOFF, -HALF_W, 0.015, runoffMat, { vMul: 0.8, uScale: 15 });
  const gravelMat = layer(new THREE.MeshStandardMaterial({ map: gravelTex, roughness: 1 }), 1);
  gravelTex.repeat.set(1, 1);
  ribbon(HALF_W + RUNOFF, WALL - 0.5, 0.012, gravelMat, { mask: GL, vMul: 4, uScale: 8 });
  ribbon(-WALL + 0.5, -HALF_W - RUNOFF, 0.012, gravelMat, { mask: GR, vMul: 4, uScale: 8 });
  const lineMat = layer(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }), 5);
  ribbon(HALF_W - 0.45, HALF_W - 0.15, 0.03, lineMat, { step: 2 });
  ribbon(-HALF_W + 0.15, -HALF_W + 0.45, 0.03, lineMat, { step: 2 });
  const kerbMat = layer(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }), 5);
  const kerbCol = (s) => (Math.floor((s * DS) / 3) % 2 ? [0.85, 0.06, 0.08] : [0.95, 0.95, 0.95]);
  ribbon(HALF_W, HALF_W + KERB_W, 0.06, kerbMat, { mask: KL, colorAt: kerbCol });
  ribbon(-HALF_W - KERB_W, -HALF_W, 0.06, kerbMat, { mask: KR, colorAt: kerbCol });

  // start / finish checker
  {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 2.2), layer(new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 0.6 }), 6));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(T.tx[START], T.tz[START]);
    m.position.set(T.px[START], 0.035, T.pz[START]);
    m.receiveShadow = true;
    scene.add(m);
  }
  // grid boxes
  {
    const gm = layer(new THREE.MeshBasicMaterial({ color: 0xffffff }), 6);
    for (let k = 0; k < 10; k++) {
      const s = START - Math.round((8 + k * 8) / DS);
      const i = (s + N) % N, lat = k % 2 ? -3 : 3;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.25), gm);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(T.tx[i], T.tz[i]);
      m.position.set(T.px[i] + leftX(i) * lat + T.tx[i] * 2.4, 0.035, T.pz[i] + leftZ(i) * lat + T.tz[i] * 2.4);
      scene.add(m);
    }
  }

  // barriers both sides + neon strip on top
  {
    const H = 1.15;
    const build = (off) => {
      const pos = [], uv = [];
      for (let s = 0; s < N; s++) {
        const i = s, j = (s + 1) % N;
        const ax = T.px[i] + leftX(i) * off, az = T.pz[i] + leftZ(i) * off;
        const bx = T.px[j] + leftX(j) * off, bz = T.pz[j] + leftZ(j) * off;
        pos.push(ax, 0, az, ax, H, az, bx, H, bz, ax, 0, az, bx, H, bz, bx, 0, bz);
        const u0 = (s * DS) / 12, u1 = ((s + 1) * DS) / 12;
        uv.push(u0, 0, u0, 1, u1, 1, u0, 0, u1, 1, u1, 0);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.5, side: THREE.DoubleSide }));
      m.castShadow = !lowPower; m.receiveShadow = true;
      scene.add(m);
    };
    build(WALL); build(-WALL);
    const neon = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const nc = (s) => (Math.floor((s * DS) / 60) % 2 ? [0, 2.2, 2.5] : [2.5, 0.3, 2.0]);
    ribbon(WALL - 0.12, WALL + 0.12, H + 0.01, neon, { colorAt: nc, step: 2 });
    ribbon(-WALL - 0.12, -WALL + 0.12, H + 0.01, neon, { colorAt: nc, step: 2 });
  }

  // ground
  {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(5200, 5200), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.position.set(100, 0, 300);
    g.receiveShadow = true;
    scene.add(g);
  }

  // helpers to place things beside the track
  const nearTrack = (x, z, r) => {
    for (let i = 0; i < N; i += 3) if ((T.px[i] - x) ** 2 + (T.pz[i] - z) ** 2 < r * r) return true;
    return false;
  };
  function placeBeside(i, side, dist) {
    const o = new THREE.Object3D();
    const ox = leftX(i) * side, oz = leftZ(i) * side; // outward direction
    o.position.set(T.px[i] + ox * dist, 0, T.pz[i] + oz * dist);
    o.rotation.y = Math.atan2(ox, oz); // local +z = away from track, local -z faces it
    return o;
  }

  // ---------- grandstands with crowd ----------
  const crowdUniform = { value: 0 };
  const crowdMat = new THREE.MeshLambertMaterial();
  crowdMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = crowdUniform;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\n transformed.y += abs(sin(uTime * 4.0 + float(gl_InstanceID) * 1.37)) * 0.12;');
  };
  const crowdColors = [0xff2a2a, 0xffffff, 0xffd200, 0x1f6fff, 0xff8000, 0x00d2be, 0x111111, 0xff6eb4, 0x2a2a2a, 0xe8e8e8].map((c) => new THREE.Color(c));
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8d9097, roughness: 0.9 });
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x1d3b8f, roughness: 0.7 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide });
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.2, 2.0), toneMapped: false });
  function grandstand(i, side, length, tiers = 9) {
    const g = placeBeside(i, side, WALL + 4);
    const D = 1.35, Hs = 0.75;
    for (let t = 0; t < tiers; t++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(length, Hs * (t + 1), D), t % 2 ? concrete : seatMat);
      b.position.set(0, (Hs * (t + 1)) / 2, t * D + D / 2);
      b.castShadow = !lowPower; b.receiveShadow = true;
      g.add(b);
    }
    const backH = Hs * tiers + 4.2;
    const back = new THREE.Mesh(new THREE.BoxGeometry(length, backH, 0.4), concrete);
    back.position.set(0, backH / 2, tiers * D + 0.2);
    g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(length + 2, 0.35, tiers * D + 3), roofMat);
    roof.position.set(0, backH, (tiers * D) / 2 - 0.6);
    roof.rotation.x = -0.06;
    roof.castShadow = !lowPower;
    g.add(roof);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.3), stripMat);
    strip.position.set(0, backH - 0.3, -1.8);
    g.add(strip);
    for (let x = -length / 2 + 4; x <= length / 2 - 4; x += 12) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, backH, 8), roofMat);
      p.position.set(x, backH / 2, -1.5);
      g.add(p);
    }
    // crowd
    const per = Math.floor(length / (lowPower ? 1.1 : 0.72));
    const count = per * tiers;
    const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.62, 0.36), crowdMat, count);
    const mt = new THREE.Matrix4();
    let n = 0;
    for (let t = 0; t < tiers; t++) {
      for (let k = 0; k < per; k++) {
        if (Math.random() < 0.14) continue;
        const x = -length / 2 + 0.5 + (k / per) * (length - 1) + (Math.random() - 0.5) * 0.2;
        mt.makeTranslation(x, Hs * (t + 1) + 0.31, t * D + 0.45);
        inst.setMatrixAt(n, mt);
        inst.setColorAt(n, crowdColors[(Math.random() * crowdColors.length) | 0]);
        n++;
      }
    }
    inst.count = n;
    g.add(inst);
    scene.add(g);
    return g;
  }
  const idxAt = (meters) => ((START + Math.round(meters / DS)) % N + N) % N;
  // main grandstand opposite the pits, plus stands at the big braking zones
  grandstand(idxAt(-40), 1, 150, 11);
  grandstand(idxAt(150), 1, 80);
  {
    const corners = [];
    for (let i = 0; i < N; i++) if (Math.abs(T.k[i]) > 1 / 40) corners.push(i);
    const used = [];
    for (const i of corners.sort((a, b) => Math.abs(T.k[b]) - Math.abs(T.k[a]))) {
      if (used.some((u) => Math.min(Math.abs(u - i), N - Math.abs(u - i)) < 120)) continue;
      const side = -Math.sign(T.k[i]); // outside of the corner
      const g = placeBeside(i, side, WALL + 12);
      if (nearTrack(g.position.x, g.position.z, WALL + 6)) continue;
      used.push(i);
      grandstand(i, side, 60, 8);
      if (used.length >= 3) break;
    }
  }

  // pit building + garages on the inside of the main straight
  {
    const g = placeBeside(idxAt(30), -1, WALL + 6);
    const len = 190;
    const body = new THREE.Mesh(new THREE.BoxGeometry(len, 9, 14), new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 0.5 }));
    body.position.set(0, 4.5, 7);
    body.castShadow = !lowPower; body.receiveShadow = true;
    g.add(body);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(len - 4, 2.6, 0.2), new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: 0x2a6f9a, emissiveIntensity: 0.6, roughness: 0.1, metalness: 0.8 }));
    glass.position.set(0, 6.6, -0.05);
    g.add(glass);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x1b1f29, roughness: 0.7 });
    for (let x = -len / 2 + 8; x < len / 2 - 6; x += 9.5) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.2, 0.2), doorMat);
      d.position.set(x, 2.1, -0.06);
      g.add(d);
      const l = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.15, 0.15), stripMat);
      l.position.set(x, 4.35, -0.2);
      g.add(l);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.5, 18), roofMat);
    top.position.set(0, 9.25, 6);
    g.add(top);
    scene.add(g);
  }

  // start gantry with five light pods
  const startLights = [];
  {
    const i = START;
    const g = new THREE.Object3D();
    g.position.set(T.px[i], 0, T.pz[i]);
    g.rotation.y = Math.atan2(leftX(i), leftZ(i));
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d36, metalness: 0.6, roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), metal);
      p.position.set(0, 4, sx * (HALF_W + 1.4));
      p.castShadow = !lowPower;
      g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, HALF_W * 2 + 3.4), metal);
    beam.position.set(0, 7.6, 0);
    beam.castShadow = !lowPower;
    g.add(beam);
    for (let k = 0; k < 5; k++) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.9), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.4 }));
      pod.position.set(0.3, 6.4, (k - 2) * 1.6);
      g.add(pod);
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x220404, toneMapped: false });
      for (const dy of [-0.35, 0.35]) {
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.26, 20), lampMat);
        lamp.position.set(0.76, 6.4 + dy, (k - 2) * 1.6); // faces the cars on the grid (local +x)
        lamp.rotation.y = Math.PI / 2;
        g.add(lamp);
      }
      startLights.push(lampMat);
    }
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2 + 3, 1.6), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false }));
    banner.position.set(0.42, 8.9, 0);
    banner.rotation.y = Math.PI / 2;
    g.add(banner);
    scene.add(g);
  }

  // billboards and floodlight towers
  {
    const boardMat = new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x30333b, metalness: 0.5, roughness: 0.5 });
    for (let k = 0; k < 9; k++) {
      const i = (START + Math.round((k * LEN) / 9 / DS) + 70) % N;
      const side = Math.abs(T.k[i]) > 1 / 200 ? -Math.sign(T.k[i]) : (k % 2 ? 1 : -1);
      const g = placeBeside(i, side, WALL + 2.5);
      if (nearTrack(g.position.x, g.position.z, WALL)) continue;
      const b = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), boardMat);
      b.position.set(0, 4.2, 0);
      b.rotation.y = Math.PI;
      g.add(b);
      for (const x of [-6.5, 6.5]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, 0.3), postMat); p.position.set(x, 1.2, 0.1); g.add(p); }
      scene.add(g);
    }
    const lampHead = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.8, 2.4), toneMapped: false });
    for (let k = 0; k < 18; k++) {
      const i = (k * Math.round(N / 18) + 25) % N;
      const g = placeBeside(i, k % 2 ? 1 : -1, WALL + 7);
      if (nearTrack(g.position.x, g.position.z, WALL + 4)) continue;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 24, 8), postMat);
      pole.position.y = 12;
      g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.4), lampHead);
      head.position.set(0, 24, -0.4);
      head.rotation.x = -0.3;
      g.add(head);
      scene.add(g);
    }
  }

  // trees
  {
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 3, 6), new THREE.MeshStandardMaterial({ color: 0x4a3423 }), 700);
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(2.4, 7, 8), new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9 }), 700);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0;
    const want = lowPower ? 260 : 650;
    for (let tries = 0; tries < want * 6 && n < want; tries++) {
      const x = -700 + Math.random() * 1500, z = -450 + Math.random() * 1350;
      if (nearTrack(x, z, WALL + 14)) continue;
      const sc2 = 0.7 + Math.random() * 0.8;
      s.set(sc2, sc2, sc2);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
      m.compose(p.set(x, 1.5 * sc2, z), q, s); trunk.setMatrixAt(n, m);
      m.compose(p.set(x, (3 + 3.5) * sc2, z), q, s); crown.setMatrixAt(n, m);
      crown.setColorAt(n, new THREE.Color().setHSL(0.28 + Math.random() * 0.06, 0.45, 0.2 + Math.random() * 0.1));
      n++;
    }
    trunk.count = crown.count = n;
    crown.castShadow = !lowPower;
    scene.add(trunk, crown);
  }

  // ---------- sparks ----------
  const SPARKS = 240;
  const sparkPos = new Float32Array(SPARKS * 3), sparkVel = new Float32Array(SPARKS * 3), sparkLife = new Float32Array(SPARKS);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: new THREE.Color(3, 1.6, 0.4), size: 0.18, toneMapped: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sparks.frustumCulled = false;
  scene.add(sparks);
  let sparkHead = 0;
  function emitSparks(x, y, z, n, vx, vz) {
    for (let k = 0; k < n; k++) {
      const i = sparkHead++ % SPARKS;
      sparkPos.set([x, y, z], i * 3);
      sparkVel.set([vx * 0.5 + (Math.random() - 0.5) * 9, 2 + Math.random() * 5, vz * 0.5 + (Math.random() - 0.5) * 9], i * 3);
      sparkLife[i] = 0.4 + Math.random() * 0.5;
    }
  }
  function updateSparks(dt) {
    for (let i = 0; i < SPARKS; i++) {
      if (sparkLife[i] <= 0) { sparkPos[i * 3 + 1] = -100; continue; }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 18 * dt;
      for (let a = 0; a < 3; a++) sparkPos[i * 3 + a] += sparkVel[i * 3 + a] * dt;
      if (sparkPos[i * 3 + 1] < 0.02) { sparkPos[i * 3 + 1] = 0.02; sparkVel[i * 3 + 1] *= -0.3; }
    }
    sparkGeo.attributes.position.needsUpdate = true;
  }

  // ---------- car models ----------
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('./vendor/jsm/libs/draco/gltf/', import.meta.url).href);
  loader.setDRACOLoader(draco);
  const texLoader = new THREE.TextureLoader();
  const templates = new Map(); // model key -> Promise<template>
  function loadTemplate(key) {
    if (!templates.has(key)) {
      const p = loader.loadAsync(asset(MODEL_FILES[key].file)).then((gltf) => {
        const model = gltf.scene;
        model.updateMatrixWorld(true);
        let bb = new THREE.Box3().setFromObject(model);
        const size = bb.getSize(new THREE.Vector3());
        model.scale.setScalar(CAR_LEN / size.z);
        model.updateMatrixWorld(true);
        bb = new THREE.Box3().setFromObject(model);
        const c = bb.getCenter(new THREE.Vector3());
        model.position.set(-c.x, -bb.min.y, -c.z);
        model.updateMatrixWorld(true);
        const wheels = {};
        for (const o of [...model.children]) {
          if (!o.name.startsWith('wheel')) continue;
          const box = new THREE.Box3();
          o.traverse((m) => { if (m.isMesh) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrix)); } });
          const ctr = box.getCenter(new THREE.Vector3());
          if (o.isMesh) o.geometry.translate(-ctr.x, -ctr.y, -ctr.z);
          else o.children.forEach((ch) => ch.position.sub(ctr));
          o.position.add(ctr);
          wheels[o.name] = { r: (box.max.y - box.min.y) / 2 };
        }
        model.updateMatrixWorld(true);
        const wf = model.getObjectByName('wheelFL') || model.getObjectByName('wheelFR');
        const wr = model.getObjectByName('wheelRL') || model.getObjectByName('wheelRR');
        const toCar = (o) => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
        const head = model.getObjectByName('halo') || model.getObjectByName('cockpit');
        const hb = head ? new THREE.Box3().setFromObject(head) : new THREE.Box3(new THREE.Vector3(-0.3, 0.6, -0.6), new THREE.Vector3(0.3, 1.0, 0.2));
        return {
          model, wheelR: (wheels.wheelRL || wheels.wheelFL || { r: 0.033 }).r * model.scale.x,
          axleF: wf ? toCar(wf).z : 1.8, axleR: wr ? toCar(wr).z : -1.8,
          eye: new THREE.Vector3(0, hb.max.y - 0.08, hb.getCenter(new THREE.Vector3()).z - 0.35),
        };
      });
      p.catch(() => templates.delete(key));
      templates.set(key, p);
    }
    return templates.get(key);
  }
  const liveryCache = new Map();
  function loadLivery(id) {
    if (!liveryCache.has(id)) {
      const tex = async (f, srgb) => {
        const t = await texLoader.loadAsync(asset(`liveries/${f}`));
        t.flipY = false; t.anisotropy = 4;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      const p = Promise.all([tex(`${id}.jpg`, true), tex(`${id}-mr.jpg`, false)]);
      p.catch(() => liveryCache.delete(id));
      liveryCache.set(id, p);
    }
    return liveryCache.get(id);
  }
  async function buildCar(team) {
    const key = team.model || 'car';
    const tpl = await loadTemplate(key);
    const livery = MODEL_FILES[key].livery ? await loadLivery(team.id) : null;
    const body = tpl.model.clone(true);
    const mats = new Map();
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = !lowPower;
      if (!mats.has(o.material)) {
        const m = o.material.clone();
        m.envMapIntensity = 1.4;
        if (livery && m.map) { m.map = livery[0]; m.metalnessMap = livery[1]; m.roughnessMap = livery[1]; }
        mats.set(o.material, m);
      }
      o.material = mats.get(o.material);
    });
    const group = new THREE.Group();
    const chassis = new THREE.Group();
    chassis.add(body);
    group.add(chassis);
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 6.2), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: lowPower ? 0.75 : 0.45 }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.04;
    group.add(blob);
    const wheels = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].map((n) => body.getObjectByName(n)).filter(Boolean);
    wheels.forEach((w) => { w.rotation.order = 'YXZ'; });
    scene.add(group);
    return { team, group, chassis, wheels, front: wheels.filter((w) => w.name.startsWith('wheelF')), tpl };
  }
  const blobTex = canvasTex(64, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, h / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.9)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });

  // 3D F1 steering wheel for the cockpit camera
  const wheelHud = (() => {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    const w = 0.15, h = 0.085, r = 0.03;
    shape.moveTo(-w + r, -h); shape.lineTo(w - r, -h); shape.quadraticCurveTo(w, -h, w, -h + r); shape.lineTo(w, h - r);
    shape.quadraticCurveTo(w, h, w - r, h); shape.lineTo(-w + r, h); shape.quadraticCurveTo(-w, h, -w, h - r); shape.lineTo(-w, -h + r);
    shape.quadraticCurveTo(-w, -h, -w + r, -h);
    const carbon = new THREE.MeshStandardMaterial({ color: 0x121317, roughness: 0.45, metalness: 0.3 });
    const base = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.006, bevelThickness: 0.006, bevelSegments: 2 }), carbon);
    base.position.z = -0.0125;
    g.add(base);
    const rubber = new THREE.MeshStandardMaterial({ color: 0x1d1e22, roughness: 0.95 });
    for (const sx of [-1, 1]) {
      const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.11, 6, 12), rubber);
      grip.position.set(sx * 0.16, -0.01, 0.004);
      grip.rotation.z = sx * 0.12;
      g.add(grip);
    }
    const scr = document.createElement('canvas');
    scr.width = 256; scr.height = 128;
    const scrTex = new THREE.CanvasTexture(scr);
    scrTex.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.055), new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }));
    screen.position.set(0, 0.008, 0.02);
    g.add(screen);
    const leds = [];
    for (let k = 0; k < 10; k++) {
      const m = new THREE.MeshBasicMaterial({ color: 0x111111, toneMapped: false });
      const led = new THREE.Mesh(new THREE.CircleGeometry(0.0055, 10), m);
      led.position.set(-0.054 + k * 0.012, 0.064, 0.02);
      g.add(led);
      leds.push(m);
    }
    const btnCols = [0xff2a2a, 0xffd200, 0x00d2be, 0x1f6fff, 0xffffff, 0xff8000];
    btnCols.forEach((c, k) => {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12), new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
      b.rotation.x = Math.PI / 2;
      b.position.set((k % 2 ? 1 : -1) * 0.085, 0.03 - Math.floor(k / 2) * 0.03, 0.02);
      g.add(b);
    });
    g.visible = false;
    const sctx = scr.getContext('2d');
    let last = '';
    return {
      group: g,
      update(gear, kmh, rpmFrac) {
        const txt = `${gear}|${kmh}`;
        if (txt !== last) {
          last = txt;
          sctx.fillStyle = '#05070c'; sctx.fillRect(0, 0, 256, 128);
          sctx.fillStyle = '#00f0ff'; sctx.font = '900 84px Orbitron, Arial Black, sans-serif'; sctx.textAlign = 'center'; sctx.textBaseline = 'middle';
          sctx.fillText(String(gear), 70, 66);
          sctx.fillStyle = '#ffffff'; sctx.font = '700 46px JetBrains Mono, monospace';
          sctx.fillText(String(kmh), 180, 56);
          sctx.fillStyle = '#7d86a8'; sctx.font = '600 20px JetBrains Mono, monospace'; sctx.fillText('KM/H', 180, 98);
          scrTex.needsUpdate = true;
        }
        leds.forEach((m, k) => {
          const on = rpmFrac > 0.62 + k * 0.035;
          m.color.setHex(!on ? 0x111111 : k < 4 ? 0x00ff66 : k < 7 ? 0xff2020 : 0x3d7bff);
        });
      },
    };
  })();

  // ---------- audio ----------
  const audio = {
    ctx: null, muted: false,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.gain.value = 0.32; this.master.connect(ctx.destination);
      const lp = (this.lp = ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 2;
      this.eng = ctx.createGain(); this.eng.gain.value = 0;
      lp.connect(this.eng); this.eng.connect(this.master);
      this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
      this.o2 = ctx.createOscillator(); this.o2.type = 'square';
      const g2 = ctx.createGain(); g2.gain.value = 0.35;
      this.o1.connect(lp); this.o2.connect(g2); g2.connect(lp);
      this.o1.start(); this.o2.start();
      // noise for tyres / wind / impacts
      const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const mk = (type, f, q) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(flt); flt.connect(g); g.connect(this.master); src.start();
        return g;
      };
      this.squeal = mk('bandpass', 1800, 6);
      this.wind = mk('lowpass', 500, 0.5);
      this.rumble = mk('lowpass', 120, 1);
    },
    update(rpm, throttle, slip, speed, surface) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const f = (rpm / 60) * 1.5;
      this.o1.frequency.setTargetAtTime(f, t, 0.03);
      this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
      this.lp.frequency.setTargetAtTime(500 + throttle * 2600 + rpm * 0.08, t, 0.05);
      this.eng.gain.setTargetAtTime(this.muted ? 0 : 0.18 + throttle * 0.35, t, 0.05);
      this.squeal.gain.setTargetAtTime(this.muted ? 0 : clamp((slip - 0.09) * 3, 0, 0.5) * clamp(speed / 15, 0, 1), t, 0.05);
      this.wind.gain.setTargetAtTime(this.muted ? 0 : clamp(speed / 90, 0, 1) * 0.35, t, 0.1);
      this.rumble.gain.setTargetAtTime(this.muted ? 0 : surface * clamp(speed / 20, 0, 1) * 0.9, t, 0.04);
    },
    hit(strength) {
      if (!this.ctx || this.muted) return;
      const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const flt = ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 700;
      const g = ctx.createGain(); g.gain.value = clamp(strength, 0.1, 1.2);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(); src.stop(ctx.currentTime + 0.4);
    },
    beep(freq, dur = 0.18) {
      if (!this.ctx || this.muted) return;
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.12;
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur);
    },
    suspend() { this.ctx?.suspend(); },
    resume() { this.ctx?.resume(); },
  };

  // ---------- UI ----------
  ui.innerHTML = `
    <div class="rc-hud" id="rc-hud" hidden>
      <div class="rc-tl">
        <div class="rc-pos"><b id="rc-pos">P–</b><span id="rc-of">/–</span></div>
        <div class="rc-lap">КРУГ <b id="rc-lap">1</b><span id="rc-laps">/3</span></div>
        <canvas id="rc-map" width="180" height="180"></canvas>
      </div>
      <div class="rc-tr">
        <div><span>ВРЕМЯ</span><b id="rc-time">0:00.000</b></div>
        <div><span>ПОСЛЕДНИЙ</span><b id="rc-last">—</b></div>
        <div><span>ЛУЧШИЙ</span><b id="rc-best">—</b></div>
        <div class="rc-btns">
          <button id="rc-cam" title="Камера (C)">🎥</button><button id="rc-snd" title="Звук (M)">🔊</button><button id="rc-pause" title="Пауза (Esc)">❚❚</button>
        </div>
      </div>
      <div class="rc-dash">
        <div class="rc-leds" id="rc-leds">${'<i></i>'.repeat(15)}</div>
        <div class="rc-speed"><b id="rc-speed">0</b><span>км/ч</span></div>
        <div class="rc-gear" id="rc-gear">N</div>
        <div class="rc-bars"><i id="rc-thr"></i><i id="rc-brk"></i></div>
      </div>
      <div class="rc-wheel" id="rc-wheel">
        <svg viewBox="-110 -70 220 140" aria-hidden="true">
          <path d="M-96,-30 Q-104,-58 -70,-60 L70,-60 Q104,-58 96,-30 L84,40 Q78,62 52,60 L30,44 L-30,44 L-52,60 Q-78,62 -84,40 Z" fill="#101218" stroke="#2c3040" stroke-width="3"/>
          <rect x="-104" y="-36" width="26" height="74" rx="12" fill="#1f2128"/><rect x="78" y="-36" width="26" height="74" rx="12" fill="#1f2128"/>
          <rect x="-38" y="-30" width="76" height="40" rx="5" fill="#05070c" stroke="#00f0ff" stroke-opacity=".5"/>
          <text id="rc-wgear" x="0" y="-2" text-anchor="middle" fill="#00f0ff" font-family="Orbitron, sans-serif" font-weight="900" font-size="26">N</text>
          <g id="rc-wleds">${Array.from({ length: 10 }, (_, k) => `<circle cx="${-45 + k * 10}" cy="-46" r="3.4" fill="#222"/>`).join('')}</g>
          <circle cx="-58" cy="18" r="6" fill="#ff2a2a"/><circle cx="58" cy="18" r="6" fill="#00d2be"/><circle cx="-58" cy="-6" r="5" fill="#ffd200"/><circle cx="58" cy="-6" r="5" fill="#1f6fff"/>
        </svg>
      </div>
      <div class="rc-pedals" id="rc-pedals">
        <button id="rc-brake">ТОРМОЗ</button><button id="rc-gas">ГАЗ</button>
      </div>
      <div class="rc-lights" id="rc-lights" hidden>${'<i><b></b><b></b></i>'.repeat(5)}</div>
      <div class="rc-msg" id="rc-msg"></div>
      <div class="rc-help">← → / A D — руль · ↑ W — газ · ↓ S — тормоз · C — камера · R — на трассу · мышь — обзор · Esc — пауза</div>
    </div>
    <div class="rc-menu" id="rc-menu">
      <div class="rc-panel">
        <p class="eyebrow">// F1 PULSE GP_</p>
        <h2 class="glitch">Гонка</h2>
        <p class="muted">Трасса «Неон Сити» · 3,4 км · трибуны, поребрики, гравий. Реалистичная управляемость: прижимная сила, срыв задней оси на газу, торможение с перегрузкой до 5g.</p>
        <h4>Болид</h4>
        <div class="rc-cars" id="rc-cars"></div>
        <div class="rc-opts">
          <label>Круги<select id="rc-o-laps"><option>1</option><option selected>3</option><option>5</option><option>10</option></select></label>
          <label>Соперники<select id="rc-o-ai"><option>0</option><option ${lowPower ? 'selected' : ''}>3</option><option ${lowPower ? '' : 'selected'}>5</option><option>7</option></select></label>
          <label>Сложность<select id="rc-o-diff"><option value="0.86">Лёгкая</option><option value="0.92" selected>Средняя</option><option value="0.975">Сложная</option></select></label>
          <label>Стабилизация<select id="rc-o-assist"><option value="1" selected>Вкл (TC + ESC)</option><option value="0">Выкл — хардкор</option></select></label>
        </div>
        <div class="rc-actions"><button class="btn primary" id="rc-start">Старт</button><button class="btn neon" id="rc-resume" hidden>Продолжить</button></div>
        <p class="rc-load muted" id="rc-load"></p>
        <p class="muted small">Клавиатура, геймпад (руль — стик, газ/тормоз — курки) или касания: руль слева, педали справа. Мышью или пальцем по экрану можно вращать обзор.</p>
      </div>
    </div>
    <div class="rc-menu" id="rc-results" hidden><div class="rc-panel"><p class="eyebrow">// ФИНИШ_</p><h2 id="rc-res-title">Результаты</h2><div id="rc-res-body"></div>
      <div class="rc-actions"><button class="btn primary" id="rc-again">Ещё раз</button><button class="btn neon" id="rc-menu-btn">Меню</button></div></div></div>`;
  const $ = (id) => document.getElementById(id);
  const ledEls = [...$('rc-leds').children];
  const wLedEls = [...$('rc-wleds').children];
  let choice = TEAMS[0];
  try { choice = TEAMS.find((t) => t.id === localStorage.getItem('f1p-race-car')) || choice; } catch { /* storage blocked */ }
  $('rc-cars').innerHTML = TEAMS.map((t) => `<button data-id="${t.id}" style="--c:${hex(t.accent)}"><i></i>${t.label || t.name}<b>${t.num}</b><small>${t.short}</small></button>`).join('');
  const markChoice = () => $('rc-cars').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === choice.id));
  markChoice();
  $('rc-cars').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    choice = TEAMS.find((t) => t.id === b.dataset.id);
    try { localStorage.setItem('f1p-race-car', choice.id); } catch { /* storage blocked */ }
    markChoice();
  });
  if (!touch) { $('rc-pedals').hidden = true; }
  const fmt = (ms) => {
    if (ms == null || !isFinite(ms)) return '—';
    const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000;
    return `${m}:${s.toFixed(3).padStart(6, '0')}`;
  };
  let bestLap = null;
  try { bestLap = +localStorage.getItem('f1p-race-best') || null; } catch { /* storage blocked */ }
  $('rc-best').textContent = fmt(bestLap);
  let msgTimer = 0;
  function msg(text, ms = 1600, cls = '') {
    const el = $('rc-msg');
    el.textContent = text;
    el.className = `rc-msg show ${cls}`;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.className = 'rc-msg'; }, ms);
  }

  // minimap
  const map = $('rc-map').getContext('2d');
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let i = 0; i < N; i++) { minX = Math.min(minX, T.px[i]); maxX = Math.max(maxX, T.px[i]); minZ = Math.min(minZ, T.pz[i]); maxZ = Math.max(maxZ, T.pz[i]); }
  const mapS = 160 / Math.max(maxX - minX, maxZ - minZ);
  const MX = (x) => 10 + (x - minX) * mapS + (160 - (maxX - minX) * mapS) / 2;
  const MZ = (z) => 170 - ((z - minZ) * mapS + (160 - (maxZ - minZ) * mapS) / 2);
  const mapPath = new Path2D();
  for (let i = 0; i <= N; i += 4) { const k = i % N; i ? mapPath.lineTo(MX(T.px[k]), MZ(T.pz[k])) : mapPath.moveTo(MX(T.px[k]), MZ(T.pz[k])); }
  mapPath.closePath();
  function drawMap() {
    map.clearRect(0, 0, 180, 180);
    map.lineWidth = 7; map.strokeStyle = 'rgba(0,240,255,0.18)'; map.stroke(mapPath);
    map.lineWidth = 2.5; map.strokeStyle = 'rgba(230,246,255,0.85)'; map.stroke(mapPath);
    map.fillStyle = '#fff'; map.fillRect(MX(T.px[START]) - 1, MZ(T.pz[START]) - 5, 2, 10);
    for (const c of cars) {
      const me = c === player;
      map.fillStyle = hex(c.team.accent);
      map.beginPath(); map.arc(MX(c.x), MZ(c.z), me ? 5.5 : 3.6, 0, 6.3); map.fill();
      if (me) { map.lineWidth = 2; map.strokeStyle = '#fff'; map.stroke(); }
    }
  }

  // ---------- input ----------
  const keys = new Set();
  const input = { steer: 0, throttle: 0, brake: 0 };
  let touchSteer = null, touchGas = 0, touchBrake = 0;
  const active = () => !root.hidden;
  addEventListener('keydown', (e) => {
    if (!active()) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    keys.add(k);
    if (e.repeat) return;
    if (k === 'c') cycleCam();
    else if (k === 'm') toggleMute();
    else if (k === 'r') resetToTrack();
    else if (k === 'escape' || k === 'p') togglePause();
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());
  $('rc-cam').onclick = () => cycleCam();
  $('rc-snd').onclick = () => toggleMute();
  $('rc-pause').onclick = () => togglePause();

  // on-screen wheel: drag to turn, springs back (self-aligning) on release
  {
    const el = $('rc-wheel');
    let startAng = 0, pid = null;
    const angOf = (e) => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    el.addEventListener('pointerdown', (e) => { pid = e.pointerId; el.setPointerCapture(pid); startAng = angOf(e) - (touchSteer || 0) * 1.6; touchSteer = touchSteer || 0; e.preventDefault(); });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      let d = angOf(e) - startAng;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      touchSteer = clamp(-d / 1.6, -1, 1);
    });
    const up = (e) => { if (e.pointerId === pid) { pid = null; touchSteer = null; } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    const pedal = (btn, set) => {
      btn.addEventListener('pointerdown', (e) => { btn.setPointerCapture(e.pointerId); set(1); btn.classList.add('on'); e.preventDefault(); });
      const off = () => { set(0); btn.classList.remove('on'); };
      btn.addEventListener('pointerup', off); btn.addEventListener('pointercancel', off);
    };
    pedal($('rc-gas'), (v) => { touchGas = v; });
    pedal($('rc-brake'), (v) => { touchBrake = v; });
  }
  // look around: drag on the canvas rotates the chase / cockpit view, springs back on release
  const look = { yaw: 0, pitch: 0, drag: false, lx: 0, ly: 0 };
  canvas.addEventListener('pointerdown', (e) => { if (camMode === 2) return; look.drag = true; look.lx = e.clientX; look.ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!look.drag) return;
    look.yaw = clamp(look.yaw - (e.clientX - look.lx) * 0.008, -Math.PI, Math.PI);
    look.pitch = clamp(look.pitch + (e.clientY - look.ly) * 0.005, -0.35, 0.9);
    look.lx = e.clientX; look.ly = e.clientY;
  });
  const lookUp = () => { look.drag = false; };
  canvas.addEventListener('pointerup', lookUp);
  canvas.addEventListener('pointercancel', lookUp);
  canvas.style.touchAction = 'none';

  let padCamPrev = false, padStartPrev = false;
  function readInput(dt) {
    let steerT = 0, thr = 0, brk = 0, kb = false;
    if (keys.has('arrowleft') || keys.has('a')) { steerT += 1; kb = true; }
    if (keys.has('arrowright') || keys.has('d')) { steerT -= 1; kb = true; }
    if (keys.has('arrowup') || keys.has('w')) thr = 1;
    if (keys.has('arrowdown') || keys.has('s') || keys.has(' ')) brk = 1;
    const pad = navigator.getGamepads?.()[0];
    let analog = null;
    if (pad) {
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.08) analog = -Math.sign(ax) * ((Math.abs(ax) - 0.08) / 0.92) ** 1.4;
      thr = Math.max(thr, pad.buttons[7]?.value || 0, pad.buttons[0]?.pressed ? 1 : 0);
      brk = Math.max(brk, pad.buttons[6]?.value || 0, pad.buttons[1]?.pressed ? 1 : 0);
      const camB = !!pad.buttons[3]?.pressed;
      if (camB && !padCamPrev) cycleCam();
      padCamPrev = camB;
      const st = !!pad.buttons[9]?.pressed;
      if (st && !padStartPrev) togglePause();
      padStartPrev = st;
    }
    thr = Math.max(thr, touchGas); brk = Math.max(brk, touchBrake);
    if (touchSteer != null) analog = touchSteer;
    if (analog != null) input.steer = lerp(input.steer, analog, 1 - Math.exp(-dt * 18));
    else {
      // keyboard: ramps in, self-centres faster at speed (the wheel "fights back")
      const back = 4 + Math.abs(player?.u || 0) * 0.06;
      const rate = steerT === 0 || Math.sign(steerT) !== Math.sign(input.steer) ? back : 2.1;
      input.steer += clamp(steerT - input.steer, -rate * dt, rate * dt);
      if (!kb && touchSteer == null) input.steer *= Math.exp(-dt * 3);
    }
    // pedals ramp in (a key press is not a 0→100% stab), release quickly
    input.throttle += clamp(thr - input.throttle, -8 * dt, (pad || touchGas ? 10 : 4) * dt);
    input.brake += clamp(brk - input.brake, -10 * dt, 9 * dt);
  }

  // ---------- race state ----------
  let cars = [], player = null, ais = [];
  let state = 'menu'; // menu | loading | intro | lights | race | finished | paused
  let prevState = null;
  let raceT = 0, lightsT = 0, lightsGo = 0, introT = 0;
  let LAPS = 3, assist = true;
  let camMode = 0; // 0 chase, 1 cockpit, 2 tv
  let shake = 0, impact = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

  function sampleAt(s) {
    const f = ((s % N) + N) % N, i = Math.floor(f), j = (i + 1) % N, t = f - i;
    return {
      x: lerp(T.px[i], T.px[j], t), z: lerp(T.pz[i], T.pz[j], t),
      tx: lerp(T.tx[i], T.tx[j], t), tz: lerp(T.tz[i], T.tz[j], t),
      line: lerp(LINE[i], LINE[j], t), vmax: lerp(VMAX[i], VMAX[j], t),
    };
  }
  function locate(c) {
    let best = c.idx, bd = 1e18;
    const span = c.lost ? N : 40;
    for (let d = -span; d <= span; d++) {
      const i = (c.idx + d + N) % N;
      const dx = c.x - T.px[i], dz = c.z - T.pz[i], dd = dx * dx + dz * dz;
      if (dd < bd) { bd = dd; best = i; }
    }
    const prev = c.idx;
    c.idx = best;
    c.lost = bd > 60 * 60;
    let dIdx = best - prev;
    if (dIdx > N / 2) dIdx -= N; else if (dIdx < -N / 2) dIdx += N;
    c.s += dIdx;
    c.lat = (c.x - T.px[best]) * leftX(best) + (c.z - T.pz[best]) * leftZ(best);
  }
  function surfaceOf(c) {
    const d = c.lat, a = Math.abs(d), i = c.idx;
    if (a < HALF_W) return SURF.asphalt;
    const kerb = d > 0 ? KL[i] : KR[i];
    if (a < HALF_W + KERB_W && kerb) return SURF.kerb;
    if (a < HALF_W + RUNOFF) return SURF.runoff;
    const grav = d > 0 ? GL[i] : GR[i];
    return grav ? SURF.gravel : SURF.grass;
  }

  function placeOnGrid(c, slot) {
    const meters = -(8 + slot * 8);
    c.s = START + meters / DS - START; // progress relative to the start line, in samples
    const sm = sampleAt(START + meters / DS);
    const lat = slot % 2 ? -3 : 3;
    c.x = sm.x + sm.tz * lat; c.z = sm.z - sm.tx * lat;
    c.h = Math.atan2(sm.tx, sm.tz);
    c.vx = c.vz = 0; c.u = c.w = c.r = 0; c.steer = 0;
    c.idx = (Math.round(START + meters / DS) + N) % N;
    c.lane = lat; c.lap = 0; c.lapStart = 0; c.lapTimes = []; c.finished = null; c.lost = false;
    c.wheelSpin = 0;
  }

  async function startRace() {
    LAPS = +$('rc-o-laps').value;
    const nAI = +$('rc-o-ai').value;
    const skill = +$('rc-o-diff').value;
    assist = $('rc-o-assist').value === '1';
    audio.init(); audio.resume();
    state = 'loading';
    $('rc-load').textContent = 'Загрузка болидов…';
    $('rc-start').disabled = true;
    for (const c of cars) scene.remove(c.group);
    cars = []; ais = [];
    try {
      const rivals = TEAMS.filter((t) => t.id !== choice.id && !t.model).sort(() => Math.random() - 0.5).slice(0, nAI);
      const built = await Promise.all([choice, ...rivals].map(buildCar));
      player = built[0];
      ais = built.slice(1);
      cars = built;
      const order = [...ais];
      order.forEach((c, k) => { placeOnGrid(c, k); c.skill = skill * (0.975 + Math.random() * 0.05); c.v = 0; c.offset = c.lane; c.ai = true; });
      placeOnGrid(player, ais.length);
      if (!player.group.children.includes(wheelHud.group)) player.group.add(wheelHud.group);
      wheelHud.group.position.copy(player.tpl.eye).add(new THREE.Vector3(0, -0.2, 0.42));
      wheelHud.group.rotation.set(-0.25, Math.PI, 0);
      wheelHud.group.rotation.order = 'YXZ';
    } catch (err) {
      console.warn(err);
      $('rc-load').textContent = 'Не удалось загрузить модели. Проверьте соединение и попробуйте ещё раз.';
      $('rc-start').disabled = false;
      state = 'menu';
      return;
    }
    $('rc-start').disabled = false;
    $('rc-load').textContent = '';
    $('rc-menu').hidden = true;
    $('rc-results').hidden = true;
    $('rc-hud').hidden = false;
    $('rc-laps').textContent = `/${LAPS}`;
    $('rc-of').textContent = `/${cars.length}`;
    $('rc-lap').textContent = '1';
    $('rc-last').textContent = '—';
    raceT = 0; introT = 0; lightsT = 0;
    startLights.forEach((m) => m.color.setHex(0x220404));
    state = 'intro';
    look.yaw = 0; look.pitch = 0;
    camPos.set(player.x + 40, 22, player.z - 30);
  }
  $('rc-start').onclick = startRace;
  $('rc-again').onclick = startRace;
  $('rc-menu-btn').onclick = () => { $('rc-results').hidden = true; $('rc-menu').hidden = false; $('rc-resume').hidden = true; $('rc-hud').hidden = true; state = 'menu'; };
  $('rc-resume').onclick = () => togglePause();

  function togglePause() {
    if (state === 'paused') {
      state = prevState;
      $('rc-menu').hidden = true;
      audio.resume();
    } else if (['intro', 'lights', 'race'].includes(state)) {
      prevState = state;
      state = 'paused';
      $('rc-menu').hidden = false;
      $('rc-resume').hidden = false;
      audio.suspend();
    }
  }
  function cycleCam() {
    camMode = (camMode + 1) % 3;
    orbit.enabled = camMode === 2;
    wheelHud.group.visible = camMode === 1;
    if (camMode === 2) { orbit.target.set(player?.x || 0, 1, player?.z || 0); }
    msg(['Камера: сзади', 'Камера: кокпит', 'Камера: ТВ — вращайте мышью/пальцем'][camMode], 1300);
  }
  function toggleMute() { audio.muted = !audio.muted; $('rc-snd').textContent = audio.muted ? '🔇' : '🔊'; }
  function resetToTrack() {
    if (!player || state !== 'race') return;
    const sm = sampleAt(player.idx);
    player.x = sm.x; player.z = sm.z; player.h = Math.atan2(sm.tx, sm.tz);
    player.vx = player.vz = player.u = player.w = player.r = 0;
    msg('Возврат на трассу', 1200);
  }

  // ---------- player physics ----------
  const tire = (alpha, fz, mu) => -mu * fz * Math.sin(TIRE_C * Math.atan(TIRE_B * alpha));
  let slipMetric = 0, surfShake = 0, lastRumble = 0;
  function stepPlayer(c, dt, inp, canDrive) {
    const sinH = Math.sin(c.h), cosH = Math.cos(c.h);
    let u = c.vx * sinH + c.vz * cosH;
    let w = c.vx * cosH - c.vz * sinH;
    let r = c.r;
    locate(c);
    const surf = surfaceOf(c);
    const A = c.tpl.axleF, B = -c.tpl.axleR;
    // steering: speed-sensitive lock, optional assist (counter-steer help)
    const maxSt = Math.max(0.055, 0.32 - Math.abs(u) * 0.0031);
    let target = inp.steer * maxSt;
    if (assist && Math.abs(u) > 8) {
      const betaR = Math.atan2(w - B * r, Math.abs(u));
      target += clamp(betaR * 0.55, -0.12, 0.12);
    }
    c.steer += clamp(target - c.steer, -1.9 * dt, 1.9 * dt);
    const df = K_DF * u * u, fz = M * G + df, fzf = fz * 0.46, fzr = fz * 0.54;
    const ua = Math.max(Math.abs(u), 4);
    const dir = u >= 0 ? 1 : -1;
    const af = Math.atan2(w + A * r, ua) - c.steer * dir;
    const ar = Math.atan2(w - B * r, ua);
    // longitudinal
    let fxr = 0, fxf = 0;
    const thr = canDrive ? inp.throttle : 0, brk = canDrive ? inp.brake : 1;
    if (u > -0.5 && thr > 0) fxr += thr * Math.min(F_TRACT, P_MAX / Math.max(u, 4));
    if (brk > 0) {
      if (u > 0.6) { const fb = brk * (BRAKE_BASE + BRAKE_DF * u * u); fxf -= fb * 0.6; fxr -= fb * 0.4; }
      else if (canDrive && thr === 0) fxr -= brk * 3800; // reverse
      else if (!canDrive) { u *= 0.9; }
    }
    if (u < -0.5 && thr > 0) fxr += thr * 9000;
    if (u < -9) fxr = Math.max(fxr, 0);
    // friction circle per axle
    const capF = surf.mu * fzf, capR = surf.mu * REAR_GRIP * fzr;
    // traction control (assist): drive force never eats all of the rear grip
    const tc = assist ? 0.72 : 0.98;
    fxf = clamp(fxf, -capF, capF); fxr = clamp(fxr, -capR, capR * tc);
    let fyf = tire(af, fzf, surf.mu), fyr = tire(ar, fzr, surf.mu * REAR_GRIP);
    const limF = Math.sqrt(Math.max(0, capF * capF - fxf * fxf)), limR = Math.sqrt(Math.max(0, capR * capR - fxr * fxr));
    fyf = clamp(fyf, -limF, limF); fyr = clamp(fyr, -limR, limR);
    const drag = CD * u * Math.abs(u) + ROLL * Math.sign(u) + surf.drag * u;
    const cs = Math.cos(c.steer), sn = Math.sin(c.steer);
    const du = (fxf * cs - fyf * sn + fxr - drag) / M + w * r;
    const dw = (fyf * cs + fxf * sn + fyr) / M - u * r;
    const dr = (A * (fyf * cs + fxf * sn) - B * fyr) / IZ;
    u += du * dt; w += dw * dt; r += dr * dt;
    if (Math.abs(u) < 3) { w *= 1 - dt * 5; r *= 1 - dt * 4; }
    if (assist && Math.abs(u) > 2) {
      // stability control: when the car starts to slide, pull the yaw rate towards what the
      // steering asks for and bleed off the sideways slip (still lets the tail move a little)
      const rKin = (u * Math.tan(c.steer)) / (A + B);
      const beta = Math.atan2(w, Math.abs(u));
      const k = clamp((Math.abs(beta) - 0.035) * 14, 0, 1) * 7 + (surf === SURF.grass || surf === SURF.gravel ? 0 : 1.2);
      r += (rKin - r) * Math.min(1, k * dt);
      w *= 1 - Math.min(1, k * 0.45 * dt);
      const rMax = (surf.mu * (G + (K_DF * u * u) / M)) / Math.abs(u);
      r = clamp(r, -rMax * 1.05, rMax * 1.05);
    }
    if (!canDrive || (thr === 0 && Math.abs(u) < 0.25 && brk > 0 && !canDrive)) { u *= 1 - dt * 6; }
    c.u = u; c.w = w; c.r = r;
    c.vx = u * sinH + w * cosH; c.vz = u * cosH - w * sinH;
    c.x += c.vx * dt; c.z += c.vz * dt; c.h += r * dt;
    c.ax = du; c.ay = dw + u * r;
    slipMetric = Math.max(Math.abs(af), Math.abs(ar)) + (fxr >= capR * 0.98 && thr > 0 ? 0.15 : 0) + (brk > 0 && u > 5 && Math.abs(fxf) >= capF * 0.98 ? 0.15 : 0);
    surfShake = surf.shake;
    // barriers
    const lim = WALL - 1.05;
    if (Math.abs(c.lat) > lim) {
      const side = Math.sign(c.lat), i = c.idx;
      const nx = leftX(i) * side, nz = leftZ(i) * side; // outward normal
      const pen = Math.abs(c.lat) - lim;
      c.x -= nx * pen; c.z -= nz * pen;
      const vn = c.vx * nx + c.vz * nz;
      if (vn > 0) {
        c.vx -= vn * nx * 1.35; c.vz -= vn * nz * 1.35;
        c.vx *= 0.82; c.vz *= 0.82;
        c.r += (Math.random() - 0.5) * vn * 0.08;
        const hard = clamp(vn / 25, 0, 1);
        impact = Math.max(impact, 0.25 + hard);
        if (vn > 2) { audio.hit(0.2 + hard); emitSparks(c.x + nx * 1, 0.4, c.z + nz * 1, 10 + Math.round(hard * 40), c.vx, c.vz); rumble(0.4 + hard * 0.6, 0.6 + hard * 0.4, 180); }
      }
      const sinH2 = Math.sin(c.h), cosH2 = Math.cos(c.h);
      c.u = c.vx * sinH2 + c.vz * cosH2; c.w = c.vx * cosH2 - c.vz * sinH2;
    }
  }

  // ---------- AI ----------
  function stepAI(c, dt, go) {
    const sm = sampleAt(START + c.s);
    let target = go ? sm.vmax * c.skill : 0;
    if (c.finished != null) target = Math.min(target, 40);
    // traffic: slow behind cars, steer around them
    let want = sm.line * 0.85 + c.lane * 0.25;
    for (const o of cars) {
      if (o === c) continue;
      const gap = (o.s - c.s) * DS;
      if (gap > 0 && gap < 22) {
        const dl = o.lat - c.offset;
        if (Math.abs(dl) < 2.6) {
          const ov = o.ai ? o.v : Math.max(0, o.u);
          if (ov < c.v - 1) want = c.offset + (dl > 0 ? -3.4 : 3.4);
          if (gap < 9) target = Math.min(target, ov * 0.97);
        }
      }
    }
    want = clamp(want, -HALF_W + 1.3, HALF_W - 1.3);
    c.offset += clamp(want - c.offset, -2.5 * dt, 2.5 * dt);
    if (c.v < target) c.v = Math.min(target, c.v + Math.min(11.5, P_MAX / M / Math.max(c.v, 6)) * dt);
    else c.v = Math.max(target, c.v - 30 * dt);
    c.s += (c.v * dt) / DS;
    const a = sampleAt(START + c.s), b = sampleAt(START + c.s + 2);
    const ax = a.x + a.tz * c.offset, az = a.z - a.tx * c.offset;
    const bx = b.x + b.tz * c.offset, bz = b.z - b.tx * c.offset;
    const nh = Math.atan2(bx - ax, bz - az);
    let dh = nh - c.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    c.steer = clamp(dh * 2.2, -0.35, 0.35);
    c.h = nh; c.x = ax; c.z = az;
    c.idx = (Math.floor(START + c.s) % N + N) % N;
    c.lat = c.offset;
    c.u = c.v;
  }

  // car-to-car contact (two circles per car)
  function collide(a, b) {
    const R = 1.05;
    for (const oa of [-1.6, 1.6]) for (const ob of [-1.6, 1.6]) {
      const ax = a.x + Math.sin(a.h) * oa, az = a.z + Math.cos(a.h) * oa;
      const bx = b.x + Math.sin(b.h) * ob, bz = b.z + Math.cos(b.h) * ob;
      const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz);
      if (d > 0.001 && d < R * 2) {
        const nx = dx / d, nz = dz / d, pen = R * 2 - d;
        if (a === player) {
          a.x += nx * pen; a.z += nz * pen;
          const bvx = Math.sin(b.h) * (b.v || 0), bvz = Math.cos(b.h) * (b.v || 0);
          const rel = (a.vx - bvx) * nx + (a.vz - bvz) * nz;
          if (rel < 0) {
            a.vx -= rel * nx * 1.3; a.vz -= rel * nz * 1.3;
            a.r += (Math.random() - 0.5) * 0.6;
            impact = Math.max(impact, clamp(-rel / 15, 0.2, 1));
            if (-rel > 1.5) { audio.hit(clamp(-rel / 15, 0.2, 1)); emitSparks((ax + bx) / 2, 0.5, (az + bz) / 2, 12, a.vx, a.vz); rumble(0.6, 0.8, 150); }
            b.v *= 0.94;
          }
          const sinH = Math.sin(a.h), cosH = Math.cos(a.h);
          a.u = a.vx * sinH + a.vz * cosH; a.w = a.vx * cosH - a.vz * sinH;
        } else {
          b.v *= 0.995;
        }
      }
    }
  }

  function rumble(strong, weak, ms) {
    const now = performance.now();
    if (now - lastRumble < 90) return;
    lastRumble = now;
    const pad = navigator.getGamepads?.()[0];
    pad?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: clamp(strong, 0, 1), weakMagnitude: clamp(weak, 0, 1) }).catch?.(() => {});
    if (touch && navigator.vibrate) navigator.vibrate(Math.round(ms * 0.6));
  }

  // ---------- race logic ----------
  function progress(c) { return c.s; }
  function lapCheck(c) {
    const lap = Math.floor(c.s / N);
    if (lap > c.lap) {
      c.lap = lap;
      const t = raceT;
      const lt = t - c.lapStart;
      c.lapStart = t;
      c.lapTimes.push(lt);
      if (c === player) {
        $('rc-last').textContent = fmt(lt * 1000);
        if (lap >= 1 && (!bestLap || lt * 1000 < bestLap)) {
          bestLap = lt * 1000;
          try { localStorage.setItem('f1p-race-best', String(Math.round(bestLap))); } catch { /* storage blocked */ }
          $('rc-best').textContent = fmt(bestLap);
          if (lap < LAPS) msg('ЛУЧШИЙ КРУГ', 1600, 'purple');
        } else if (lap < LAPS) msg(`КРУГ ${lap + 1}`, 1300);
        if (lap === LAPS - 1) msg('ПОСЛЕДНИЙ КРУГ', 1600);
      }
      if (lap >= LAPS && c.finished == null) c.finished = t;
    }
  }
  function standings() {
    return [...cars].sort((a, b) => {
      if (a.finished != null && b.finished != null) return a.finished - b.finished;
      if (a.finished != null) return -1;
      if (b.finished != null) return 1;
      return progress(b) - progress(a);
    });
  }
  function showResults() {
    const order = standings();
    const pace = (c) => c.v || Math.abs(c.u) || 50;
    const rows = order.map((c, i) => {
      const fin = c.finished != null ? c.finished : raceT + ((LAPS * N - c.s) * DS) / Math.max(30, pace(c));
      const best = c.lapTimes.length ? Math.min(...c.lapTimes) : null;
      return `<tr class="${c === player ? 'me' : ''}" style="--tc:${hex(c.team.accent)}"><td class="p">${i + 1}</td><td class="drv"><span class="bar"></span>${c.team.name} · ${c.team.short}</td>
        <td>${fmt(fin * 1000)}${c.finished == null ? '*' : ''}</td><td>${fmt(best == null ? null : best * 1000)}</td></tr>`;
    }).join('');
    const pos = order.indexOf(player) + 1;
    $('rc-res-title').textContent = pos === 1 ? 'Победа! P1' : `Финиш: P${pos}`;
    $('rc-res-body').innerHTML = `<table class="tower"><thead><tr><th>#</th><th>Пилот</th><th>Время</th><th>Лучший круг</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted small">* расчётное время для тех, кто ещё не финишировал</p>`;
    $('rc-results').hidden = false;
  }

  // ---------- frame ----------
  const clock = new THREE.Clock();
  let acc = 0, hudT = 0, running = false;
  const tmp = new THREE.Vector3(), fwd = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  function frame() {
    const rawDt = Math.min(clock.getDelta(), 0.25);
    const dt = Math.min(rawDt, 0.05);
    crowdUniform.value += dt;
    updateSparks(dt);
    if (state === 'menu' || state === 'loading') {
      // attract mode: slow fly-over of the grid
      const t = performance.now() / 1000;
      const i = (START + Math.round(t * 12)) % N;
      camera.position.set(T.px[i] + Math.sin(t * 0.2) * 70, 26, T.pz[i] + Math.cos(t * 0.2) * 70);
      camera.lookAt(T.px[i], 0, T.pz[i]);
      render();
      return;
    }
    if (state === 'paused') { render(); return; }
    readInput(dt);
    const go = state === 'race' || state === 'finished';
    if (state === 'intro') {
      introT += rawDt;
      if (introT > 2.6) { state = 'lights'; lightsT = 0; lightsGo = 4 + 0.6 + Math.random() * 1.2; $('rc-lights').hidden = false; [...$('rc-lights').children].forEach((e) => e.classList.remove('on')); }
    } else if (state === 'lights') {
      lightsT += rawDt;
      const lit = Math.min(5, Math.floor(lightsT / 0.9) + 1);
      [...$('rc-lights').children].forEach((e, k) => e.classList.toggle('on', k < lit));
      startLights.forEach((m, k) => m.color.setHex(k < lit ? 0xff1010 : 0x220404));
      if (lit !== (frame.lit || 0)) { frame.lit = lit; audio.beep(440, 0.15); }
      if (lightsT >= lightsGo) {
        state = 'race'; raceT = 0; frame.lit = 0;
        startLights.forEach((m) => m.color.setHex(0x220404));
        $('rc-lights').hidden = true;
        audio.beep(880, 0.4);
        msg('ВПЕРЁД!', 1100, 'go');
        cars.forEach((c) => { c.lapStart = 0; });
      }
    }
    if (go) raceT += dt;
    // physics at 240 Hz
    acc += dt;
    const h = 1 / 240;
    let steps = 0;
    while (acc >= h && steps < 24) {
      stepPlayer(player, h, input, go && player.finished == null ? true : go);
      for (const a of ais) stepAI(a, h, go);
      acc -= h; steps++;
    }
    if (steps >= 24) acc = 0;
    for (const a of ais) collide(player, a);
    for (let i = 0; i < ais.length; i++) for (let j = i + 1; j < ais.length; j++) {
      const p = ais[i], q = ais[j];
      if (Math.abs(p.s - q.s) * DS < 6 && Math.abs(p.offset - q.offset) < 2.2) { if (p.s < q.s) p.v *= 0.995; else q.v *= 0.995; }
    }
    if (go) for (const c of cars) lapCheck(c);
    if (state === 'race' && player.finished != null) {
      state = 'finished';
      msg('ФИНИШ!', 2500, 'go');
      setTimeout(() => { if (state === 'finished') showResults(); }, 2600);
    }
    // feedback
    const speed = Math.abs(player.u);
    shake = lerp(shake, surfShake * clamp(speed / 30, 0, 1) + clamp((speed - 60) / 40, 0, 1) * 0.06, 1 - Math.exp(-dt * 10));
    impact *= Math.exp(-dt * 5);
    if (surfShake >= 0.5 && speed > 15) rumble(surfShake * 0.5, surfShake * 0.7, 80);
    // visuals
    for (const c of cars) updateCarVisual(c, dt);
    updateCamera(dt);
    // gear / rpm
    const kmh = speed * 3.6;
    let gear = 1;
    while (gear < 8 && kmh > GEAR_TOP[gear - 1] * 0.97) gear++;
    const lo = gear === 1 ? 0 : GEAR_TOP[gear - 2] * 0.9, hi = GEAR_TOP[gear - 1];
    const rpm = state === 'lights' || state === 'intro' ? 4200 + input.throttle * 7000 : clamp(4200 + ((kmh - lo) / (hi - lo)) * 7800, 4000, 12200);
    const rpmFrac = (rpm - 4000) / 8200;
    audio.update(rpm, input.throttle, slipMetric, speed, Math.max(surfShake, impact * 0.6));
    wheelHud.update(player.u < -0.5 ? 'R' : speed < 0.5 && !go ? 'N' : gear, Math.round(kmh), rpmFrac);
    wheelHud.group.rotation.z = input.steer * 1.4 * (assist ? 1 : 1);
    hudT += dt;
    if (hudT > 0.05) {
      hudT = 0;
      $('rc-speed').textContent = Math.round(kmh);
      const g = player.u < -0.5 ? 'R' : speed < 0.5 && !go ? 'N' : String(gear);
      $('rc-gear').textContent = g;
      $('rc-wgear').textContent = g;
      ledEls.forEach((e, k) => { e.className = rpmFrac > 0.55 + k * 0.03 ? (k < 5 ? 'g' : k < 10 ? 'r' : 'b') : ''; });
      wLedEls.forEach((e, k) => e.setAttribute('fill', rpmFrac > 0.62 + k * 0.035 ? (k < 4 ? '#00ff66' : k < 7 ? '#ff2020' : '#3d7bff') : '#222'));
      $('rc-thr').style.setProperty('--v', input.throttle);
      $('rc-brk').style.setProperty('--v', input.brake);
      $('rc-time').textContent = fmt((raceT - player.lapStart) * 1000);
      const order = standings();
      $('rc-pos').textContent = `P${order.indexOf(player) + 1}`;
      $('rc-lap').textContent = String(Math.min(LAPS, Math.max(1, player.lap + 1)));
      drawMap();
    }
    const svg = $('rc-wheel').firstElementChild;
    svg.style.transform = `rotate(${(-input.steer * 120 + (Math.random() - 0.5) * (shake + impact) * 6).toFixed(2)}deg)`;
    render();
  }
  function updateCarVisual(c, dt) {
    c.group.position.set(c.x, 0, c.z);
    c.group.rotation.y = c.h;
    // chassis roll / pitch from accelerations (player) or curvature (AI)
    const ay = c.ai ? c.v * c.v * (T.k[c.idx] || 0) : c.ay || 0;
    const ax = c.ai ? 0 : c.ax || 0;
    c.chassis.rotation.z = lerp(c.chassis.rotation.z, clamp(-ay * 0.0016, -0.03, 0.03), 1 - Math.exp(-dt * 8));
    c.chassis.rotation.x = lerp(c.chassis.rotation.x, clamp(ax * 0.0012, -0.025, 0.025), 1 - Math.exp(-dt * 8));
    const v = c.ai ? c.v : c.u;
    c.wheelSpin += (v * dt) / Math.max(0.2, c.tpl.wheelR);
    for (const w of c.wheels) { w.rotation.x = c.wheelSpin; }
    for (const w of c.front) w.rotation.y = c.steer;
  }
  function updateCamera(dt) {
    const p = player;
    const speed = Math.abs(p.u);
    if (!look.drag) { look.yaw *= Math.exp(-dt * 2.2); look.pitch *= Math.exp(-dt * 2.2); }
    const sh = (shake + impact * 0.8);
    const jitter = () => (Math.random() - 0.5) * sh;
    if (state === 'intro') {
      const t = clamp(introT / 2.6, 0, 1), e = t * t * (3 - 2 * t);
      const back = 9.5;
      tmp.set(p.x - Math.sin(p.h) * back, 3.1, p.z - Math.cos(p.h) * back);
      const sx = p.x + Math.sin(p.h + 1.2) * 30, sz = p.z + Math.cos(p.h + 1.2) * 30;
      camera.position.set(lerp(sx, tmp.x, e), lerp(14, tmp.y, e), lerp(sz, tmp.z, e));
      camera.lookAt(p.x, 1, p.z);
      camPos.copy(camera.position);
      camLook.set(p.x, 1, p.z);
      return;
    }
    if (camMode === 2) {
      orbit.target.lerp(tmp.set(p.x, 1.2, p.z), 1 - Math.exp(-dt * 8));
      orbit.update();
      camera.fov = 55; camera.updateProjectionMatrix();
      return;
    }
    if (camMode === 0) {
      const back = 9.6 + speed * 0.022, height = 3.0 + look.pitch * 6;
      const yaw = p.h + look.yaw;
      tmp.set(p.x - Math.sin(yaw) * back, height, p.z - Math.cos(yaw) * back);
      camPos.lerp(tmp, 1 - Math.exp(-dt * 7));
      camera.position.copy(camPos);
      camera.position.x += jitter() * 0.35; camera.position.y += jitter() * 0.25;
      camLook.set(p.x + Math.sin(p.h) * 4, 1.1, p.z + Math.cos(p.h) * 4);
      camera.lookAt(camLook);
      camera.fov = lerp(camera.fov, 60 + clamp(speed / 90, 0, 1) * 14, 1 - Math.exp(-dt * 3));
      camera.updateProjectionMatrix();
    } else {
      p.group.updateMatrixWorld(true);
      tmp.copy(p.tpl.eye).applyMatrix4(p.group.matrixWorld);
      camera.position.copy(tmp);
      camera.position.y += jitter() * 0.05;
      const yaw = p.h + look.yaw;
      fwd.set(Math.sin(yaw), -0.06 - look.pitch * 0.5 + jitter() * 0.02, Math.cos(yaw));
      camera.lookAt(tmp.add(fwd));
      camera.rotateZ(clamp(-(p.ay || 0) * 0.002, -0.05, 0.05));
      camera.fov = lerp(camera.fov, 72 + clamp(speed / 90, 0, 1) * 8, 1 - Math.exp(-dt * 3));
      camera.updateProjectionMatrix();
    }
  }
  function render() {
    // keep the shadow camera on the player
    const p = player || { x: T.px[START], z: T.pz[START] };
    sun.position.set(p.x + SUN_DIR.x * 160, SUN_DIR.y * 160, p.z + SUN_DIR.z * 160);
    sun.target.position.set(p.x, 0, p.z);
    sky.position.copy(camera.position);
    if (fx) fx.render(); else renderer.render(scene, camera);
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    fx?.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  document.addEventListener('visibilitychange', () => { if (document.hidden && ['intro', 'lights', 'race'].includes(state)) togglePause(); });

  if (new URLSearchParams(location.search).has('debug')) window.__race = { get state() { return state; }, input, get player() { return player; }, startRace, keys, cycleCam, togglePause, choose: (id) => { choice = TEAMS.find((t) => t.id === id) || choice; } };

  return {
    resume() {
      if (running) return;
      running = true;
      clock.getDelta();
      renderer.setAnimationLoop(frame);
      resize();
    },
    pause() {
      if (!running) return;
      running = false;
      if (['intro', 'lights', 'race'].includes(state)) togglePause();
      renderer.setAnimationLoop(null);
      audio.suspend();
    },
  };
}
