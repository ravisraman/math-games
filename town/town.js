/* Math Quest — My Town.
   A cozy block island where he places the pieces he earned (one per finished round) plus free roads,
   trees and decorations. The layout lives in data.town.placed = [{ id, x, z, r }] (core.js syncs it):
   x, z = the tile of the piece's corner with the smallest x and z, r = quarter turns (0..3).
   Keyboard: arrows move the glowing square, space/return puts the piece, R turns, Q/E (or tab) picks
   another piece, backspace picks a piece back up, T turns the town, +/- zoom, esc goes home.
   Touch/mouse: tap a piece in the tray then tap the grass (or drag it out of the tray); tap a placed
   piece for turn / pick-up buttons; drag to look around when zoomed in; pinch or wheel to zoom. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const MQ = window.MQ;
const TOWN = MQ.TOWN;
const $ = (id) => document.getElementById(id);
const MODELS = new URL('../shared/models/', import.meta.url).href;
const ART = new URL('../shared/art/town/', import.meta.url).href;

const data = MQ.load();
MQ.applySettings(data.settings);

// ---------------- The land ----------------
const GW = 16, GH = 12, X0 = -8, Z0 = -6; // buildable tiles: x in [-8, 7], z in [-6, 5]
const BORDER = 3;
const inGrid = (x, z) => x >= X0 && x < X0 + GW && z >= Z0 && z < Z0 + GH;
const key = (x, z) => x + ',' + z;

// ---------------- Pieces ----------------
const ALL = [...TOWN.earned, ...TOWN.free];
const BY_ID = new Map(ALL.map((p) => [p.id, p]));
const FREE = new Set(TOWN.free.map((p) => p.id));
const FLAT = new Set(['road', 'bend', 'cross', 'tjunct', 'roadend', 'path']); // he can walk over these
// How big each model is drawn: w = longest side on the ground (tiles), h = height (tiles).
const LOOK = {
  tent: { w: 0.95 }, campfire: { w: 0.62 }, bench: { w: 0.62 }, chest: { w: 0.5 }, sign: { h: 0.8 },
  barrel: { h: 0.55 }, bedroll: { w: 0.8 }, bigfish: { w: 0.72 },
  road: { w: 1 }, bend: { w: 1 }, cross: { w: 1 }, tjunct: { w: 1 }, roadend: { w: 1 },
  lamp: { h: 1.1 }, tree: { h: 1.5 }, treesm: { h: 1.05 }, autumn: { h: 1.45 }, pine: { h: 1.8 },
  planter: { w: 0.78 }, fence: { w: 1 }, rock: { w: 0.7 }, path: { w: 0.85 }, wood: { w: 0.62 },
};
const lookFor = (p) => LOOK[p.id] || (p.size === 2 ? { w: 1.82 } : { w: 0.9 });

// ---------------- Counts: what's in his tray ----------------
function roundsDone() { return TOWN.roundsDone(data); }
function copiesOf(id) {
  const i = TOWN.earned.findIndex((p) => p.id === id);
  if (i < 0) return Infinity;
  const R = roundsDone();
  let n = R > i ? Math.floor((R - 1 - i) / TOWN.earned.length) + 1 : 0;
  if (id === 'tent') n += 1; // the starter tent is a gift
  return n;
}
function placedCount(id) { return pieces.filter((p) => p.id === id).length + extras.filter((p) => p.id === id).length; }
function leftOf(id) { return FREE.has(id) ? Infinity : Math.max(0, copiesOf(id) - placedCount(id)); }

// ---------------- State ----------------
let pieces = []; // { id, x, z, r, obj }
let extras = []; // saved entries we can't show (unknown ids / off the island) — kept as they are
const occ = new Map(); // "x,z" -> piece
let sel = null; // selected tray id
let ghostR = 0;
const cursor = { x: -1, z: -1 };
let picked = null; // a placed piece picked with a tap / the cursor (turn + pick-up buttons)
let lastInput = MQ.isTouch ? 'touch' : 'key';
let dragging = null; // dragging a picture out of the tray
let gl = null; // the 3D world (null when WebGL isn't available)

// ---------------- Load the layout ----------------
function footprint(p) { const s = BY_ID.get(p.id).size; const out = []; for (let dx = 0; dx < s; dx++) for (let dz = 0; dz < s; dz++) out.push([p.x + dx, p.z + dz]); return out; }
function fits(id, x, z, ignore = null) {
  const s = BY_ID.get(id).size;
  for (let dx = 0; dx < s; dx++) for (let dz = 0; dz < s; dz++) {
    if (!inGrid(x + dx, z + dz)) return false;
    const o = occ.get(key(x + dx, z + dz));
    if (o && o !== ignore) return false;
  }
  return true;
}
function addOcc(p) { for (const [x, z] of footprint(p)) occ.set(key(x, z), p); }
function removeOcc(p) { for (const [x, z] of footprint(p)) if (occ.get(key(x, z)) === p) occ.delete(key(x, z)); }

let firstVisit = false;
function readLayout() {
  pieces = []; extras = []; occ.clear();
  const list = (data.town && Array.isArray(data.town.placed)) ? data.town.placed : [];
  for (const e of list) {
    const p = { id: String(e.id), x: e.x | 0, z: e.z | 0, r: ((e.r | 0) % 4 + 4) % 4 };
    if (!BY_ID.has(p.id) || !fits(p.id, p.x, p.z)) { extras.push({ id: p.id, x: p.x, z: p.z, r: p.r }); continue; }
    pieces.push(p); addOcc(p);
  }
}
if (!data.town || !Array.isArray(data.town.placed)) {
  // First visit: a tent and two trees so the island already feels like home.
  firstVisit = true;
  data.town = { placed: [{ id: 'tent', x: -1, z: -1, r: 0 }, { id: 'tree', x: -3, z: -2, r: 0 }, { id: 'pine', x: 2, z: -3, r: 1 }] };
}
readLayout();
let savedSig = '';
function layoutList() { return [...pieces.map(({ id, x, z, r }) => ({ id, x, z, r })), ...extras]; }
function save() {
  data.town = { placed: layoutList() };
  savedSig = JSON.stringify(data.town.placed);
  MQ.save(data);
  updateCount();
}
if (firstVisit) save(); else savedSig = JSON.stringify(layoutList());

// ---------------- Tray ----------------
function trayItems() {
  const R = roundsDone();
  const items = [];
  const owned = new Set(TOWN.earnedFor(data).map((p) => p.id));
  owned.add('tent');
  // Newest pieces he still has first, then the ones already in his town.
  const mine = TOWN.earned.filter((p) => owned.has(p.id)).reverse();
  for (const p of mine) if (leftOf(p.id) > 0) items.push({ id: p.id, kind: 'earned' });
  for (const p of mine) if (leftOf(p.id) <= 0) items.push({ id: p.id, kind: 'earned' });
  const N = TOWN.earned.length;
  for (let i = R, n = 0; i < N && n < 3; i++, n++) if (!owned.has(TOWN.earned[i].id)) items.push({ id: TOWN.earned[i].id, kind: 'locked', rounds: i - R + 1 });
  for (const p of TOWN.free) items.push({ id: p.id, kind: 'free' });
  return items;
}
let tray = [];
const newest = TOWN.earned[Math.min(TOWN.earned.length, roundsDone()) - 1];
function renderTray() {
  tray = trayItems();
  let html = '';
  let prevKind = null;
  for (const it of tray) {
    const p = BY_ID.get(it.id);
    if (prevKind && prevKind !== it.kind && it.kind === 'free') html += '<span class="tray-sep" aria-hidden="true"></span>';
    prevKind = it.kind;
    if (it.kind === 'locked') {
      html += `<div class="card locked" data-locked="${it.id}" aria-label="Locked. ${it.rounds} more rounds">
        <img src="${ART}${it.id}.webp" alt="" draggable="false"><span class="nm">${it.rounds} more!</span><span class="badge">⭐${it.rounds}</span></div>`;
      continue;
    }
    const left = leftOf(it.id);
    const badge = it.kind === 'earned' ? `<span class="badge">${left}</span>` : '';
    const cls = ['card', it.kind, sel === it.id ? 'on' : '', left === 0 ? 'empty' : '', newest && newest.id === it.id && left > 0 ? 'new' : ''].join(' ');
    html += `<button class="${cls}" data-id="${it.id}" type="button" tabindex="-1" aria-label="${MQ.escapeHtml(p.name)}">
      <img src="${ART}${it.id}.webp" alt="" draggable="false"><span class="nm${p.name.length > 9 ? ' long' : ''}">${MQ.escapeHtml(p.name)}</span>${badge}</button>`;
  }
  $('tray-list').innerHTML = html;
}
function refreshTray() {
  // Update badges / selection without rebuilding (keeps the scroll position smooth).
  for (const el of $('tray-list').querySelectorAll('[data-id]')) {
    const id = el.dataset.id;
    const left = leftOf(id);
    el.classList.toggle('on', sel === id);
    el.classList.toggle('empty', left === 0);
    if (left === 0) el.classList.remove('new');
    const b = el.querySelector('.badge');
    if (b) b.textContent = left;
  }
}
function selectable() { return tray.filter((t) => t.kind !== 'locked'); }
// Q / E skip pieces he has none left of (tapping still shows them).
function cyclable() { return tray.filter((t) => t.kind === 'free' || (t.kind === 'earned' && (leftOf(t.id) > 0 || t.id === sel))); }
function select(id, { scroll = true, sound = true } = {}) {
  sel = id;
  ghostR = 0;
  refreshTray();
  if (id && scroll) {
    const el = $('tray-list').querySelector(`[data-id="${id}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }
  if (sound) MQ.Sound.note(72 + (selectable().findIndex((t) => t.id === id) % 5) * 2, 'bell', { dur: 0.4, vel: 0.08 });
  setPicked(null);
  if (gl) gl.updateGhost();
}
function cycle(dir) {
  const list = cyclable();
  if (!list.length) return;
  let i = list.findIndex((t) => t.id === sel);
  i = (i + dir + list.length) % list.length;
  select(list[i].id);
}
function updateCount() {
  const n = pieces.length;
  $('t-count').textContent = `${n} ${n === 1 ? 'piece' : 'pieces'}`;
}

// ---------------- Speech bubble ----------------
let bubbleTimer = 0;
function say(text, { speak = false, ms = 3800 } = {}) {
  const b = $('bubble');
  b.textContent = text;
  b.hidden = false;
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  clearTimeout(bubbleTimer);
  if (ms) bubbleTimer = setTimeout(() => { b.hidden = true; }, ms);
  if (speak) MQ.Voice.say(text, 'en-US', { interrupt: true });
}

// ---------------- Picked piece: turn / pick up ----------------
function setPicked(p) {
  picked = p;
  $('actions').hidden = !p;
  if (gl) { gl.updateGhost(); gl.placeActions(); }
}
function rotatePiece(p) {
  p.r = (p.r + 1) % 4;
  if (gl) gl.spinPiece(p);
  MQ.Sound.click();
  save();
}
function removePiece(p) {
  const i = pieces.indexOf(p);
  if (i < 0) return;
  pieces.splice(i, 1);
  removeOcc(p);
  if (gl) gl.liftPiece(p);
  MQ.Sound.putBack();
  save();
  setPicked(null);
  select(p.id, { sound: false }); // it's back in his hand, ready to put somewhere else
  refreshTray();
}
function placeAt(x, z) {
  if (!sel) { MQ.Sound.nope(); say('Pick a piece first! 👇'); pulseTray(); return false; }
  const info = BY_ID.get(sel);
  if (leftOf(sel) <= 0) {
    MQ.Sound.nope();
    say(roundsDone() ? 'All used! Play a game to earn more.' : 'Play a game to earn your first house!', { speak: true });
    return false;
  }
  if (!fits(sel, x, z)) { MQ.Sound.nope(); if (gl) gl.wiggleGhost(); return false; }
  const p = { id: sel, x, z, r: ghostR };
  pieces.push(p); addOcc(p);
  if (gl) gl.dropPiece(p);
  const earned = !FREE.has(p.id);
  if (earned) { MQ.Sound.star(); if (info.size === 2) MQ.Sound.open(); }
  else MQ.Sound.hop(pieces.length % 7);
  save();
  refreshTray();
  if (gl) gl.heroVisit(p, earned);
  if (earned && leftOf(sel) === 0) {
    // Out of that one: move on to the next piece he still has, so the next tap does something.
    const nextOne = selectable().find((t) => t.kind === 'earned' && leftOf(t.id) > 0);
    if (nextOne) select(nextOne.id, { sound: false });
  }
  if (gl) gl.updateGhost();
  return true;
}
function pulseTray() {
  $('tray').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }], { duration: 380, easing: 'ease-out' });
}

// ---------------- The 3D world ----------------
function webglOK() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}

function createWorld(stage) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  stage.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#cdeeff', 34, 80);
  scene.add(new THREE.HemisphereLight('#fff5e0', '#7fa066', 1.5));
  const sun = new THREE.DirectionalLight('#ffe9c9', 2.2);
  sun.position.set(-9, 16, 8);
  sun.castShadow = true;
  const SM = MQ.isTouch ? 1024 : 2048;
  sun.shadow.mapSize.set(SM, SM);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.025;
  const S = 15;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 50 });
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 240);

  const loader = new GLTFLoader();
  const gltfCache = new Map();
  const loadGLB = (path) => {
    if (!gltfCache.has(path)) gltfCache.set(path, loader.loadAsync(MODELS + path + '.glb').catch(() => null));
    return gltfCache.get(path);
  };
  const shadows = (o, cast = true) => { o.traverse((m) => { if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true; } }); return o; };

  // ---------- Island ----------
  const island = new THREE.Group(); scene.add(island);
  const cellType = new Map();
  let seed = 20240917;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const pondC = { x: X0 + GW + 1.2, z: Z0 + 3.5 }; // a little pond in the right-hand meadow
  for (let x = X0 - BORDER; x < X0 + GW + BORDER; x++) for (let z = Z0 - BORDER; z < Z0 + GH + BORDER; z++) {
    if (inGrid(x, z)) { cellType.set(key(x, z), 'grid'); continue; }
    const ring = Math.min(x - (X0 - BORDER), X0 + GW + BORDER - 1 - x, z - (Z0 - BORDER), Z0 + GH + BORDER - 1 - z);
    const corner = (x < X0 || x >= X0 + GW) && (z < Z0 || z >= Z0 + GH);
    const dx = x + 0.5 - pondC.x, dz = z + 0.5 - pondC.z;
    if (ring >= 1 && dx * dx / 2.6 + dz * dz / 5.5 < 1 && !inGrid(x, z)) { cellType.set(key(x, z), 'pond'); continue; }
    if (ring === 0) {
      if (corner && ((x === X0 - BORDER || x === X0 + GW + BORDER - 1) && (z === Z0 - BORDER || z === Z0 + GH + BORDER - 1))) continue; // rounded corners
      cellType.set(key(x, z), 'sand');
    } else cellType.set(key(x, z), ring === 1 ? 'meadow' : 'near');
  }
  // A sandy shore round the pond.
  for (const [k, t] of [...cellType]) {
    if (t !== 'pond') continue;
    const [x, z] = k.split(',').map(Number);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nk = key(x + dx, z + dz);
      if (cellType.get(nk) === 'meadow' || cellType.get(nk) === 'near') cellType.set(nk, 'shore');
    }
  }
  const top = new THREE.BoxGeometry(1, 0.22, 1);
  const dirt = new THREE.BoxGeometry(1, 1.4, 1);
  const cells = [...cellType.entries()];
  const topMesh = new THREE.InstancedMesh(top, new THREE.MeshLambertMaterial({ color: '#ffffff' }), cells.length);
  const dirtMesh = new THREE.InstancedMesh(dirt, new THREE.MeshLambertMaterial({ color: '#9b6a42' }), cells.length);
  topMesh.receiveShadow = true; dirtMesh.receiveShadow = true;
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  const COLORS = { grid: ['#8fd35c', '#86cb54'], meadow: ['#7cc24c', '#78bd48'], near: ['#80c64f', '#7bc14b'], sand: ['#f2dca0', '#eed597'], shore: ['#f0d89a', '#ecd294'], pond: ['#d9c08a', '#d4bb85'] };
  cells.forEach(([k, t], i) => {
    const [x, z] = k.split(',').map(Number);
    const y = t === 'sand' || t === 'shore' ? -0.2 : t === 'pond' ? -0.75 : 0;
    m4.makeTranslation(x + 0.5, y - 0.11, z + 0.5); topMesh.setMatrixAt(i, m4);
    const c = COLORS[t][(x + z) & 1];
    col.set(c); if (t !== 'grid') col.offsetHSL(0, 0, (rnd() - 0.5) * 0.025); topMesh.setColorAt(i, col);
    m4.makeTranslation(x + 0.5, y - 0.22 - 0.7, z + 0.5); dirtMesh.setMatrixAt(i, m4);
  });
  island.add(topMesh, dirtMesh);

  // Water all around (and in the pond) with a slow shimmer.
  function rippleTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineCap = 'round';
    let s2 = 7;
    const r2 = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
    for (let i = 0; i < 26; i++) {
      const px = r2() * 256, py = r2() * 256, w = 8 + r2() * 22;
      x.lineWidth = 1.5 + r2() * 2;
      x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + w / 2, py - 3, px + w, py); x.stroke();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(26, 26); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ color: '#58bde6' }));
  water.rotation.x = -Math.PI / 2; water.position.y = -0.36; water.receiveShadow = true;
  const ripTex = rippleTexture();
  const ripples = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ map: ripTex, transparent: true, opacity: 0.55, depthWrite: false }));
  ripples.rotation.x = -Math.PI / 2; ripples.position.y = -0.35;
  const ripTex2 = ripTex.clone(); ripTex2.repeat.set(19, 19);
  const ripples2 = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshBasicMaterial({ map: ripTex2, transparent: true, opacity: 0.35, depthWrite: false }));
  ripples2.rotation.x = -Math.PI / 2; ripples2.position.y = -0.345;
  scene.add(water, ripples, ripples2);
  // Lily pads on the pond.
  const padMat = new THREE.MeshLambertMaterial({ color: '#4f9e3c' });
  const padGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 14, 1, false, 0.4, Math.PI * 2 - 0.8);
  const pads = [];
  for (const [dx, dz] of [[-0.4, -1.2], [0.5, 0.3], [-0.2, 1.6]]) {
    const p = new THREE.Mesh(padGeo, padMat); p.position.set(pondC.x + dx, -0.33, pondC.z + dz); p.rotation.y = rnd() * 6; island.add(p); pads.push(p);
  }
  const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshLambertMaterial({ color: '#ff9ec7' }));
  flower.position.set(pondC.x + 0.5, -0.27, pondC.z + 0.3); island.add(flower);

  // Trees, bushes and flowers around the building grass (never on it).
  async function decorate() {
    const trees = ['tree_default', 'tree_oak', 'tree_fat', 'tree_pineRoundA', 'tree_simple', 'tree_blocks', 'tree_pineSmallA'];
    const small = ['plant_bush', 'plant_bushSmall', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'mushroom_red', 'rock_smallA', 'grass', 'stump_round'];
    const jobs = [];
    for (const [k, t] of cells) {
      if (t !== 'meadow' && t !== 'near') continue;
      const [x, z] = k.split(',').map(Number);
      const r = rnd();
      let name, h;
      if (t === 'meadow') { if (r < 0.62) { name = trees[Math.floor(rnd() * trees.length)]; h = 1.1 + rnd() * 0.7; } else if (r < 0.85) { name = small[Math.floor(rnd() * small.length)]; h = 0.35; } }
      else if (r < 0.45) { name = small[Math.floor(rnd() * small.length)]; h = 0.28 + rnd() * 0.12; }
      if (!name) continue;
      const ox = (rnd() - 0.5) * 0.35, oz = (rnd() - 0.5) * 0.35, ry = rnd() * Math.PI * 2;
      jobs.push(loadGLB('nature/' + name).then((g) => {
        if (!g) return;
        const o = shadows(g.scene.clone(), true);
        const box = new THREE.Box3().setFromObject(o); const sz = box.getSize(new THREE.Vector3());
        const s = h / Math.max(0.01, sz.y);
        o.scale.setScalar(s);
        const b2 = new THREE.Box3().setFromObject(o); const c = b2.getCenter(new THREE.Vector3());
        o.position.set(x + 0.5 + ox - c.x, -b2.min.y, z + 0.5 + oz - c.z);
        o.rotation.y = ry;
        island.add(o);
      }));
    }
    await Promise.all(jobs);
    invalidate();
  }

  // A butterfly fluttering over the grass.
  const butterfly = new THREE.Group();
  const wingMat = new THREE.MeshLambertMaterial({ color: '#ffb347', side: THREE.DoubleSide, emissive: '#7a3a00', emissiveIntensity: 0.25 });
  const wingGeo = new THREE.PlaneGeometry(0.16, 0.13); wingGeo.translate(0.08, 0, 0);
  const wl = new THREE.Mesh(wingGeo, wingMat), wr = new THREE.Mesh(wingGeo, wingMat);
  wl.rotation.x = wr.rotation.x = -Math.PI / 2; wr.scale.x = -1;
  const wingL = new THREE.Group(); wingL.add(wl); const wingR = new THREE.Group(); wingR.add(wr);
  butterfly.add(wingL, wingR); scene.add(butterfly);

  // ---------- Piece models ----------
  const templates = new Map();
  function template(id) {
    if (!templates.has(id)) {
      const info = BY_ID.get(id);
      templates.set(id, loadGLB('town/' + info.model).then((g) => {
        if (!g) return null;
        const o = shadows(g.scene.clone(), !FLAT.has(id));
        const box = new THREE.Box3().setFromObject(o); const sz = box.getSize(new THREE.Vector3());
        const look = lookFor(info);
        const s = look.h ? look.h / sz.y : look.w / Math.max(sz.x, sz.z);
        o.scale.setScalar(s);
        const b2 = new THREE.Box3().setFromObject(o); const c = b2.getCenter(new THREE.Vector3());
        o.position.set(-c.x, -b2.min.y + (FLAT.has(id) ? 0.004 : 0), -c.z);
        const holder = new THREE.Group(); holder.add(o);
        holder.userData.height = b2.max.y - b2.min.y;
        return holder;
      }));
    }
    return templates.get(id);
  }
  const piecesGroup = new THREE.Group(); scene.add(piecesGroup);
  const center = (p) => { const s = BY_ID.get(p.id).size; return new THREE.Vector3(p.x + s / 2, 0, p.z + s / 2); };

  function makePieceObj(p, animate) {
    const holder = new THREE.Group();
    holder.position.copy(center(p));
    holder.rotation.y = p.r * Math.PI / 2;
    holder.userData.piece = p;
    piecesGroup.add(holder);
    p.obj = holder;
    template(p.id).then((t) => {
      if (!t || p.obj !== holder) return;
      const inst = t.clone();
      inst.traverse((m) => { if (m.isMesh) m.userData.piece = p; });
      holder.add(inst);
      holder.userData.height = t.userData.height;
      if (animate) startDrop(holder);
      invalidate();
      if (picked === p) api.placeActions();
    });
  }
  function syncAll() {
    piecesGroup.clear();
    for (const p of pieces) makePieceObj(p, false);
    invalidate();
  }

  // ---------- Tweens: drops, spins, lifts, dust ----------
  const tweens = [];
  function tween(dur, step, done) { tweens.push({ t: 0, dur, step, done }); invalidate(); }
  function startDrop(holder) {
    const inner = holder.children[0];
    if (!inner) return;
    const baseY = inner.position.y;
    holder.position.y = 3;
    tween(0.34, (k) => { holder.position.y = 3 * (1 - k * k); }, () => {
      holder.position.y = 0;
      dust(holder.position, BY_ID.get(holder.userData.piece.id).size);
      tween(0.42, (k) => {
        const q = Math.sin(k * Math.PI * 2.2) * Math.exp(-k * 4) ;
        holder.scale.set(1 + q * 0.18, 1 - q * 0.26, 1 + q * 0.18);
      }, () => { holder.scale.set(1, 1, 1); inner.position.y = baseY; });
    });
  }
  function spinPiece(p) {
    const h = p.obj; if (!h) return;
    const from = h.rotation.y, to = p.r * Math.PI / 2;
    let d = ((to - from) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (d < 0.01 && d > -0.01) d = 0;
    if (d < 0) d += Math.PI * 2; // always turn the same way
    tween(0.28, (k) => { const e = 1 - Math.pow(1 - k, 3); h.rotation.y = from + d * e; h.position.y = Math.sin(k * Math.PI) * 0.18; }, () => { h.rotation.y = to; h.position.y = 0; });
  }
  function liftPiece(p) {
    const h = p.obj; if (!h) return;
    p.obj = null;
    dust(h.position, BY_ID.get(p.id).size, '#ffffff', 8);
    tween(0.3, (k) => { h.position.y = k * 1.2; h.scale.setScalar(Math.max(0.01, 1 - k)); }, () => piecesGroup.remove(h));
  }
  const dustGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const bits = [];
  function dust(pos, size = 1, color = '#fff6e0', n = 14) {
    const m = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.95 });
    for (let i = 0; i < n; i++) {
      const b = new THREE.Mesh(dustGeo, m);
      const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
      const r0 = size * 0.45;
      b.position.set(pos.x + Math.cos(a) * r0, 0.08, pos.z + Math.sin(a) * r0);
      const sp = 1.3 + rnd() * 1.2;
      b.userData = { v: new THREE.Vector3(Math.cos(a) * sp, 0.8 + rnd() * 1.2, Math.sin(a) * sp), age: 0, life: 0.55 + rnd() * 0.25, mat: m };
      scene.add(b); bits.push(b);
    }
  }
  function stepBits(dt) {
    for (let i = bits.length - 1; i >= 0; i--) {
      const b = bits[i], u = b.userData;
      u.age += dt; u.v.multiplyScalar(Math.pow(0.05, dt)); u.v.y -= 2 * dt;
      b.position.addScaledVector(u.v, dt);
      const k = u.age / u.life;
      b.scale.setScalar(0.6 + k * 1.1);
      b.rotation.y += dt * 3;
      u.mat.opacity = Math.max(0, 1 - k);
      if (u.age >= u.life) { scene.remove(b); bits.splice(i, 1); }
    }
  }

  // ---------- Cursor frame + ghost ----------
  const cursorG = new THREE.Group(); scene.add(cursorG);
  const frameMat = new THREE.MeshBasicMaterial({ color: '#fff27a', transparent: true, opacity: 0.95, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({ color: '#fff9c4', transparent: true, opacity: 0.35, depthWrite: false });
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fillMat); fill.rotation.x = -Math.PI / 2; fill.position.y = 0.02; fill.renderOrder = 2;
  const edges = [];
  for (let i = 0; i < 4; i++) { const e = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.08), frameMat); e.renderOrder = 3; edges.push(e); cursorG.add(e); }
  cursorG.add(fill);
  function sizeFrame(s) {
    const h = s / 2;
    edges[0].scale.x = s + 0.08; edges[0].position.set(0, 0.03, -h);
    edges[1].scale.x = s + 0.08; edges[1].position.set(0, 0.03, h);
    edges[2].scale.x = s + 0.08; edges[2].rotation.y = Math.PI / 2; edges[2].position.set(-h, 0.03, 0);
    edges[3].scale.x = s + 0.08; edges[3].rotation.y = Math.PI / 2; edges[3].position.set(h, 0.03, 0);
    fill.scale.set(s, s, 1);
  }
  const ghostMats = new Map();
  function ghostMat(orig, bad) {
    const k = orig.uuid + (bad ? 'b' : 'g');
    if (!ghostMats.has(k)) {
      const m = orig.clone();
      m.transparent = true; m.opacity = bad ? 0.5 : 0.62; m.depthWrite = false;
      if (bad) { m.color = new THREE.Color('#ff7b7b'); if (m.emissive) { m.emissive = new THREE.Color('#b01010'); m.emissiveIntensity = 0.5; } }
      else if (m.emissive) { m.emissive = new THREE.Color('#fff2b0'); m.emissiveIntensity = 0.25; }
      ghostMats.set(k, m);
    }
    return ghostMats.get(k);
  }
  const ghosts = new Map(); // id+bad -> object
  let ghost = null, ghostKey = '';
  async function ghostFor(id, bad) {
    const k = id + (bad ? ':b' : ':g');
    if (!ghosts.has(k)) {
      ghosts.set(k, template(id).then((t) => {
        if (!t) return null;
        const g = t.clone();
        g.traverse((m) => { if (m.isMesh) { m.material = ghostMat(m.material, bad); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 4; } });
        return g;
      }));
    }
    return ghosts.get(k);
  }
  const ghostHolder = new THREE.Group(); scene.add(ghostHolder);
  let ghostWiggle = 0;
  // What the cursor shows: ghost of the selected piece (yellow / red) or a blue frame round a placed piece.
  function anchorFor(id) {
    const s = id ? BY_ID.get(id).size : 1;
    return { x: Math.max(X0, Math.min(X0 + GW - s, cursor.x)), z: Math.max(Z0, Math.min(Z0 + GH - s, cursor.z)), s };
  }
  let cursorOn = false;
  function updateGhost() {
    const hoverPiece = picked || occ.get(key(cursor.x, cursor.z));
    const showCursor = cursorOn && inGrid(cursor.x, cursor.z);
    if (picked || (showCursor && hoverPiece && !(dragging))) {
      const p = picked || hoverPiece;
      const s = BY_ID.get(p.id).size;
      sizeFrame(s + 0.1); cursorG.position.copy(center(p)); cursorG.visible = true;
      frameMat.color.set('#6cc4ff'); fillMat.color.set('#bfe6ff'); fillMat.opacity = 0.25;
      ghostHolder.visible = false;
      invalidate();
      return;
    }
    cursorG.visible = showCursor;
    ghostHolder.visible = false;
    if (!showCursor) { invalidate(); return; }
    const a = anchorFor(sel);
    const bad = !!sel && (!fits(sel, a.x, a.z) || leftOf(sel) <= 0);
    sizeFrame(a.s); cursorG.position.set(a.x + a.s / 2, 0, a.z + a.s / 2);
    frameMat.color.set(bad ? '#ff6b6b' : '#fff27a'); fillMat.color.set(bad ? '#ff9b9b' : '#fff9c4'); fillMat.opacity = bad ? 0.35 : 0.3;
    if (sel) {
      ghostHolder.position.set(a.x + a.s / 2, 0, a.z + a.s / 2);
      ghostHolder.rotation.y = ghostR * Math.PI / 2;
      ghostHolder.visible = true;
      const k = sel + bad;
      if (k !== ghostKey) {
        ghostKey = k;
        ghostFor(sel, bad).then((g) => {
          if (ghostKey !== k) return;
          ghostHolder.clear(); if (g) ghostHolder.add(g);
          invalidate();
        });
      }
    }
    invalidate();
  }

  // ---------- Hero ----------
  const heroRoot = new THREE.Group(); scene.add(heroRoot);
  let mixer = null, actions = {}, curAction = null;
  const hero = { x: 0.5, z: 0.5, path: [], facing: 0, mode: 'idle', timer: 2.5, hop: 0, after: null, busy: 0 };
  async function loadHero() {
    const id = MQ.heroId(data.player && data.player.hero);
    const g = await loadGLB('pets/animal-' + id);
    if (!g) return;
    const o = shadows(g.scene);
    const box = new THREE.Box3().setFromObject(o); const sz = box.getSize(new THREE.Vector3());
    o.scale.setScalar(0.8 / Math.max(sz.x, sz.z));
    const b2 = new THREE.Box3().setFromObject(o); const c = b2.getCenter(new THREE.Vector3());
    o.position.set(-c.x, -b2.min.y, -c.z);
    heroRoot.add(o);
    mixer = new THREE.AnimationMixer(o);
    for (const clip of g.animations) actions[clip.name] = mixer.clipAction(clip);
    play('idle');
    invalidate();
  }
  function play(name) {
    const a = actions[name];
    if (!a || curAction === a) return;
    a.reset().fadeIn(0.2).play();
    if (curAction) curAction.fadeOut(0.2);
    curAction = a;
  }
  const walkable = (x, z) => inGrid(x, z) && (!occ.get(key(x, z)) || FLAT.has(occ.get(key(x, z)).id));
  const heroCell = () => ({ x: Math.floor(hero.x), z: Math.floor(hero.z) });
  function bfs(goal, limit = 400) {
    const s = heroCell();
    const prev = new Map([[key(s.x, s.z), null]]);
    const q = [s];
    while (q.length && prev.size < limit) {
      const c = q.shift();
      if (goal(c.x, c.z)) {
        const path = []; let k = key(c.x, c.z), cur = c;
        while (prev.get(k)) { path.unshift(cur); cur = prev.get(k); k = key(cur.x, cur.z); }
        return path;
      }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: c.x + dx, z: c.z + dz }, nk = key(n.x, n.z);
        if (prev.has(nk) || !walkable(n.x, n.z)) continue;
        prev.set(nk, c); q.push(n);
      }
    }
    return null;
  }
  function placeHeroStart() {
    // A free tile near the middle, next to the first building if there is one.
    let best = null, bd = Infinity;
    for (let x = X0; x < X0 + GW; x++) for (let z = Z0; z < Z0 + GH; z++) {
      if (!walkable(x, z)) continue;
      const d = Math.abs(x + 0.5) + Math.abs(z - 1.5);
      if (d < bd) { bd = d; best = { x, z }; }
    }
    if (best) { hero.x = best.x + 0.5; hero.z = best.z + 0.5; }
    hero.facing = 0;
  }
  function heroVisit(p, earned) {
    const fp = new Set(footprint(p).map(([x, z]) => key(x, z)));
    const c = heroCell();
    if (!walkable(c.x, c.z)) {
      // The piece landed on him: hop out of the way first.
      hero.path = [];
      const out = bfsFrom(c, (x, z) => walkable(x, z));
      if (out) { hero.hopFrom = { x: hero.x, z: hero.z }; hero.x = out.x + 0.5; hero.z = out.z + 0.5; hero.hop = 0.001; }
    }
    const next = (x, z) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => fp.has(key(x + dx, z + dz)));
    const path = next(heroCell().x, heroCell().z) ? [] : bfs(next);
    const pc = center(p);
    const celebrate = () => {
      hero.facing = Math.atan2(pc.x - hero.x, pc.z - hero.z);
      hero.mode = 'cheer'; hero.timer = earned ? 2.6 : 1.3;
      play(earned ? 'dance' : 'gesture-positive');
    };
    hero.path = path || [];
    hero.after = celebrate;
    hero.mode = hero.path.length ? 'walk' : 'arrive';
    if (hero.path.length) play('walk');
    invalidate();
  }
  function bfsFrom(start, ok) {
    const seen = new Set([key(start.x, start.z)]);
    const q = [start];
    while (q.length) {
      const c = q.shift();
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const n = { x: c.x + dx, z: c.z + dz }, nk = key(n.x, n.z);
        if (seen.has(nk) || !inGrid(n.x, n.z)) continue;
        if (ok(n.x, n.z)) return n;
        seen.add(nk); q.push(n);
      }
    }
    return null;
  }
  function stepHero(dt) {
    if (hero.hop > 0) {
      hero.hop = Math.min(1, hero.hop + dt / 0.35);
      if (hero.hop >= 1) hero.hop = 0;
    }
    if (hero.mode === 'walk') {
      const n = hero.path[0];
      if (!n) { hero.mode = 'arrive'; }
      else if (!walkable(n.x, n.z)) { hero.path = []; hero.mode = 'arrive'; }
      else {
        const tx = n.x + 0.5, tz = n.z + 0.5;
        const dx = tx - hero.x, dz = tz - hero.z, d = Math.hypot(dx, dz);
        const sp = 1.9 * dt;
        hero.facing = Math.atan2(dx, dz);
        if (d <= sp) { hero.x = tx; hero.z = tz; hero.path.shift(); }
        else { hero.x += dx / d * sp; hero.z += dz / d * sp; }
      }
    }
    if (hero.mode === 'arrive') {
      const f = hero.after; hero.after = null;
      hero.mode = 'idle'; hero.timer = 3 + Math.random() * 4; play('idle');
      if (f) f();
    } else if (hero.mode === 'cheer') {
      hero.timer -= dt;
      if (hero.timer <= 0) { hero.mode = 'idle'; hero.timer = 4 + Math.random() * 4; play('idle'); }
    } else if (hero.mode === 'idle') {
      hero.timer -= dt;
      if (hero.timer <= 0) {
        // Wander to a nearby spot, like a little animal exploring its town.
        const c = heroCell();
        const tx = c.x + Math.round((Math.random() - 0.5) * 8), tz = c.z + Math.round((Math.random() - 0.5) * 6);
        const path = walkable(tx, tz) ? bfs((x, z) => x === tx && z === tz, 200) : null;
        if (path && path.length) { hero.path = path; hero.mode = 'walk'; play('walk'); }
        else hero.timer = 1.5;
        if (hero.mode !== 'walk') hero.timer = 2 + Math.random() * 3;
      } else if (hero.timer < 1.2 && hero.timer > 1.1) {
        hero.facing = camYaw; // look at him now and then
      }
    }
    let x = hero.x, z = hero.z, y = 0;
    if (hero.hop > 0 && hero.hopFrom) { const k = hero.hop; x = hero.hopFrom.x + (hero.x - hero.hopFrom.x) * k; z = hero.hopFrom.z + (hero.z - hero.hopFrom.z) * k; y = Math.sin(k * Math.PI) * 0.6; }
    heroRoot.position.set(x, y, z);
    const turn = ((hero.facing - heroRoot.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    heroRoot.rotation.y += turn * Math.min(1, dt * 10);
    if (mixer) mixer.update(dt);
  }

  // ---------- Camera ----------
  let W = 1, H = 1;
  let yawIndex = 0, camYaw = 0, zoom = 1, zoomT = 1;
  const pan = new THREE.Vector3(), panT = new THREE.Vector3();
  let t = 0;
  const baseYaw = () => (W / H < 0.95 ? Math.PI / 2 : 0) + 0.14;
  const yawTarget = () => baseYaw() + yawIndex * Math.PI / 2;
  camYaw = 0;
  const PITCH = () => (W / H < 0.95 ? 1.12 : W / H > 1.8 ? 0.8 : 0.92);
  function fitView(yaw) {
    const pitch = PITCH();
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const pts = [];
    const m = 0.5;
    for (const x of [X0 - m, X0 + GW + m]) for (const z of [Z0 - m, Z0 + GH + m]) pts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 0.8, z));
    const target = new THREE.Vector3(X0 + GW / 2, 0, Z0 + GH / 2);
    let dist = 24;
    // leave room for the top bar
    const topPx = H < 500 ? 34 : 70, usable = (H - topPx) / H;
    for (let i = 0; i < 24; i++) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target); camera.updateMatrixWorld();
      let minX = 1, maxX = -1, minY = 1, maxY = -1;
      for (const p of pts) { const q = p.clone().project(camera); minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
      const ext = Math.max((maxX - minX) / 2 / 0.97, (maxY - minY) / 2 / (0.97 * usable));
      dist *= 0.5 + 0.5 * ext;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2 + (1 - usable);
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
      target.addScaledVector(right, cx * halfH * camera.aspect * 0.7).addScaledVector(up, cy * halfH * 0.7);
      target.y = 0;
    }
    return { dist, target, dir };
  }
  function clampPan(v) {
    const lim = (1 - 1 / zoom);
    v.x = Math.max(-GW / 2 * lim, Math.min(GW / 2 * lim, v.x));
    v.z = Math.max(-GH / 2 * lim, Math.min(GH / 2 * lim, v.z));
    v.y = 0;
    return v;
  }
  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 7);
    const yt = yawTarget();
    camYaw += (yt - camYaw) * k;
    zoom += (zoomT - zoom) * k;
    if (lastInput === 'key' && zoomT > 1.05 && cursorOn) {
      const c = new THREE.Vector3(cursor.x + 0.5 - (X0 + GW / 2), 0, cursor.z + 0.5 - (Z0 + GH / 2));
      panT.copy(c);
    }
    clampPan(panT);
    pan.lerp(panT, k);
    const sway = Math.sin(t * 0.12) * 0.035;
    const f = fitView(camYaw + sway);
    const target = f.target.clone().add(pan);
    camera.position.copy(target).addScaledVector(f.dir, f.dist / zoom);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    sun.target.position.set(X0 + GW / 2, 0, Z0 + GH / 2);
    sun.position.set(sun.target.position.x - 9, 16, sun.target.position.z + 8);
    return Math.abs(yt - camYaw) > 0.002 || Math.abs(zoomT - zoom) > 0.002 || pan.distanceTo(panT) > 0.01;
  }

  // ---------- Pointer → tile ----------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(ground, hit) ? hit : null;
  }
  function pieceAt(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(piecesGroup.children, true);
    for (const h of hits) { const p = h.object.userData.piece; if (p && pieces.includes(p) && !FLAT.has(p.id)) return p; }
    const g = groundAt(cx, cy);
    if (g) { const p = occ.get(key(Math.floor(g.x), Math.floor(g.z))); if (p) return p; }
    return null;
  }
  // Where a piece of `size` goes when the pointer is at ground point g (centred under the finger).
  function anchorAtPoint(g, size) { return { x: Math.round(g.x - size / 2), z: Math.round(g.z - size / 2) }; }

  function screenOf(v) {
    const p = v.clone().project(camera);
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
  }
  function placeActions() {
    if (!picked || !picked.obj) return;
    const h = picked.obj.userData.height || 1;
    const c = center(picked); c.y = h + 0.25;
    const s = screenOf(c);
    const el = $('actions');
    el.style.left = Math.max(70, Math.min(W - 70, s.x)) + 'px';
    el.style.top = Math.max(130, Math.min(H - 10, s.y)) + 'px';
  }

  // ---------- Frame loop: full speed while something moves, a calm 30 fps otherwise ----------
  let lastRender = 0, busyUntil = 0;
  function invalidate(ms = 120) { busyUntil = Math.max(busyUntil, performance.now() + ms); }
  function frame(now) {
    requestAnimationFrame(frame);
    const busy = tweens.length || bits.length || hero.mode === 'walk' || hero.hop > 0 || now < busyUntil;
    if (!busy && now - lastRender < 32) return;
    const dt = Math.min(0.05, (now - (lastRender || now)) / 1000);
    lastRender = now;
    t += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const tw = tweens[i]; tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) { tweens.splice(i, 1); if (tw.done) tw.done(); }
    }
    stepBits(dt);
    stepHero(dt);
    if (updateCamera(dt)) invalidate(60);
    // ambient life
    ripTex.offset.set(t * 0.012, t * 0.006);
    ripTex2.offset.set(-t * 0.008, t * 0.01);
    ripples.material.opacity = 0.45 + Math.sin(t * 0.8) * 0.12;
    pads.forEach((p, i) => { p.position.y = -0.33 + Math.sin(t * 1.2 + i) * 0.012; });
    const bt = t * 0.35;
    butterfly.position.set(Math.sin(bt) * 5.5 + Math.sin(bt * 2.3) * 1.2, 0.9 + Math.sin(bt * 3.1) * 0.3, Math.sin(bt * 1.4) * 3.6);
    butterfly.rotation.y = Math.atan2(Math.cos(bt) * 5.5, Math.cos(bt * 1.4) * 5) ;
    const flap = Math.sin(t * 18) * 0.9;
    wingL.rotation.z = flap; wingR.rotation.z = -flap;
    const pulse = 0.8 + Math.sin(t * 5) * 0.2;
    frameMat.opacity = pulse;
    if (ghostWiggle > 0) { ghostWiggle = Math.max(0, ghostWiggle - dt); ghostHolder.position.x += Math.sin(ghostWiggle * 60) * 0.03; }
    if (picked) placeActions();
    renderer.render(scene, camera);
  }

  const api = {
    canvas: renderer.domElement,
    resize(w, h) {
      W = Math.max(1, w); H = Math.max(1, h);
      renderer.setSize(W, H, false);
      renderer.domElement.style.width = W + 'px'; renderer.domElement.style.height = H + 'px';
      camera.aspect = W / H;
      camera.fov = W / H < 0.95 ? 40 : 34;
      camera.updateProjectionMatrix();
      if (!api.started) camYaw = yawTarget();
      invalidate();
    },
    start() {
      api.started = true;
      camYaw = yawTarget();
      placeHeroStart();
      syncAll();
      loadHero();
      decorate();
      requestAnimationFrame(frame);
      // Warm up the models in his tray so the first drop is instant.
      for (const it of trayItems()) if (it.kind !== 'locked') template(it.id);
    },
    syncAll, updateGhost, spinPiece, liftPiece, heroVisit, placeActions,
    dropPiece(p) { makePieceObj(p, true); },
    wiggleGhost() { ghostWiggle = 0.35; invalidate(400); },
    setCursorOn(v) { cursorOn = v; updateGhost(); },
    turn(dir = 1) { yawIndex += dir; invalidate(800); },
    zoomBy(f) { zoomT = Math.max(1, Math.min(2.8, zoomT * f)); if (zoomT <= 1.001) panT.set(0, 0, 0); invalidate(600); },
    panBy(dxPx, dyPx) {
      const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.position.distanceTo(new THREE.Vector3().copy(camera.position).setY(0)) ;
      const perPx = (2 * halfH) / H * 0.9;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0); right.y = 0; right.normalize();
      const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      panT.addScaledVector(right, -dxPx * perPx / zoom).addScaledVector(fwd, dyPx * perPx / zoom);
      clampPan(panT); pan.copy(panT);
      invalidate(200);
    },
    // Arrow keys move along the screen: work out which grid direction is "up" for this view.
    screenDir(k) {
      const yaw = yawTarget();
      const fwd = [-Math.sin(yaw), -Math.cos(yaw)], right = [Math.cos(yaw), -Math.sin(yaw)];
      const v = { ArrowUp: fwd, ArrowDown: [-fwd[0], -fwd[1]], ArrowRight: right, ArrowLeft: [-right[0], -right[1]] }[k];
      return Math.abs(v[0]) > Math.abs(v[1]) ? [Math.sign(v[0]), 0] : [0, Math.sign(v[1])];
    },
    groundAt, pieceAt, anchorAtPoint, invalidate,
    get heroState() { return { x: hero.x, z: hero.z, mode: hero.mode, anim: curAction ? curAction.getClip().name : null }; },
    get zoom() { return zoomT; },
    get yawIndex() { return yawIndex; },
    tileScreen(x, z) { return screenOf(new THREE.Vector3(x + 0.5, 0, z + 0.5)); },
  };
  return api;
}

// ---------------- Wire up the page ----------------
const stage = $('stage');
renderTray();
updateCount();
cursor.x = -1; cursor.z = 1;
{
  const first = tray.find((t) => t.kind === 'earned' && leftOf(t.id) > 0) || tray.find((t) => t.kind === 'free');
  if (first) select(first.id, { sound: false, scroll: false });
}

if (webglOK()) {
  try { gl = createWorld(stage); } catch (e) { gl = null; }
}
if (gl) {
  const fit = () => { const r = stage.getBoundingClientRect(); gl.resize(r.width, r.height); };
  fit();
  new ResizeObserver(fit).observe(stage);
  window.addEventListener('orientationchange', () => setTimeout(fit, 250));
  gl.start();
  gl.setCursorOn(!MQ.isTouch);
  setTimeout(() => $('loading').classList.add('done'), 400);
} else {
  $('loading').hidden = true;
  $('nogl').hidden = false;
  document.body.classList.add('no-gl');
}

// Welcome
const R0 = roundsDone();
if (!gl) { /* the fallback card says it all */ }
else if (R0 === 0) setTimeout(() => say(firstVisit ? 'This is your town! Play a game to earn your first house! 🏠' : 'Play a game to earn your first house! 🏠', { speak: firstVisit, ms: 6500 }), 700);
else if (firstVisit) setTimeout(() => say('This is your town! Pick a piece and place it.', { speak: true, ms: 6000 }), 700);
else if (newest && leftOf(newest.id) > 0) setTimeout(() => say(`New: ${newest.name}! Put it in your town.`, { ms: 4500 }), 700);

