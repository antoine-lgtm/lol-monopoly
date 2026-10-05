/**
 * LoL Monopoly — la « tour » construite sur les cases : un gardien de pierre en
 * robe, sur un socle rond en briques, qui tient un cristal rouge d'une main et un
 * livre de l'autre (inspiré d'une statue du Riot Creative Contest 2017).
 *
 * Modélisé avec des formes simples, puis fusionné par matériau : une statue ne
 * coûte que quelques objets à dessiner, même quand le plateau en est couvert.
 * Le pan de la robe et l'anneau du socle sont à la couleur du propriétaire.
 *
 * Unités : la statue fait 1 de haut (on la met à l'échelle à l'usage), regarde
 * vers +Z, pieds en y = 0.
 */
import * as THREE from '/vendor/three/three.module.js';
import { mergeGeometries } from '/vendor/three-addons/utils/BufferGeometryUtils.js';

/** Largeur totale de la statue (épaulières et bras compris), en unités du modèle. */
export const STATUE_WIDTH = 0.58;

const MATERIALS = {
  stone: new THREE.MeshStandardMaterial({ color: 0x484e7e, roughness: 0.85, metalness: 0.05 }),
  robe: new THREE.MeshStandardMaterial({ color: 0x33356c, roughness: 0.75, metalness: 0.05 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x5b6a92, roughness: 0.6, metalness: 0.2 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xbdb68a, roughness: 0.5, metalness: 0.45 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x0c0f1a, roughness: 0.6 }),
  cloth: new THREE.MeshStandardMaterial({ color: 0x9a2424, roughness: 0.7 }),
  teal: new THREE.MeshStandardMaterial({ color: 0x2fa6a8, roughness: 0.6, emissive: 0x0a3a3c, emissiveIntensity: 0.4 }),
  crystal: new THREE.MeshPhysicalMaterial({
    color: 0xff5a3c, emissive: 0xe0281a, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.05,
    clearcoat: 1, flatShading: true,
  }),
};

let parts = null; // géométries fusionnées, construites une seule fois

