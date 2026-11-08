// 3D circuit map: track outline from telemetry, neon car markers with light trails, radar sweep
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { createBloom, lowPower } from './fx.js?v=202611090337';

const TRAIL = lowPower ? 14 : 26;

export function createTrack(canvas, tagLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower });
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060b);
  scene.fog = new THREE.Fog(0x05060b, 120, 260);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
  camera.position.set(0, 70, 70);
  const fx = createBloom(renderer, scene, camera, { strength: 0.8, radius: 0.35, threshold: 0.25 });
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minDistance = 20;
  controls.maxDistance = 220;
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.25;
  canvas.style.touchAction = 'pan-y';
  canvas.addEventListener('pointerdown', () => (controls.autoRotate = false));

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const grid = new THREE.GridHelper(200, 80, 0xff2bd6, 0x141a33);
  grid.material.transparent = true;
  grid.material.opacity = 0.25;
  scene.add(grid);

  // radar sweep
  const sweep = new THREE.Mesh(
    new THREE.CircleGeometry(90, 48, 0, Math.PI / 7),
    new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.05;
  scene.add(sweep);
  for (const r of [30, 60, 90]) {
    const c = new THREE.Mesh(new THREE.RingGeometry(r - 0.15, r, 128), new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide }));
    c.rotation.x = -Math.PI / 2;
    c.position.y = 0.04;
    scene.add(c);
  }

  const trackGroup = new THREE.Group();
  scene.add(trackGroup);
  const carGroup = new THREE.Group();
  scene.add(carGroup);

  let norm = null;
  let pathPts = null; // raw telemetry points + cumulative arc length
  let pulse = null;
  const cars = new Map();

  function toWorld(x, y, out = new THREE.Vector3()) {
    if (!norm) return out.set(0, 0, 0);
    return out.set((x - norm.cx) * norm.scale, 0.8, -(y - norm.cy) * norm.scale);
  }

  function setOutline(points) {
    trackGroup.clear();
    pathPts = null;
    if (!points || points.length < 10) { norm = null; return false; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    norm = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: 100 / Math.max(maxX - minX, maxY - minY, 1) };
    // arc-length table for placing cars by lap fraction
    const cum = [0];
    for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    pathPts = { points, cum, total: cum[cum.length - 1] };

    const step = Math.max(1, Math.floor(points.length / 400));
    const vs = points.filter((_, i) => i % step === 0).map((p) => toWorld(p.x, p.y).setY(0.1));
    const curve = new THREE.CatmullRomCurve3(vs, true);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 800, 1.3, 8, true),
      new THREE.MeshStandardMaterial({ color: 0x10142a, metalness: 0.3, roughness: 0.7 }),
    );
    tube.scale.y = 0.12;
    trackGroup.add(tube);
    const linePts = curve.getPoints(1400);
    const mkLine = (color, y, off) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(linePts.map((v) => v.clone().setY(y).multiplyScalar(off).setY(y))),
        new THREE.LineBasicMaterial({ color }),
      );
      trackGroup.add(l);
    };
    mkLine(0x00f0ff, 0.3, 1);
    mkLine(0xff2bd6, 0.2, 1.025);
    // energy pulse running around the lap
    pulse = { curve, mesh: new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xfcee0a })) };
    trackGroup.add(pulse.mesh);
    const sf = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    sf.position.copy(vs[0]).setY(1.2);
    const dir = vs[1].clone().sub(vs[0]);
    sf.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    trackGroup.add(sf);
    return true;
  }

  function setOutlineFallback() {
    const pts = [];
    for (let i = 0; i < 400; i++) {
      const a = (i / 400) * Math.PI * 2;
      const r = 40 + 10 * Math.sin(a * 3) + 6 * Math.cos(a * 5);
      pts.push({ x: Math.cos(a) * r * 1.3, y: Math.sin(a) * r * 0.8 });
    }
    setOutline(pts);
    return pts;
  }

  // telemetry point at a lap fraction 0..1 (0 = where the outline lap began, i.e. start/finish)
  function pointAt(frac) {
    if (!pathPts) return null;
    const { points, cum, total } = pathPts;
    const d = (((frac % 1) + 1) % 1) * total;
    let lo = 0, hi = cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m + 1; else hi = m; }
    const i = Math.max(1, lo);
    const k = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return { x: points[i - 1].x + (points[i].x - points[i - 1].x) * k, y: points[i - 1].y + (points[i].y - points[i - 1].y) * k };
  }

  function makeCar(c) {
    const color = new THREE.Color(c.color || '#ffffff');
    const m = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12), new THREE.MeshBasicMaterial({ color }));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 5, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 }));
    beam.position.y = 2.5;
    m.add(beam);
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.7, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.6;
    m.add(halo);
    carGroup.add(m);
    const trailPos = new Float32Array(TRAIL * 3);
    const trailCol = new Float32Array(TRAIL * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    tg.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
    for (let i = 0; i < TRAIL; i++) {
      const f = 1 - i / TRAIL;
      trailCol[i * 3] = color.r * f; trailCol[i * 3 + 1] = color.g * f; trailCol[i * 3 + 2] = color.b * f;
    }
    const trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true }));
    trail.frustumCulled = false;
    carGroup.add(trail);
    const tag = document.createElement('div');
    tag.className = 'car-tag';
    tag.style.setProperty('--c', c.color || '#fff');
    tagLayer.appendChild(tag);
    return { mesh: m, halo, trail, trailPos, tag, target: new THREE.Vector3(), primed: false };
  }

  function setCars(list) {
    const seen = new Set();
    for (const c of list) {
      if (c.x == null) continue;
      seen.add(c.num);
      let car = cars.get(c.num);
      if (!car) { car = makeCar(c); cars.set(c.num, car); }
      car.tag.textContent = c.pos ? `${c.pos} ${c.code}` : c.code;
      car.tag.classList.toggle('lead', c.pos === 1);
      car.tag.classList.toggle('sel', !!c.selected);
      car.mesh.scale.setScalar(c.selected ? 1.5 : 1);
      toWorld(c.x, c.y, car.target);
      if (!car.primed) {
        car.mesh.position.copy(car.target);
        for (let i = 0; i < TRAIL; i++) car.trailPos.set([car.target.x, 0.8, car.target.z], i * 3);
        car.primed = true;
      }
    }
    for (const [num, car] of cars) {
      if (!seen.has(num)) {
        carGroup.remove(car.mesh, car.trail);
        car.tag.remove();
        cars.delete(num);
      }
    }
  }
  const clearCars = () => setCars([]);

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    fx.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // fit the 100-unit circuit in narrow (phone) viewports
    const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    // distance that fits ~115 units across and ~85 units deep (the view is tilted)
    const d = Math.max(62 / Math.tan(hHalf), 50 / Math.tan(vHalf));
    camera.position.setLength(Math.min(d, controls.maxDistance));
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const tmp = new THREE.Vector3();
  const clock = new THREE.Clock();
  let active = true;
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!active || !visible || document.hidden) return;
    const t = clock.elapsedTime;
    controls.update();
    sweep.rotation.z = -t * 0.8;
    if (pulse) pulse.mesh.position.copy(pulse.curve.getPointAt((t * 0.05) % 1)).setY(0.6);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const k = 1 - Math.pow(0.0001, dt); // frame-rate independent smoothing
    for (const car of cars.values()) {
      // avoid long jumps lerping across the infield (e.g. lap wrap or seek)
      if (car.mesh.position.distanceTo(car.target) > 25) car.mesh.position.copy(car.target);
      else car.mesh.position.lerp(car.target, k);
      car.trailPos.copyWithin(3, 0, (TRAIL - 1) * 3);
      car.trailPos[0] = car.mesh.position.x; car.trailPos[1] = 0.8; car.trailPos[2] = car.mesh.position.z;
      car.trail.geometry.attributes.position.needsUpdate = true;
      car.halo.scale.setScalar(1 + ((t * 1.5) % 1) * 0.8);
      car.halo.material.opacity = 0.6 * (1 - ((t * 1.5) % 1));
      tmp.copy(car.mesh.position).project(camera);
      car.tag.style.display = tmp.z < 1 ? '' : 'none';
      car.tag.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * w}px, ${(-tmp.y * 0.5 + 0.5) * h}px) translate(-50%, -150%)`;
    }
    fx.render();
  });

  return {
    setOutline, setOutlineFallback, setCars, clearCars, pointAt,
    hasOutline: () => !!pathPts,
    setActive: (v) => { active = v; },
  };
}
