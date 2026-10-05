/**
 * LoL Monopoly — décors 3D du plateau, modélisés avec des formes simples :
 *  - buildRock()        : rocher stylisé sur un tapis d'herbe, mousse, fleurs et
 *                         son panneau « 100 % REAL ROCK! » ;
 *  - buildHextechChest(): le coffre hextech (cadre d'or, panneaux d'ardoise,
 *                         lueur turquoise qui filtre par les jointures) ;
 *  - buildRuneterra()   : une carte de Runeterra en relief (continents, montagnes,
 *                         neiges du Freljord, désert de Shurima, îles), en fond.
 */
import * as THREE from '/vendor/three/three.module.js';
import { mergeGeometries } from '/vendor/three-addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from '/vendor/three-addons/geometries/RoundedBoxGeometry.js';

/** Petit atelier : on empile des formes par matériau puis on les fusionne. */
function workshop() {
  const lists = {};
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  return {
    add(key, geo, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1]) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      g.deleteAttribute('uv');
      g.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
      (lists[key] ||= []).push(g);
    },
    build(materials) {
      const group = new THREE.Group();
      for (const [key, geos] of Object.entries(lists)) {
        const mesh = new THREE.Mesh(mergeGeometries(geos), materials[key]);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      return group;
    },
  };
}

/** Générateur pseudo-aléatoire reproductible. */
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// --- Rocher stylisé --------------------------------------------------------------
const ROCK_MATS = {
  rock: new THREE.MeshStandardMaterial({ color: 0xa8a096, roughness: 0.92, flatShading: true }),
  rockDark: new THREE.MeshStandardMaterial({ color: 0x878075, roughness: 0.95, flatShading: true }),
  ground: new THREE.MeshStandardMaterial({ color: 0x3f7a2c, roughness: 0.95 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x5f9e34, roughness: 0.9 }),
  moss: new THREE.MeshStandardMaterial({ color: 0x356a22, roughness: 0.95 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff8a3a, roughness: 0.6, emissive: 0x402000, emissiveIntensity: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x7a9aff, roughness: 0.6, emissive: 0x101a40, emissiveIntensity: 0.3 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x7a5232, roughness: 0.85 }),
};
let rockTemplate = null;

function signMaterial() {
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 192;
  const g = cv.getContext('2d');
  g.fillStyle = '#8a5c36';
  g.fillRect(0, 0, 512, 192);
  g.strokeStyle = 'rgba(60,35,18,0.55)';
  g.lineWidth = 3;
  for (let y = 24; y < 192; y += 30) { g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y - 6, 340, y + 6, 512, y); g.stroke(); }
  g.fillStyle = '#f2e2c4';
  g.textAlign = 'center';
  g.font = '700 64px "Comic Sans MS", Chalkboard, Georgia, serif';
  g.fillText('100%', 256, 82);
  g.font = '700 50px "Comic Sans MS", Chalkboard, Georgia, serif';
  g.fillText('REAL ROCK!', 256, 150);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
}