// ---------------- Keyboard ----------------
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); location.href = '../index.html'; return; }
  if (!gl) return;
  const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (lastInput !== 'key') { lastInput = 'key'; gl.setCursorOn(true); }
  if (arrows.includes(k)) {
    e.preventDefault();
    setPicked(null);
    const [dx, dz] = gl.screenDir(k);
    const nx = Math.max(X0, Math.min(X0 + GW - 1, cursor.x + dx)), nz = Math.max(Z0, Math.min(Z0 + GH - 1, cursor.z + dz));
    if (nx !== cursor.x || nz !== cursor.z) { cursor.x = nx; cursor.z = nz; MQ.Sound.note(79, 'wood', { dur: 0.04, vel: 0.12 }); }
    gl.updateGhost();
    return;
  }
  if (k === ' ' || k === 'Enter') {
    e.preventDefault();
    if (e.repeat) return;
    const on = occ.get(key(cursor.x, cursor.z));
    if (on) { MQ.Sound.nope(); say('Something is here! ⌫ picks it up.'); return; }
    const s = sel ? BY_ID.get(sel).size : 1;
    const ax = Math.max(X0, Math.min(X0 + GW - s, cursor.x)), az = Math.max(Z0, Math.min(Z0 + GH - s, cursor.z));
    placeAt(ax, az);
    return;
  }
  if (k === 'r' || k === 'R') {
    e.preventDefault();
    const on = picked || occ.get(key(cursor.x, cursor.z));
    if (on) rotatePiece(on);
    else { ghostR = (ghostR + 1) % 4; MQ.Sound.click(); gl.updateGhost(); }
    return;
  }
  if (k === 'Backspace' || k === 'Delete') {
    e.preventDefault();
    const on = picked || occ.get(key(cursor.x, cursor.z));
    if (on) removePiece(on); else MQ.Sound.nope();
    return;
  }
  if (k === 'Tab') { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); return; }
  if (k === 'q' || k === 'Q' || k === '[') { e.preventDefault(); cycle(-1); return; }
  if (k === 'e' || k === 'E' || k === ']') { e.preventDefault(); cycle(1); return; }
  if (k === 't' || k === 'T') { e.preventDefault(); turnView(); return; }
  if (k === '+' || k === '=') { e.preventDefault(); gl.zoomBy(1.25); return; }
  if (k === '-' || k === '_') { e.preventDefault(); gl.zoomBy(1 / 1.25); return; }
  if ((k === 'm' || k === 'M') && !e.repeat) { toggleMusic(); }
});

