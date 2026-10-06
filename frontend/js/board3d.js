/**
 * LoL Monopoly — plateau en vraie 3D (WebGL, Three.js).
 *
 * Ce module ne fait que l'affichage : game.js garde les règles, l'interface et
 * les animations de jeu, et lui transmet positions et états. Les coordonnées
 * reçues sont celles du plateau « papier » (0..900 px) ; ici 100 px = 1 unité,
 * le plateau est centré sur l'origine, Y vers le haut, le côté de la Fontaine
 * (bas du plateau) vers +Z.
 */
import * as THREE from '/vendor/three/three.module.js';
import { buildPawn } from './pawns3d.js';
import { buildTowerStatue, animateStatues } from './tower3d.js';
import { buildRock, buildHextechChest, buildRuneterra, buildBaron } from './props3d.js';

const BOARD_PX = 900;
const S = BOARD_PX / 100; // côté du plateau en unités
const TEX = 4096; // résolution de la texture du dessus
const K = TEX / BOARD_PX; // px plateau -> px texture

/** Réglages des niveaux de qualité du plateau 3D. */
const QUALITY = {
  high: { ratio: 2, bloom: true, shadows: true, shadowSize: 3072, dust: true, world: true },
  medium: { ratio: 1.25, bloom: true, shadows: true, shadowSize: 2048, dust: true, world: true },
  low: { ratio: 1, bloom: false, shadows: false, shadowSize: 1024, dust: false, world: false },
};

const TOP = 0.16; // dessus des tuiles (cases) ; le centre (la Faille) est en contrebas, à 0
const BASE_Y = 0.36; // épaisseur du socle sous les cases
const toWorld = (x, y, h = TOP) => new THREE.Vector3(x / 100 - S / 2, h, y / 100 - S / 2);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - (1 - t) ** 3;