function makeRockTemplate() {
  const w = workshop();
  const rand = seeded(42);
  // tapis d'herbe légèrement bombé
  w.add('ground', new THREE.CylinderGeometry(1.0, 1.1, 0.12, 24), [0, 0.06, 0], [0, 0, 0], [1.2, 1, 0.9]);
  w.add('ground', new THREE.SphereGeometry(0.9, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), [0, 0.1, 0], [0, 0, 0], [1.25, 0.12, 0.95]);
  // blocs de pierre empilés en gradins, arêtes adoucies
  const blocks = [
    [[0, 0.42, 0], [1.35, 0.72, 1.0], 0.2, 0.04],
    [[-0.55, 0.27, 0.28], [0.72, 0.52, 0.62], -0.35, 0.08],
    [[0.18, 0.9, -0.08], [1.0, 0.44, 0.78], 0.35, -0.05],
    [[0.62, 0.32, 0.32], [0.62, 0.56, 0.56], 0.55, 0],
    [[-0.22, 1.2, -0.12], [0.62, 0.26, 0.52], -0.1, 0.1],
    [[0.66, 0.15, -0.5], [0.4, 0.28, 0.34], 0.2, 0],
    [[-0.75, 0.13, -0.35], [0.36, 0.22, 0.3], -0.4, 0.05],
  ];
  blocks.forEach(([pos, size, ry, rz], k) => {
    w.add(k % 3 === 1 ? 'rockDark' : 'rock', new RoundedBoxGeometry(size[0], size[1], size[2], 2, 0.07), pos, [0, ry, rz]);
  });
  // fissures : petites entailles sombres
  for (const [x, y, z, ry] of [[0.1, 1.13, 0.22, 0.3], [-0.3, 0.6, 0.52, -0.2], [0.45, 0.62, 0.48, 0.5]]) {
    w.add('rockDark', new THREE.BoxGeometry(0.22, 0.02, 0.04), [x, y, z], [0, ry, 0.2]);
  }
  // mousse qui coule sur les flancs
  for (const [x, y, z, s] of [[0.5, 0.62, 0.42, 0.2], [-0.3, 0.45, 0.55, 0.17], [0.75, 0.48, 0.05, 0.16], [-0.05, 1.08, 0.3, 0.14], [-0.82, 0.3, 0.2, 0.13]]) {
    w.add('moss', new THREE.SphereGeometry(s, 10, 8), [x, y, z], [0, 0, 0], [1, 1.4, 0.3]);
  }
  // brins d'herbe et fleurs autour
  const blade = new THREE.ConeGeometry(0.03, 0.16, 4);
  const flower = new THREE.SphereGeometry(0.035, 6, 5);
  for (let k = 0; k < 70; k++) {
    const a = rand() * Math.PI * 2;
    const r = 0.75 + rand() * 0.35;
    const x = Math.cos(a) * r * 1.15;
    const z = Math.sin(a) * r * 0.85;
    w.add('grass', blade, [x, 0.18, z], [(rand() - 0.5) * 0.5, 0, (rand() - 0.5) * 0.5]);
    if (k % 4 === 0) w.add(k % 8 ? 'orange' : 'blue', flower, [x + 0.04, 0.17, z + 0.03]);
  }
  // panneau en bois planté devant
  w.add('wood', new THREE.BoxGeometry(0.07, 0.62, 0.07), [-0.85, 0.32, 0.62], [0.05, 0, 0.12]);
  const group = w.build(ROCK_MATS);
  const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.27, 0.05), [ROCK_MATS.wood, ROCK_MATS.wood, ROCK_MATS.wood, ROCK_MATS.wood, signMaterial(), ROCK_MATS.wood]);
  plank.position.set(-0.86, 0.5, 0.66);
  plank.rotation.set(0.05, 0.45, 0.1);
  plank.castShadow = true;
  group.add(plank);
  return group;
}

/** Un rocher (environ 2,4 de large sur 1,3 de haut, à mettre à l'échelle). */
export function buildRock() {
  if (!rockTemplate) rockTemplate = makeRockTemplate();
  return rockTemplate.clone();
}

