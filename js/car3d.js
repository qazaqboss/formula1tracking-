// Procedural 3D model of the #12 Mercedes (Kimi Antonelli livery colours: black body,
// silver nose, teal accents, yellow-wall tyres). Exploded "anatomy" view with part labels,
// an x-ray mode, wind-tunnel airflow and a moving neon floor.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { createBloom, lowPower } from './fx.js';

const TEAL = 0x00d2be;
const CYAN = 0x00f0ff;
const MAGENTA = 0xff2bd6;
const BG = 0x05060b;

export function initCar(canvas, labelLayer, explodeBtn, xrayBtn) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.055);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  camera.position.set(8.4, 3.2, 8.2);
  const fx = createBloom(renderer, scene, camera, { strength: 0.55, radius: 0.4, threshold: 0.85 });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 3.5;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;
  controls.enablePan = false;
  controls.enableZoom = !lowPower;
  controls.target.set(0.1, 0.4, 0);
  canvas.style.touchAction = 'pan-y';

  scene.add(new THREE.HemisphereLight(0x9fd8ff, 0x101018, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(4, 7, 5);
  scene.add(key);
  const rimT = new THREE.PointLight(TEAL, 5, 14);
  rimT.position.set(-3, 1.8, -3);
  scene.add(rimT);
  const rimM = new THREE.PointLight(MAGENTA, 4, 14);
  rimM.position.set(3, 1.2, -3.5);
  scene.add(rimM);

  // floor: reflective-looking dark disc + moving neon grid
  const floor = new THREE.Group();
  const grid = new THREE.GridHelper(60, 120, MAGENTA, 0x1a2140);
  grid.material.transparent = true;
  grid.material.opacity = 0.3;
  floor.add(grid);
  scene.add(floor);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(4.2, 96), new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.2, roughness: 0.6 }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.002;
  scene.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.15, 4.22, 160), new THREE.MeshBasicMaterial({ color: TEAL, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);
  const ring2 = new THREE.Mesh(ring.geometry, new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, side: THREE.DoubleSide }));
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.012;
  scene.add(ring2);

  // ---------- livery materials ----------
  const M = {
    black: new THREE.MeshPhysicalMaterial({ color: 0x050607, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 }),
    silver: new THREE.MeshPhysicalMaterial({ color: 0xc3c9d1, metalness: 1, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 }),
    teal: new THREE.MeshStandardMaterial({ color: TEAL, emissive: TEAL, emissiveIntensity: 0.25, metalness: 0.2, roughness: 0.35 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x0c0d10, metalness: 0.3, roughness: 0.6 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0, roughness: 0.92 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xffd200, emissive: 0x806400, emissiveIntensity: 0.1, roughness: 0.5 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.9, roughness: 0.3 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 1, roughness: 0.05, clearcoat: 1 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xffe600, metalness: 0.2, roughness: 0.25, clearcoat: 1 }),
    engine: new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 1, roughness: 0.35 }),
    glow: new THREE.MeshStandardMaterial({ color: 0xffb000, emissive: 0xff7a00, emissiveIntensity: 2 }),
    light: new THREE.MeshStandardMaterial({ color: 0xff0020, emissive: 0xff0020, emissiveIntensity: 3 }),
  };
  // x-ray look
  const X = {
    shell: new THREE.MeshPhysicalMaterial({ color: 0x0a1426, metalness: 0.3, roughness: 0.25, transparent: true, opacity: 0.22, emissive: 0x041a2e, side: THREE.DoubleSide, depthWrite: false }),
    edge: new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9 }),
  };

  const numberTex = (text, sub) => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#0a0b0e'; g.fillRect(0, 0, 512, 256);
    g.font = '900 190px Orbitron, Arial Black, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#00d2be'; g.strokeText(text, 256, sub ? 110 : 132);
    g.fillStyle = '#ffffff'; g.fillText(text, 256, sub ? 110 : 132);
    if (sub) { g.font = '700 44px Orbitron, Arial, sans-serif'; g.fillStyle = '#00d2be'; g.fillText(sub, 256, 222); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const decal = (tex, w, h) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.2, transparent: true }));

  const car = new THREE.Group();
  scene.add(car);
  const parts = [];
  const allMeshes = [];

  function addPart(name, label, build, explode, labelOffset = new THREE.Vector3(0, 0.3, 0)) {
    const g = new THREE.Group();
    build(g);
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false;
      o.userData.mat = o.material;
      if (!o.userData.noEdges) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 28), X.edge);
        e.visible = false;
        o.add(e);
        o.userData.edges = e;
      }
      allMeshes.push(o);
    });
    car.add(g);
    parts.push({ name, label, group: g, explode: explode.clone(), home: g.position.clone(), labelOffset });
    return g;
  }
  const mesh = (geo, mat, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    return m;
  };
  // side-profile extrusion centred on z
  const profile = (pts, depth, bevel = 0.04) => {
    const sh = new THREE.Shape();
    sh.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 12 });
    geo.translate(0, 0, -depth / 2);
    return geo;
  };

  // ---------- nose ----------
  addPart('nose', 'Носовой обтекатель · краш-структура', (g) => {
    g.add(mesh(profile([[3.3, 0.17], [3.3, 0.27], [2.6, 0.36], [1.5, 0.5], [1.3, 0.5], [1.3, 0.2]], 0.22, 0.06), M.silver));
    for (const s of [-1, 1]) {
      const stripe = mesh(new THREE.BoxGeometry(1.7, 0.03, 0.01), M.teal, 2.25, 0.34, s * 0.145);
      stripe.rotation.z = 0.12;
      stripe.userData.noEdges = true;
      g.add(stripe);
    }
    const n = decal(numberTex('12'), 0.36, 0.18);
    n.rotation.x = -Math.PI / 2;
    n.rotation.z = -Math.PI / 2;
    n.position.set(2.05, 0.465, 0);
    n.rotation.y = 0.14;
    n.userData.noEdges = true;
    g.add(n);
  }, new THREE.Vector3(0.9, 0.35, 0), new THREE.Vector3(0.6, 0.25, 0));

  // ---------- monocoque / cockpit ----------
  addPart('chassis', 'Монокок · карбон', (g) => {
    g.add(mesh(profile([[1.5, 0.2], [1.5, 0.52], [0.85, 0.68], [0.65, 0.74], [-0.15, 0.74], [-0.25, 0.2]], 0.6, 0.06), M.black));
    const silverTop = mesh(profile([[1.5, 0.5], [0.9, 0.66], [0.85, 0.69], [1.5, 0.53]], 0.5, 0.02), M.silver);
    g.add(silverTop);
    const cockpit = mesh(new THREE.SphereGeometry(0.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.carbon, 0.25, 0.7, 0);
    cockpit.scale.set(1.5, 0.35, 0.8);
    cockpit.rotation.x = Math.PI;
    g.add(cockpit);
    for (const s of [-1, 1]) {
      const name = decal(numberTex('ANTONELLI'), 0.5, 0.1);
      name.position.set(0.55, 0.6, s * 0.335);
      name.rotation.y = s > 0 ? 0 : Math.PI;
      name.userData.noEdges = true;
      g.add(name);
    }
  }, new THREE.Vector3(0, 0.75, 0), new THREE.Vector3(0.6, 0.3, 0));

  addPart('driver', 'Пилот · шлем №12', (g) => {
    const helmet = mesh(new THREE.SphereGeometry(0.155, 28, 20), M.helmet, 0.22, 0.83, 0);
    helmet.scale.set(1.12, 1, 0.95);
    g.add(helmet);
    const visor = mesh(new THREE.SphereGeometry(0.157, 28, 12, -0.9, 1.8, 1.15, 0.45), M.visor, 0.22, 0.83, 0);
    visor.scale.set(1.12, 1, 0.95);
    visor.userData.noEdges = true;
    g.add(visor);
    const stripe = mesh(new THREE.TorusGeometry(0.152, 0.012, 6, 40), new THREE.MeshStandardMaterial({ color: TEAL, roughness: 0.4 }), 0.22, 0.86, 0);
    stripe.rotation.x = Math.PI / 2;
    stripe.userData.noEdges = true;
    g.add(stripe);
  }, new THREE.Vector3(0, 1.7, 0), new THREE.Vector3(0, 0.3, 0));

  addPart('halo', 'Halo · титан', (g) => {
    const arc = mesh(new THREE.TorusGeometry(0.4, 0.035, 12, 48, Math.PI), M.black, 0.2, 0.97, 0);
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = Math.PI / 2;
    arc.scale.set(1, 0.8, 1);
    g.add(arc);
    const strut = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.34, 10), M.black, 0.66, 0.84, 0);
    strut.rotation.z = -0.75;
    g.add(strut);
    for (const s of [-1, 1]) {
      const leg = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), M.black, -0.16, 0.84, s * 0.32);
      g.add(leg);
      const mirror = mesh(new THREE.BoxGeometry(0.12, 0.06, 0.16), M.black, 0.62, 0.78, s * 0.52);
      g.add(mirror);
      const glass = mesh(new THREE.PlaneGeometry(0.14, 0.05), M.visor, 0.56, 0.78, s * 0.52);
      glass.rotation.y = -Math.PI / 2;
      glass.userData.noEdges = true;
      g.add(glass);
    }
  }, new THREE.Vector3(0.3, 1.2, 0), new THREE.Vector3(0.4, 0.25, 0));

  // ---------- engine cover, airbox, fin ----------
  addPart('cover', 'Воздухозаборник · кожух двигателя', (g) => {
    g.add(mesh(profile([[-0.05, 0.6], [-0.05, 1.07], [-0.5, 1.1], [-1.5, 0.78], [-2.3, 0.52], [-2.4, 0.42], [-2.4, 0.3], [-0.2, 0.45]], 0.42, 0.06), M.black));
    const inlet = mesh(new THREE.BoxGeometry(0.06, 0.2, 0.22), M.carbon, -0.03, 0.93, 0);
    inlet.userData.noEdges = true;
    g.add(inlet);
    const fin = mesh(profile([[-0.55, 1.08], [-2.15, 0.95], [-2.15, 0.62], [-1.5, 0.82]], 0.012, 0.004), M.black);
    g.add(fin);
    for (const s of [-1, 1]) {
      const n = decal(numberTex('12'), 0.36, 0.18);
      n.position.set(-1.75, 0.86, s * 0.012);
      n.rotation.y = s > 0 ? 0 : Math.PI;
      n.userData.noEdges = true;
      g.add(n);
      // teal "feather" accents along the engine cover
      for (let i = 0; i < 5; i++) {
        const st = mesh(new THREE.BoxGeometry(0.22, 0.012, 0.01), M.teal, -1.0 - i * 0.24, 0.76 - i * 0.06, s * 0.27);
        st.rotation.z = 0.32;
        st.userData.noEdges = true;
        g.add(st);
      }
    }
    // camera "T-bar" in yellow, like the photo
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.04, 0.2), M.yellow, -0.12, 1.17, 0));
  }, new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(-0.4, 0.45, 0));

  addPart('engine', 'Силовая установка · 1.6 V6 турбо-гибрид', (g) => {
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.32, 0.36), M.engine, -0.95, 0.45, 0));
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const head = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.26, 14), M.engine, -0.65 - i * 0.24, 0.66, s * 0.13);
        head.rotation.x = s * 0.55;
        g.add(head);
        const plug = mesh(new THREE.SphereGeometry(0.03, 8, 8), M.glow, -0.65 - i * 0.24, 0.78, s * 0.2);
        plug.userData.noEdges = true;
        g.add(plug);
      }
    }
    const turbo = mesh(new THREE.TorusGeometry(0.12, 0.05, 12, 28), M.glow, -1.55, 0.48, 0);
    turbo.rotation.y = Math.PI / 2;
    g.add(turbo);
    const ers = mesh(new THREE.BoxGeometry(0.35, 0.16, 0.3), M.rim, -0.3, 0.32, 0);
    g.add(ers);
    const gearbox = mesh(new THREE.BoxGeometry(0.75, 0.22, 0.26), M.carbon, -2.0, 0.33, 0);
    g.add(gearbox);
  }, new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(-0.2, 0.45, 0));

  // ---------- sidepods ----------
  for (const s of [-1, 1]) {
    addPart(`sidepod${s}`, s > 0 ? 'Понтон · радиаторы' : '', (g) => {
      const pod = mesh(profile([[0.6, 0.2], [0.6, 0.58], [0.3, 0.64], [-0.6, 0.6], [-1.45, 0.42], [-2.0, 0.26], [-2.0, 0.2]], 0.36, 0.08), M.black, 0, 0, s * 0.5);
      g.add(pod);
      const inlet = mesh(new THREE.BoxGeometry(0.05, 0.22, 0.3), M.carbon, 0.66, 0.44, s * 0.52);
      inlet.userData.noEdges = true;
      g.add(inlet);
      const stripe = mesh(new THREE.BoxGeometry(2.2, 0.025, 0.012), M.teal, -0.6, 0.47, s * 0.7);
      stripe.rotation.z = 0.1;
      stripe.userData.noEdges = true;
      g.add(stripe);
      const radiator = mesh(new THREE.BoxGeometry(0.7, 0.28, 0.06), M.engine, -0.25, 0.4, s * 0.48);
      radiator.userData.noEdges = true;
      g.add(radiator);
    }, new THREE.Vector3(0, 0.25, s * 1.4), new THREE.Vector3(0, 0.4, s * 0.25));
  }

  // ---------- floor ----------
  addPart('floor', 'Днище · граунд-эффект · диффузор', (g) => {
    const shape = new THREE.Shape();
    shape.moveTo(1.3, -0.4); shape.lineTo(1.3, 0.4); shape.lineTo(0.7, 0.82); shape.lineTo(-1.6, 0.86);
    shape.lineTo(-2.2, 0.62); shape.lineTo(-2.5, 0.5); shape.lineTo(-2.5, -0.5); shape.lineTo(-2.2, -0.62); shape.lineTo(-1.6, -0.86); shape.lineTo(0.7, -0.82); shape.closePath();
    const fl = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }), M.carbon, 0, 0.16, 0);
    fl.rotation.x = Math.PI / 2;
    g.add(fl);
    for (const s of [-1, 1]) {
      const edge = mesh(new THREE.BoxGeometry(2.3, 0.05, 0.02), M.silver, -0.45, 0.15, s * 0.86);
      edge.userData.noEdges = true;
      g.add(edge);
    }
    for (let i = -2; i <= 2; i++) {
      const strake = mesh(new THREE.BoxGeometry(0.55, 0.2, 0.012), M.carbon, -2.25, 0.22, i * 0.18);
      strake.rotation.z = -0.4;
      g.add(strake);
    }
  }, new THREE.Vector3(0, -0.9, 0), new THREE.Vector3(-1.6, 0.1, 0.8));

  // ---------- front wing ----------
  addPart('frontwing', 'Переднее антикрыло', (g) => {
    const els = [[3.32, 0.1, 0.32, 0.03], [3.12, 0.16, 0.24, 0.2], [2.95, 0.22, 0.18, 0.38]];
    els.forEach(([x, y, w, a], i) => {
      const el = mesh(new THREE.BoxGeometry(w, 0.018, 1.9 - i * 0.06), M.black, x, y, 0);
      el.rotation.z = a;
      g.add(el);
      const lead = mesh(new THREE.BoxGeometry(0.02, 0.022, 1.9 - i * 0.06), i === 2 ? M.teal : M.silver, x + w / 2 - 0.01, y + Math.sin(a) * w / 2, 0);
      lead.userData.noEdges = true;
      g.add(lead);
    });
    for (const s of [-1, 1]) {
      g.add(mesh(new THREE.BoxGeometry(0.55, 0.3, 0.02), M.black, 3.08, 0.22, s * 0.96));
      const top = mesh(new THREE.BoxGeometry(0.55, 0.02, 0.025), M.teal, 3.08, 0.37, s * 0.96);
      top.userData.noEdges = true;
      g.add(top);
      g.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.02), M.black, 2.85, 0.24, s * 0.09));
    }
  }, new THREE.Vector3(0.75, -0.05, 0), new THREE.Vector3(0.3, 0.3, 0));

  // ---------- rear wing ----------
  let drsFlap, rainLight;
  addPart('rearwing', 'Заднее антикрыло · DRS', (g) => {
    const main = mesh(new THREE.BoxGeometry(0.38, 0.03, 0.98), M.black, -2.6, 0.98, 0);
    main.rotation.z = -0.12;
    g.add(main);
    drsFlap = new THREE.Group();
    drsFlap.position.set(-2.42, 1.08, 0);
    const flap = mesh(new THREE.BoxGeometry(0.24, 0.02, 0.98), M.black, -0.12, 0, 0);
    drsFlap.add(flap);
    const flapEdge = mesh(new THREE.BoxGeometry(0.02, 0.024, 0.98), M.teal, -0.24, 0, 0);
    flapEdge.userData.noEdges = true;
    drsFlap.add(flapEdge);
    g.add(drsFlap);
    for (const s of [-1, 1]) {
      g.add(mesh(profile([[-2.25, 0.4], [-2.25, 1.22], [-2.95, 1.22], [-2.95, 0.62]], 0.022, 0.006), M.black, 0, 0, s * 0.5));
      const top = mesh(new THREE.BoxGeometry(0.7, 0.03, 0.03), M.teal, -2.6, 1.23, s * 0.5);
      top.userData.noEdges = true;
      g.add(top);
    }
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.9), M.black, -2.55, 0.42, 0)); // beam wing
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.55, 0.05), M.carbon, -2.5, 0.68, 0)); // pylon
    rainLight = mesh(new THREE.BoxGeometry(0.03, 0.06, 0.12), M.light, -2.62, 0.34, 0);
    rainLight.userData.noEdges = true;
    g.add(rainLight);
  }, new THREE.Vector3(-0.9, 0.7, 0), new THREE.Vector3(-0.1, 0.4, 0));

  // ---------- wheels (Pirelli-style yellow sidewall band) ----------
  const spinners = [];
  const wheels = [
    [1.85, 0.33, 0.82, 0.33, 0.32, 'Передние шины · 18"'], [1.85, 0.33, -0.82, 0.33, 0.32, ''],
    [-1.62, 0.36, 0.8, 0.36, 0.4, 'Задние шины · 18"'], [-1.62, 0.36, -0.8, 0.36, 0.4, ''],
  ];
  wheels.forEach(([x, y, z, r, w, label], i) => {
    addPart(`wheel${i}`, label, (g) => {
      const wheel = new THREE.Group();
      wheel.position.set(x, y, z);
      const sz = Math.sign(z);
      const tread = mesh(new THREE.CylinderGeometry(r, r, w - 0.06, 40, 1, true), M.tyre);
      tread.rotation.x = Math.PI / 2;
      wheel.add(tread);
      for (const side of [-1, 1]) {
        const shoulder = mesh(new THREE.TorusGeometry(r - 0.03, 0.03, 10, 48), M.tyre, 0, 0, side * (w / 2 - 0.03));
        shoulder.userData.noEdges = true;
        wheel.add(shoulder);
        const wall = mesh(new THREE.RingGeometry(0.21, r - 0.03, 48), M.tyre, 0, 0, side * (w / 2));
        wall.rotation.y = side > 0 ? 0 : Math.PI;
        wall.userData.noEdges = true;
        wheel.add(wall);
      }
      const band = mesh(new THREE.RingGeometry(r - 0.09, r - 0.065, 64), M.yellow, 0, 0, sz * (w / 2 + 0.002));
      band.rotation.y = sz > 0 ? 0 : Math.PI;
      band.userData.noEdges = true;
      wheel.add(band);
      const rimDisc = mesh(new THREE.CylinderGeometry(0.21, 0.21, w - 0.04, 32), M.rim);
      rimDisc.rotation.x = Math.PI / 2;
      wheel.add(rimDisc);
      const cover = mesh(new THREE.CircleGeometry(0.2, 32), M.black, 0, 0, sz * (w / 2 - 0.01));
      cover.rotation.y = sz > 0 ? 0 : Math.PI;
      cover.userData.noEdges = true;
      wheel.add(cover);
      for (let k = 0; k < 5; k++) {
        const sp = mesh(new THREE.BoxGeometry(0.18, 0.02, 0.01), M.teal, 0, 0, sz * (w / 2));
        sp.rotation.z = (k / 5) * Math.PI * 2;
        sp.position.x = Math.cos(sp.rotation.z) * 0.09;
        sp.position.y = Math.sin(sp.rotation.z) * 0.09;
        sp.userData.noEdges = true;
        wheel.add(sp);
      }
      g.add(wheel);
      spinners.push(wheel);
      // wishbones + push/pull rod
      const inner = x > 0 ? 1.4 : -1.25;
      for (const [dy, dx] of [[-0.1, 0.18], [-0.1, -0.18], [0.14, 0.15], [0.14, -0.15]]) {
        const a = new THREE.Vector3(inner + dx, y + dy * 0.6, sz * 0.3);
        const b = new THREE.Vector3(x, y + dy, z - sz * (w / 2 + 0.02));
        const len = a.distanceTo(b);
        const arm = mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 6), M.black);
        arm.position.copy(a).add(b).multiplyScalar(0.5);
        arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        arm.userData.noEdges = true;
        g.add(arm);
      }
    }, new THREE.Vector3(Math.sign(x) * 0.5, 0, Math.sign(z) * 1.25), new THREE.Vector3(0, 0.5, Math.sign(z) * 0.2));
  });

  // ---------- wind-tunnel airflow ----------
  const N = lowPower ? 600 : 1400;
  const flow = new Float32Array(N * 4);
  const flowPos = new Float32Array(N * 6);
  const flowCol = new Float32Array(N * 6);
  const resetP = (i, xStart) => {
    flow[i * 4] = xStart ?? 7 + Math.random() * 2;
    flow[i * 4 + 1] = 0.08 + Math.random() * 1.6;
    flow[i * 4 + 2] = (Math.random() - 0.5) * 3.2;
    flow[i * 4 + 3] = 7 + Math.random() * 5;
  };
  for (let i = 0; i < N; i++) resetP(i, -7 + Math.random() * 14);
  const flowGeo = new THREE.BufferGeometry();
  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
  flowGeo.setAttribute('color', new THREE.BufferAttribute(flowCol, 3));
  const flowLines = new THREE.LineSegments(flowGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  flowLines.frustumCulled = false;
  scene.add(flowLines);
  const heightAt = (x) => (x > 3.35 || x < -2.95 ? 0 : x > 1.5 ? 0.45 : x > 0.7 ? 0.7 : x > -0.5 ? 1.15 : x > -2.2 ? 0.95 : 1.25);
  const cA = new THREE.Color(TEAL), cB = new THREE.Color(MAGENTA), cT = new THREE.Color();
  function updateFlow(dt, intensity) {
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      flow[o] -= flow[o + 3] * dt;
      if (flow[o] < -7) resetP(i);
      const x = flow[o], y0 = flow[o + 1], z0 = flow[o + 2];
      let y = y0, z = z0, heat = 0;
      const az = Math.abs(z0), h = heightAt(x);
      if (h && az < 0.55 && y0 < h + 0.35) { y = Math.max(y0, h + 0.06 + (y0 / (h + 0.35)) * 0.3); heat = 1 - (y0 / (h + 0.35)) * 0.6; }
      else if (h && az < 1.2 && y0 < 0.7 && x < 1.0 && x > -2.0) { z = Math.sign(z0) * Math.max(az, 0.95 + az * 0.2); heat = 0.6; }
      if (x < -2.95 && x > -6 && az < 0.6 && y0 > 0.8) { const a = (x + 2.95) * 3 + i; y += Math.sin(a) * 0.12; z += Math.cos(a) * 0.12; heat = 0.8; }
      const len = 0.18 + heat * 0.35, p = i * 6;
      flowPos[p] = x; flowPos[p + 1] = y; flowPos[p + 2] = z;
      flowPos[p + 3] = x + len; flowPos[p + 4] = y; flowPos[p + 5] = z;
      cT.copy(cA).lerp(cB, heat).multiplyScalar(intensity * (0.3 + heat * 0.8));
      flowCol[p] = cT.r; flowCol[p + 1] = cT.g; flowCol[p + 2] = cT.b;
      flowCol[p + 3] = 0; flowCol[p + 4] = 0; flowCol[p + 5] = 0;
    }
    flowGeo.attributes.position.needsUpdate = true;
    flowGeo.attributes.color.needsUpdate = true;
  }

  // ---------- labels ----------
  const labels = parts.filter((p) => p.label).map((p) => {
    const el = document.createElement('div');
    el.className = 'part-label';
    el.textContent = p.label;
    labelLayer.appendChild(el);
    return { el, part: p };
  });

  let exploded = 0, target = 0, xray = false;
  explodeBtn?.addEventListener('click', () => {
    target = target ? 0 : 1;
    explodeBtn.textContent = target ? 'Собрать болид' : 'Разобрать болид';
  });
  function setXray(on) {
    xray = on;
    for (const m of allMeshes) {
      m.material = on ? (m.userData.mat === M.glow || m.userData.mat === M.teal ? m.userData.mat : X.shell) : m.userData.mat;
      if (m.userData.edges) m.userData.edges.visible = on;
    }
    fx.bloom.threshold = on ? 0.25 : 0.85;
    fx.bloom.strength = on ? 0.8 : 0.55;
    if (xrayBtn) xrayBtn.textContent = on ? 'Ливрея' : 'Рентген';
  }
  xrayBtn?.addEventListener('click', () => setXray(!xray));

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    fx.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 50 : 34;
    // phones are tall and narrow: back the camera off so the whole car fits
    camera.position.setLength(camera.aspect < 0.8 ? 16 : 12);
    if (w > 900) camera.setViewOffset(w, h, -w * 0.15, 0, w, h);
    else camera.setViewOffset(w, h, 0, -h * 0.22, w, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const tmp = new THREE.Vector3();
  const box = new THREE.Box3();
  const clock = new THREE.Clock();
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);

  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!visible || document.hidden) return;
    const t = clock.elapsedTime;
    exploded += (target - exploded) * Math.min(1, dt * 3);
    const e = exploded * exploded * (3 - 2 * exploded);
    for (const p of parts) p.group.position.copy(p.home).addScaledVector(p.explode, e * 0.85);
    const speed = 1 - e * 0.9;
    for (const w of spinners) w.rotation.z -= dt * 24 * speed;
    floor.position.x = -((t * 9 * speed) % 0.5);
    car.position.y = Math.sin(t * 11) * 0.004 * speed;
    drsFlap.rotation.z = Math.sin(t * 0.5) > 0.55 ? 0.45 : 0;
    rainLight.visible = Math.sin(t * 12) > 0;
    updateFlow(dt * speed, 1 - e * 0.75);
    ring2.scale.setScalar(1 + ((t * 0.4) % 1) * 0.5);
    ring2.material.opacity = 0.6 * (1 - ((t * 0.4) % 1));
    controls.update();
    fx.render();

    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const { el, part } of labels) {
      box.setFromObject(part.group).getCenter(tmp).add(part.labelOffset);
      tmp.project(camera);
      el.style.opacity = tmp.z < 1 && e > 0.05 ? Math.min(1, e * 1.5) : 0;
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w + 14}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translateY(-50%)`;
    }
  });
}
