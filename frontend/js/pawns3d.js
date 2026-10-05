/**
 * LoL Monopoly — pions modélisés en 3D (Three.js), à partir de formes simples.
 *
 * Chaque pion est un groupe posé sur un socle doré, d'environ 0,6 unité de haut
 * (une case fait ~0,74 de large), qui regarde vers +Z. La couleur du joueur est
 * reprise par le liseré du socle (et par tout le pion classique).
 */
import * as THREE from '/vendor/three/three.module.js';

const mats = new Map();
/** Matériau partagé (même paramètres = même matériau). */
function mat(params) {
  const key = JSON.stringify(params);
  if (!mats.has(key)) {
    const { physical, ...rest } = params;
    mats.set(key, physical ? new THREE.MeshPhysicalMaterial(rest) : new THREE.MeshStandardMaterial(rest));
  }
  return mats.get(key);
}

const GOLD = { color: 0xd4a84a, metalness: 0.85, roughness: 0.28 };
const DARK = { color: 0x0b0f14, roughness: 0.4 };

function mesh(geo, params, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat(params));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Œil brillant : globe sombre + reflet blanc. */
function eye(r, iris, x, y, z) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(r, 16, 12), { color: iris, roughness: 0.15, metalness: 0.1 }));
  const shine = mesh(new THREE.SphereGeometry(r * 0.35, 10, 8), { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.6 });
  shine.position.set(r * 0.35, r * 0.4, r * 0.75);
  g.add(shine);
  g.position.set(x, y, z);
  return g;
}

// --- Les pions ---------------------------------------------------------------

function poro() {
  const g = new THREE.Group();
  const fur = { color: 0xf4f8fc, roughness: 0.85 };
  const body = mesh(new THREE.SphereGeometry(0.2, 24, 18), fur, 0, 0.24, 0);
  body.scale.set(1.05, 0.95, 1);
  g.add(body);
  // touffes de poils tout autour
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const tuft = mesh(new THREE.ConeGeometry(0.045, 0.1, 6), fur);
    tuft.position.set(Math.cos(a) * 0.19, 0.3 + Math.sin(k * 1.7) * 0.05, Math.sin(a) * 0.19);
    tuft.lookAt(Math.cos(a) * 2, 0.35, Math.sin(a) * 2);
    tuft.rotateX(Math.PI / 2);
    g.add(tuft);
  }
  // cornes
  for (const s of [-1, 1]) {
    const horn = mesh(new THREE.ConeGeometry(0.035, 0.16, 8), { color: 0xe8d6a8, roughness: 0.5 }, s * 0.11, 0.46, -0.02);
    horn.rotation.z = -s * 0.45;
    g.add(horn);
  }
  g.add(eye(0.055, 0x1b3a7a, -0.075, 0.28, 0.16), eye(0.055, 0x1b3a7a, 0.075, 0.28, 0.16));
  const mouth = mesh(new THREE.SphereGeometry(0.05, 12, 8), { color: 0x3a0c18, roughness: 0.6 }, 0, 0.17, 0.18);
  mouth.scale.set(1.3, 0.6, 0.6);
  const tongue = mesh(new THREE.SphereGeometry(0.03, 10, 8), { color: 0xff7aa0, roughness: 0.5 }, 0, 0.14, 0.2);
  tongue.scale.set(1, 1.4, 0.6);
  g.add(mouth, tongue);
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.05, 12, 8), fur, s * 0.1, 0.05, 0.08));
  return g;
}

function teemo() {
  const g = new THREE.Group();
  const stemProfile = [[0, 0], [0.11, 0], [0.1, 0.06], [0.08, 0.2], [0.075, 0.3], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(mesh(new THREE.LatheGeometry(stemProfile, 18), { color: 0xf3e6c4, roughness: 0.7 }));
  const cap = mesh(new THREE.SphereGeometry(0.22, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), { color: 0x8445cc, roughness: 0.45 }, 0, 0.28, 0);
  cap.scale.set(1, 0.85, 1);
  const under = mesh(new THREE.CircleGeometry(0.22, 24), { color: 0x4a2470, side: THREE.DoubleSide }, 0, 0.28, 0);
  under.rotation.x = Math.PI / 2;
  g.add(cap, under);
  const spot = { color: 0x7dff6a, emissive: 0x2a8a20, emissiveIntensity: 0.5, roughness: 0.4 };
  [[0.1, 0.4, 0.12, 0.05], [-0.12, 0.38, 0.1, 0.045], [0.02, 0.45, -0.12, 0.05], [-0.06, 0.47, 0.02, 0.035], [0.15, 0.36, -0.06, 0.04]]
    .forEach(([x, y, z, r]) => g.add(mesh(new THREE.SphereGeometry(r, 10, 8), spot, x, y, z)));
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), DARK, s * 0.03, 0.16, 0.085));
  return g;
}

