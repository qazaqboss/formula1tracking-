// 3D model of the #12 Mercedes (Kimi Antonelli): a baked PBR mesh (models/mercedes12.glb)
// repainted in the black / silver / teal livery, no sponsor logos. The mesh is split into
// nodes (body, wings, halo, four wheels) for the exploded "anatomy" view; plus an x-ray mode,
// wind-tunnel airflow and a moving neon floor.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from './vendor/jsm/environments/RoomEnvironment.js';
import { createBloom, lowPower } from './fx.js?v=202611082341';

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

  // x-ray look
  const X = {
    shell: new THREE.MeshPhysicalMaterial({ color: 0x0a1426, metalness: 0.3, roughness: 0.25, transparent: true, opacity: 0.22, emissive: 0x041a2e, side: THREE.DoubleSide, depthWrite: false }),
    edge: new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9 }),
  };

  // soft contact shadow
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  })();
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 2.9), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.2, 0.015, 0);
  scene.add(shadow);

  const car = new THREE.Group();
  scene.add(car);
  const parts = [];
  const allMeshes = [];
  const spinners = [];

  // node name in the GLB -> label + explode direction (world space, nose points to +X)
  const PARTS = {
    body: ['Монокок · понтоны · днище', new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.2, 0.55, 0)],
    frontwing: ['Переднее антикрыло', new THREE.Vector3(1.0, -0.05, 0), new THREE.Vector3(0.2, 0.3, 0)],
    rearwing: ['Заднее антикрыло · DRS', new THREE.Vector3(-1.0, 0.75, 0), new THREE.Vector3(0, 0.55, 0)],
    halo: ['Halo · титан', new THREE.Vector3(0.2, 1.3, 0), new THREE.Vector3(0, 0.3, 0)],
    wheelFL: ['', null],
    wheelFR: ['Передние шины · 18"', null, new THREE.Vector3(0, 0.55, 0)],
    wheelRL: ['', null],
    wheelRR: ['Задние шины · 18"', null, new THREE.Vector3(0, 0.6, 0)],
  };

  // ---------- selectable cars: same chassis, two liveries ----------
  const CARS = {
    mercedes: {
      file: 'mercedes12.glb', accent: TEAL, title: 'Mercedes', sub: '№12 · Антонелли', num: '12',
      lead: 'Андреа Кими Антонелли. Детализированная 3D-модель в ливрее чёрный · серебро · бирюза. Разберите болид на узлы — монокок с понтонами, Halo, переднее и заднее антикрылья, колёса. Режим рентгена показывает каркас.',
    },
    ferrari: {
      file: 'ferrari16.glb', accent: 0xff1e1e, title: 'Ferrari', sub: '№16 · Леклер', num: '16',
      lead: 'Шарль Леклер. Та же детализированная модель в ливрее красный · чёрный · белый. Разберите болид на узлы или включите рентген, вращайте и приближайте.',
    },
  };
  const loader = new GLTFLoader();
  const cache = new Map(); // car id -> Promise<{ model, parts, meshes, spinners }>
  let current = null;
  let loadToken = 0;

  function prepare(gltf) {
    const model = gltf.scene;
    // GLB is Y-up with the nose along +Z: turn it to face +X and scale to the scene (~6.3 m stage)
    model.rotation.y = Math.PI / 2;
    model.scale.setScalar(1.72);
    model.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(model);
    const c = bb.getCenter(new THREE.Vector3());
    model.position.x += 0.2 - c.x;
    model.position.z -= c.z;
    model.position.y -= bb.min.y;
    model.updateMatrixWorld(true);

    const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const meshes = [], spin = [], list = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].anisotropy = maxAniso;
      m.envMapIntensity = 2.2;
      if ('clearcoat' in m) { m.clearcoat = Math.max(m.clearcoat, 0.6); m.clearcoatRoughness = 0.08; }
      const geo = o.geometry;
      if (o.name.startsWith('wheel')) {
        // pivot each wheel on its own axle so it can spin
        geo.computeBoundingBox();
        const ctr = geo.boundingBox.getCenter(new THREE.Vector3());
        geo.translate(-ctr.x, -ctr.y, -ctr.z);
        o.position.add(ctr);
        spin.push(o);
      }
      o.userData.mat = m;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), X.edge);
      e.visible = false;
      o.add(e);
      o.userData.edges = e;
      meshes.push(o);
    });
    model.updateMatrixWorld(true);
    for (const o of [...model.children]) {
      const def = PARTS[o.name];
      if (!def) continue;
      const wc = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      const explodeWorld = def[1] ?? new THREE.Vector3(Math.sign(wc.x - 0.2) * 0.5, 0, Math.sign(wc.z) * 1.35);
      // explode offsets are given in world space; convert to the model's local frame
      const local = explodeWorld.clone().applyQuaternion(model.quaternion.clone().invert()).divideScalar(model.scale.x);
      list.push({ name: o.name, label: def[0], group: o, explode: local, home: o.position.clone(), labelOffset: def[2] ?? new THREE.Vector3(0, 0.4, 0) });
    }
    return { model, parts: list, meshes, spinners: spin };
  }

  function loadCar(id) {
    if (!cache.has(id)) {
      const url = new URL(`../models/${CARS[id].file}` + new URL(import.meta.url).search, import.meta.url);
      cache.set(id, loader.loadAsync(url.href).then(prepare));
      cache.get(id).catch(() => cache.delete(id));
    }
    return cache.get(id);
  }

  const pick = document.getElementById('car-pick');
  const hero = canvas.parentElement;
  function setCopy(id) {
    const c = CARS[id];
    const q = (sel) => hero?.querySelector(sel);
    if (q('.hero-copy h1.glitch')) q('.hero-copy h1.glitch').textContent = c.title;
    if (q('.hero-copy .h1-sub')) q('.hero-copy .h1-sub').textContent = c.sub;
    if (q('.hero-copy .lead')) q('.hero-copy .lead').textContent = c.lead;
    if (q('.car-spec b')) q('.car-spec b').textContent = c.num;
    hero?.setAttribute('data-car', id);
    pick?.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.car === id));
    rimT.color.setHex(c.accent);
    ring.material.color.setHex(c.accent);
  }

  async function selectCar(id) {
    if (!CARS[id] || id === current) return;
    current = id;
    try { localStorage.setItem('f1p-car', id); } catch { /* storage blocked */ }
    setCopy(id);
    const token = ++loadToken;
    hero?.classList.add('car-loading');
    try {
      const entry = await loadCar(id);
      if (token !== loadToken) return;
      car.clear();
      car.add(entry.model);
      parts.length = 0; parts.push(...entry.parts);
      allMeshes.length = 0; allMeshes.push(...entry.meshes);
      spinners.length = 0; spinners.push(...entry.spinners);
      buildLabels();
      setXray(xray);
    } catch (err) {
      console.warn('car model failed to load', err);
    } finally {
      if (token === loadToken) hero?.classList.remove('car-loading');
    }
  }
  pick?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-car]');
    if (b) selectCar(b.dataset.car);
  });
  let saved = 'mercedes';
  try { saved = localStorage.getItem('f1p-car') || saved; } catch { /* storage blocked */ }
  queueMicrotask(() => {
    selectCar(CARS[saved] ? saved : 'mercedes');
    // warm the other car in the background so switching is instant
    setTimeout(() => Object.keys(CARS).forEach((k) => loadCar(k).catch(() => {})), 4000);
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
  const heightAt = (x) => (x > 3.35 || x < -2.95 ? 0 : x > 1.6 ? 0.45 : x > 0.6 ? 0.75 : x > -0.4 ? 1.3 : x > -2.2 ? 0.9 : 1.4);
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
  let labels = [];
  function buildLabels() {
    for (const l of labels) l.el.remove();
    labels = parts.filter((p) => p.label).map((p) => {
      const el = document.createElement('div');
      el.className = 'part-label';
      el.textContent = p.label;
      labelLayer.appendChild(el);
      return { el, part: p };
    });
  }

  let exploded = 0, target = 0, xray = false;
  explodeBtn?.addEventListener('click', () => {
    target = target ? 0 : 1;
    explodeBtn.textContent = target ? 'Собрать болид' : 'Разобрать болид';
  });
  function setXray(on) {
    xray = on;
    for (const m of allMeshes) {
      m.material = on ? X.shell : m.userData.mat;
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
    for (const w of spinners) w.rotation.x += dt * 24 * speed;
    floor.position.x = -((t * 9 * speed) % 0.5);
    car.position.y = Math.sin(t * 11) * 0.004 * speed;
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