// --- Coffre hextech ------------------------------------------------------------------
/** Le coffre (1 de côté), posé en y = 0. userData.animate(t) le fait vivre. */
export function buildHextechChest() {
  const gold = new THREE.MeshPhysicalMaterial({ color: 0xeec060, metalness: 0.95, roughness: 0.22, clearcoat: 0.6 });
  const slate = new THREE.MeshPhysicalMaterial({ color: 0x2c3c4c, metalness: 0.55, roughness: 0.35, clearcoat: 0.4 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x9ff3f8, emissive: 0x2ad8e0, emissiveIntensity: 1.6 });
  const w = workshop();
  const H = 0.5; // demi-côté
  // cœur lumineux qui filtre par les jointures
  w.add('glow', new THREE.BoxGeometry(0.94, 0.94, 0.94), [0, H, 0]);
  // panneaux d'ardoise de chaque face (un peu en retrait du cadre)
  const P = 0.82;
  for (const [x, z, ry] of [[0, H - 0.02, 0], [0, -H + 0.02, 0], [H - 0.02, 0, Math.PI / 2], [-H + 0.02, 0, Math.PI / 2]]) {
    w.add('slate', new THREE.BoxGeometry(P, 0.6, 0.03), [x, 0.38, z], [0, ry, 0]); // bas
    w.add('slate', new THREE.BoxGeometry(P, 0.2, 0.03), [x, 0.84, z], [0, ry, 0]); // couvercle
  }
  w.add('slate', new THREE.BoxGeometry(P, 0.03, P), [0, 2 * H - 0.02, 0]);
  // cadre d'or : les 12 arêtes
  const T = 0.09;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) w.add('gold', new THREE.BoxGeometry(T, 1, T), [sx * (H - T / 2 + 0.01), H, sz * (H - T / 2 + 0.01)]);
    for (const y of [T / 2, 1 - T / 2]) {
      w.add('gold', new THREE.BoxGeometry(T, T, 1), [sx * (H - T / 2 + 0.01), y, 0]);
      w.add('gold', new THREE.BoxGeometry(1, T, T), [0, y, sx * (H - T / 2 + 0.01)]);
    }
  }
  // ceinture du couvercle
  for (const [x, z, ry] of [[0, H + 0.005, 0], [0, -H - 0.005, 0], [H + 0.005, 0, Math.PI / 2], [-H - 0.005, 0, Math.PI / 2]]) {
    w.add('gold', new THREE.BoxGeometry(1.0, 0.05, 0.04), [x, 0.7, z], [0, ry, 0]);
  }
  // motif hextech en relief sur chaque face : deux crochets et un losange
  for (const [x, z, ry, nx, nz] of [[0, H, 0, 0, 1], [0, -H, Math.PI, 0, -1], [H, 0, Math.PI / 2, 1, 0], [-H, 0, -Math.PI / 2, -1, 0]]) {
    const o = 0.03;
    const at = (u, y) => [x + nx * o + Math.cos(ry) * u, y, z + nz * o - Math.sin(ry) * u];
    for (const s of [-1, 1]) {
      w.add('gold', new THREE.BoxGeometry(0.05, 0.42, 0.04), at(s * 0.2, 0.38), [0, ry, 0]);
      w.add('gold', new THREE.BoxGeometry(0.16, 0.05, 0.04), at(s * 0.13, 0.57), [0, ry, 0]);
      w.add('gold', new THREE.BoxGeometry(0.12, 0.05, 0.04), at(s * 0.15, 0.19), [0, ry, s * 0.5]);
    }
    w.add('gold', new THREE.BoxGeometry(0.13, 0.13, 0.04), at(0, 0.4), [0, ry, Math.PI / 4]);
    w.add('glow', new THREE.BoxGeometry(0.07, 0.07, 0.05), at(0, 0.4), [0, ry, Math.PI / 4]);
  }
  // plaque du dessus avec sa poignée
  w.add('gold', new THREE.BoxGeometry(0.5, 0.04, 0.32), [0, 1.02, 0]);
  w.add('slate', new THREE.BoxGeometry(0.34, 0.05, 0.16), [0, 1.03, 0]);
  w.add('gold', new THREE.TorusGeometry(0.09, 0.022, 6, 16, Math.PI), [0, 1.04, 0]);
  const chest = w.build({ gold, slate, glow });
  // anneau de lumière au sol et petite lumière
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.95, 48),
    new THREE.MeshBasicMaterial({ color: 0x5fe0f0, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.01;
  const light = new THREE.PointLight(0x5fe0f0, 2.5, 2.5, 1.6);
  light.position.y = 0.6;
  const root = new THREE.Group();
  root.add(chest, halo, light);
  root.userData.animate = (t) => {
    chest.position.y = 0.06 + Math.sin(t * 1.4) * 0.04;
    chest.rotation.y = Math.sin(t * 0.5) * 0.25;
    glow.emissiveIntensity = 1.3 + Math.sin(t * 2.4) * 0.5;
    halo.material.opacity = 0.25 + Math.sin(t * 2.4) * 0.1;
    light.intensity = 2 + Math.sin(t * 2.4) * 0.8;
  };
  return root;
}

// --- Carte de Runeterra en relief ------------------------------------------------------
function makeNoise(seed) {
  const rand = seeded(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let k = 0; k < N; k++) { perm[k] = k; vals[k] = rand(); }
  for (let k = N - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [perm[k], perm[j]] = [perm[j], perm[k]]; }
  for (let k = 0; k < N; k++) perm[k + N] = perm[k];
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 255]];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = smooth(x - xi);
    const fy = smooth(y - yi);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx;
    return a + (b - a) * fy;
  };
  return (x, y, octaves = 5) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < octaves; o++) { sum += amp * noise(x * f, y * f); amp *= 0.5; f *= 2.03; }
    return sum; // ~0..1
  };
}

/**
 * Carte de Runeterra : un terrain en relief de `width` x `depth` unités, à poser
 * sous le plateau. Les régions sont placées comme sur la carte du jeu.
 */
