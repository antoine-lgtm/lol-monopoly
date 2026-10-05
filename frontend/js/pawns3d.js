/**
 * LoL Monopoly — pions modélisés en 3D (Three.js), à partir de formes simples.
 *
 * Chaque pion est un groupe posé sur un socle doré, d'environ 0,6 unité de haut
 * (une case fait ~0,74 de large), qui regarde vers +Z. La couleur du joueur est
 * reprise par le liseré du socle (et par tout le pion classique).
 *
 * Chaque pion a une petite animation : `pawn.userData.animate(t, active)`,
 * appelée à chaque image (t en secondes ; active = c'est le tour de ce joueur,
 * l'animation est alors plus marquée).
 */
import * as THREE from '/vendor/three/three.module.js';

const mats = new Map();
/** Matériau partagé (mêmes paramètres = même matériau). */
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
  const m = new THREE.Mesh(geo, params.isMaterial ? params : mat(params));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** Œil brillant : globe + reflet blanc. */
function eye(r, iris, x, y, z) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.SphereGeometry(r, 16, 12), { color: iris, roughness: 0.12, metalness: 0.1 }));
  const shine = mesh(new THREE.SphereGeometry(r * 0.32, 10, 8), { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.7 });
  shine.position.set(r * 0.32, r * 0.4, r * 0.78);
  const small = mesh(new THREE.SphereGeometry(r * 0.14, 8, 6), { color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  small.position.set(-r * 0.3, -r * 0.35, r * 0.85);
  g.add(shine, small);
  g.position.set(x, y, z);
  return g;
}

/** Corne recourbée : une suite de troncs de cône de plus en plus fins. */
function curvedHorn(params, segments = 5, length = 0.17, radius = 0.038, bend = 0.5) {
  const root = new THREE.Group();
  let parent = root;
  const step = length / segments;
  for (let k = 0; k < segments; k++) {
    const r0 = radius * (1 - k / segments);
    const r1 = radius * (1 - (k + 1) / segments) + 0.002;
    const seg = mesh(new THREE.CylinderGeometry(r1, r0, step, 10), params, 0, step / 2, 0);
    const joint = new THREE.Group();
    joint.add(seg);
    joint.rotation.z = k === 0 ? 0 : bend / segments;
    if (k > 0) joint.position.y = step;
    parent.add(joint);
    parent = joint;
  }
  return root;
}

/** Points répartis régulièrement sur une sphère (spirale de Fibonacci). */
function fibonacci(n) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    pts.push(new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r));
  }
  return pts;
}

// --- Les pions ---------------------------------------------------------------