function turnView() { gl.turn(1); MQ.Sound.note(67, 'harp', { dur: 0.5, vel: 0.1 }); MQ.Sound.note(72, 'harp', { delay: 0.08, dur: 0.6, vel: 0.1 }); }
function toggleMusic() {
  data.settings.music = data.settings.music === false;
  MQ.applySettings(data.settings);
  MQ.save(data);
  syncMusicBtn();
}
function syncMusicBtn() { $('btn-music').classList.toggle('off', data.settings.music === false); }

// ---------------- Buttons ----------------
const tapBtn = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); fn(); e.currentTarget.blur(); });
tapBtn('btn-turn', () => gl && turnView());
tapBtn('btn-zoom-in', () => gl && gl.zoomBy(1.25));
tapBtn('btn-zoom-out', () => gl && gl.zoomBy(1 / 1.25));
tapBtn('btn-music', toggleMusic);
tapBtn('act-rotate', () => picked && rotatePiece(picked));
tapBtn('act-remove', () => picked && removePiece(picked));
syncMusicBtn();

// ---------------- Tray: tap to pick, or drag a picture onto the grass ----------------
const trayList = $('tray-list');
let trayDown = null;
trayList.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('[data-id], [data-locked]');
  if (!card) return;
  trayDown = { card, id: card.dataset.id, locked: card.dataset.locked, x: e.clientX, y: e.clientY, pid: e.pointerId };
});
trayList.addEventListener('click', (e) => {
  const lockedCard = e.target.closest('[data-locked]');
  if (lockedCard) {
    const it = tray.find((t) => t.id === lockedCard.dataset.locked);
    MQ.Sound.nope();
    say(`${it.rounds} more ${it.rounds === 1 ? 'round' : 'rounds'}! ⭐`, { speak: true });
    return;
  }
  const card = e.target.closest('[data-id]');
  if (!card) return;
  e.preventDefault(); card.blur();
  if (e.pointerType) lastInput = e.pointerType === 'mouse' ? 'mouse' : 'touch';
  select(card.dataset.id);
  if (gl && lastInput === 'touch') gl.setCursorOn(false);
  if (MQ.isTouch && leftOf(card.dataset.id) > 0) say('Now tap the grass! 👆', { ms: 2200 });
});
window.addEventListener('pointermove', (e) => {
  if (!trayDown || e.pointerId !== trayDown.pid || !gl) return;
  const dy = e.clientY - trayDown.y, dx = e.clientX - trayDown.x;
  if (!dragging && trayDown.id && dy < -18 && Math.abs(dy) > Math.abs(dx)) {
    // Pulled up out of the tray: carry the piece.
    dragging = { id: trayDown.id, pid: e.pointerId };
    select(trayDown.id, { scroll: false });
    const img = document.createElement('img');
    img.className = 'drag-pic'; img.src = `${ART}${trayDown.id}.webp`; img.alt = '';
    document.body.appendChild(img);
    dragging.img = img;
    try { trayDown.card.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  if (dragging) {
    e.preventDefault();
    dragging.img.style.left = e.clientX + 'px'; dragging.img.style.top = e.clientY + 'px';
    const sr = stage.getBoundingClientRect();
    const over = e.clientY < sr.bottom && e.clientY > sr.top;
    dragging.img.classList.toggle('over-stage', over);
    const g = over && gl.groundAt(e.clientX, e.clientY - (e.pointerType === 'touch' ? 40 : 0));
    if (g) {
      const s = BY_ID.get(dragging.id).size;
      const a = gl.anchorAtPoint(g, s);
      cursor.x = a.x; cursor.z = a.z;
      gl.setCursorOn(true);
    } else gl.setCursorOn(false);
  }
}, { passive: false });
function endTrayDrag(e) {
  if (!trayDown || e.pointerId !== trayDown.pid) return;
  trayDown = null;
  if (!dragging) return;
  const d = dragging; dragging = null;
  d.img.remove();
  const sr = stage.getBoundingClientRect();
  if (e.type === 'pointerup' && e.clientY < sr.bottom && gl && inGrid(cursor.x, cursor.z)) {
    const s = BY_ID.get(d.id).size;
    placeAt(Math.max(X0, Math.min(X0 + GW - s, cursor.x)), Math.max(Z0, Math.min(Z0 + GH - s, cursor.z)));
  }
  if (gl) gl.setCursorOn(lastInput !== 'touch');
}
window.addEventListener('pointerup', endTrayDrag);
window.addEventListener('pointercancel', endTrayDrag);

// ---------------- Stage: tap tiles and pieces, drag to look around, pinch / wheel to zoom ----------------
const pointers = new Map();
let gesture = null; // { kind: 'tap' | 'pan' | 'pinch', ... }
stage.addEventListener('pointerdown', (e) => {
  if (!gl || e.target !== gl.canvas) return;
  lastInput = e.pointerType === 'mouse' ? 'mouse' : 'touch';
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { gl.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  if (pointers.size === 1) gesture = { kind: 'tap', x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
  else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) };
  }
});
stage.addEventListener('pointermove', (e) => {
  if (!gl) return;
  if (!pointers.has(e.pointerId)) {
    // Mouse hovering: the glowing square follows it.
    if (e.pointerType === 'mouse' && e.target === gl.canvas && !dragging) {
      lastInput = 'mouse';
      const g = gl.groundAt(e.clientX, e.clientY);
      const p = gl.pieceAt(e.clientX, e.clientY);
      stage.classList.toggle('hovering', !!p);
      if (!picked && g) {
        let a;
        if (p) a = { x: p.x, z: p.z };
        else a = gl.anchorAtPoint(g, sel ? BY_ID.get(sel).size : 1);
        if (a.x !== cursor.x || a.z !== cursor.z || !inGrid(cursor.x, cursor.z)) { cursor.x = a.x; cursor.z = a.z; }
        gl.setCursorOn(inGrid(Math.floor(g.x), Math.floor(g.z)));
      }
    }
    return;
  }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;
  if (gesture.kind === 'pinch' && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (gesture.d > 0) gl.zoomBy(d / gesture.d);
    gesture.d = d;
    return;
  }
  if (gesture.kind === 'tap' && Math.hypot(e.clientX - gesture.x, e.clientY - gesture.y) > 10) { gesture.kind = 'pan'; stage.classList.add('panning'); }
  if (gesture.kind === 'pan') {
    if (gl.zoom > 1.01) gl.panBy(e.clientX - gesture.lx, e.clientY - gesture.ly);
    gesture.lx = e.clientX; gesture.ly = e.clientY;
  }
});
function stageUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  stage.classList.remove('panning');
  if (!gesture) return;
  const g0 = gesture;
  if (pointers.size === 0) gesture = null;
  if (g0.kind !== 'tap' || e.type !== 'pointerup') return;
  tapAt(e.clientX, e.clientY);
}
stage.addEventListener('pointerup', stageUp);
stage.addEventListener('pointercancel', stageUp);
function tapAt(cx, cy) {
  const p = gl.pieceAt(cx, cy);
  if (p) {
    if (picked === p) { setPicked(null); return; }
    cursor.x = p.x; cursor.z = p.z;
    setPicked(p);
    MQ.Sound.click();
    return;
  }
  if (picked) { setPicked(null); }
  const g = gl.groundAt(cx, cy);
  if (!g || !inGrid(Math.floor(g.x), Math.floor(g.z))) return;
  const s = sel ? BY_ID.get(sel).size : 1;
  const a = gl.anchorAtPoint(g, s);
  a.x = Math.max(X0, Math.min(X0 + GW - s, a.x)); a.z = Math.max(Z0, Math.min(Z0 + GH - s, a.z));
  cursor.x = a.x; cursor.z = a.z;
  gl.updateGhost();
  placeAt(a.x, a.z);
}
stage.addEventListener('wheel', (e) => {
  if (!gl) return;
  e.preventDefault();
  gl.zoomBy(Math.exp(-e.deltaY * 0.0022));
}, { passive: false });
// Safari's trackpad pinch
stage.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.stage, .tray')) e.preventDefault(); });