export function buildRuneterra({ width = 46, depth = 30, segX = 160, segZ = 104 } = {}) {
  const fbm = makeNoise(11);
  const ridge = makeNoise(29);
  // continents et îles (coordonnées -1..1, x vers l'est, y vers le sud)
  const lands = [
    { u: -0.42, v: -0.62, r: 0.36, region: 'freljord' },
    { u: -0.12, v: -0.66, r: 0.25, region: 'freljord' },
    { u: -0.6, v: -0.12, r: 0.3, region: 'demacia' },
    { u: -0.15, v: -0.2, r: 0.32, region: 'noxus' },
    { u: 0.18, v: -0.28, r: 0.26, region: 'noxus' },
    { u: -0.1, v: 0.38, r: 0.44, region: 'shurima' },
    { u: 0.28, v: 0.3, r: 0.3, region: 'shurima' },
    { u: -0.45, v: 0.3, r: 0.22, region: 'targon' },
    { u: 0.12, v: 0.72, r: 0.24, region: 'jungle' },
    { u: 0.72, v: -0.32, r: 0.2, region: 'ionia' },
    { u: 0.62, v: -0.12, r: 0.12, region: 'ionia' },
    { u: 0.74, v: 0.32, r: 0.08, region: 'bilgewater' },
    { u: 0.66, v: 0.42, r: 0.06, region: 'bilgewater' },
    { u: 0.88, v: 0.72, r: 0.08, region: 'shadow' },
  ];
  const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /** Altitude, région et grain de bruit d'un point de la carte (u, v dans -1..1). */
  const sample = (u, v) => {
    const n = fbm(u * 3 + 10, v * 3 + 10);
    let land = -1;
    let region = 'sea';
    for (const L of lands) {
      const val = 1 - Math.hypot(u - L.u, (v - L.v) * 1.15) / L.r + (n - 0.5) * 0.9;
      if (val > land) { land = val; region = L.region; }
    }
    let h;
    if (land > 0) {
      const r = 1 - Math.abs(ridge(u * 5, v * 5, 4) * 2 - 1); // crêtes montagneuses
      const mountains = region === 'freljord' || region === 'targon' ? 1.6 : region === 'shurima' ? 0.45 : 1;
      h = 0.08 + land * 0.5 + r * r * 0.9 * mountains * Math.min(1, land * 3);
      if (region === 'targon') h += Math.max(0, 0.6 - Math.hypot(u + 0.47, v - 0.28) * 6) * 2.4; // le mont Targon
    } else {
      h = land * 1.2; // fonds marins
    }
    return { h, region, n };
  };
  const C = (hex) => new THREE.Color(hex);
  const PAL = {
    deep: C(0x164a6e), shallow: C(0x3a9ab4), sand: C(0xe2cc94), grass: C(0x7aa84a), forest: C(0x4a7a36),
    rock: C(0x8f8576), snow: C(0xf4f8fc), ice: C(0x7f9aac), desert: C(0xe4bc7c), dune: C(0xc49a5e),
    shadow: C(0x34564e), purple: C(0x5a4a6a),
  };
  const colorAt = ({ h, region, n }, out) => {
    if (h < 0) return out.copy(PAL.deep).lerp(PAL.shallow, smooth(-0.4, 0, h));
    // couleur de base de la région
    if (region === 'freljord') out.copy(PAL.ice).lerp(PAL.rock, smooth(0.45, 0.7, n) * 0.4);
    else if (region === 'shurima') out.copy(PAL.desert).lerp(PAL.dune, smooth(0.4, 0.65, n));
    else if (region === 'shadow') out.copy(PAL.shadow).lerp(PAL.purple, n);
    else out.copy(PAL.grass).lerp(PAL.forest, smooth(0.45, 0.62, n));
    // plage, roche en altitude, neige au sommet
    out.lerp(PAL.rock, smooth(0.65, 1.0, h) * (region === 'freljord' ? 0.3 : 0.8));
    out.lerp(PAL.snow, smooth(region === 'freljord' ? 0.6 : 1.05, region === 'freljord' ? 1.1 : 1.35, h) * 0.9);
    return out.lerp(PAL.sand, 1 - smooth(0.02, 0.12, h));
  };
  // texture peinte point par point (plus fine que le maillage)
  const TW = 768;
  const TH = Math.round((TW * depth) / width);
  const cv = document.createElement('canvas');
  cv.width = TW;
  cv.height = TH;
  const g = cv.getContext('2d');
  const img = g.createImageData(TW, TH);
  const c = new THREE.Color();
  for (let py = 0; py < TH; py++) {
    for (let px = 0; px < TW; px++) {
      const p = sample(-1 + (2 * px) / (TW - 1), -1 + (2 * py) / (TH - 1));
      colorAt(p, c);
      const shade = 1 + (p.n - 0.5) * 0.12;
      const k = (py * TW + px) * 4;
      img.data[k] = Math.min(255, c.r * 255 * shade);
      img.data[k + 1] = Math.min(255, c.g * 255 * shade);
      img.data[k + 2] = Math.min(255, c.b * 255 * shade);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // relief
  const geo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let k = 0; k < pos.count; k++) {
    pos.setY(k, sample(pos.getX(k) / (width / 2), pos.getZ(k) / (depth / 2)).h);
  }
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 }));
  terrain.receiveShadow = false;
  // la mer, avec un léger reflet
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(width * 1.6, depth * 1.8),
    new THREE.MeshStandardMaterial({ color: 0x2a6a8c, transparent: true, opacity: 0.55, roughness: 0.55, metalness: 0 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.02;
  const group = new THREE.Group();
  group.add(terrain, sea);
  return group;
}