function poro() {
  const g = new THREE.Group();
  const fur = { physical: true, color: 0xf7fbff, roughness: 0.9, sheen: 1, sheenColor: 0xdbe8ff, sheenRoughness: 0.6 };
  const fluffy = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.19, 28, 20), fur, 0, 0, 0);
  fluffy.add(body);
  // duvet : des petites boules de poils tout autour du corps
  const puff = new THREE.SphereGeometry(0.055, 10, 8);
  for (const p of fibonacci(46)) {
    if (p.z > 0.2 && p.y > -0.55 && p.y < 0.75 && Math.abs(p.x) < 0.85) continue; // on dégage le visage
    const tuft = mesh(puff, fur);
    tuft.position.copy(p).multiplyScalar(0.175);
    tuft.scale.setScalar(0.75 + Math.abs(Math.sin(p.x * 9)) * 0.45);
    fluffy.add(tuft);
  }
  fluffy.position.y = 0.22;
  fluffy.scale.set(1.08, 0.95, 1);
  g.add(fluffy);
  // cornes recourbées
  const hornParams = { color: 0xeadbb0, roughness: 0.45 };
  for (const s of [-1, 1]) {
    const horn = curvedHorn(hornParams, 5, 0.16, 0.036, -s * 0.9);
    horn.position.set(s * 0.1, 0.36, -0.02);
    horn.rotation.z = -s * 0.35;
    g.add(horn);
  }
  // visage
  g.add(eye(0.058, 0x1d4fa8, -0.072, 0.265, 0.175), eye(0.058, 0x1d4fa8, 0.072, 0.265, 0.175));
  for (const s of [-1, 1]) {
    const brow = mesh(new THREE.CapsuleGeometry(0.008, 0.035, 4, 6), { color: 0x9fb0c4, roughness: 0.6 }, s * 0.075, 0.335, 0.165);
    brow.rotation.z = Math.PI / 2 + s * 0.3;
    const blush = mesh(new THREE.CircleGeometry(0.028, 16), { color: 0xffa6c2, transparent: true, opacity: 0.7, roughness: 0.8 }, s * 0.125, 0.205, 0.165);
    blush.rotation.y = s * 0.5;
    g.add(brow, blush);
  }
  const mouth = mesh(new THREE.SphereGeometry(0.048, 14, 10), { color: 0x3a0c18, roughness: 0.6 }, 0, 0.17, 0.182);
  mouth.scale.set(1.35, 0.65, 0.6);
  const tongue = mesh(new THREE.SphereGeometry(0.03, 12, 10), { color: 0xff7aa0, roughness: 0.4 }, 0, 0.145, 0.2);
  tongue.scale.set(1, 1.45, 0.55);
  g.add(mouth, tongue);
  const feet = [-1, 1].map((s) => {
    const f = mesh(new THREE.SphereGeometry(0.05, 12, 8), fur, s * 0.1, 0.035, 0.09);
    f.scale.set(1, 0.7, 1.2);
    return f;
  });
  g.add(...feet);
  // rebondit et se tasse doucement
  g.userData.animate = (t, active) => {
    const k = active ? 1 : 0.4;
    const bounce = Math.abs(Math.sin(t * 3.2)) * 0.035 * k;
    g.position.y = bounce;
    const squash = 1 - Math.max(0, 0.03 - bounce) * 2 * k;
    g.scale.set(2 - squash, squash, 2 - squash);
  };
  return g;
}

function teemo() {
  const g = new THREE.Group();
  const top = new THREE.Group();
  const stemProfile = [[0, 0], [0.11, 0], [0.105, 0.04], [0.085, 0.12], [0.075, 0.22], [0.07, 0.3], [0, 0.3]].map(([x, y]) => new THREE.Vector2(x, y));
  g.add(mesh(new THREE.LatheGeometry(stemProfile, 20), { color: 0xf3e6c4, roughness: 0.75 }));
  const skirt = mesh(new THREE.TorusGeometry(0.083, 0.014, 8, 24), { color: 0xe6d4a8, roughness: 0.7 }, 0, 0.22, 0);
  skirt.rotation.x = Math.PI / 2;
  g.add(skirt);
  // visage sur le pied
  for (const s of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.017, 10, 8), DARK, s * 0.03, 0.15, 0.083));
  const smile = mesh(new THREE.TorusGeometry(0.02, 0.005, 6, 12, Math.PI), DARK, 0, 0.122, 0.086);
  smile.rotation.z = Math.PI;
  g.add(smile);
  // chapeau, rebord et lamelles
  const cap = mesh(new THREE.SphereGeometry(0.22, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), { physical: true, color: 0x8445cc, roughness: 0.35, clearcoat: 0.6 }, 0, 0, 0);
  cap.scale.set(1, 0.82, 1);
  const rim = mesh(new THREE.TorusGeometry(0.212, 0.022, 10, 36), { color: 0x6a2fb0, roughness: 0.4 }, 0, 0, 0);
  rim.rotation.x = Math.PI / 2;
  const under = mesh(new THREE.CircleGeometry(0.21, 28), { color: 0x4a2470, side: THREE.DoubleSide }, 0, -0.002, 0);
  under.rotation.x = Math.PI / 2;
  top.add(cap, rim, under);
  const gill = new THREE.BoxGeometry(0.13, 0.008, 0.006);
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * Math.PI * 2;
    const l = mesh(gill, { color: 0x6a3a96, roughness: 0.8 }, Math.cos(a) * 0.13, -0.006, Math.sin(a) * 0.13);
    l.rotation.y = -a;
    top.add(l);
  }
  const spot = { color: 0x8dff6a, emissive: 0x3aa828, emissiveIntensity: 0.7, roughness: 0.35 };
  [[0.1, 0.12, 0.1, 0.05], [-0.12, 0.1, 0.09, 0.045], [0.03, 0.15, -0.12, 0.052], [-0.05, 0.18, 0.02, 0.038], [0.15, 0.08, -0.06, 0.04], [-0.13, 0.08, -0.1, 0.035]]
    .forEach(([x, y, z, r]) => {
      const d = mesh(new THREE.SphereGeometry(r, 12, 8), spot, x, y, z);
      d.scale.y = 0.55;
      d.lookAt(x * 4, y * 4 + 0.2, z * 4);
      top.add(d);
    });
  top.position.y = 0.29;
  g.add(top);
  // se dandine, le chapeau suit avec un petit retard
  g.userData.animate = (t, active) => {
    const k = active ? 1 : 0.45;
    g.rotation.z = Math.sin(t * 2.4) * 0.06 * k;
    top.rotation.z = Math.sin(t * 2.4 - 0.6) * 0.05 * k;
  };
  return g;
}