function ward() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.34, 8), { color: 0x4f8a34, roughness: 0.7 }, 0, 0.17, 0));
  for (const s of [-1, 1]) {
    const leaf = mesh(new THREE.ConeGeometry(0.05, 0.16, 6), { color: 0x6fb44a, roughness: 0.6 }, s * 0.07, 0.24, 0);
    leaf.rotation.z = s * 1.1;
    leaf.scale.set(1, 1, 0.4);
    g.add(leaf);
  }
  const pod = mesh(new THREE.SphereGeometry(0.13, 20, 14), { color: 0x24401a, roughness: 0.5 }, 0, 0.47, 0);
  pod.scale.set(1, 1.15, 0.9);
  const rim = mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 24), GOLD, 0, 0.47, 0.105);
  const glow = mesh(new THREE.SphereGeometry(0.08, 18, 12), { color: 0xffe14a, emissive: 0xffc81e, emissiveIntensity: 1.6, roughness: 0.2 }, 0, 0.47, 0.085);
  glow.scale.set(1, 0.85, 0.55);
  const slit = mesh(new THREE.BoxGeometry(0.02, 0.09, 0.02), DARK, 0, 0.47, 0.128);
  g.add(pod, rim, glow, slit);
  return g;
}

function minion() {
  const g = new THREE.Group();
  const armor = { color: 0x3a78d8, metalness: 0.55, roughness: 0.35 };
  const robe = mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.26, 16), { color: 0x34507e, roughness: 0.7 }, 0, 0.13, 0);
  const belt = mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.035, 16), GOLD, 0, 0.25, 0);
  const helmetProfile = [[0, 0], [0.15, 0], [0.155, 0.08], [0.14, 0.17], [0.1, 0.24], [0.04, 0.27], [0, 0.275]].map(([x, y]) => new THREE.Vector2(x, y));
  const helmet = mesh(new THREE.LatheGeometry(helmetProfile, 20), armor, 0, 0.27, 0);
  const visor = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), DARK, 0, 0.37, 0.12);
  const eyesMat = { color: 0x9fe8ff, emissive: 0x5fe0f0, emissiveIntensity: 1.8 };
  const eyes = [-1, 1].map((s) => mesh(new THREE.BoxGeometry(0.055, 0.016, 0.01), eyesMat, s * 0.045, 0.372, 0.152));
  const crest = mesh(new THREE.ConeGeometry(0.03, 0.1, 8), GOLD, 0, 0.59, 0);
  const shoulders = [-1, 1].map((s) => mesh(new THREE.SphereGeometry(0.06, 12, 10), armor, s * 0.13, 0.27, 0));
  g.add(robe, belt, helmet, visor, ...eyes, crest, ...shoulders);
  return g;
}

function zhonya() {
  const g = new THREE.Group();
  const glass = { physical: true, color: 0xdff6ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0, clearcoat: 1 };
  const sand = { color: 0xf0c040, roughness: 0.8, emissive: 0x6a4a08, emissiveIntensity: 0.4 };
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 20), GOLD, 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 20), GOLD, 0, 0.58, 0));
  const top = mesh(new THREE.ConeGeometry(0.12, 0.25, 20, 1, true), glass, 0, 0.43, 0);
  top.rotation.x = Math.PI;
  const bottom = mesh(new THREE.ConeGeometry(0.12, 0.25, 20, 1, true), glass, 0, 0.17, 0);
  const sandTop = mesh(new THREE.ConeGeometry(0.08, 0.14, 16), sand, 0, 0.4, 0);
  sandTop.rotation.x = Math.PI;
  const sandBottom = mesh(new THREE.ConeGeometry(0.1, 0.1, 16), sand, 0, 0.09, 0);
  const stream = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), sand, 0, 0.24, 0);
  g.add(top, bottom, sandTop, sandBottom, stream);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.54, 8), GOLD, Math.cos(a) * 0.13, 0.3, Math.sin(a) * 0.13));
  }
  g.add(mesh(new THREE.SphereGeometry(0.028, 10, 8), { color: 0x5fe0f0, emissive: 0x0ac8b9, emissiveIntensity: 1.2 }, 0, 0.62, 0));
  return g;
}

function blade() {
  const g = new THREE.Group();
  const steel = { color: 0xdfe6ee, metalness: 0.95, roughness: 0.18 };
  g.add(mesh(new THREE.SphereGeometry(0.035, 12, 10), GOLD, 0, 0.035, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.13, 10), { color: 0x7a3218, roughness: 0.8 }, 0, 0.13, 0));
  const guard = mesh(new THREE.BoxGeometry(0.24, 0.035, 0.05), GOLD, 0, 0.21, 0);
  const gem = mesh(new THREE.SphereGeometry(0.026, 12, 10), { color: 0xe84057, emissive: 0x8a0a1a, emissiveIntensity: 0.8, roughness: 0.1 }, 0, 0.21, 0.03);
  const bladeMesh = mesh(new THREE.BoxGeometry(0.06, 0.34, 0.016), steel, 0, 0.4, 0);
  const tip = mesh(new THREE.CylinderGeometry(0, 0.043, 0.08, 4), steel, 0, 0.61, 0);
  tip.rotation.y = Math.PI / 4;
  tip.scale.set(1, 1, 0.27);
  const fuller = mesh(new THREE.BoxGeometry(0.012, 0.3, 0.02), { color: 0x8a96a4, metalness: 0.9, roughness: 0.3 }, 0, 0.4, 0);
  g.add(guard, gem, bladeMesh, tip, fuller);
  return g;
}