// ---------------- Stay in step with the other device ----------------
setInterval(() => {
  const now = JSON.stringify((data.town && data.town.placed) || []);
  if (now === savedSig) return;
  savedSig = now;
  readLayout();
  setPicked(null);
  renderTray();
  updateCount();
  if (gl) { gl.syncAll(); gl.updateGhost(); }
}, 1500);

// ---------------- Key reminders + music ----------------
MQ.Idle.attach(stage, {
  delay: 5000,
  active: () => lastInput === 'key' && !!gl,
  keys: () => {
    const on = occ.get(key(cursor.x, cursor.z));
    if (on) return [[['R'], 'turn'], [['⌫'], 'pick up'], [['←', '↑', '↓', '→'], 'move']];
    return [[['←', '↑', '↓', '→'], 'move'], [['space'], 'put'], [['Q', 'E'], 'pick']];
  },
});
MQ.Music.play('twinkle');

// Small hook for automated tests.
window.__town = {
  get pieces() { return pieces.map(({ id, x, z, r }) => ({ id, x, z, r })); },
  get sel() { return sel; }, get cursor() { return { ...cursor }; }, get picked() { return picked && { id: picked.id, x: picked.x, z: picked.z }; },
  get tray() { return tray.map((t) => ({ ...t, left: t.kind === 'locked' ? 0 : leftOf(t.id) })); },
  get hero() { return gl && gl.heroState; }, get gl() { return !!gl; },
  tileScreen: (x, z) => gl && gl.tileScreen(x, z),
};