function ward() {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.022, 0.04, 0.34, 8), { color: 0x4f8a34, roughness: 0.7 }, 0, 0.17, 0));
  for (const [s, y] of [[-1, 0.22], [1, 0.27], [-1, 0.12]]) {
    const leaf = mesh(new THREE.SphereGeometry(0.06, 10, 8), { color: 0x6fb44a, roughness: 0.55 }, s * 0.06, y, 0);
    leaf.scale.set(1.4, 0.35, 0.7);
    leaf.rotation.z = s * 0.5;
    g.add(leaf);
  }
  const head = new THREE.Group();
  const collar = mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.04, 6), GOLD, 0, -0.12, 0);
  const pod = mesh(new THREE.SphereGeometry(0.13, 22, 16), { color: 0x24401a, roughness: 0.45 }, 0, 0, 0);
  pod.scale.set(1, 1.15, 0.9);
  const rim = mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 26), GOLD, 0, 0, 0.105);
  const glow = mesh(new THREE.SphereGeometry(0.08, 18, 12), { color: 0xffe14a, emissive: 0xffc81e, emissiveIntensity: 1.8, roughness: 0.2 }, 0, 0, 0.085);
  glow.scale.set(1, 0.85, 0.55);
  const slit = mesh(new THREE.BoxGeometry(0.02, 0.09, 0.02), DARK, 0, 0, 0.128);
  // paupière qui se ferme de temps en temps
  const lid = mesh(new THREE.SphereGeometry(0.083, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), { color: 0x2f5222, roughness: 0.5 }, 0, 0, 0.088);
  lid.rotation.x = Math.PI / 2;
  lid.scale.set(1, 0.6, 0.01);
  head.add(collar, pod, rim, glow, slit, lid);
  head.position.y = 0.47;
  g.add(head);
  // lucioles qui tournent autour
  const motes = [0, 1, 2].map(() => mesh(new THREE.SphereGeometry(0.012, 8, 6), { color: 0xfff3a0, emissive: 0xffe14a, emissiveIntensity: 2 }));
  g.add(...motes);
  g.userData.animate = (t, active) => {
    head.rotation.y = Math.sin(t * 0.9) * 0.5;
    const blink = (t % 3.6) < 0.16 ? Math.sin(((t % 3.6) / 0.16) * Math.PI) : 0;
    lid.scale.z = 0.01 + blink * 1.4;
    motes.forEach((m, k) => {
      const a = t * (active ? 2 : 1.2) + (k * Math.PI * 2) / 3;
      m.position.set(Math.cos(a) * 0.19, 0.42 + Math.sin(t * 2 + k) * 0.06, Math.sin(a) * 0.19);
    });
  };
  return g;
}

