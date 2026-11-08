// 3D circuit map: track outline from telemetry + animated car markers
import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

export function createTrack(canvas, tagLayer) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
  camera.position.set(0, 70, 70);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minDistance = 20;
  controls.maxDistance = 200;

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1);
  dl.position.set(20, 50, 10);
  scene.add(dl);
  const grid = new THREE.GridHelper(160, 64, 0x16263a, 0x0d1520);
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  scene.add(grid);

  const trackGroup = new THREE.Group();
  scene.add(trackGroup);
  const carGroup = new THREE.Group();
  scene.add(carGroup);

  let norm = null; // {cx, cy, scale}
  const cars = new Map(); // num -> {mesh, tag, target:Vector3}

  function toWorld(x, y) {
    if (!norm) return new THREE.Vector3();
    return new THREE.Vector3((x - norm.cx) * norm.scale, 0.6, -(y - norm.cy) * norm.scale);
  }

  function setOutline(points) {
    trackGroup.clear();
    if (!points || points.length < 10) { norm = null; return false; }
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    norm = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: 100 / Math.max(maxX - minX, maxY - minY, 1) };
    // thin the points for a smooth curve
    const step = Math.max(1, Math.floor(points.length / 400));
    const vs = points.filter((_, i) => i % step === 0).map((p) => toWorld(p.x, p.y).setY(0.1));
    const curve = new THREE.CatmullRomCurve3(vs, true);
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 800, 1.1, 8, true),
      new THREE.MeshStandardMaterial({ color: 0x1b2333, metalness: 0.2, roughness: 0.8 }),
    );
    tube.scale.y = 0.15;
    trackGroup.add(tube);
    const glow = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(1200).map((v) => v.setY(0.35))),
      new THREE.LineBasicMaterial({ color: 0x29e0ff, transparent: true, opacity: 0.9 }),
    );
    trackGroup.add(glow);
    // start/finish marker
    const sf = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 3.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    sf.position.copy(vs[0]).setY(0.8);
    const dir = vs[1].clone().sub(vs[0]);
    sf.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    trackGroup.add(sf);
    return true;
  }

  function setOutlineFallback() {
    // stylised generic circuit when no telemetry is available
    const pts = [];
    for (let i = 0; i < 400; i++) {
      const a = (i / 400) * Math.PI * 2;
      const r = 40 + 10 * Math.sin(a * 3) + 6 * Math.cos(a * 5);
      pts.push({ x: Math.cos(a) * r * 1.3, y: Math.sin(a) * r * 0.8 });
    }
    setOutline(pts);
    return pts;
  }

  function setCars(list) {
    const seen = new Set();
    for (const c of list) {
      if (c.x == null) continue;
      seen.add(c.num);
      let car = cars.get(c.num);
      if (!car) {
        const color = new THREE.Color(c.color || '#ffffff');
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.9, 16, 12),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }),
        );
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.08, 0.08, 4, 6),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }),
        );
        beam.position.y = 2;
        m.add(beam);
        carGroup.add(m);
        const tag = document.createElement('div');
        tag.className = 'car-tag';
        tag.style.background = c.color || '#fff';
        tagLayer.appendChild(tag);
        car = { mesh: m, tag, target: new THREE.Vector3() };
        cars.set(c.num, car);
        car.mesh.position.copy(toWorld(c.x, c.y));
      }
      car.tag.textContent = c.code;
      car.target.copy(toWorld(c.x, c.y));
    }
    for (const [num, car] of cars) {
      if (!seen.has(num)) { carGroup.remove(car.mesh); car.tag.remove(); cars.delete(num); }
    }
  }

  function clearCars() { setCars([]); }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const tmp = new THREE.Vector3();
  let active = true;
  function loop() {
    requestAnimationFrame(loop);
    if (!active) return;
    controls.update();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const car of cars.values()) {
      car.mesh.position.lerp(car.target, 0.25);
      tmp.copy(car.mesh.position).project(camera);
      car.tag.style.display = tmp.z < 1 ? '' : 'none';
      car.tag.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`;
      car.tag.style.top = `${(-tmp.y * 0.5 + 0.5) * h}px`;
    }
    renderer.render(scene, camera);
  }
  loop();

  return { setOutline, setOutlineFallback, setCars, clearCars, setActive: (v) => { active = v; } };
}