function tibbers() {
  const g = new THREE.Group();
  const furParams = { color: 0x8a5530, roughness: 0.9 };
  const belly = { color: 0xe6c08e, roughness: 0.85 };
  const body = mesh(new THREE.SphereGeometry(0.14, 18, 14), furParams, 0, 0.17, 0);
  body.scale.set(1, 1.15, 0.9);
  const tummy = mesh(new THREE.SphereGeometry(0.09, 14, 10), belly, 0, 0.16, 0.07);
  tummy.scale.set(1, 1.1, 0.6);
  const head = mesh(new THREE.SphereGeometry(0.13, 18, 14), furParams, 0, 0.4, 0);
  const snout = mesh(new THREE.SphereGeometry(0.06, 12, 10), belly, 0, 0.37, 0.11);
  snout.scale.set(1.2, 0.9, 0.8);
  const nose = mesh(new THREE.SphereGeometry(0.022, 10, 8), DARK, 0, 0.39, 0.16);
  const ears = [-1, 1].map((s) => mesh(new THREE.SphereGeometry(0.045, 12, 10), furParams, s * 0.1, 0.51, 0));
  const button = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 14), { color: 0xfff4d0, roughness: 0.3 }, 0.05, 0.43, 0.115);
  button.rotation.x = Math.PI / 2;
  const cross = [0.7, -0.7].map((r) => {
    const m = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), DARK, -0.05, 0.43, 0.122);
    m.rotation.z = r;
    return m;
  });
  const arms = [-1, 1].map((s) => {
    const a = mesh(new THREE.CapsuleGeometry(0.035, 0.09, 4, 8), furParams, s * 0.15, 0.2, 0.02);
    a.rotation.z = s * 0.6;
    return a;
  });
  const legs = [-1, 1].map((s) => mesh(new THREE.CapsuleGeometry(0.04, 0.04, 4, 8), furParams, s * 0.07, 0.04, 0.03));
  const flame = mesh(new THREE.ConeGeometry(0.03, 0.09, 8), { color: 0xff8a2a, emissive: 0xff5a0a, emissiveIntensity: 1.5 }, -0.15, 0.32, 0);
  g.add(body, tummy, head, snout, nose, ...ears, button, ...cross, ...arms, ...legs, flame);
  return g;
}

function egg() {
  const g = new THREE.Group();
  const ice = { physical: true, color: 0xaee6ff, roughness: 0.12, metalness: 0, clearcoat: 1, emissive: 0x2a6a9a, emissiveIntensity: 0.25 };
  const shell = mesh(new THREE.SphereGeometry(0.17, 24, 18), ice, 0, 0.26, 0);
  shell.scale.set(1, 1.35, 1);
  g.add(shell);
  const crystal = { color: 0xe8faff, emissive: 0x7fd0ff, emissiveIntensity: 0.6, roughness: 0.1, flatShading: true };
  [[0, 0.52, 0, 0], [-0.08, 0.48, 0.02, 0.5], [0.08, 0.48, -0.02, -0.5], [0.04, 0.47, 0.08, -0.3]].forEach(([x, y, z, r]) => {
    const c = mesh(new THREE.ConeGeometry(0.03, 0.12, 5), crystal, x, y, z);
    c.rotation.z = r;
    g.add(c);
  });
  const crack = mesh(new THREE.TorusGeometry(0.172, 0.006, 6, 30), { color: 0xffffff, emissive: 0xbfefff, emissiveIntensity: 0.8 }, 0, 0.26, 0);
  crack.rotation.x = Math.PI / 2;
  crack.scale.set(1, 1, 1);
  g.add(crack);
  return g;
}

function classic(color) {
  const profile = [
    [0, 0], [0.16, 0], [0.16, 0.04], [0.13, 0.06], [0.11, 0.1], [0.08, 0.18], [0.06, 0.31],
    [0.1, 0.33], [0.1, 0.36], [0.055, 0.38], [0.08, 0.43], [0.085, 0.48], [0.07, 0.53], [0.04, 0.56], [0, 0.57],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.Group();
  g.add(mesh(new THREE.LatheGeometry(profile, 28), { color: new THREE.Color(color).getHex(), metalness: 0.4, roughness: 0.3 }));
  return g;
}

const BUILDERS = { poro, teemo, ward, minion, zhonya, blade, tibbers, egg };

/** Construit le pion `kind` (posé sur un socle doré liseré à la couleur du joueur). */
export function buildPawn(kind, color) {
  const root = new THREE.Group();
  const base = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 28), GOLD, 0, 0.025, 0);
  // liseré à la couleur du joueur, autour du socle (sous son dessus pour éviter le scintillement)
  const band = mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.022, 28), {
    color: new THREE.Color(color).getHex(), emissive: new THREE.Color(color).getHex(), emissiveIntensity: 0.6, roughness: 0.4,
  }, 0, 0.022, 0);
  const model = (BUILDERS[kind] || (() => classic(color)))();
  model.position.y = 0.05;
  root.add(base, band, model);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return root;
}