/** Charge une image (avec CORS) en essayant plusieurs adresses ; null si aucune ne marche. */
function loadImage(sources) {
  const list = [].concat(sources);
  return new Promise((resolve) => {
    const tryNext = () => {
      const src = list.shift();
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = tryNext;
      img.src = src;
    };
    tryNext();
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Dessine une image en mode « cover » dans un rectangle. */
function drawCover(ctx, img, x, y, w, h, posY = 0.2) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) * posY, dw, dh);
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container   élément qui reçoit le canvas
 * @param {Array} opts.board             les 40 cases
 * @param {object} opts.groups
 * @param {object} opts.geo              { cellOf, track, CORNER, UNIT }
 * @param {(sq, i) => string[]|null} opts.squareArt   sources d'image d'une case
 * @param {(sq) => string} opts.priceLabel
 */
export async function createBoard3D({ container, board, groups, geo, squareArt, priceLabel, sideSpace = () => ({ left: 0, right: 0, bottom: 0 }), quality: initialQuality = 'auto' }) {
  const { cellOf, track, CORNER, UNIT } = geo;

  // --- Rendu ----------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'gv-webgl';
  container.append(renderer.domElement);

  // Post-traitement : léger halo (bloom) autour des cristaux, gemmes et lumières
  const { EffectComposer } = await import('/vendor/three-addons/postprocessing/EffectComposer.js');
  const { RenderPass } = await import('/vendor/three-addons/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('/vendor/three-addons/postprocessing/UnrealBloomPass.js');
  const { OutputPass } = await import('/vendor/three-addons/postprocessing/OutputPass.js');
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  let bloomOn = true;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x08121e, 20, 62); // un peu de brume au loin : profondeur
  // Fond : halo bleu nuit derrière le plateau, bords sombres (vignette)
  {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 512;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(256, 230, 20, 256, 256, 360);
    grad.addColorStop(0, '#1b2f44');
    grad.addColorStop(0.45, '#0c1726');
    grad.addColorStop(1, '#03060b');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    const bg = new THREE.CanvasTexture(cv);
    bg.colorSpace = THREE.SRGBColorSpace;
    scene.background = bg;
  }
  const { RoomEnvironment } = await import('/vendor/three-addons/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.4, 0.9));
  composer.addPass(new OutputPass());

  // Lumières : ciel froid + soleil chaud qui projette les ombres, lueurs des deux Nexus
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x1a1408, 1.05));
  const sun = new THREE.DirectionalLight(0xffe6c0, 2.1);
  sun.position.set(5, 11, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const blueNexus = new THREE.PointLight(0x4aa8ff, 6, 4.5, 2);
  blueNexus.position.set(-3, 0.6, 3);
  const redNexus = new THREE.PointLight(0xff5040, 6, 4.5, 2);
  redNexus.position.set(3, 0.6, -3);
  scene.add(blueNexus, redNexus);
  // Lumière de contour (derrière, froide) : détache les reliefs du fond
  const rim = new THREE.DirectionalLight(0x8fb8ff, 0.9);
  rim.position.set(-6, 5, -9);
  scene.add(rim);

  // Sol qui reçoit l'ombre du plateau
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.45 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -BASE_Y - 0.13;
  ground.receiveShadow = true;
  scene.add(ground);

  // --- Plateau : texture du dessus ------------------------------------------
  const topCanvas = document.createElement('canvas');
  topCanvas.width = topCanvas.height = TEX;
  const ctx = topCanvas.getContext('2d');
  const topTexture = new THREE.CanvasTexture(topCanvas);
  topTexture.colorSpace = THREE.SRGBColorSpace;
  topTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const images = new Map(); // case -> image chargée
  let riftMap = null;

  function squareRect(i) {
    const { row, col } = cellOf(i);
    const [x0, w] = track(col);
    const [y0, h] = track(row);
    return { x0, y0, w, h };
  }

  const ROT = { s: 0, w: Math.PI / 2, n: Math.PI, e: -Math.PI / 2 };
  const CORNER_ROT = { 0: -Math.PI / 4, 10: Math.PI / 4, 20: (3 * Math.PI) / 4, 30: (-3 * Math.PI) / 4 };
  const SPECIAL_BG = {
    go: ['#0a3a5a', '#0a1a2c'], jail: ['#262b31', '#11151a'], baron: ['#2c1350', '#120a22'],
    gotojail: ['#3a2c0c', '#16110a'], chance: ['#3d3410', '#151a14'], chest: ['#0b4148', '#0b1a22'],
  };

  // Couleur du halo derrière l'illustration des cases spéciales
  const GLOW = {
    ocean: '#3aa8ff', mountain: '#c8925a', infernal: '#ff6a3a', cloud: '#bfe8ff',
    hp: '#ff4a5a', mana: '#4a8aff', chance: '#ffd25a', chest: '#2ad8e0', sbires: '#8ab4ff', boutique: '#ffd25a',
  };
  const glowOf = (sq) => GLOW[sq.element] || GLOW[sq.kind] || GLOW[sq.type] || '#c8aa6e';

  /** Pastille de prix : pièce d'or + montant, dans une capsule bordée d'or. */
  function pricePill(text, cx, cy) {
    ctx.font = `700 ${Math.round(9.5 * K)}px Barlow, Arial, sans-serif`;
    const tw = ctx.measureText(text).width;
    const coin = 7 * K;
    const w = tw + coin + 9 * K;
    const h = 13.5 * K;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    const g = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
    g.addColorStop(0, '#1d2a36');
    g.addColorStop(1, '#070d14');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 1.1 * K;
    ctx.strokeStyle = '#c89b3c';
    ctx.stroke();
    // pièce
    const px = cx - w / 2 + 3.5 * K + coin / 2;
    const cg = ctx.createRadialGradient(px - coin * 0.15, cy - coin * 0.2, 1, px, cy, coin / 2);
    cg.addColorStop(0, '#fff2b0');
    cg.addColorStop(0.6, '#e0a83a');
    cg.addColorStop(1, '#8a5a18');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(px, cy, coin / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f0e6d2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, px + coin / 2 + 2.5 * K, cy + 0.5 * K);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
  }

  /** Plaque de nom en bas de case : fond sombre, filet d'or et petit losange. */
  function namePlate(name, sub, bw, bh, { price = false } = {}) {
    ctx.font = `800 ${Math.round(10.5 * K)}px Cinzel, Georgia, serif`;
    const lines = wrapText(ctx, name, bw * 0.86);
    const lh = 11.5 * K;
    const plateH = lines.length * lh + (sub ? 20 * K : 9 * K);
    const top = bh / 2 - plateH;
    const g = ctx.createLinearGradient(0, top - 14 * K, 0, bh / 2);
    g.addColorStop(0, 'rgba(5,10,16,0)');
    g.addColorStop(0.25, 'rgba(5,10,16,0.82)');
    g.addColorStop(1, 'rgba(3,7,12,0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(-bw / 2, top - 14 * K, bw, plateH + 14 * K);
    // filet d'or avec losange
    const lg = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
    lg.addColorStop(0, 'rgba(200,155,60,0)');
    lg.addColorStop(0.5, '#e8c878');
    lg.addColorStop(1, 'rgba(200,155,60,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(-bw * 0.42, top - 1 * K, bw * 0.84, 1.2 * K);
    ctx.save();
    ctx.translate(0, top - 0.4 * K);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#e8c878';
    ctx.fillRect(-2.6 * K, -2.6 * K, 5.2 * K, 5.2 * K);
    ctx.fillStyle = '#0b1620';
    ctx.fillRect(-1.2 * K, -1.2 * K, 2.4 * K, 2.4 * K);
    ctx.restore();
    // texte
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#f0e6d2';
    lines.forEach((l, k) => ctx.fillText(l, 0, top + 10.5 * K + k * lh));
    ctx.shadowBlur = 0;
    if (sub) {
      const y = top + lines.length * lh + 7 * K;
      if (price) pricePill(sub, 0, y);
      else {
        ctx.fillStyle = '#c89b3c';
        ctx.font = `600 ${Math.round(8.5 * K)}px Barlow, Arial, sans-serif`;
        ctx.fillText(sub, 0, y + 3 * K);
      }
    }
  }

  /** Médaillon : illustration dans un cercle cerclé d'or, sur un halo coloré. */
  function medallion(img, cx, cy, r, color) {
    const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.9);
    halo.addColorStop(0, `${color}88`);
    halo.addColorStop(0.5, `${color}22`);
    halo.addColorStop(1, `${color}00`);
    ctx.fillStyle = halo;
    ctx.fillRect(cx - r * 2, cy - r * 2, r * 4, r * 4);
    // rayons fins
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = `${color}40`;
    ctx.lineWidth = 1 * K;
    for (let k = 0; k < 16; k++) {
      ctx.rotate(Math.PI / 8);
      ctx.beginPath();
      ctx.moveTo(r * 1.12, 0);
      ctx.lineTo(r * (k % 2 ? 1.45 : 1.7), 0);
      ctx.stroke();
    }
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    const bg = ctx.createRadialGradient(cx, cy - r * 0.3, 0, cx, cy, r);
    bg.addColorStop(0, '#1e3040');
    bg.addColorStop(1, '#060c12');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.clip();
    if (img) {
      const s = (r * 1.7) / Math.max(img.width, img.height);
      ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
    }
    ctx.restore();
    ctx.lineWidth = 2.2 * K;
    const rg = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    rg.addColorStop(0, '#f5dc9a');
    rg.addColorStop(0.5, '#c89b3c');
    rg.addColorStop(1, '#6e4f1e');
    ctx.strokeStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 0.8 * K;
    ctx.strokeStyle = 'rgba(240,230,210,0.35)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3 * K, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Relief des bords : lumière en haut à gauche, ombre en bas à droite. */
  function bevel(x, y, w, h) {
    const b = 3 * K;
    ctx.fillStyle = 'rgba(255,240,210,0.16)';
    ctx.fillRect(x, y, w, b);
    ctx.fillRect(x, y, b, h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x, y + h - b, w, b);
    ctx.fillRect(x + w - b, y, b, h);
  }

  function drawSquare(sq, i) {
    const { x0, y0, w, h } = squareRect(i);
    const { side } = cellOf(i);
    const corner = side === 'corner';
    const bw = (corner ? CORNER : UNIT) * K; // largeur de la boîte locale
    const bh = CORNER * K; // hauteur (profondeur vers l'extérieur)
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0 * K, y0 * K, w * K, h * K);
    ctx.clip();
    ctx.translate((x0 + w / 2) * K, (y0 + h / 2) * K);
    ctx.rotate(corner ? CORNER_ROT[i] : ROT[side]);

    // fond : bleu nuit, fines diagonales hextech, couleur du thème en haut
    const [c1, c2] = SPECIAL_BG[sq.type]
      || (sq.type === 'property' ? [groups[sq.group].color, '#0b1620'] : ['#1a2836', '#0c1822']);
    ctx.fillStyle = '#0a141e';
    ctx.fillRect(-bh, -bh, bh * 2, bh * 2);
    const grad = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    grad.addColorStop(0, sq.type === 'property' ? `${c1}66` : c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(-bh, -bh, bh * 2, bh * 2);
    ctx.strokeStyle = 'rgba(200,170,110,0.06)';
    ctx.lineWidth = 1 * K;
    for (let d = -bh * 2; d < bh * 2; d += 7 * K) {
      ctx.beginPath();
      ctx.moveTo(d, -bh);
      ctx.lineTo(d + bh * 2, bh);
      ctx.stroke();
    }

    const img = images.get(i);
    const name = sq.type === 'go' ? 'FONTAINE' : sq.type === 'jail' ? 'PRISON' : sq.name.toUpperCase();
    const sub = sq.type === 'go' ? '+200 Or' : sq.type === 'jail' ? 'Simple visite'
      : sq.kind === 'sbires' ? '10 % ou 200 Or' : priceLabel(sq);

    if (sq.type === 'property') {
      const color = groups[sq.group].color;
      const band = bh * 0.24;
      // illustration plein cadre sous la bande
      if (img) drawCover(ctx, img, -bw / 2, -bh / 2 + band, bw, bh - band, 0.15);
      else {
        const ph = ctx.createRadialGradient(0, -bh * 0.05, 0, 0, -bh * 0.05, bh * 0.4);
        ph.addColorStop(0, `${color}55`);
        ph.addColorStop(1, `${color}00`);
        ctx.fillStyle = ph;
        ctx.fillRect(-bw / 2, -bh / 2 + band, bw, bh - band);
      }
      // vignette sur les côtés
      const vig = ctx.createLinearGradient(-bw / 2, 0, bw / 2, 0);
      vig.addColorStop(0, 'rgba(4,10,16,0.55)');
      vig.addColorStop(0.18, 'rgba(4,10,16,0)');
      vig.addColorStop(0.82, 'rgba(4,10,16,0)');
      vig.addColorStop(1, 'rgba(4,10,16,0.55)');
      ctx.fillStyle = vig;
      ctx.fillRect(-bw / 2, -bh / 2 + band, bw, bh - band);
      // bande de région : brillante, filet d'or dessous
      const bandGrad = ctx.createLinearGradient(0, -bh / 2, 0, -bh / 2 + band);
      bandGrad.addColorStop(0, '#ffffff88');
      bandGrad.addColorStop(0.35, color);
      bandGrad.addColorStop(1, color);
      ctx.fillStyle = bandGrad;
      ctx.fillRect(-bw / 2, -bh / 2, bw, band);
      ctx.fillStyle = '#e8c878';
      ctx.fillRect(-bw / 2, -bh / 2 + band, bw, 1.6 * K);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-bw / 2, -bh / 2 + band + 1.6 * K, bw, 1.4 * K);
      namePlate(name, sub, bw, bh, { price: true });
      // cadre d'or intérieur
      ctx.lineWidth = 1.2 * K;
      ctx.strokeStyle = 'rgba(232,200,120,0.75)';
      roundRect(ctx, -bw / 2 + 4 * K, -bh / 2 + band + 4 * K, bw - 8 * K, bh - band - 8 * K, 4 * K);
      ctx.stroke();
    } else if (!corner) {
      medallion(img, 0, -bh * 0.13, bw * 0.34, glowOf(sq));
      namePlate(name, sub, bw, bh, { price: sq.type === 'dragon' || sq.type === 'potion' || sq.kind === 'boutique' });
      ctx.lineWidth = 1.2 * K;
      ctx.strokeStyle = 'rgba(232,200,120,0.55)';
      roundRect(ctx, -bw / 2 + 4 * K, -bh / 2 + 4 * K, bw - 8 * K, bh - 8 * K, 4 * K);
      ctx.stroke();
    } else {
      // coins : halo du thème, anneaux décoratifs et grand titre
      const tint = { go: '#2ad8e0', jail: '#9aa8b8', baron: '#b27cff', gotojail: '#ffd25a' }[sq.type] || '#c8aa6e';
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, bw * 0.62);
      halo.addColorStop(0, `${tint}40`);
      halo.addColorStop(1, `${tint}00`);
      ctx.fillStyle = halo;
      ctx.fillRect(-bw, -bw, bw * 2, bw * 2);
      ctx.strokeStyle = 'rgba(232,200,120,0.5)';
      for (const [r, lw] of [[bw * 0.44, 1.6], [bw * 0.48, 0.8]]) {
        ctx.lineWidth = lw * K;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#f0e6d2';
      ctx.font = `800 ${Math.round(16 * K)}px Cinzel, Georgia, serif`;
      const lines = wrapText(ctx, name, bw * 0.8);
      lines.forEach((l, k) => ctx.fillText(l, 0, (k - (lines.length - 1) / 2) * 18 * K));
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#c89b3c';
      ctx.font = `600 ${Math.round(9.5 * K)}px Barlow, Arial, sans-serif`;
      ctx.fillText(sub, 0, (lines.length / 2) * 18 * K + 6 * K);
    }
    ctx.restore();
    // relief et liseré de la case
    bevel(x0 * K, y0 * K, w * K, h * K);
    ctx.strokeStyle = 'rgba(200,170,110,0.5)';
    ctx.lineWidth = 1.2 * K;
    ctx.strokeRect(x0 * K, y0 * K, w * K, h * K);
  }

  function drawTop() {
    ctx.fillStyle = '#0a1a24';
    ctx.fillRect(0, 0, TEX, TEX);
    // Centre : la Faille vue du dessus (le logo est un calque à part, au-dessus de la rivière)
    const c0 = CORNER * K;
    const cs = (BOARD_PX - 2 * CORNER) * K;
    if (riftMap) ctx.drawImage(riftMap, c0, c0, cs, cs);
    ctx.strokeStyle = 'rgba(200,170,110,0.5)';
    ctx.lineWidth = 2 * K;
    ctx.strokeRect(c0, c0, cs, cs);
    board.forEach(drawSquare);
    topTexture.needsUpdate = true;
  }

  let redrawTimer = 0;
  const scheduleRedraw = () => {
    clearTimeout(redrawTimer);
    redrawTimer = setTimeout(drawTop, 120);
  };

  // Chargement des images (cases et carte), redessin au fur et à mesure
  loadImage('/assets/board/rift-map.svg').then((img) => { riftMap = img; scheduleRedraw(); });
  board.forEach((sq, i) => {
    const sources = squareArt(sq, i);
    if (!sources) return;
    loadImage(sources).then((img) => {
      if (img) {
        images.set(i, img);
        scheduleRedraw();
      }
    });
  });
  if (document.fonts?.ready) document.fonts.ready.then(scheduleRedraw);
  drawTop();

  // --- Plateau : volume -----------------------------------------------------
  // Un socle épais, 40 tuiles en relief séparées par des rainures (une par case),
  // et au centre, en contrebas, l'arène de la Faille.
  const BASE = 0.36;
  const sideMat = (c1, c2) => {
    const cv = document.createElement('canvas');
    cv.width = 4;
    cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 64);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35 });
  };
  const blueSide = sideMat('#3a8ad0', '#081a30');
  const redSide = sideMat('#d0504a', '#2e0a0a');
  // dessus vernis : un léger reflet glisse sur les cases quand on tourne
  const topMat = new THREE.MeshPhysicalMaterial({ map: topTexture, roughness: 0.55, metalness: 0.05, clearcoat: 0.45, clearcoatRoughness: 0.25 });
  const slabTop = new THREE.MeshStandardMaterial({ color: 0x0b1118, roughness: 0.8 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x0a0d10 });
  // ordre des faces d'une boîte : +x, -x, +y, -y, +z, -z
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(S, BASE, S),
    [redSide, blueSide, slabTop, bottomMat, blueSide, redSide],
  );
  slab.position.y = -BASE / 2;
  slab.receiveShadow = true;
  slab.castShadow = true;
  scene.add(slab);

  /** Fait correspondre le dessus (+y) d'une boîte à sa zone de la grande texture. */
  function mapTopUV(geo, cx, cz) {
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let v = 8; v < 12; v++) { // les 4 sommets de la face +y
      const x = pos.getX(v) + cx;
      const z = pos.getZ(v) + cz;
      uv.setXY(v, (x + S / 2) / S, 1 - (z + S / 2) / S);
    }
    uv.needsUpdate = true;
  }

  // Les tuiles : côtés à la couleur de la région pour les champions
  const tileSideMats = new Map();
  const tileSide = (color) => {
    if (!tileSideMats.has(color)) {
      tileSideMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.15 }));
    }
    return tileSideMats.get(color);
  };
  const GAP = 3; // rainure entre deux tuiles (px plateau)
  const BAND_H = 0.016; // épaisseur des bandes de région en relief
  const enamelMats = new Map();
  const enamel = (color) => {
    const key = color.getHex();
    if (!enamelMats.has(key)) {
      enamelMats.set(key, new THREE.MeshPhysicalMaterial({
        color, emissive: color, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15,
      }));
    }
    return enamelMats.get(key);
  };
  board.forEach((sq, i) => {
    const { x0, y0, w, h } = squareRect(i);
    const corner = cellOf(i).side === 'corner';
    const height = corner ? TOP + 0.05 : TOP;
    const geo = new THREE.BoxGeometry((w - GAP) / 100, height, (h - GAP) / 100);
    const c = toWorld(x0 + w / 2, y0 + h / 2, 0);
    mapTopUV(geo, c.x, c.z);
    const side = tileSide(sq.type === 'property' ? new THREE.Color(groups[sq.group].color).multiplyScalar(0.55) : 0x18222e);
    const tile = new THREE.Mesh(geo, [side, side, topMat, side, side, side]);
    tile.position.set(c.x, height / 2, c.z);
    tile.castShadow = true;
    tile.receiveShadow = true;
    scene.add(tile);
    // bande de la région en émail, en relief sur le bord intérieur de la case
    if (sq.type === 'property') {
      const band = CORNER * 0.24 - 4;
      const color = new THREE.Color(groups[sq.group].color);
      let r;
      if (cellOf(i).side === 's') r = [x0 + 3, y0 + 3, w - 6, band];
      else if (cellOf(i).side === 'n') r = [x0 + 3, y0 + h - 3 - band, w - 6, band];
      else if (cellOf(i).side === 'w') r = [x0 + w - 3 - band, y0 + 3, band, h - 6];
      else r = [x0 + 3, y0 + 3, band, h - 6];
      const strip = new THREE.Mesh(new THREE.BoxGeometry(r[2] / 100, BAND_H, r[3] / 100), enamel(color));
      const bc = toWorld(r[0] + r[2] / 2, r[1] + r[3] / 2, TOP + BAND_H / 2);
      strip.position.copy(bc);
      strip.castShadow = strip.receiveShadow = true;
      scene.add(strip);
    }
  });

  // Le centre : la carte de la Faille au fond de l'arène
  const cMin = CORNER;
  const cSize = BOARD_PX - 2 * CORNER;
  const centerGeo = new THREE.PlaneGeometry(cSize / 100, cSize / 100);
  {
    const uv = centerGeo.attributes.uv;
    for (let v = 0; v < uv.count; v++) {
      uv.setXY(v, (cMin + uv.getX(v) * cSize) / BOARD_PX, 1 - (cMin + (1 - uv.getY(v)) * cSize) / BOARD_PX);
    }
  }
  const centerPlane = new THREE.Mesh(centerGeo, topMat);
  centerPlane.rotation.x = -Math.PI / 2;
  centerPlane.position.y = 0.002;
  centerPlane.receiveShadow = true;
  scene.add(centerPlane);

  // Cadre doré tout autour
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0xc89b3c, metalness: 0.95, roughness: 0.22, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const frameW = 0.11;
  const frameH = BASE + TOP + 0.06;
  // Cadre doré biseauté (un seul anneau extrudé, arêtes arrondies) et plinthe sombre en dessous
  {
    const ring = (outer, inner) => {
      const shape = new THREE.Shape();
      shape.moveTo(-outer, -outer); shape.lineTo(outer, -outer); shape.lineTo(outer, outer); shape.lineTo(-outer, outer); shape.closePath();
      const hole = new THREE.Path();
      hole.moveTo(-inner, -inner); hole.lineTo(-inner, inner); hole.lineTo(inner, inner); hole.lineTo(inner, -inner); hole.closePath();
      shape.holes.push(hole);
      return shape;
    };
    const bevel = 0.045;
    const frameGeo = new THREE.ExtrudeGeometry(ring(S / 2 + frameW - bevel, S / 2 + 0.004), {
      depth: frameH - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 1,
    });
    frameGeo.rotateX(-Math.PI / 2);
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = -BASE + bevel;
    frame.castShadow = frame.receiveShadow = true;
    scene.add(frame);
    const plinthMat = new THREE.MeshPhysicalMaterial({ color: 0x141b24, roughness: 0.35, metalness: 0.5, clearcoat: 0.6 });
    const pb = 0.03;
    const plinthGeo = new THREE.ExtrudeGeometry(ring(S / 2 + frameW + 0.16 - pb, S / 2 - 0.5), {
      depth: 0.12 - pb * 2, bevelEnabled: true, bevelThickness: pb, bevelSize: pb, bevelSegments: 3, curveSegments: 1,
    });
    plinthGeo.rotateX(-Math.PI / 2);
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = -BASE - 0.12 + pb;
    plinth.castShadow = plinth.receiveShadow = true;
    scene.add(plinth);
    // liseré doré en haut de la plinthe
    const lipGeo = new THREE.ExtrudeGeometry(ring(S / 2 + frameW + 0.17, S / 2 + frameW + 0.12), { depth: 0.012, bevelEnabled: false });
    lipGeo.rotateX(-Math.PI / 2);
    const lip = new THREE.Mesh(lipGeo, frameMat);
    lip.position.y = -BASE - 0.006;
    scene.add(lip);
  }

  // Ornements des quatre coins du cadre : piliers dorés surmontés d'une gemme
  const cornerGems = [];
  {
    const capGeo = new THREE.CylinderGeometry(0.22, 0.27, frameH + 0.1, 8);
    const crownGeo = new THREE.CylinderGeometry(0.15, 0.22, 0.07, 8);
    const gemGeo = new THREE.OctahedronGeometry(0.12, 0);
    const darkGold = new THREE.MeshStandardMaterial({ color: 0x785a28, metalness: 0.9, roughness: 0.35 });
    const off = S / 2 + frameW / 2;
    // coin bleu (côté Nexus bleu), coin rouge, et deux coins hextech
    for (const [x, z, color] of [[-off, off, 0x4aa8ff], [off, -off, 0xff5a4a], [off, off, 0x0ac8b9], [-off, -off, 0x0ac8b9]]) {
      const cap = new THREE.Mesh(capGeo, frameMat);
      cap.rotation.y = Math.PI / 8;
      cap.position.set(x, -BASE + (frameH + 0.1) / 2, z);
      const crown = new THREE.Mesh(crownGeo, darkGold);
      crown.rotation.y = Math.PI / 8;
      crown.position.set(x, -BASE + frameH + 0.135, z);
      const gem = new THREE.Mesh(gemGeo, new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.3, roughness: 0.1, metalness: 0.1,
      }));
      gem.scale.set(1, 1.5, 1);
      gem.position.set(x, -BASE + frameH + 0.36, z);
      cap.castShadow = crown.castShadow = gem.castShadow = true;
      cap.receiveShadow = true;
      scene.add(cap, crown, gem);
      cornerGems.push(gem);
    }
    // filet hextech lumineux tout le long du cadre, entre deux moulures sombres
    const glowLine = new THREE.MeshStandardMaterial({ color: 0x9ff3f8, emissive: 0x0ac8b9, emissiveIntensity: 1.1 });
    const y = -BASE + frameH * 0.42;
    for (const [x, z, w, d] of [[0, -off, S + frameW * 2, frameW], [0, off, S + frameW * 2, frameW], [-off, 0, frameW, S], [off, 0, frameW, S]]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(w + (w > 1 ? 0 : 0.012), 0.022, d + (d > 1 ? 0 : 0.012)), glowLine);
      line.position.set(x, y, z);
      const mold = new THREE.Mesh(new THREE.BoxGeometry(w + (w > 1 ? 0 : 0.008), 0.07, d + (d > 1 ? 0 : 0.008)), darkGold);
      mold.position.set(x, y, z);
      scene.add(line, mold);
    }
    cornerGems.glowLine = glowLine;
  }

  // --- La Faille en relief (centre du plateau) -------------------------------
  // Coordonnées « carte » 0..100 (comme la mini-carte) -> monde
  const toRift = (mx, my, h = 0) => toWorld(cMin + (mx / 100) * cSize, cMin + (my / 100) * cSize, h);
  const ambient = []; // objets animés du décor
  const rand = (() => { let seed = 7; return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); })();

  // Rivière : un ruban d'eau qui suit la diagonale haut-gauche -> bas-droite
  {
    const bez = (p0, p1, p2, p3, t) => {
      const u = 1 - t;
      return p0 * u * u * u + 3 * p1 * u * u * t + 3 * p2 * u * t * t + p3 * t * t * t;
    };
    const segs = [[[-6, 6], [14, 16], [30, 30], [50, 50]], [[50, 50], [70, 70], [86, 84], [106, 94]]];
    const pts = [];
    for (const [a, b, c, d] of segs) {
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        pts.push([bez(a[0], b[0], c[0], d[0], t), bez(a[1], b[1], c[1], d[1], t)]);
      }
    }
    const half = 6.5; // demi-largeur (unités carte)
    const positions = [];
    const uvs = [];
    const index = [];
    pts.forEach(([x, y], k) => {
      const [nx, ny] = pts[Math.min(k + 1, pts.length - 1)];
      const [px, py] = pts[Math.max(k - 1, 0)];
      let tx = nx - px;
      let ty = ny - py;
      const len = Math.hypot(tx, ty) || 1;
      tx /= len;
      ty /= len;
      for (const sgn of [-1, 1]) {
        const v = toRift(Math.max(0, Math.min(100, x - ty * half * sgn)), Math.max(0, Math.min(100, y + tx * half * sgn)), 0.03);
        positions.push(v.x, v.y, v.z);
        uvs.push(sgn < 0 ? 0 : 1, k / 6);
      }
      if (k < pts.length - 1) {
        const a = k * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    // reflets qui coulent : petite texture de vaguelettes qui défile
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#1b6f94';
    g.fillRect(0, 0, 64, 256);
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(190,240,255,${0.15 + rand() * 0.35})`;
      g.fillRect(rand() * 56, rand() * 256, 4 + rand() * 10, 2 + rand() * 3);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const water = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, transparent: true, opacity: 0.82, roughness: 0.08, metalness: 0.25,
      emissive: 0x0a3a50, emissiveIntensity: 0.6, side: THREE.DoubleSide,
    }));
    water.receiveShadow = true;
    scene.add(water);
    ambient.push((t) => { tex.offset.y = -t * 0.25; });
  }

  // Fosses du Baron (violette) et du Dragon (orange), creusées dans le sol
  for (const [mx, my, color] of [[27, 22, 0x9b6cf0], [73, 78, 0xf08a3c]]) {
    const c = toRift(mx, my, 0);
    const rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.07, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x4a4a52, roughness: 0.9, flatShading: true }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(c.x, 0.04, c.z);
    rim.castShadow = rim.receiveShadow = true;
    const pit = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 32),
      new THREE.MeshStandardMaterial({ color: 0x0b0710, emissive: color, emissiveIntensity: 0.35 }),
    );
    pit.rotation.x = -Math.PI / 2;
    pit.position.set(c.x, 0.012, c.z);
    scene.add(rim, pit);
  }

  // Nexus (cristaux) et tourelles des deux équipes
  {
    const nexusGeo = new THREE.OctahedronGeometry(0.22, 0);
    const pedestalGeo = new THREE.CylinderGeometry(0.3, 0.38, 0.12, 8);
    const turretGeo = new THREE.CylinderGeometry(0.05, 0.075, 0.3, 8);
    const roofGeo = new THREE.ConeGeometry(0.085, 0.12, 8);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8a92, roughness: 0.6, metalness: 0.2 });
    const teams = [
      { color: 0x4aa8ff, nexus: [7, 93], turrets: [[8, 70], [8, 44], [30, 92], [56, 92], [24, 76], [36, 64]] },
      { color: 0xff5a4a, nexus: [93, 7], turrets: [[92, 30], [92, 56], [70, 8], [44, 8], [76, 24], [64, 36]] },
    ];
    for (const team of teams) {
      const glowMat = new THREE.MeshStandardMaterial({ color: team.color, emissive: team.color, emissiveIntensity: 1.4, roughness: 0.15, metalness: 0.1 });
      const c = toRift(...team.nexus, 0);
      const pedestal = new THREE.Mesh(pedestalGeo, stone);
      pedestal.position.set(c.x, 0.06, c.z);
      pedestal.castShadow = pedestal.receiveShadow = true;
      const crystal = new THREE.Mesh(nexusGeo, glowMat);
      crystal.scale.set(1, 1.7, 1);
      crystal.position.set(c.x, 0.5, c.z);
      crystal.castShadow = true;
      scene.add(pedestal, crystal);
      ambient.push((t) => {
        crystal.rotation.y = t * 0.8;
        crystal.position.y = 0.5 + Math.sin(t * 1.6) * 0.04;
      });
      for (const [mx, my] of team.turrets) {
        const p = toRift(mx, my, 0);
        const body = new THREE.Mesh(turretGeo, stone);
        body.position.set(p.x, 0.15, p.z);
        const roof = new THREE.Mesh(roofGeo, glowMat);
        roof.position.set(p.x, 0.36, p.z);
        body.castShadow = roof.castShadow = true;
        scene.add(body, roof);
      }
    }
  }

  // --- Pièce centrale : le Nexus géant ----------------------------------------
  // Un autel octogonal à trois étages, cerclé du logo gravé, au-dessus duquel
  // flotte un grand cristal hextech entouré d'anneaux d'or et d'éclats.
  {
    const stone = new THREE.MeshPhysicalMaterial({ color: 0x8c8a86, roughness: 0.55, metalness: 0.15, clearcoat: 0.2 });
    const darkStone = new THREE.MeshStandardMaterial({ color: 0x3c4450, roughness: 0.6, metalness: 0.3 });
    const gold = frameMat;
    const glowMat = new THREE.MeshStandardMaterial({ color: 0x9ff3f8, emissive: 0x0ac8b9, emissiveIntensity: 1.6 });
    const altar = new THREE.Group();
    // étages
    let y = 0;
    for (const [r, h, mat] of [[1.0, 0.12, darkStone], [0.8, 0.12, stone], [0.58, 0.1, stone]]) {
      const tier = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.05, h, 8), mat);
      tier.rotation.y = Math.PI / 8;
      tier.position.y = y + h / 2;
      tier.castShadow = tier.receiveShadow = true;
      const trim = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.012, r + 0.012, 0.022, 8, 1, true), gold);
      trim.rotation.y = Math.PI / 8;
      trim.position.y = y + h - 0.012;
      altar.add(tier, trim);
      y += h;
    }
    // filet lumineux sur le premier étage
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.03, 1.03, 0.018, 8, 1, true), glowMat);
    band.rotation.y = Math.PI / 8;
    band.position.y = 0.05;
    altar.add(band);
    // quatre obélisques aux angles, pointe lumineuse
    const pylons = [];
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const ob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 0.42, 4), stone);
      ob.position.set(Math.cos(a) * 0.88, 0.12 + 0.21, Math.sin(a) * 0.88);
      ob.rotation.y = Math.PI / 4;
      ob.castShadow = true;
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), glowMat);
      cap.position.set(ob.position.x, 0.6, ob.position.z);
      cap.scale.y = 1.5;
      altar.add(ob, cap);
      pylons.push(cap);
    }
    // socle du cristal : couronne d'or à griffes
    const cradle = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.08, 8), gold);
    cradle.position.y = y + 0.04;
    cradle.castShadow = true;
    altar.add(cradle);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.2, 4), gold);
      claw.position.set(Math.cos(a) * 0.27, y + 0.16, Math.sin(a) * 0.27);
      claw.rotation.set(Math.sin(a) * -0.45, 0, Math.cos(a) * 0.45);
      claw.castShadow = true;
      altar.add(claw);
    }
    // colonne de lumière entre le socle et le cristal
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.2, 0.6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0x5fe0f0, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    beam.position.y = y + 0.38;
    altar.add(beam);
    // le cristal (facettes nettes), légèrement translucide
    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0x2fc8f0, emissive: 0x0a90c0, emissiveIntensity: 0.9, roughness: 0.08, metalness: 0.25,
      clearcoat: 1, clearcoatRoughness: 0.05, flatShading: true,
    });
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.38, 1), crystalMat);
    crystal.scale.set(0.85, 1.9, 0.85);
    crystal.castShadow = true;
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshBasicMaterial({ color: 0xe8ffff }));
    core.scale.y = 1.8;
    const crystalY = y + 1.05;
    crystal.position.y = core.position.y = crystalY;
    altar.add(crystal, core);
    // anneaux d'or qui tournent autour
    const rings = [0.6, 0.74].map((r, k) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 8, 64), gold);
      ring.position.y = crystalY;
      ring.castShadow = true;
      ring.userData.tilt = k ? -0.5 : 0.45;
      altar.add(ring);
      return ring;
    });
    // éclats en orbite
    const shardGeo = new THREE.OctahedronGeometry(0.05, 0);
    const shards = Array.from({ length: 7 }, (_, k) => {
      const sh = new THREE.Mesh(shardGeo, crystalMat);
      sh.scale.y = 1.8;
      sh.userData = { r: 0.86 + (k % 2) * 0.1, phase: (k / 7) * Math.PI * 2, h: (k % 3) * 0.12 - 0.12 };
      altar.add(sh);
      return sh;
    });
    const light = new THREE.PointLight(0x5fe0f0, 6, 5, 1.6);
    light.position.y = crystalY;
    altar.add(light);
    scene.add(altar);

    // le logo gravé en cercle autour de l'autel, en lettres d'or
    const cv = document.createElement('canvas');
    cv.width = cv.height = 2048;
    const g = cv.getContext('2d');
    const R_IN = 1.08;
    const R_OUT = 1.62;
    const px = 1024 / R_OUT; // px par unité
    const drawLogo = () => {
      g.clearRect(0, 0, 2048, 2048);
      g.save();
      g.translate(1024, 1024);
      // anneau sombre + filets dorés
      g.beginPath();
      g.arc(0, 0, R_OUT * px - 6, 0, Math.PI * 2);
      g.arc(0, 0, R_IN * px + 4, 0, Math.PI * 2, true);
      g.fillStyle = 'rgba(6,12,20,0.78)';
      g.fill();
      g.strokeStyle = '#c89b3c';
      for (const [r, w] of [[R_OUT * px - 10, 8], [R_OUT * px - 34, 3], [R_IN * px + 12, 6], [R_IN * px + 32, 3]]) {
        g.lineWidth = w;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.stroke();
      }
      // texte le long du cercle
      const text = 'LEAGUE OF MONOPOLY  ✦  FAILLE DE L’INVOCATEUR  ✦  ';
      const radius = ((R_IN + R_OUT) / 2) * px - 34;
      g.font = '700 118px Cinzel, Georgia, serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const grad = g.createLinearGradient(0, -radius, 0, radius);
      grad.addColorStop(0, '#fff2cc');
      grad.addColorStop(0.5, '#c89b3c');
      grad.addColorStop(1, '#f0d890');
      g.fillStyle = grad;
      const total = g.measureText(text).width;
      const scale = (2 * Math.PI * radius) / total; // on étire pour faire le tour complet
      let angle = -Math.PI / 2;
      for (const ch of text) {
        const w = g.measureText(ch).width * scale;
        g.save();
        g.rotate(angle + w / 2 / radius);
        g.translate(0, -radius);
        g.fillText(ch, 0, 0);
        g.restore();
        angle += w / radius;
      }
      g.restore();
      logoTex.needsUpdate = true;
    };
    const logoTex = new THREE.CanvasTexture(cv);
    logoTex.colorSpace = THREE.SRGBColorSpace;
    logoTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    drawLogo();
    if (document.fonts?.ready) document.fonts.ready.then(drawLogo);
    const ringGeo = new THREE.RingGeometry(R_IN, R_OUT, 96, 1);
    const logo = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({
      map: logoTex, transparent: true, depthWrite: false, roughness: 0.35, metalness: 0.5,
      emissive: 0xffffff, emissiveMap: logoTex, emissiveIntensity: 0.2, polygonOffset: true, polygonOffsetFactor: -2,
    }));
    logo.rotation.x = -Math.PI / 2;
    logo.rotation.z = Math.PI / 4; // le titre face à la Fontaine (coin de départ)
    logo.position.y = 0.045;
    logo.receiveShadow = true;
    scene.add(logo);

    ambient.push((t) => {
      crystal.rotation.y = t * 0.45;
      crystal.position.y = core.position.y = crystalY + Math.sin(t * 1.2) * 0.05;
      crystalMat.emissiveIntensity = 0.75 + Math.sin(t * 2) * 0.2;
      rings.forEach((r, k) => {
        r.rotation.set(Math.PI / 2 + r.userData.tilt + Math.sin(t * 0.7 + k) * 0.15, t * (k ? -0.6 : 0.5), 0);
        r.position.y = crystal.position.y;
      });
      shards.forEach((sh) => {
        const { r, phase, h } = sh.userData;
        const a = t * 0.5 + phase;
        sh.position.set(Math.cos(a) * r, crystalY + h + Math.sin(t * 1.5 + phase) * 0.06, Math.sin(a) * r);
        sh.rotation.y = t * 2 + phase;
      });
      pylons.forEach((c, k) => { c.position.y = 0.6 + Math.sin(t * 2 + k) * 0.025; });
      light.intensity = 5 + Math.sin(t * 2) * 1.5;
      beam.material.opacity = 0.18 + Math.sin(t * 3) * 0.06;
    });
  }

  // --- Décors des coins -------------------------------------------------------
  const cornerAt = (i, inward) => {
    const { x0, y0, w, h } = squareRect(i);
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    return toWorld(cx + (BOARD_PX / 2 - cx) * inward, cy + (BOARD_PX / 2 - cy) * inward, TOP + 0.05);
  };
  // Fontaine : deux bassins de pierre étagés, eau lumineuse, jets qui retombent et flèche de cristal
  {
    const c = cornerAt(0, -0.06);
    const stone = new THREE.MeshStandardMaterial({ color: 0xcfc8b6, roughness: 0.6 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.85, roughness: 0.3 });
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x7fe9f0, emissive: 0x2ab8d0, emissiveIntensity: 0.9, roughness: 0.1, transparent: true, opacity: 0.9 });
    const g = new THREE.Group();
    const add = (mesh, y) => { mesh.position.y = y; mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh; };
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.06, 8), stone), 0.03); // dalle octogonale
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.24, 0.1, 24, 1, true), stone), 0.11).material.side = THREE.DoubleSide;
    add(new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 6, 32), trim), 0.16).rotation.x = Math.PI / 2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.02, 24), waterMat), 0.13);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8), stone), 0.24); // colonne
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.08, 0.05, 16), stone), 0.35); // bassin du haut
    add(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 24), trim), 0.375).rotation.x = Math.PI / 2;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.015, 16), waterMat), 0.37);
    const spire = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), new THREE.MeshStandardMaterial({ color: 0x9ff3f8, emissive: 0x0ac8b9, emissiveIntensity: 1.3, roughness: 0.1 })), 0.52);
    spire.scale.set(1, 2.2, 1);
    // jets : gouttes lumineuses qui partent du bassin du haut et retombent dans celui du bas
    const drops = [];
    const dropGeo = new THREE.SphereGeometry(0.012, 6, 4);
    const dropMat = new THREE.MeshBasicMaterial({ color: 0xbff8ff, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 24; k++) {
      const d = new THREE.Mesh(dropGeo, dropMat);
      d.userData = { a: (k / 24) * Math.PI * 2, phase: (k % 6) / 6 };
      g.add(d);
      drops.push(d);
    }
    g.position.set(c.x, c.y - 0.05, c.z);
    scene.add(g);
    const light = new THREE.PointLight(0x5fe0f0, 2.5, 2, 2);
    light.position.set(c.x, c.y + 0.5, c.z);
    scene.add(light);
    ambient.push((t) => {
      spire.rotation.y = t;
      spire.position.y = 0.52 + Math.sin(t * 2) * 0.02;
      light.intensity = 2 + Math.sin(t * 3) * 0.8;
      for (const d of drops) {
        const u = (t * 0.8 + d.userData.phase) % 1; // 0 -> 1 le long de l'arc
        const r = 0.12 + u * 0.1;
        d.position.set(Math.cos(d.userData.a) * r, 0.38 + Math.sin(u * Math.PI) * 0.08 - u * 0.24, Math.sin(d.userData.a) * r);
      }
    });
  }
  // Prison : socle de pierre, cage en fer forgé (les prisonniers se tiennent dedans), toit à pointe,
  // chaînes et lanterne qui vacille
  {
    const c = cornerAt(10, 0.06);
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.7, roughness: 0.45 });
    const stone = new THREE.MeshStandardMaterial({ color: 0x6a6e78, roughness: 0.85, flatShading: true });
    const cage = new THREE.Group();
    const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6);
    const size = 0.5;
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(size + 0.14, 0.05, size + 0.14), stone);
    plinth.position.y = 0.025;
    plinth.receiveShadow = true;
    cage.add(plinth);
    for (let k = 0; k < 4; k++) {
      for (let b = 1; b < 4; b++) {
        const bar = new THREE.Mesh(barGeo, iron);
        const tt = -size / 2 + (b / 4) * size;
        const [x, z] = [[tt, -size / 2], [size / 2, tt], [-tt, size / 2], [-size / 2, -tt]][k];
        bar.position.set(x, 0.3, z);
        bar.castShadow = true;
        cage.add(bar);
      }
    }
    // piliers d'angle plus épais, coiffés d'une boule
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.56, 0.045), iron);
      post.position.set((x * size) / 2, 0.3, (z * size) / 2);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), iron);
      knob.position.set((x * size) / 2, 0.6, (z * size) / 2);
      post.castShadow = knob.castShadow = true;
      cage.add(post, knob);
    }
    // traverses à mi-hauteur
    for (const [x, z, ry] of [[0, -size / 2, 0], [0, size / 2, 0], [size / 2, 0, Math.PI / 2], [-size / 2, 0, Math.PI / 2]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(size, 0.025, 0.025), iron);
      rail.position.set(x, 0.32, z);
      rail.rotation.y = ry;
      cage.add(rail);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(size * 0.78, 0.18, 4), iron);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.66;
    roof.castShadow = true;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.12, 6), iron);
    spike.position.y = 0.8;
    cage.add(roof, spike);
    // chaînes qui pendent d'un coin, lanterne à l'autre
    const link = new THREE.TorusGeometry(0.018, 0.005, 4, 8);
    for (let k = 0; k < 6; k++) {
      const l = new THREE.Mesh(link, iron);
      l.position.set(size / 2 + 0.03, 0.55 - k * 0.032, -size / 2 + 0.03);
      l.rotation.y = k % 2 ? Math.PI / 2 : 0;
      cage.add(l);
    }
    const lantern = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.06), iron);
    const fire = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), new THREE.MeshStandardMaterial({ color: 0xffd080, emissive: 0xff8a20, emissiveIntensity: 2.2 }));
    fire.scale.y = 1.6;
    lantern.add(frame, fire);
    lantern.position.set(-size / 2 - 0.04, 0.5, size / 2 + 0.04);
    cage.add(lantern);
    const lanternLight = new THREE.PointLight(0xffa040, 1.2, 1.4, 2);
    lanternLight.position.copy(lantern.position);
    cage.add(lanternLight);
    cage.position.set(c.x, c.y - 0.05, c.z);
    scene.add(cage);
    ambient.push((t) => {
      const f = 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07;
      fire.scale.set(f, 1.6 * f, f);
      lanternLight.intensity = 1.2 * f;
    });
  }
  // Grab de Blitzcrank : le golem à vapeur en personne
  {
    const c = cornerAt(30, -0.05);
    const yellow = new THREE.MeshStandardMaterial({ color: 0xe6b422, metalness: 0.6, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a3226, metalness: 0.6, roughness: 0.5 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.32, 14), yellow);
    body.position.y = 0.2;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), yellow);
    head.position.y = 0.36;
    const eyes = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.02), new THREE.MeshStandardMaterial({ color: 0x9ff3f8, emissive: 0x5fe0f0, emissiveIntensity: 1.5 }));
    eyes.position.set(0, 0.4, 0.11);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), dark);
    chimney.position.set(-0.08, 0.46, -0.06);
    const armGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.24, 8);
    const handGeo = new THREE.SphereGeometry(0.075, 12, 10);
    for (const sgn of [-1, 1]) {
      const arm = new THREE.Mesh(armGeo, dark);
      arm.position.set(sgn * 0.22, 0.2, 0);
      arm.rotation.z = sgn * 0.35;
      const hand = new THREE.Mesh(handGeo, yellow);
      hand.position.set(sgn * 0.26, 0.07, 0.02);
      g.add(arm, hand);
    }
    g.add(body, head, eyes, chimney);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(c.x, c.y - 0.05, c.z);
    g.lookAt(0, c.y, 0);
    scene.add(g);
  }

  // --- Paquets de cartes ----------------------------------------------------
  const deckRects = [];
  async function makeDeck(art, label, colorA, colorB, px, py) {
    deckRects.push(toWorld(px, py));
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 390;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 512, 390);
    grad.addColorStop(0, colorA);
    grad.addColorStop(1, colorB);
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 390);
    const img = await loadImage(art);
    g.fillStyle = 'rgba(1,10,19,0.55)';
    roundRect(g, 18, 18, 476, 290, 22);
    g.fill();
    if (img) {
      const s = Math.min(460 / img.width, 280 / img.height);
      g.drawImage(img, 256 - (img.width * s) / 2, 163 - (img.height * s) / 2, img.width * s, img.height * s);
    }
    g.fillStyle = 'rgba(1,10,19,0.8)';
    roundRect(g, 106, 318, 300, 52, 26);
    g.fill();
    g.fillStyle = '#f0e6d2';
    g.font = '700 30px Cinzel, Georgia, serif';
    g.textAlign = 'center';
    g.fillText(label, 256, 355);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const edge = new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.12, 1.28), [edge, edge, top, edge, edge, edge]);
    const pos = toWorld(px, py);
    deck.position.set(pos.x, 0.06, pos.z);
    deck.rotation.y = Math.PI / 4;
    deck.castShadow = true;
    deck.receiveShadow = true;
    scene.add(deck);
  }
  const cArea = BOARD_PX - 2 * CORNER;
  makeDeck(['/assets/board/real/ping.png', '/assets/board/ping.svg'], 'PING SS', '#ffe680', '#c8901a',
    CORNER + 0.06 * cArea + 84, CORNER + cArea / 2 + 64);
  // Coffre hextech en 3D à la place du paquet de cartes « Coffre Hextech »
  let chest = null;
  {
    chest = buildHextechChest();
    const pos = toWorld(BOARD_PX - CORNER - 0.06 * cArea - 84, CORNER + cArea / 2 - 64, 0);
    chest.position.copy(pos);
    chest.rotation.y = Math.PI / 4;
    chest.scale.setScalar(0.66);
    scene.add(chest);
    ambient.push((t) => chest.userData.animate(t));
  }

  // Rochers stylisés dans la jungle (là où était la forêt)
  for (const [mx, my, ry] of [[42, 79, 0.4], [58, 21, 3.5], [78, 62, -1.2], [22, 38, 2.0]]) {
    const rock = buildRock();
    rock.position.copy(toRift(mx, my, 0));
    rock.rotation.y = ry;
    rock.scale.setScalar(0.3);
    scene.add(rock);
  }

  // En contrebas, la carte de Runeterra en relief : le plateau flotte au-dessus du monde
  // (construite juste après la première image, pour que le plateau apparaisse plus vite)
  let world = null;
  const buildWorld = () => {
    if (world) return;
    world = buildRuneterra();
    world.position.y = -5;
    world.scale.set(0.8, 0.7, 0.8);
    world.visible = QUALITY[quality].world;
    scene.add(world);
  };

  // --- Vagues de sbires -----------------------------------------------------
  // Toutes les 16 s, chaque Nexus envoie 3 sbires dans chaque voie ; ils se
  // rejoignent au milieu, se battent un instant puis disparaissent.
  {
    const LANES = [
      [[12, 86], [11.5, 60], [11.5, 11.5], [60, 11.5], [86, 12]], // haut
      [[18, 92], [32, 72], [27, 50], [33, 33], [50, 27], [72, 32], [92, 18]], // milieu : contourne l'autel
      [[16, 89], [40, 88.5], [88.5, 88.5], [88.5, 40], [89, 16]], // bas
    ].map((pts) => {
      const world = pts.map(([x, y]) => toRift(x, y, 0));
      const lens = [0];
      for (let k = 1; k < world.length; k++) lens.push(lens[k - 1] + world[k].distanceTo(world[k - 1]));
      return { world, lens, total: lens[lens.length - 1] };
    });
    const PER = 3;
    const count = LANES.length * PER * 2;
    const bodyGeo = new THREE.CapsuleGeometry(0.03, 0.035, 3, 8);
    bodyGeo.translate(0, 0.06, 0);
    const hatGeo = new THREE.ConeGeometry(0.034, 0.05, 8);
    hatGeo.translate(0, 0.13, 0);
    const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), count);
    const hats = new THREE.InstancedMesh(hatGeo, new THREE.MeshStandardMaterial({ color: 0xd4a84a, metalness: 0.8, roughness: 0.3 }), count);
    for (let k = 0; k < count; k++) bodies.setColorAt(k, new THREE.Color(k < count / 2 ? 0x3a8ae8 : 0xe0483c));
    bodies.castShadow = hats.castShadow = false; // trop petits pour qu'on voie leur ombre
    bodies.frustumCulled = hats.frustumCulled = false;
    scene.add(bodies, hats);
    const pointAt = (lane, d, out) => {
      let k = 1;
      while (k < lane.lens.length - 1 && lane.lens[k] < d) k++;
      const a = lane.world[k - 1];
      const b = lane.world[k];
      const f = Math.max(0, Math.min(1, (d - lane.lens[k - 1]) / (lane.lens[k] - lane.lens[k - 1])));
      out.lerpVectors(a, b, f);
      // les sbires grimpent sur les paquets de cartes qu'ils traversent
      for (const c of deckRects) {
        const dx = out.x - c.x;
        const dz = out.z - c.z;
        const lx = (dx - dz) * Math.SQRT1_2;
        const lz = (dx + dz) * Math.SQRT1_2;
        if (Math.abs(lx) < 0.86 && Math.abs(lz) < 0.66) out.y = 0.12;
      }
      return Math.atan2(b.x - a.x, b.z - a.z);
    };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const PERIOD = 16;
    ambient.push((t) => {
      const cycle = t % PERIOD;
      let n = 0;
      for (const team of [0, 1]) {
        LANES.forEach((lane, li) => {
          for (let k = 0; k < PER; k++) {
            // progression : marche (0..10 s) jusqu'au milieu, combat (10..13 s), disparition
            const walk = Math.min(1, cycle / 10);
            const meet = lane.total / 2 - 0.07 - k * 0.09;
            let d = walk * meet;
            const fighting = cycle > 10 && cycle < 13.5;
            if (fighting) d = meet + Math.sin(t * 9 + k + li) * 0.015;
            let yaw = pointAt(lane, team ? lane.total - d : d, pos);
            if (team) yaw += Math.PI;
            pos.y += fighting ? Math.abs(Math.sin(t * 9 + k * 2 + li)) * 0.03 : Math.abs(Math.sin(t * 12 + k)) * 0.008;
            const size = cycle < 0.6 ? cycle / 0.6 : cycle > 13.5 ? Math.max(0, 1 - (cycle - 13.5) / 0.8) : 1;
            q.setFromAxisAngle(up, yaw + (fighting ? Math.sin(t * 9 + k) * 0.3 : 0));
            sc.setScalar(Math.max(size * 1.45, 0.0001));
            m.compose(pos, q, sc);
            bodies.setMatrixAt(n, m);
            hats.setMatrixAt(n, m);
            n++;
          }
        });
      }
      bodies.instanceMatrix.needsUpdate = true;
      hats.instanceMatrix.needsUpdate = true;
    });
  }

  // --- Poussière magique qui flotte autour du plateau --------------------------
  let dust = null;
  {
    const N = 200;
    const positions = new Float32Array(N * 3);
    const colors = new Float32Array(N * 3);
    const seeds = [];
    const teal = new THREE.Color(0x7fe9f0);
    const gold = new THREE.Color(0xf0c860);
    for (let k = 0; k < N; k++) {
      const a = rand() * Math.PI * 2;
      const r = 2 + rand() * 6.5;
      seeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, y: rand() * 3.2, speed: 0.08 + rand() * 0.14, phase: rand() * 6 });
      (rand() < 0.65 ? teal : gold).toArray(colors, k * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    dust = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.1, map: new THREE.CanvasTexture(cv), vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85,
    }));
    dust.frustumCulled = false;
    scene.add(dust);
    ambient.push((t) => {
      if (!dust.visible) return;
      seeds.forEach((s, k) => {
        positions[k * 3] = s.x + Math.sin(t * 0.4 + s.phase) * 0.25;
        positions[k * 3 + 1] = -0.2 + ((s.y + t * s.speed) % 3.2);
        positions[k * 3 + 2] = s.z + Math.cos(t * 0.35 + s.phase) * 0.25;
      });
      geo.attributes.position.needsUpdate = true;
    });
  }

  ambient.push((t) => {
    cornerGems.glowLine.emissiveIntensity = 0.9 + Math.sin(t * 1.5) * 0.35;
    cornerGems.forEach((gem, k) => {
      gem.rotation.y = t * 0.9 + k;
      gem.position.y = -BASE + frameH + 0.36 + Math.sin(t * 1.8 + k * 1.3) * 0.03;
    });
  });

  // --- Matériaux et géométries partagés -------------------------------------
  const inhibGeo = new THREE.OctahedronGeometry(0.15, 0);
  const poleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.46, 6);
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.9, roughness: 0.25 });
  const colorMats = new Map();
  const colorMat = (c, extra = {}) => {
    const key = `${c}|${JSON.stringify(extra)}`;
    if (!colorMats.has(key)) colorMats.set(key, new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.2, ...extra }));
    return colorMats.get(key);
  };

  // --- Pions ----------------------------------------------------------------
  const ringGeo = new THREE.RingGeometry(0.17, 0.24, 40);
  const blobGeo = new THREE.CircleGeometry(0.22, 32);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });



  const pawns = new Map(); // key -> { group, body, ring, target, from, t0, dur, hop }

  function ensurePawn(key, { color, pawn }) {
    let p = pawns.get(key);
    if (p) return p;
    const group = new THREE.Group();
    const blob = new THREE.Mesh(blobGeo, blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.004;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    group.add(blob, ring);
    group.scale.setScalar(1.2);
    // Pion modélisé en 3D (pawns3d.js), qui se tourne doucement vers la caméra
    const body = buildPawn(pawn || 'classic', color);
    group.add(body);
    scene.add(group);
    p = { group, body, ring, from: null, target: null, t0: 0, dur: 0, hop: false, current: false, hidden: false, phase: pawns.size * 1.7 };
    pawns.set(key, p);
    return p;
  }

  /** Place un pion (coordonnées plateau) ; hop = petit saut, glide = glissade. */
  function setPawn(key, { x, y, color, pawn, hop = false, glide = false, current = false, hidden = false }) {
    const p = ensurePawn(key, { color, pawn });
    const target = toWorld(x, y);
    p.current = current;
    p.hidden = hidden;
    p.group.visible = !hidden;
    if (!p.target) {
      p.group.position.copy(target);
      p.target = target;
      return;
    }
    if (p.target.distanceTo(target) < 1e-4) return;
    p.from = p.group.position.clone();
    p.target = target;
    p.t0 = performance.now();
    p.dur = glide ? 600 : hop ? 190 : 260;
    p.hop = hop;
  }

  // --- Constructions --------------------------------------------------------
  const buildings = new THREE.Group();
  buildings.position.y = BAND_H; // posées sur les bandes de région en relief
  scene.add(buildings);
  const animated = []; // objets animés (inhibiteurs, drapeaux, Baron)

  // Le Baron Nashor en 3D (props3d.js) : enfoui avant son apparition, dressé ensuite
  const baronModel = buildBaron();
  baronModel.visible = false;
  baronModel.scale.setScalar(0.9);
  scene.add(baronModel);
  const baronState = { risen: 0, target: 0 };

  // Héraut de la Faille : petite créature violette à l'œil lumineux, dans la fosse du Baron
  const herald = new THREE.Group();
  {
    const shellMat = new THREE.MeshPhysicalMaterial({ color: 0x7a3ac8, roughness: 0.35, clearcoat: 0.8 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
    shell.scale.set(1, 0.8, 1.1);
    shell.position.y = 0.08;
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), new THREE.MeshStandardMaterial({ color: 0xbff8ff, emissive: 0x2ad8f0, emissiveIntensity: 2 }));
    eye.position.set(0, 0.16, 0.17);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x3a1a6a, roughness: 0.5 });
    for (let k = 0; k < 6; k++) {
      const side = k < 3 ? -1 : 1;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.16, 5), legMat);
      leg.position.set(side * 0.2, 0.05, ((k % 3) - 1) * 0.11);
      leg.rotation.z = side * 0.9;
      herald.add(leg);
    }
    herald.add(shell, eye);
    herald.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    herald.userData.eye = eye;
    herald.visible = false;
    scene.add(herald);
  }
  // Dragon Ancien éveillé : anneaux bleutés qui pulsent sur les 4 cases Dragon
  const elderRings = board.map((sq, i) => (sq.type === 'dragon' ? i : -1)).filter((i) => i >= 0).map((i) => {
    const { x0, y0, w, h } = squareRect(i);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.3, 40),
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(toWorld(x0 + w / 2, y0 + h / 2, TOP + 0.03));
    ring.visible = false;
    scene.add(ring);
    return ring;
  });
  /** Héraut dans la fosse, Dragon Ancien éveillé. */
  function setObjectives({ herald: heraldActive = false, elder = false } = {}) {
    herald.visible = Boolean(heraldActive);
    if (heraldActive) {
      const c = cornerAt(20, 0.25);
      herald.position.set(c.x, c.y, c.z);
      herald.rotation.y = Math.atan2(-c.x, -c.z);
    }
    for (const r of elderRings) r.visible = Boolean(elder);
  }
  const baronLight = new THREE.PointLight(0xb27cff, 0, 3, 2);
  scene.add(baronLight);

  let lastBuildings = null;

  function setBuildings({ towers, inhibs, flags, baron }) {
    lastBuildings = { towers, inhibs, flags, baron };
    buildings.clear();
    animated.length = 0;
    // Tours : des gardiens de pierre (tower3d.js), tournés vers l'extérieur du plateau.
    // À 3 ou 4 sur une case, ils rapetissent un peu et se placent en quinconce.
    for (const t of towers) {
      const pos = toWorld(t.x, t.y);
      const facing = Math.abs(pos.z) > Math.abs(pos.x) ? new THREE.Vector3(0, 0, Math.sign(pos.z)) : new THREE.Vector3(Math.sign(pos.x), 0, 0);
      const count = t.count || 1;
      const statue = buildTowerStatue(t.color);
      statue.scale.setScalar(count >= 4 ? 0.32 : count === 3 ? 0.37 : 0.45);
      if (count >= 3) pos.addScaledVector(facing, ((t.slot || 0) % 2 ? 1 : -1) * 0.045);
      statue.position.copy(pos);
      statue.rotation.y = Math.atan2(facing.x, facing.z);
      buildings.add(statue);
    }
    for (const h of inhibs) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.06, 16), goldMat);
      base.position.y = 0.03;
      base.castShadow = true;
      const crystal = new THREE.Mesh(inhibGeo, colorMat(h.color, { emissive: h.color, emissiveIntensity: 0.6, metalness: 0.1, roughness: 0.15 }));
      crystal.scale.set(1, 1.6, 1);
      crystal.position.y = 0.36;
      crystal.castShadow = true;
      g.add(base, crystal);
      g.position.copy(toWorld(h.x, h.y));
      buildings.add(g);
      animated.push({ kind: 'inhib', obj: crystal, phase: Math.random() * 6 });
    }
    for (const f of flags) {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(poleGeo, goldMat);
      pole.position.y = 0.23;
      pole.castShadow = true;
      const clothGeo = new THREE.PlaneGeometry(0.2, 0.12, 8, 1);
      clothGeo.translate(0.1, 0, 0);
      const cloth = new THREE.Mesh(clothGeo, new THREE.MeshStandardMaterial({
        color: f.mortgaged ? 0x5a5a5a : f.color, side: THREE.DoubleSide, roughness: 0.7,
      }));
      cloth.position.set(0.008, f.mortgaged ? 0.16 : 0.39, 0);
      cloth.castShadow = true;
      g.add(pole, cloth);
      g.position.copy(toWorld(f.x, f.y));
      buildings.add(g);
      if (!f.mortgaged) animated.push({ kind: 'flag', obj: cloth, base: clothGeo.attributes.position.array.slice(), phase: Math.random() * 6 });
    }
    baronModel.visible = Boolean(baron);
    if (baron) {
      const pos = toWorld(baron.x, baron.y, TOP + 0.05);
      baronModel.position.copy(pos);
      baronModel.rotation.y = Math.atan2(-pos.x, -pos.z); // il regarde le centre du plateau
      baronLight.position.set(pos.x, 0.9, pos.z);
      baronState.target = baron.active ? 1 : 0;
    } else {
      baronLight.intensity = 0;
    }
  }

  // --- Marqueurs de cases (propriétaire, hypothèque, surbrillances) ---------
  const markers = new THREE.Group();
  scene.add(markers);
  const squareCenter = (i) => {
    const { x0, y0, w, h } = squareRect(i);
    return { x: x0 + w / 2, y: y0 + h / 2, w, h };
  };

  /** Liseré du propriétaire sur le bord extérieur + voile sur les cases hypothéquées. */
  function setOwners(list) {
    markers.clear();
    for (const { index, color, mortgaged } of list) {
      const { x0, y0, w, h } = squareRect(index);
      const { side } = cellOf(index);
      const t = 6; // épaisseur du liseré (px plateau)
      let rx = x0;
      let ry = y0;
      let rw = w;
      let rh = h;
      if (side === 's') { ry = y0 + h - t; rh = t; } else if (side === 'n') { rh = t; } else if (side === 'w') { rw = t; } else { rx = x0 + w - t; rw = t; }
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(rw / 100, 0.035, rh / 100),
        colorMat(color, { emissive: color, emissiveIntensity: 0.55 }),
      );
      const c = toWorld(rx + rw / 2, ry + rh / 2);
      strip.position.set(c.x, TOP + 0.018, c.z);
      markers.add(strip);
      if (mortgaged) {
        const veil = new THREE.Mesh(
          new THREE.PlaneGeometry(w / 100, h / 100),
          new THREE.MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0.62, depthWrite: false }),
        );
        veil.rotation.x = -Math.PI / 2;
        const vc = toWorld(x0 + w / 2, y0 + h / 2);
        veil.position.set(vc.x, TOP + 0.004, vc.z);
        markers.add(veil);
      }
    }
  }

  // Surbrillances : survol (remplissage 2 s), case inspectée, case à acheter, arrivée
  const glowMats = new Map();
  function glow(index) {
    if (!glowMats.has(index)) {
      const { w, h } = squareCenter(index);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(w / 100 - 0.02, h / 100 - 0.02),
        new THREE.MeshBasicMaterial({ color: 0xf0e6d2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.rotation.x = -Math.PI / 2;
      const { x, y } = squareCenter(index);
      const c = toWorld(x, y);
      mesh.position.set(c.x, TOP + 0.008, c.z);
      scene.add(mesh);
      glowMats.set(index, { mesh, hover: 0, hoverStart: 0, inspected: false, pending: false, flash: 0, flashColor: null });
    }
    return glowMats.get(index);
  }
  let hoverIndex = null;
  function setHover(index) {
    if (hoverIndex !== null) glow(hoverIndex).hoverStart = 0;
    hoverIndex = index;
    if (index !== null) glow(index).hoverStart = performance.now();
  }
  let inspectedIndex = null;
  function setInspected(index) {
    if (inspectedIndex !== null) glow(inspectedIndex).inspected = false;
    inspectedIndex = index;
    if (index !== null) glow(index).inspected = true;
  }
  let pendingIndex = null;
  function setPending(index) {
    if (pendingIndex !== null) glow(pendingIndex).pending = false;
    pendingIndex = index;
    if (index !== null) glow(index).pending = true;
  }
  function flash(index, color) {
    const g = glow(index);
    g.flash = performance.now();
    g.flashColor = new THREE.Color(color);
  }

  // --- Dés -------------------------------------------------------------------
  function faceTexture(v) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#fffaf0');
    grad.addColorStop(1, '#e2d4b8');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const pos = { 1: [[64, 64]], 2: [[34, 34], [94, 94]], 3: [[30, 30], [64, 64], [98, 98]],
      4: [[34, 34], [94, 34], [34, 94], [94, 94]], 5: [[32, 32], [96, 32], [64, 64], [32, 96], [96, 96]],
      6: [[34, 28], [34, 64], [34, 100], [94, 28], [94, 64], [94, 100]] }[v];
    for (const [x, y] of pos) {
      g.beginPath();
      g.arc(x, y, v === 1 ? 15 : 11, 0, Math.PI * 2);
      g.fillStyle = v === 1 ? '#c81c1c' : '#141414';
      g.fill();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35 });
  }
  // faces : +x=3, -x=4, +y=1, -y=6, +z=2, -z=5
  const FACE_VALUES = [3, 4, 1, 6, 2, 5];
  const FACE_NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const diceMats = FACE_VALUES.map(faceTexture);
  const DIE = 0.4;
  const dieGeo = new THREE.BoxGeometry(DIE, DIE, DIE);
  const dice = [0, 1].map(() => {
    const m = new THREE.Mesh(dieGeo, diceMats);
    m.castShadow = true;
    m.visible = false;
    scene.add(m);
    return m;
  });
  const diceHome = [toWorld(560, 560), toWorld(640, 600)];
  let diceAnim = null;

  function quatForValue(v, yaw) {
    const n = new THREE.Vector3(...FACE_NORMALS[FACE_VALUES.indexOf(v)]);
    const q = new THREE.Quaternion().setFromUnitVectors(n, new THREE.Vector3(0, 1, 0));
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(q);
  }

  function rollDice(values, animate = true) {
    dice.forEach((d, k) => {
      d.visible = true;
      const end = diceHome[k].clone();
      end.y = DIE / 2;
      d.userData.end = end;
      d.userData.qEnd = quatForValue(values[k], (Math.random() - 0.5) * 0.9);
      d.userData.start = end.clone().add(new THREE.Vector3(-1.4 + k * 0.3, 1.6, 1.2));
      d.userData.spin = new THREE.Vector3((Math.random() + 1.5) * 9, (Math.random() + 1) * 6, (Math.random() + 1.5) * 9);
      if (!animate) {
        d.position.copy(end);
        d.quaternion.copy(d.userData.qEnd);
      }
    });
    if (animate) diceAnim = { t0: performance.now(), dur: 950 };
  }

  // --- Caméra ----------------------------------------------------------------
  // Ouverture : la caméra descend en tournant vers le plateau pendant ~3 s
  const PITCH = 34;
  const cam = { yaw: -70, pitch: 72, dist: 13, tYaw: 0, tPitch: PITCH, tDist: 13, zoom: 0.72, tZoom: 1 };
  let introUntil = 0; // fixé à la première image
  // La caméra vise toujours le centre du plateau : on ne peut que tourner autour (et zoomer)
  const focus = new THREE.Vector3(0, 0, 0);
  const ZOOM_MIN = 0.75;
  const ZOOM_MAX = 2.2;
  const PITCH_MIN = 12;
  const PITCH_MAX = 85;
  function fitDistance() {
    // le canvas couvre tout l'écran, mais le plateau doit tenir entre les panneaux
    const { left, right, bottom = 0 } = sideSpace();
    const w = Math.max(320, container.clientWidth - left - right);
    const h = Math.max(240, container.clientHeight - bottom);
    const aspect = w / Math.max(h, 1);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const need = S * 1.38;
    const byH = (need * 0.74) / 2 / Math.tan(vFov / 2);
    const byW = need / 2 / Math.tan(hFov / 2);
    return Math.max(byH, byW) + 1.2;
  }
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    camera.aspect = w / h;
    // décale le centre de l'image au milieu de l'espace libre entre les panneaux
    const { left, right, bottom = 0 } = sideSpace();
    camera.setViewOffset(w, h, (right - left) / 2, bottom / 2, w, h);
    camera.updateProjectionMatrix();
    cam.base = fitDistance();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  // Clavier : ← → pour tourner, ↑ ↓ pour incliner, + − pour zoomer, R pour revenir à la vue de départ
  const keys = new Set();
  let spinDir = 0;
  const CAM_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'];
  const onKeyDown = (e) => {
    if (!running || !container.isConnected || container.closest('[hidden]')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'KeyR') { api.resetCamera(); return; }
    if (!CAM_KEYS.includes(e.key)) return;
    e.preventDefault();
    keys.add(e.key);
    hideHint();
  };
  const onKeyUp = (e) => keys.delete(e.key);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  // Petite aide affichée au début de la partie
  const hint = document.createElement('div');
  hint.className = 'gv-hint';
  hint.innerHTML = '<b>Glisse</b> pour tourner autour du plateau · <b>molette</b> pour zoomer · <b>← → ↑ ↓</b> au clavier · <b>R</b> pour revenir';
  container.append(hint);
  let hintTimer = 0; // démarre au premier affichage du plateau
  function hideHint() {
    clearTimeout(hintTimer);
    hint.classList.add('is-hidden');
  }

  function updateCamera() {
    if (keys.has('ArrowLeft')) cam.tYaw -= 1.8;
    if (keys.has('ArrowRight')) cam.tYaw += 1.8;
    if (keys.has('ArrowUp')) cam.tPitch = Math.min(PITCH_MAX, cam.tPitch + 0.9);
    if (keys.has('ArrowDown')) cam.tPitch = Math.max(PITCH_MIN, cam.tPitch - 0.9);
    if (keys.has('+') || keys.has('=')) cam.tZoom = Math.min(ZOOM_MAX, (cam.tZoom ?? 1) * 1.015);
    if (keys.has('-')) cam.tZoom = Math.max(ZOOM_MIN, (cam.tZoom ?? 1) / 1.015);
    if (spinDir) cam.tYaw += spinDir * 1.8;
    const now = performance.now();
    if (!introUntil) introUntil = now + 3200;
    const k = now < introUntil ? 0.022 : 0.12;
    cam.yaw = lerp(cam.yaw, cam.tYaw, k);
    cam.pitch = lerp(cam.pitch, cam.tPitch, k);
    cam.zoom = lerp(cam.zoom, cam.tZoom ?? 1, now < introUntil ? 0.03 : 0.08);
    const d = (cam.base || 13) / cam.zoom;
    const yaw = (cam.yaw * Math.PI) / 180;
    const pitch = (cam.pitch * Math.PI) / 180;
    camera.position.set(
      focus.x + Math.sin(yaw) * Math.cos(pitch) * d,
      focus.y + Math.sin(pitch) * d,
      focus.z + Math.cos(yaw) * Math.cos(pitch) * d,
    );
    camera.lookAt(focus);
  }

  // Glisser pour tourner / incliner, molette pour zoomer
  const canvas = renderer.domElement;
  let drag = null;
  let dragged = false;
  // Sur écran tactile : un doigt pour tourner, deux doigts pour zoomer (pincer)
  canvas.style.touchAction = 'none';
  const touches = new Map();
  let pinch = null;
  const spread = () => {
    const [a, b] = [...touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        pinch = { d: spread(), zoom: cam.tZoom ?? 1 };
        drag = null;
        dragged = true;
        return;
      }
    }
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, yaw: cam.tYaw, pitch: cam.tPitch };
    dragged = false;
  });
  const endTouch = (e) => {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
  };
  window.addEventListener('pointerup', endTouch);
  window.addEventListener('pointercancel', endTouch);
  window.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      cam.tZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.zoom * (spread() / Math.max(pinch.d, 1))));
      hideHint();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 6) return;
    dragged = true;
    hideHint();
    cam.tYaw = drag.yaw - dx * 0.3;
    cam.tPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, drag.pitch + dy * 0.25));
    api.onDrag?.();
  });
  window.addEventListener('pointerup', () => {
    drag = null;
    setTimeout(() => { dragged = false; }, 0);
  });
  // molette : zoom (toujours centré sur le plateau)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    hideHint();
    cam.tZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (cam.tZoom ?? 1) * (e.deltaY < 0 ? 1.08 : 0.92)));
  }, { passive: false });

  // --- Survol des cases (rayon souris -> plateau) ----------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP);
  function squareAt(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;
    const px = (hit.x + S / 2) * 100;
    const py = (hit.z + S / 2) * 100;
    if (px < 0 || py < 0 || px > BOARD_PX || py > BOARD_PX) return null;
    const idx = (v) => (v < CORNER ? 1 : v >= BOARD_PX - CORNER ? 11 : 2 + Math.floor((v - CORNER) / UNIT));
    const col = idx(px);
    const row = idx(py);
    if (row === 11) return 11 - col;
    if (col === 1) return 10 + (11 - row);
    if (row === 1) return 20 + (col - 1);
    if (col === 11) return 30 + (row - 1);
    return null;
  }
  let lastHover = null;
  canvas.addEventListener('pointermove', (e) => {
    if (drag && dragged) return;
    const i = squareAt(e.clientX, e.clientY);
    canvas.style.cursor = drag ? 'grabbing' : 'grab';
    if (i !== lastHover) {
      lastHover = i;
      api.onHover?.(i);
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (lastHover !== null) {
      lastHover = null;
      api.onHover?.(null);
    }
  });
  canvas.addEventListener('click', (e) => {
    if (dragged) return;
    const i = squareAt(e.clientX, e.clientY);
    if (i !== null) api.onClick?.(i);
  });

  // --- Étiquette au-dessus du pion actif -------------------------------------
  const label = document.createElement('div');
  label.className = 'gv-label3d';
  label.hidden = true;
  container.append(label);
  let labelKey = null;
  function setLabel(key, text, color) {
    labelKey = key;
    label.textContent = text || '';
    label.style.setProperty('--c', color || '#c8aa6e');
    label.hidden = !key;
  }

  // --- Boucle d'animation ------------------------------------------------------
  let running = true;
  let raf = 0;
  const tmp = new THREE.Vector3();
  // --- Qualité -----------------------------------------------------------------
  // high / medium / low, ou auto : on part de high (medium sur mobile) et on baisse
  // d'un cran tant que l'image saccade (moins de 28 images/s).
  const FORCE_HQ = new URLSearchParams(location.search).get('hq') === '1'; // ?hq=1 : toujours au maximum
  if (FORCE_HQ) window.__boardTop = topCanvas; // pour les captures de test
  let autoQuality = FORCE_HQ ? false : initialQuality === 'auto';
  let quality = FORCE_HQ ? 'high'
    : QUALITY[initialQuality] ? initialQuality
      : matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
  function applyQuality() {
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    bloomOn = q.bloom;
    if (renderer.shadowMap.enabled !== q.shadows || sun.shadow.mapSize.x !== q.shadowSize) {
      renderer.shadowMap.enabled = q.shadows;
      sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
    if (dust) dust.visible = q.dust;
    if (world) world.visible = q.world;
    resize();
  }
  const perf = { frames: 0, since: 0 };
  function adaptQuality(now) {
    if (!autoQuality) return;
    if (!perf.since) perf.since = now;
    perf.frames++;
    if (now - perf.since < 2500) return;
    const fps = (perf.frames * 1000) / (now - perf.since);
    perf.frames = 0;
    perf.since = now;
    if (fps >= 28 || quality === 'low') return;
    quality = quality === 'high' ? 'medium' : 'low';
    applyQuality();
    console.info(`[plateau 3D] ${fps.toFixed(0)} images/s : qualité ${quality}.`);
  }
  applyQuality();

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (!hintTimer && container.offsetWidth) hintTimer = setTimeout(hideHint, 12000);
    adaptQuality(now);
    updateCamera();
    const t = now / 1000;

    // pions
    for (const [key, p] of pawns) {
      if (p.from && p.target) {
        const k = Math.min(1, (now - p.t0) / p.dur);
        const e = ease(k);
        p.group.position.lerpVectors(p.from, p.target, e);
        p.group.position.y = p.hop ? Math.sin(Math.PI * k) * 0.28 : 0;
        if (p.hop) {
          const squash = k > 0.8 ? 1 - (1 - k) * 0.5 : 1;
          p.body.scale.set(k > 0.8 ? 1.08 : 0.95, k > 0.8 ? squash * 0.9 : 1.06, k > 0.8 ? 1.08 : 0.95);
        }
        if (k >= 1) {
          p.from = null;
          p.group.position.copy(p.target);
          p.body.scale.set(1, 1, 1);
        }
      }
      // le pion se tourne doucement vers la caméra (rotation verticale uniquement)
      {
        const want = Math.atan2(camera.position.x - p.group.position.x, camera.position.z - p.group.position.z);
        let diff = want - p.body.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        p.body.rotation.y += diff * 0.12;
      }
      // le pion actif flotte et son anneau pulse
      const bob = p.current && !p.from ? Math.sin(t * 2.6) * 0.04 + 0.04 : 0;
      p.body.position.y = bob;
      // petite animation propre à chaque pion (décalée pour qu'ils ne bougent pas en même temps)
      if (quality !== 'low') p.body.userData.animate?.(t + p.phase, p.current);
      p.ring.material.opacity = p.current ? 0.65 + Math.sin(t * 4) * 0.3 : 0.75;
      p.ring.scale.setScalar(p.current ? 1 + Math.sin(t * 4) * 0.08 : 1);
      if (key === labelKey) {
        tmp.copy(p.group.position);
        tmp.y += 0.85 + bob;
        tmp.project(camera);
        const r = container.getBoundingClientRect();
        label.style.transform = `translate(${((tmp.x + 1) / 2) * r.width}px, ${((1 - tmp.y) / 2) * r.height}px) translate(-50%, -100%)`;
      }
    }

    // constructions animées
    for (const a of animated) {
      if (a.kind === 'inhib') {
        a.obj.rotation.y = t * 1.2 + a.phase;
        a.obj.position.y = 0.36 + Math.sin(t * 2 + a.phase) * 0.04;
      } else if (a.kind === 'flag') {
        const pos = a.obj.geometry.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          const x = a.base[v * 3];
          pos.setZ(v, Math.sin(x * 22 - t * 6 + a.phase) * 0.018 * (x / 0.2));
        }
        pos.needsUpdate = true;
      }
    }
    if (herald.visible) {
      herald.position.y = TOP + 0.05 + Math.abs(Math.sin(t * 3)) * 0.03;
      herald.userData.eye.material.emissiveIntensity = 1.6 + Math.sin(t * 4) * 0.6;
    }
    for (const r of elderRings) {
      if (!r.visible) continue;
      const k = (t * 0.8) % 1;
      r.scale.setScalar(0.8 + k * 0.9);
      r.material.opacity = 0.7 * (1 - k);
    }
    if (baronModel.visible) {
      baronState.risen += (baronState.target - baronState.risen) * 0.03;
      baronModel.userData.animate(t, baronState.risen);
      baronLight.intensity = baronState.risen * (3 + Math.sin(t * 3) * 1.2);
    }
    for (const animate of ambient) animate(t);
    animateStatues(t);
    blueNexus.intensity = 5 + Math.sin(t * 2) * 2;
    redNexus.intensity = 5 + Math.sin(t * 2 + Math.PI) * 2;

    // surbrillances des cases
    for (const [index, g] of glowMats) {
      let opacity = 0;
      let color = 0xf0e6d2;
      if (g.inspected) opacity = 0.22;
      if (g.pending) { opacity = Math.max(opacity, 0.18 + Math.sin(t * 5) * 0.12); color = 0x0ac8b9; }
      if (g.hoverStart) opacity = Math.max(opacity, 0.06 + Math.min(1, (now - g.hoverStart) / 2000) * 0.3);
      if (g.flash) {
        const k = (now - g.flash) / 1600;
        if (k < 1) { opacity = Math.max(opacity, (1 - k) * 0.6); color = g.flashColor; } else g.flash = 0;
      }
      g.mesh.material.opacity = opacity;
      g.mesh.material.color.set(color);
      g.mesh.visible = opacity > 0.01;
    }

    // dés
    if (diceAnim) {
      const k = Math.min(1, (now - diceAnim.t0) / diceAnim.dur);
      dice.forEach((d) => {
        const { start, end, qEnd, spin } = d.userData;
        const e = ease(k);
        d.position.lerpVectors(start, end, e);
        d.position.y = lerp(start.y, end.y, e) + Math.abs(Math.sin(k * Math.PI * 2.2)) * (1 - k) * 0.9;
        const rest = 1 - e;
        const qSpin = new THREE.Quaternion().setFromEuler(new THREE.Euler(spin.x * rest, spin.y * rest, spin.z * rest));
        d.quaternion.copy(qEnd).premultiply(qSpin);
      });
      if (k >= 1) diceAnim = null;
    }

    if (bloomOn) composer.render();
    else renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  setTimeout(buildWorld, 60);

  const api = {
    /** Ouvre le coffre hextech du centre (carte Coffre Hextech tirée). */
    openChest() { chest?.userData.open(); },
    setObjectives,
    /** 'auto' | 'high' | 'medium' | 'low' */
    setQuality(q) {
      autoQuality = q === 'auto' && !FORCE_HQ;
      if (QUALITY[q]) quality = q;
      else if (autoQuality) quality = matchMedia('(pointer: coarse)').matches ? 'medium' : 'high';
      perf.since = 0;
      perf.frames = 0;
      applyQuality();
    },
    setPawn,
    setBuildings,
    setOwners,
    setHover,
    setInspected,
    setPending,
    flash,
    rollDice,
    hideDice() { dice.forEach((d) => { d.visible = false; }); },
    setLabel,
    rotate(deg) { cam.tYaw += deg; hideHint(); },
    /** Rotation continue (bouton maintenu) : -1, 0 ou 1. */
    spin(dir) { spinDir = dir; if (dir) hideHint(); },
    resetCamera() { cam.tYaw = Math.round(cam.tYaw / 360) * 360; cam.tPitch = PITCH; cam.tZoom = 1; },
    get dragging() { return dragged; },
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      hint.remove();
      renderer.dispose();
      canvas.remove();
      label.remove();
    },
    onHover: null,
    onClick: null,
    onDrag: null,
  };
  return api;
}