function minion() {
  const g = new THREE.Group();
  const armor = { color: 0x3a78d8, metalness: 0.6, roughness: 0.3 };
  const robe = mesh(new THREE.CylinderGeometry(0.1, 0.17, 0.26, 18), { color: 0x34507e, roughness: 0.7 }, 0, 0.13, 0);
  const trim = mesh(new THREE.TorusGeometry(0.168, 0.012, 6, 28), GOLD, 0, 0.01, 0);
  trim.rotation.x = Math.PI / 2;
  const belt = mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.035, 18), GOLD, 0, 0.25, 0);
  const buckle = mesh(new THREE.SphereGeometry(0.022, 10, 8), { color: 0x9fe8ff, emissive: 0x0ac8b9, emissiveIntensity: 1.2 }, 0, 0.25, 0.1);
  const head = new THREE.Group();
  const helmetProfile = [[0, 0], [0.15, 0], [0.155, 0.08], [0.14, 0.17], [0.1, 0.24], [0.04, 0.27], [0, 0.275]].map(([x, y]) => new THREE.Vector2(x, y));
  const helmet = mesh(new THREE.LatheGeometry(helmetProfile, 22), armor);
  const ridge = mesh(new THREE.BoxGeometry(0.02, 0.2, 0.3), GOLD, 0, 0.17, 0);
  ridge.scale.set(1, 1, 0.9);
  const visor = mesh(new THREE.BoxGeometry(0.22, 0.05, 0.06), DARK, 0, 0.1, 0.12);
  const eyesMat = mat({ color: 0x9fe8ff, emissive: 0x5fe0f0, emissiveIntensity: 1.8 });
  const eyes = [-1, 1].map((s) => mesh(new THREE.BoxGeometry(0.055, 0.016, 0.01), eyesMat, s * 0.045, 0.102, 0.152));
  const crest = mesh(new THREE.ConeGeometry(0.03, 0.1, 8), GOLD, 0, 0.32, 0);
  head.add(helmet, ridge, visor, ...eyes, crest);
  head.position.y = 0.27;
  const shoulders = [-1, 1].map((s) => {
    const sh = mesh(new THREE.SphereGeometry(0.065, 14, 10), armor, s * 0.14, 0.28, 0);
    sh.scale.y = 0.8;
    return sh;
  });
  // bâton de sbire mage avec son orbe
  const staff = new THREE.Group();
  staff.add(mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.46, 8), { color: 0x6a4a28, roughness: 0.7 }, 0, 0.23, 0));
  const orb = mesh(new THREE.SphereGeometry(0.035, 14, 10), { color: 0xb8f4ff, emissive: 0x3ac8f0, emissiveIntensity: 2 }, 0, 0.48, 0);
  staff.add(orb, mesh(new THREE.TorusGeometry(0.04, 0.007, 6, 18), GOLD, 0, 0.48, 0));
  staff.position.set(0.2, 0.02, 0.05);
  staff.rotation.z = -0.12;
  g.add(robe, trim, belt, buckle, head, ...shoulders, staff);
  g.userData.animate = (t, active) => {
    head.position.y = 0.27 + Math.sin(t * 2.2) * 0.008;
    eyesMat.emissiveIntensity = 1.4 + Math.sin(t * (active ? 9 : 4)) * 0.6;
    orb.position.y = 0.48 + Math.sin(t * 3) * 0.012;
    staff.rotation.z = -0.12 + Math.sin(t * 1.6) * 0.04;
  };
  return g;
}