function buildParts() {
  const lists = {};
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const add = (key, geo, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], [sx, sy, sz] = [1, 1, 1]) => {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    (lists[key] ||= []).push(g);
  };
  /** Membre arrondi (capsule) tendu entre deux points. */
  const limb = (key, a, b, r) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const g = new THREE.CapsuleGeometry(r, len, 4, 10).toNonIndexed();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.applyMatrix4(m.compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    (lists[key] ||= []).push(g);
  };

  // --- socle rond en briques ---
  add('stone', new THREE.CylinderGeometry(0.215, 0.225, 0.04, 20), [0, 0.02, 0]);
  add('stone', new THREE.CylinderGeometry(0.19, 0.2, 0.1, 20), [0, 0.09, 0]);
  const brick = new THREE.BoxGeometry(0.1, 0.075, 0.05);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2 + (k % 2) * 0.12;
    add('stone', brick, [Math.sin(a) * 0.195, 0.085 + (k % 2) * 0.012, Math.cos(a) * 0.195], [0, a, 0]);
  }
  // anneau à la couleur du propriétaire
  add('owner', new THREE.TorusGeometry(0.192, 0.014, 6, 32), [0, 0.142, 0], [Math.PI / 2, 0, 0]);

  // --- robe évasée ---
  const robe = [[0, 0.13], [0.172, 0.13], [0.165, 0.2], [0.14, 0.34], [0.112, 0.46], [0.1, 0.5], [0, 0.5]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  add('robe', new THREE.LatheGeometry(robe, 20));
  // pan avant (couleur du propriétaire) bordé d'or, et bandes latérales
  const tilt = -Math.atan((0.165 - 0.105) / 0.34);
  add('owner', new THREE.BoxGeometry(0.1, 0.34, 0.02), [0, 0.31, 0.142], [tilt, 0, 0]);
  for (const s of [-1, 1]) {
    add('trim', new THREE.BoxGeometry(0.016, 0.34, 0.024), [s * 0.058, 0.31, 0.14], [tilt, 0, 0]);
    add('teal', new THREE.BoxGeometry(0.05, 0.3, 0.02), [s * 0.093, 0.3, 0.122], [tilt, s * 0.55, 0]);
  }
  // pointe dorée en bas du pan
  add('trim', new THREE.ConeGeometry(0.05, 0.07, 3), [0, 0.43, 0.118], [Math.PI, 0, 0], [1, 1, 0.3]);

  // --- ceinture, boucle et pompon rouge ---
  add('trim', new THREE.TorusGeometry(0.106, 0.022, 6, 24), [0, 0.5, 0], [Math.PI / 2, 0, 0], [1, 1, 1]);
  add('trim', new THREE.BoxGeometry(0.05, 0.055, 0.03), [0, 0.5, 0.122]);
  for (const a of [-0.9, 0.9, 2.2, -2.2]) add('trim', new THREE.BoxGeometry(0.035, 0.045, 0.03), [Math.sin(a) * 0.112, 0.5, Math.cos(a) * 0.112], [0, a, 0]);
  add('cloth', new THREE.ConeGeometry(0.022, 0.1, 8), [0, 0.42, 0.13], [Math.PI, 0, 0]);
  add('trim', new THREE.SphereGeometry(0.018, 8, 6), [0, 0.47, 0.13]);

  // --- buste en armure ---
  add('armor', new THREE.SphereGeometry(0.15, 18, 14), [0, 0.62, 0], [0, 0, 0], [1.05, 0.88, 0.78]);
  // plastron doré : deux plaques en V et une pointe au centre
  for (const s of [-1, 1]) {
    add('trim', new THREE.BoxGeometry(0.11, 0.13, 0.035), [s * 0.05, 0.65, 0.105], [-0.25, s * 0.35, s * -0.35]);
    add('armor', new THREE.BoxGeometry(0.06, 0.07, 0.02), [s * 0.05, 0.64, 0.128], [-0.25, s * 0.35, s * -0.35]);
  }
  add('trim', new THREE.BoxGeometry(0.06, 0.05, 0.04), [0, 0.57, 0.12], [-0.1, 0, Math.PI / 4]);
  add('trim', new THREE.ConeGeometry(0.018, 0.07, 6), [0, 0.66, 0.15], [Math.PI / 2, 0, 0]);
  // épaulières massives, à plaques
  for (const s of [-1, 1]) {
    add('armor', new THREE.SphereGeometry(0.075, 12, 10), [s * 0.175, 0.7, 0]);
    add('trim', new THREE.BoxGeometry(0.17, 0.07, 0.19), [s * 0.185, 0.765, 0], [0, 0, s * -0.32]);
    add('trim', new THREE.BoxGeometry(0.15, 0.05, 0.17), [s * 0.215, 0.71, 0], [0, 0, s * -0.7]);
    add('armor', new THREE.BoxGeometry(0.12, 0.04, 0.15), [s * 0.235, 0.66, 0], [0, 0, s * -1.0]);
    add('trim', new THREE.BoxGeometry(0.07, 0.03, 0.08), [s * 0.16, 0.81, 0.01], [0, 0.3, s * -0.25]);
  }

  // --- capuche et visière en T ---
  add('trim', new THREE.SphereGeometry(0.088, 16, 12), [0, 0.8, -0.005], [0, 0, 0], [1, 1.12, 1]);
  add('trim', new THREE.ConeGeometry(0.03, 0.06, 4), [0, 0.89, -0.01], [0, Math.PI / 4, 0]);
  add('dark', new THREE.SphereGeometry(0.062, 14, 10), [0, 0.785, 0.042], [0, 0, 0], [1, 1.05, 0.9]);
  add('trim', new THREE.BoxGeometry(0.075, 0.013, 0.012), [0, 0.81, 0.1]);
  add('trim', new THREE.BoxGeometry(0.013, 0.055, 0.012), [0, 0.785, 0.1]);

  // --- bras droit levé : le poing tient le cristal rouge ---
  limb('armor', [-0.2, 0.69, 0], [-0.25, 0.6, 0.07], 0.045);
  limb('armor', [-0.25, 0.6, 0.07], [-0.25, 0.71, 0.14], 0.04);
  add('trim', new THREE.BoxGeometry(0.06, 0.04, 0.07), [-0.25, 0.64, 0.105], [0.6, 0, 0]); // brassard
  add('trim', new THREE.SphereGeometry(0.05, 12, 10), [-0.25, 0.74, 0.15]);
  add('crystal', new THREE.ConeGeometry(0.06, 0.06, 6), [-0.25, 0.675, 0.17]);
  add('crystal', new THREE.ConeGeometry(0.06, 0.2, 6), [-0.25, 0.545, 0.17], [Math.PI, 0, 0]);

  // --- bras gauche : tient un livre contre la hanche ---
  limb('armor', [0.2, 0.69, 0], [0.225, 0.56, 0.04], 0.045);
  limb('armor', [0.225, 0.56, 0.04], [0.1, 0.52, 0.16], 0.04);
  add('trim', new THREE.BoxGeometry(0.06, 0.045, 0.06), [0.17, 0.545, 0.1], [0, -0.9, 0]);
  add('trim', new THREE.SphereGeometry(0.042, 10, 8), [0.09, 0.53, 0.17]);
  add('robe', new THREE.BoxGeometry(0.17, 0.04, 0.13), [0.14, 0.5, 0.15], [0.15, -0.35, 0]);
  add('trim', new THREE.BoxGeometry(0.12, 0.044, 0.09), [0.14, 0.502, 0.15], [0.15, -0.35, 0]);

  parts = Object.fromEntries(Object.entries(lists).map(([key, geos]) => [key, mergeGeometries(geos)]));
}

const ownerMats = new Map();
function ownerMat(color) {
  const key = new THREE.Color(color).getHex();
  if (!ownerMats.has(key)) {
    ownerMats.set(key, new THREE.MeshStandardMaterial({ color: key, emissive: key, emissiveIntensity: 0.18, roughness: 0.5, metalness: 0.1 }));
  }
  return ownerMats.get(key);
}

/** Construit une statue (1 de haut) aux couleurs du propriétaire. */
export function buildTowerStatue(color) {
  if (!parts) buildParts();
  const g = new THREE.Group();
  for (const [key, geo] of Object.entries(parts)) {
    const mesh = new THREE.Mesh(geo, key === 'owner' ? ownerMat(color) : MATERIALS[key]);
    mesh.castShadow = true;
    mesh.receiveShadow = key === 'stone' || key === 'robe';
    g.add(mesh);
  }
  return g;
}

/** Fait luire doucement les cristaux de toutes les statues (à appeler à chaque image). */
export function animateStatues(t) {
  MATERIALS.crystal.emissiveIntensity = 0.75 + Math.sin(t * 2.2) * 0.3;
}
