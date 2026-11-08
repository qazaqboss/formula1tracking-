// Procedural F1 car rendered in an "anatomy / x-ray" style with an exploded view
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const CYAN = 0x29e0ff;
const RED = 0xff1e3c;

export function initCar(canvas, labelLayer, explodeBtn) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x07080c, 0.045);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(6.5, 3.2, 7.5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.minDistance = 4;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.enablePan = false;
  controls.target.set(0, 0.5, 0);

  scene.add(new THREE.AmbientLight(0x6080ff, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(5, 8, 4);
  scene.add(key);
  const rim = new THREE.PointLight(RED, 30, 20);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  // ground grid
  const grid = new THREE.GridHelper(40, 80, 0x1d3550, 0x101a28);
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.6, 3.65, 128),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  scene.add(ring);

  // materials
  const shell = new THREE.MeshPhysicalMaterial({
    color: 0x0b1a2a, metalness: 0.2, roughness: 0.3, transparent: true, opacity: 0.35,
    emissive: 0x062033, side: THREE.DoubleSide, depthWrite: false,
  });
  const accent = new THREE.MeshStandardMaterial({ color: RED, emissive: RED, emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.3, roughness: 0.7, transparent: true, opacity: 0.85 });
  const glowPU = new THREE.MeshStandardMaterial({ color: 0xff5a1e, emissive: 0xff3a00, emissiveIntensity: 1.2 });
  const edgeMat = new THREE.LineBasicMaterial({ color: CYAN, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending });

  const car = new THREE.Group();
  scene.add(car);
  const parts = [];

  function addPart(name, label, build, explode, labelOffset = new THREE.Vector3(0, 0.3, 0)) {
    const g = new THREE.Group();
    build(g);
    g.traverse((o) => {
      if (o.isMesh && !o.userData.noEdges) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), edgeMat);
        o.add(e);
      }
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

  // Monocoque + nose (car points along +X)
  addPart('chassis', 'Монокок', (g) => {
    const tub = mesh(new THREE.BoxGeometry(2.2, 0.55, 0.75), shell, 0.3, 0.5, 0);
    g.add(tub);
    const nose = mesh(new THREE.CylinderGeometry(0.08, 0.32, 1.9, 16), shell, 2.3, 0.42, 0);
    nose.rotation.z = Math.PI / 2;
    nose.scale.set(1, 1, 0.75);
    g.add(nose);
    const cockpit = mesh(new THREE.TorusGeometry(0.32, 0.04, 8, 32, Math.PI * 1.2), accent, 0.15, 0.8, 0);
    cockpit.rotation.x = Math.PI / 2;
    cockpit.rotation.z = -Math.PI * 0.1;
    g.add(cockpit);
    const helmet = mesh(new THREE.SphereGeometry(0.17, 20, 16), accent, -0.05, 0.92, 0);
    g.add(helmet);
  }, new THREE.Vector3(0, 0.9, 0), new THREE.Vector3(1.6, 0.25, 0));

  addPart('engine', 'Силовая установка V6', (g) => {
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
    const block = mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5), dark, -1.0, 0.42, 0);
    g.add(block);
  }, new THREE.Vector3(0, 1.8, 0), new THREE.Vector3(0, 0.45, 0));

  addPart('cover', 'Воздухозаборник', (g) => {
    const cover = mesh(new THREE.CylinderGeometry(0.05, 0.3, 2.0, 4, 1, true), shell, -1.0, 0.82, 0);
    cover.rotation.z = Math.PI / 2;
    cover.rotation.x = Math.PI / 4;
    cover.scale.set(1, 1, 0.6);
    g.add(cover);
    const airbox = mesh(new THREE.BoxGeometry(0.4, 0.3, 0.22), shell, -0.25, 1.1, 0);
    g.add(airbox);
    const fin = mesh(new THREE.BoxGeometry(1.4, 0.3, 0.015), shell, -1.4, 1.05, 0);
    g.add(fin);
  }, new THREE.Vector3(0, 2.8, 0), new THREE.Vector3(-0.3, 0.5, 0));

  for (const s of [-1, 1]) {
    addPart(`sidepod${s}`, s > 0 ? 'Понтон / радиаторы' : '', (g) => {
      const pod = mesh(new THREE.BoxGeometry(1.6, 0.4, 0.42), shell, -0.4, 0.42, s * 0.6);
      g.add(pod);
      const inlet = mesh(new THREE.BoxGeometry(0.06, 0.26, 0.34), accent, 0.42, 0.48, s * 0.6);
      g.add(inlet);
      for (let i = 0; i < 6; i++) {
        const fin = mesh(new THREE.BoxGeometry(0.02, 0.3, 0.34), dark, -0.1 - i * 0.12, 0.42, s * 0.6);
        fin.userData.noEdges = true;
        g.add(fin);
      }
    }, new THREE.Vector3(0, 0.3, s * 1.6), new THREE.Vector3(0, 0.35, s * 0.2));
  }

  addPart('halo', 'Halo', (g) => {
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

  addPart('rearwing', 'Заднее антикрыло · DRS', (g) => {
    const main = mesh(new THREE.BoxGeometry(0.36, 0.03, 1.0), accent, -2.55, 1.0, 0);
    main.rotation.z = -0.15;
    g.add(main);
    const flap = mesh(new THREE.BoxGeometry(0.22, 0.02, 1.0), shell, -2.42, 1.12, 0);
    flap.rotation.z = -0.5;
    g.add(flap);
    for (const s of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.7, 0.75, 0.02), shell, -2.5, 0.75, s * 0.5));
    const pylon = mesh(new THREE.BoxGeometry(0.06, 0.55, 0.04), dark, -2.35, 0.65, 0);
    g.add(pylon);
  }, new THREE.Vector3(-1.4, 0.8, 0), new THREE.Vector3(0, 0.35, 0));

  addPart('floor', 'Днище · диффузор', (g) => {
    const shape = new THREE.Shape();
    shape.moveTo(1.4, -0.55); shape.lineTo(1.4, 0.55); shape.lineTo(0.6, 0.85); shape.lineTo(-1.9, 0.85);
    shape.lineTo(-2.3, 0.6); shape.lineTo(-2.3, -0.6); shape.lineTo(-1.9, -0.85); shape.lineTo(0.6, -0.85); shape.closePath();
    const floor = mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.03, bevelEnabled: false }), shell, 0, 0.1, 0);
    floor.rotation.x = Math.PI / 2;
    g.add(floor);
    for (let i = -2; i <= 2; i++) {
      const strake = mesh(new THREE.BoxGeometry(0.5, 0.2, 0.015), shell, -2.1, 0.18, i * 0.22);
      strake.rotation.z = -0.35;
      g.add(strake);
    }
  }, new THREE.Vector3(0, -1.1, 0), new THREE.Vector3(-1.8, 0.1, 0.7));

  const tyreGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.38, 32, 1, true);
  const rimGeo = new THREE.TorusGeometry(0.22, 0.03, 8, 24);
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
      const band = mesh(new THREE.TorusGeometry(0.33, 0.012, 6, 48), accent, 0, 0, Math.sign(z) * 0.19);
      band.userData.noEdges = true;
      w.add(band);
      const r = mesh(rimGeo, shell, 0, 0, Math.sign(z) * 0.15);
      w.add(r);
      g.add(w);
      spinners.push(w);
      // suspension arms
      for (const dy of [-0.1, 0.12]) {
        const len = Math.abs(z) - 0.3;
        const arm = mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 6), dark, x, y + dy, Math.sign(z) * (0.3 + len / 2));
        arm.rotation.x = Math.PI / 2;
        arm.userData.noEdges = true;
        g.add(arm);
      }
    }, new THREE.Vector3(Math.sign(x) * 0.6, 0, Math.sign(z) * 1.3), new THREE.Vector3(0, 0.5, Math.sign(z) * 0.2));
  });

  // scanning plane
  const scan = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.8),
    new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.08, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  scan.rotation.y = Math.PI / 2;
  scan.position.y = 0.8;
  scene.add(scan);

  // floating particles
  const pGeo = new THREE.BufferGeometry();
  const pts = new Float32Array(600 * 3);
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = (Math.random() - 0.5) * 30;
    pts[i + 1] = Math.random() * 8;
    pts[i + 2] = (Math.random() - 0.5) * 30;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: CYAN, size: 0.03, transparent: true, opacity: 0.6 }));
  scene.add(particles);

  // labels
  const labels = parts.filter((p) => p.label).map((p) => {
    const el = document.createElement('div');
    el.className = 'part-label';
    el.textContent = p.label;
    labelLayer.appendChild(el);
    return { el, part: p };
  });

  let exploded = 0;
  let target = 0;
  explodeBtn?.addEventListener('click', () => {
    target = target ? 0 : 1;
    explodeBtn.textContent = target ? 'Собрать болид' : 'Разобрать болид';
  });

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 700 ? 52 : 38;
    // keep the car clear of the hero copy on wide screens
    if (w > 900) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.setViewOffset(w, h, 0, -h * 0.2, w, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const tmp = new THREE.Vector3();
  const clock = new THREE.Clock();
  let running = true;
  const io = new IntersectionObserver(([e]) => { running = e.isIntersecting; if (running) loop(); });
  io.observe(canvas);

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    exploded += (target - exploded) * Math.min(1, dt * 3);
    const e = exploded * exploded * (3 - 2 * exploded);
    for (const p of parts) p.group.position.copy(p.home).addScaledVector(p.explode, e * 0.8);
    for (const w of spinners) w.rotation.z -= dt * (4 - e * 3.5);
    car.position.y = Math.sin(t * 1.3) * 0.03;
    scan.position.x = Math.sin(t * 0.7) * 3.2;
    scan.material.opacity = 0.05 + 0.05 * Math.abs(Math.cos(t * 0.7));
    particles.rotation.y = t * 0.02;
    ring.scale.setScalar(1 + Math.sin(t * 2) * 0.02);
    controls.update();
    renderer.render(scene, camera);

    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const { el, part } of labels) {
      const box = new THREE.Box3().setFromObject(part.group);
      box.getCenter(tmp).add(part.labelOffset);
      tmp.project(camera);
      const visible = tmp.z < 1 && e > 0.05;
      el.style.opacity = visible ? Math.min(1, e * 1.5) : 0;
      el.style.left = `${(tmp.x * 0.5 + 0.5) * w + 14}px`;
      el.style.top = `${(-tmp.y * 0.5 + 0.5) * h}px`;
    }
  }
  loop();
}