function zhonya() {
  const g = new THREE.Group();
  const glass = { physical: true, color: 0xdff6ff, transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0, clearcoat: 1 };
  const sand = { color: 0xf0c040, roughness: 0.8, emissive: 0x6a4a08, emissiveIntensity: 0.45 };
  const frame = new THREE.Group();
  frame.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 6), GOLD, 0, -0.27, 0));
  frame.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 6), GOLD, 0, 0.27, 0));
  for (const y of [-0.245, 0.245]) frame.add(mesh(new THREE.TorusGeometry(0.11, 0.01, 6, 24), GOLD, 0, y, 0).rotateX(Math.PI / 2));
  const top = mesh(new THREE.ConeGeometry(0.12, 0.25, 22, 1, true), glass, 0, 0.125, 0);
  top.rotation.x = Math.PI;
  const bottom = mesh(new THREE.ConeGeometry(0.12, 0.25, 22, 1, true), glass, 0, -0.125, 0);
  const sandTop = mesh(new THREE.ConeGeometry(0.08, 0.14, 16), sand, 0, 0.1, 0);
  sandTop.rotation.x = Math.PI;
  const sandBottom = mesh(new THREE.ConeGeometry(0.1, 0.1, 16), sand, 0, -0.2, 0);
  const stream = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 6), sand, 0, -0.06, 0);
  frame.add(top, bottom, sandTop, sandBottom, stream);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    frame.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.54, 8), GOLD, Math.cos(a) * 0.135, 0, Math.sin(a) * 0.135));
  }
  frame.add(mesh(new THREE.OctahedronGeometry(0.03, 0), { color: 0x5fe0f0, emissive: 0x0ac8b9, emissiveIntensity: 1.4 }, 0, 0.32, 0));
  frame.position.y = 0.3;
  g.add(frame);
  // le sablier se retourne de temps en temps, le sable coule
  g.userData.animate = (t) => {
    const cycle = t % 7;
    frame.rotation.z = cycle > 6.2 ? ((cycle - 6.2) / 0.8) * Math.PI : 0;
    frame.rotation.y = t * 0.3;
    stream.scale.y = 0.9 + Math.sin(t * 20) * 0.1;
  };
  return g;
}

function blade() {
  const g = new THREE.Group();
  const sword = new THREE.Group();
  const steel = { color: 0xe6edf4, metalness: 0.95, roughness: 0.15 };
  sword.add(mesh(new THREE.SphereGeometry(0.035, 14, 10), GOLD, 0, 0.035, 0));
  const grip = mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.13, 10), { color: 0x7a3218, roughness: 0.8 }, 0, 0.13, 0);
  sword.add(grip);
  for (let k = 0; k < 4; k++) sword.add(mesh(new THREE.TorusGeometry(0.025, 0.004, 4, 12), { color: 0xd8a060, roughness: 0.5 }, 0, 0.08 + k * 0.03, 0).rotateX(Math.PI / 2));
  const guard = mesh(new THREE.BoxGeometry(0.24, 0.035, 0.05), GOLD, 0, 0.21, 0);
  const guardTips = [-1, 1].map((s) => mesh(new THREE.SphereGeometry(0.025, 10, 8), GOLD, s * 0.125, 0.21, 0));
  const gem = mesh(new THREE.OctahedronGeometry(0.03, 0), { color: 0xe84057, emissive: 0x8a0a1a, emissiveIntensity: 0.9, roughness: 0.1 }, 0, 0.21, 0.03);
  const bladeMesh = mesh(new THREE.BoxGeometry(0.095, 0.34, 0.03), steel, 0, 0.4, 0);
  const tip = mesh(new THREE.CylinderGeometry(0, 0.067, 0.1, 4), steel, 0, 0.62, 0);
  tip.rotation.y = Math.PI / 4;
  tip.scale.set(1, 1, 0.32);
  const fuller = mesh(new THREE.BoxGeometry(0.018, 0.3, 0.034), { color: 0x8a96a4, metalness: 0.9, roughness: 0.3 }, 0, 0.4, 0);
  sword.add(guard, ...guardTips, gem, bladeMesh, tip, fuller);
  g.add(sword);
  // flotte et oscille, en montrant surtout le plat de la lame
  g.userData.animate = (t, active) => {
    sword.rotation.y = Math.sin(t * (active ? 1.8 : 0.8)) * 0.7;
    sword.rotation.z = Math.sin(t * 1.3) * 0.05;
    sword.position.y = 0.02 + Math.sin(t * 2) * 0.015;
  };
  return g;
}

