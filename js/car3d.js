// Procedural F1 car in a cyberpunk "x-ray anatomy" style: neon wireframe, bloom,
// wind-tunnel airflow streaks, exploded view with part labels.
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createBloom, lowPower } from './fx.js';

const CYAN = 0x00f0ff;
const MAGENTA = 0xff2bd6;
const YELLOW = 0xfcee0a;
const BG = 0x05060b;

export function initCar(canvas, labelLayer, explodeBtn) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(BG, 0.06);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(6.2, 2.6, 7.2);
  const fx = createBloom(renderer, scene, camera, { strength: 0.75, radius: 0.4, threshold: 0.3 });

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.45;
  controls.enablePan = false;
  controls.enableZoom = !lowPower; // pinch-zoom fights page scroll on phones
  controls.target.set(0, 0.5, 0);
  canvas.style.touchAction = 'pan-y';

  scene.add(new THREE.AmbientLight(0x4050ff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.2);
  key.position.set(5, 8, 4);
  scene.add(key);
  const rimM = new THREE.PointLight(MAGENTA, 18, 20);
  rimM.position.set(-4, 2, -3);
  scene.add(rimM);
  const rimC = new THREE.PointLight(CYAN, 14, 20);
  rimC.position.set(4, 1.5, 3);
  scene.add(rimC);

  // moving neon floor (treadmill effect)
  const floor = new THREE.Group();
  const gridA = new THREE.GridHelper(60, 120, MAGENTA, 0x1a2140);
  gridA.material.transparent = true;
  gridA.material.opacity = 0.35;
  floor.add(gridA);
  scene.add(floor);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.6, 3.66, 160),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);
  const ring2 = ring.clone();
  ring2.material = ring.material.clone();
  ring2.material.color.set(MAGENTA);
  scene.add(ring2);

  // materials
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0x0a1426, metalness: 0.3, roughness: 0.25, transparent: true, opacity: 0.3,
    emissive: 0x041a2e, side: THREE.DoubleSide, depthWrite: false,
  });
  const accent = new THREE.MeshStandardMaterial({ color: MAGENTA, emissive: MAGENTA, emissiveIntensity: 1.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0e14, metalness: 0.4, roughness: 0.6, transparent: true, opacity: 0.9 });
  const glowPU = new THREE.MeshStandardMaterial({ color: YELLOW, emissive: 0xffb000, emissiveIntensity: 1.6 });
  const edgeMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.9 });

  const car = new THREE.Group();
  scene.add(car);
  const parts = [];

  function addPart(name, label, build, explode, labelOffset = new THREE.Vector3(0, 0.3, 0)) {
    const g = new THREE.Group();
    build(g);
    g.traverse((o) => {
      if (o.isMesh && !o.userData.noEdges) o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), edgeMat));
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

  addPart('chassis', 'Монокок · карбон', (g) => {
    g.add(mesh(new THREE.BoxGeometry(2.2, 0.55, 0.75), shell, 0.3, 0.5, 0));
    const nose = mesh(new THREE.CylinderGeometry(0.08, 0.32, 1.9, 16), shell, 2.3, 0.42, 0);
    nose.rotation.z = Math.PI / 2;
    nose.scale.set(1, 1, 0.75);
    g.add(nose);
    const cockpit = mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 32, Math.PI * 1.2), accent, 0.15, 0.8, 0);
    cockpit.rotation.x = Math.PI / 2;
    cockpit.rotation.z = -Math.PI * 0.1;
    g.add(cockpit);
    g.add(mesh(new THREE.SphereGeometry(0.17, 20, 16), accent, -0.05, 0.92, 0));
  }, new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(1.6, 0.25, 0));

  addPart('engine', 'Силовая установка V6 · 1.6 турбо', (g) => {
    for (let i = 0; i < 3; i++) {
      for (const s of [-1, 1]) {
        const cyl = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 12), glowPU, -0.75 - i * 0.24, 0.55, s * 0.14);
        cyl.rotation.x = s * 0.5;
        cyl.userData.noEdges = true;
        g.add(cyl);
      }
    }
    const turbo = mesh(new THREE.TorusGeometry(0.13, 0.05, 10, 24), glowPU, -1.45, 0.5, 0);
    turbo.rotation.y = Math.PI / 2;
    g.add(turbo);
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5), dark, -1.0, 0.42, 0));
  }, new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0, 0.45, 0));

  addPart('cover', 'Воздухозаборник', (g) => {
    const cover = mesh(new THREE.CylinderGeometry(0.05, 0.3, 2.0, 4, 1, true), shell, -1.0, 0.82, 0);
    cover.rotation.z = Math.PI / 2;
    cover.rotation.x = Math.PI / 4;
    cover.scale.set(1, 1, 0.6);
    g.add(cover);
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.3, 0.22), shell, -0.25, 1.1, 0));
    g.add(mesh(new THREE.BoxGeometry(1.4, 0.3, 0.015), shell, -1.4, 1.05, 0));
  }, new THREE.Vector3(0, 2.8, 0), new THREE.Vector3(-0.3, 0.5, 0));

  for (const s of [-1, 1]) {
    addPart(`sidepod${s}`, s > 0 ? 'Понтон · радиаторы' : '', (g) => {
      g.add(mesh(new THREE.BoxGeometry(1.6, 0.4, 0.42), shell, -0.4, 0.42, s * 0.6));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.26, 0.34), accent, 0.42, 0.48, s * 0.6));
      for (let i = 0; i < 6; i++) {
        const fin = mesh(new THREE.BoxGeometry(0.02, 0.3, 0.34), dark, -0.1 - i * 0.12, 0.42, s * 0.6);
        fin.userData.noEdges = true;
        g.add(fin);
      }
    }, new THREE.Vector3(0, 0.3, s * 1.6), new THREE.Vector3(0, 0.35, s * 0.2));
  }

  addPart('halo', 'Halo · титан', (g) => {
    const arc = mesh(new THREE.TorusGeometry(0.42, 0.035, 10, 40, Math.PI), accent, 0.15, 0.98, 0);
    arc.rotation.x = -Math.PI / 2;
    arc.rotation.z = Math.PI / 2;
    g.add(arc);
    const strut = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.32, 8), accent, 0.62, 0.85, 0);
    strut.rotation.z = -0.6;
    g.add(strut);
  }, new THREE.Vector3(0.4, 1.4, 0), new THREE.Vector3(0.3, 0.3, 0));

  addPart('frontwing', 'Переднее антикрыло', (g) => {
    for (let i = 0; i < 3; i++) {
      const el = mesh(new THREE.BoxGeometry(0.28 - i * 0.04, 0.02, 1.9), i === 0 ? accent : shell, 3.15 - i * 0.18, 0.12 + i * 0.07, 0);
      el.rotation.z = 0.08 + i * 0.12;
      g.add(el);
    }
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.5, 0.28, 0.02), shell, 3.0, 0.2, s * 0.96));
  }, new THREE.Vector3(1.4, 0, 0), new THREE.Vector3(0.2, 0.3, 0));

  let drsFlap;
  addPart('rearwing', 'Заднее антикрыло · DRS', (g) => {
    const main = mesh(new THREE.BoxGeometry(0.36, 0.03, 1.0), accent, -2.55, 1.0, 0);
    main.rotation.z = -0.15;
    g.add(main);
    drsFlap = mesh(new THREE.BoxGeometry(0.22, 0.02, 1.0), shell, -2.42, 1.12, 0);
    drsFlap.rotation.z = -0.5;
    g.add(drsFlap);
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.7, 0.75, 0.02), shell, -2.5, 0.75, s * 0.5));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.55, 0.04), dark, -2.35, 0.65, 0));
  }, new THREE.Vector3(-1.4, 0.8, 0), new THREE.Vector3(0, 0.35, 0));

  addPart('floor', 'Днище · диффузор', (g) => {
    const shape = new THREE.Shape();
    shape.moveTo(1.4, -0.55); shape.lineTo(1.4, 0.55); shape.lineTo(0.6, 0.85); shape.lineTo(-1.9, 0.85);
    shape.lineTo(-2.3, 0.6); shape.lineTo(-2.3, -0.6); shape.lineTo(-1.9, -0.85); shape.lineTo(0.6, -0.85); shape.closePath();
    const fl = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }), shell, 0, 0.1, 0);
    fl.rotation.x = Math.PI / 2;
    g.add(fl);
    for (let i = -2; i <= 2; i++) {
      const strake = mesh(new THREE.BoxGeometry(0.5, 0.2, 0.015), shell, -2.1, 0.18, i * 0.22);
      strake.rotation.z = -0.35;
      g.add(strake);
    }
  }, new THREE.Vector3(0, -1.1, 0), new THREE.Vector3(-1.8, 0.1, 0.7));

  const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 32, 1, true);
  const rimGeo = new THREE.TorusGeometry(0.22, 0.03, 8, 24);
  const spokeGeo = new THREE.BoxGeometry(0.4, 0.025, 0.02);
  const wheelPos = [
    [1.85, 0.36, 0.85, 'Передние шины'], [1.85, 0.36, -0.85, ''],
    [-1.55, 0.38, 0.85, 'Задние шины · 18"'], [-1.55, 0.38, -0.85, ''],
  ];
  const spinners = [];
  wheelPos.forEach(([x, y, z, label], i) => {
    addPart(`wheel${i}`, label, (g) => {
      const w = new THREE.Group();
      w.position.set(x, y, z);
      const tyre = mesh(tyreGeo, dark);
      tyre.rotation.x = Math.PI / 2;
      w.add(tyre);
      const band = mesh(new THREE.TorusGeometry(0.33, 0.014, 6, 48), i < 2 ? accent : glowPU, 0, 0, Math.sign(z) * 0.19);
      band.userData.noEdges = true;
      w.add(band);
      w.add(mesh(rimGeo, shell, 0, 0, Math.sign(z) * 0.15));
      for (let k = 0; k < 3; k++) {
        const sp = mesh(spokeGeo, accent, 0, 0, Math.sign(z) * 0.16);
        sp.rotation.z = (k * Math.PI) / 3;
        sp.userData.noEdges = true;
        w.add(sp);
      }
      g.add(w);
      spinners.push(w);
      for (const dy of [-0.1, 0.12]) {
        const len = Math.abs(z) - 0.3;
        const arm = mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 6), dark, x, y + dy, Math.sign(z) * (0.3 + len / 2));
        arm.rotation.x = Math.PI / 2;
        arm.userData.noEdges = true;
        g.add(arm);
      }
    }, new THREE.Vector3(Math.sign(x) * 0.6, 0, Math.sign(z) * 1.3), new THREE.Vector3(0, 0.5, Math.sign(z) * 0.2));
  });

  // ---- wind-tunnel airflow: short streaks that bend over the bodywork ----
  const N = lowPower ? 700 : 1600;
  const flow = new Float32Array(N * 4); // x, y, z, speed
  const flowPos = new Float32Array(N * 6);
  const flowCol = new Float32Array(N * 6);
  const resetP = (i, xStart) => {
    flow[i * 4] = xStart ?? 7 + Math.random() * 2;
    flow[i * 4 + 1] = 0.08 + Math.random() * 1.7;
    flow[i * 4 + 2] = (Math.random() - 0.5) * 3.2;
    flow[i * 4 + 3] = 7 + Math.random() * 5;
  };
  for (let i = 0; i < N; i++) resetP(i, -7 + Math.random() * 14);
  const flowGeo = new THREE.BufferGeometry();
  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));
  flowGeo.setAttribute('color', new THREE.BufferAttribute(flowCol, 3));
  const flowLines = new THREE.LineSegments(flowGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flowLines.frustumCulled = false;
  scene.add(flowLines);
  // rough height profile of the car along x
  const profile = (x) => {
    if (x > 3.3 || x < -2.9) return 0;
    if (x > 1.4) return 0.5;
    if (x > 0.6) return 0.8;
    if (x > -1.0) return 1.2;
    if (x > -2.2) return 1.0;
    return 1.25;
  };
  const cC = new THREE.Color(CYAN), cM = new THREE.Color(MAGENTA), cTmp = new THREE.Color();

  function updateFlow(dt, intensity) {
    for (let i = 0; i < N; i++) {
      const o = i * 4;
      flow[o] -= flow[o + 3] * dt;
      if (flow[o] < -7) resetP(i);
      const x = flow[o], y0 = flow[o + 1], z0 = flow[o + 2];
      let y = y0, z = z0, heat = 0;
      const az = Math.abs(z0);
      const h = profile(x);
      if (h && az < 0.55 && y0 < h + 0.35) {
        y = Math.max(y0, h + 0.06 + (y0 / (h + 0.35)) * 0.3);
        heat = 1 - (y0 / (h + 0.35)) * 0.6;
      } else if (h && az < 1.25 && y0 < 0.75 && x < 1.0 && x > -2.0) {
        z = Math.sign(z0) * Math.max(az, 1.0 + az * 0.2);
        heat = 0.6;
      }
      // trailing vortex behind the rear wing
      if (x < -2.9 && x > -6 && az < 0.6 && y0 > 0.8) {
        const a = (x + 2.9) * 3 + i;
        y += Math.sin(a) * 0.12;
        z += Math.cos(a) * 0.12;
        heat = 0.8;
      }
      const len = 0.18 + heat * 0.35;
      const p = i * 6;
      flowPos[p] = x; flowPos[p + 1] = y; flowPos[p + 2] = z;
      flowPos[p + 3] = x + len; flowPos[p + 4] = y; flowPos[p + 5] = z;
      cTmp.copy(cC).lerp(cM, heat).multiplyScalar(intensity * (0.35 + heat * 0.9));
      flowCol[p] = cTmp.r; flowCol[p + 1] = cTmp.g; flowCol[p + 2] = cTmp.b;
      flowCol[p + 3] = 0; flowCol[p + 4] = 0; flowCol[p + 5] = 0;
    }
    flowGeo.attributes.position.needsUpdate = true;
    flowGeo.attributes.color.needsUpdate = true;
  }

  // scanning laser plane
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.9),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.06, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scan.rotation.y = Math.PI / 2;
  scan.position.y = 0.8;
  scan.add(new THREE.LineSegments(new THREE.EdgesGeometry(scan.geometry), new THREE.LineBasicMaterial({ color: CYAN })));
  scene.add(scan);

  // labels
  const labels = parts.filter((p) => p.label).map((p) => {
    const el = document.createElement('div');
    el.className = 'part-label';
    el.textContent = p.label;
    labelLayer.appendChild(el);
    return { el, part: p };
  });

  let exploded = 0, target = 0;
  explodeBtn?.addEventListener('click', () => {
    target = target ? 0 : 1;
    explodeBtn.textContent = target ? 'Собрать болид' : 'Разобрать болид';
  });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    fx.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 56 : 38;
    if (w > 900) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
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
    for (const p of parts) p.group.position.copy(p.home).addScaledVector(p.explode, e * 0.8);
    const speed = 1 - e * 0.85;
    for (const w of spinners) w.rotation.z -= dt * 22 * speed;
    floor.position.x = -((t * 9 * speed) % 0.5);
    car.position.y = Math.sin(t * 9) * 0.006 * speed + Math.sin(t * 1.3) * 0.02;
    drsFlap.rotation.z = -0.5 + (Math.sin(t * 0.6) > 0.6 ? 0.4 : 0);
    updateFlow(dt * speed, 1 - e * 0.7);
    scan.position.x = Math.sin(t * 0.7) * 3.2;
    ring.scale.setScalar(1 + Math.sin(t * 2) * 0.02);
    ring2.scale.setScalar(1 + ((t * 0.4) % 1) * 0.6);
    ring2.material.opacity = 0.5 * (1 - ((t * 0.4) % 1));
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