function tibbers() {
  const g = new THREE.Group();
  const furParams = { physical: true, color: 0x8a5530, roughness: 0.95, sheen: 1, sheenColor: 0xc08a5a, sheenRoughness: 0.7 };
  const belly = { color: 0xe6c08e, roughness: 0.85 };
  const stitch = { color: 0xd8a060, roughness: 0.6 };
  const body = mesh(new THREE.SphereGeometry(0.14, 20, 16), furParams, 0, 0.17, 0);
  body.scale.set(1, 1.15, 0.9);
  const tummy = mesh(new THREE.SphereGeometry(0.09, 16, 12), belly, 0, 0.16, 0.07);
  tummy.scale.set(1, 1.1, 0.6);
  const head = new THREE.Group();
  head.add(mesh(new THREE.SphereGeometry(0.13, 20, 16), furParams));
  const snout = mesh(new THREE.SphereGeometry(0.06, 14, 10), belly, 0, -0.03, 0.11);
  snout.scale.set(1.2, 0.9, 0.8);
  head.add(snout, mesh(new THREE.SphereGeometry(0.022, 10, 8), DARK, 0, -0.01, 0.16));
  for (const s of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.045, 12, 10), furParams, s * 0.1, 0.11, 0));
    head.add(mesh(new THREE.SphereGeometry(0.025, 10, 8), { color: 0xe8b0a0, roughness: 0.8 }, s * 0.1, 0.11, 0.025));
  }
  const button = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.012, 16), { color: 0xfff4d0, roughness: 0.3 }, 0.05, 0.03, 0.115);
  button.rotation.x = Math.PI / 2;
  head.add(button);
  [0.7, -0.7].forEach((r) => {
    const m = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), DARK, -0.05, 0.03, 0.122);
    m.rotation.z = r;
    head.add(m);
  });
  head.add(mesh(new THREE.BoxGeometry(0.004, 0.06, 0.004), stitch, 0.03, 0.09, 0.105).rotateZ(0.5));
  head.position.y = 0.4;
  const arms = [-1, 1].map((s) => {
    const pivot = new THREE.Group();
    pivot.position.set(s * 0.12, 0.26, 0.01);
    const a = mesh(new THREE.CapsuleGeometry(0.035, 0.09, 4, 10), furParams, s * 0.03, -0.06, 0.01);
    a.rotation.z = s * 0.6;
    pivot.add(a);
    return pivot;
  });
  const legs = [-1, 1].map((s) => mesh(new THREE.CapsuleGeometry(0.04, 0.04, 4, 10), furParams, s * 0.07, 0.04, 0.03));
  g.add(mesh(new THREE.BoxGeometry(0.004, 0.08, 0.004), stitch, 0.04, 0.17, 0.12).rotateZ(-0.3));
  const flames = [[-0.15, 0.32, 0], [0.16, 0.36, -0.02], [0, 0.55, -0.05]].map(([x, y, z]) => mesh(new THREE.ConeGeometry(0.028, 0.09, 8), { color: 0xffa040, emissive: 0xff5a0a, emissiveIntensity: 1.8 }, x, y, z));
  g.add(body, tummy, head, ...arms, ...legs, ...flames);
  g.userData.animate = (t, active) => {
    const k = active ? 1 : 0.5;
    head.rotation.z = Math.sin(t * 1.8) * 0.12 * k;
    arms.forEach((a, i) => { a.rotation.z = Math.sin(t * 3 + i * Math.PI) * 0.25 * k; });
    flames.forEach((f, i) => {
      const s = 0.8 + Math.abs(Math.sin(t * 9 + i * 2)) * 0.5;
      f.scale.set(1, s, 1);
    });
  };
  return g;
}

function egg() {
  const g = new THREE.Group();
  const ice = { physical: true, color: 0xaee6ff, roughness: 0.1, metalness: 0, clearcoat: 1, emissive: 0x2a6a9a, emissiveIntensity: 0.3 };
  const shellMat = mat(ice);
  const shell = mesh(new THREE.SphereGeometry(0.17, 28, 20), shellMat, 0, 0.26, 0);
  shell.scale.set(1, 1.35, 1);
  g.add(shell);
  const crystal = { color: 0xe8faff, emissive: 0x7fd0ff, emissiveIntensity: 0.7, roughness: 0.08, flatShading: true };
  [[0, 0.52, 0, 0], [-0.08, 0.48, 0.02, 0.5], [0.08, 0.48, -0.02, -0.5], [0.04, 0.47, 0.08, -0.3], [-0.03, 0.47, -0.08, 0.35]].forEach(([x, y, z, r]) => {
    const c = mesh(new THREE.ConeGeometry(0.03, 0.13, 5), crystal, x, y, z);
    c.rotation.z = r;
    g.add(c);
  });
  // fêlures en zigzag
  const crackMat = { color: 0xffffff, emissive: 0xbfefff, emissiveIntensity: 1 };
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const seg = mesh(new THREE.BoxGeometry(0.06, 0.006, 0.006), crackMat, Math.cos(a) * 0.172, 0.27 + (k % 2 ? 0.02 : -0.02), Math.sin(a) * 0.172);
    seg.rotation.y = -a + Math.PI / 2;
    seg.rotation.z = k % 2 ? 0.5 : -0.5;
    g.add(seg);
  }
  // éclats de glace en orbite
  const shards = [0, 1, 2, 3].map(() => mesh(new THREE.OctahedronGeometry(0.022, 0), crystal));
  g.add(...shards);
  g.userData.animate = (t, active) => {
    shell.rotation.y = t * 0.4;
    shellMat.emissiveIntensity = 0.25 + (Math.sin(t * 2) + 1) * (active ? 0.25 : 0.1);
    shards.forEach((s, k) => {
      const a = t * 1.3 + (k * Math.PI) / 2;
      s.position.set(Math.cos(a) * 0.23, 0.2 + Math.sin(t * 1.7 + k) * 0.12, Math.sin(a) * 0.23);
      s.rotation.set(t * 2, t * 3, 0);
    });
  };
  return g;
}

function classic(color) {
  const profile = [
    [0, 0], [0.16, 0], [0.16, 0.04], [0.13, 0.06], [0.11, 0.1], [0.08, 0.18], [0.06, 0.31],
    [0.1, 0.33], [0.1, 0.36], [0.055, 0.38], [0.08, 0.43], [0.085, 0.48], [0.07, 0.53], [0.04, 0.56], [0, 0.57],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.Group();
  const hex = new THREE.Color(color).getHex();
  g.add(mesh(new THREE.LatheGeometry(profile, 32), { physical: true, color: hex, metalness: 0.45, roughness: 0.22, clearcoat: 1 }));
  g.add(mesh(new THREE.TorusGeometry(0.1, 0.008, 6, 28), GOLD, 0, 0.345, 0).rotateX(Math.PI / 2));
  g.add(mesh(new THREE.OctahedronGeometry(0.035, 0), { color: 0xffffff, emissive: hex, emissiveIntensity: 0.8 }, 0, 0.61, 0));
  g.userData.animate = (t, active) => { g.rotation.y = active ? t * 0.8 : 0; };
  return g;
}

const BUILDERS = { poro, teemo, ward, minion, zhonya, blade, tibbers, egg };

/** Construit le pion `kind` (posé sur un socle doré liseré à la couleur du joueur). */
export function buildPawn(kind, color) {
  const root = new THREE.Group();
  const hex = new THREE.Color(color).getHex();
  const base = mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 32), GOLD, 0, 0.025, 0);
  // liseré à la couleur du joueur, autour du socle (sous son dessus pour éviter le scintillement)
  const band = mesh(new THREE.CylinderGeometry(0.228, 0.228, 0.022, 32), {
    color: hex, emissive: hex, emissiveIntensity: 0.6, roughness: 0.4,
  }, 0, 0.022, 0);
  const model = (BUILDERS[kind] || (() => classic(color)))();
  const holder = new THREE.Group(); // l'animation du modèle bouge ce groupe, pas le socle
  holder.position.y = 0.05;
  holder.add(model);
  root.add(base, band, holder);
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.userData.animate = (t, active) => model.userData.animate?.(t, active);
  return root;
}
