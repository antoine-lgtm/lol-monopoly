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

const BOARD_PX = 900;
const S = BOARD_PX / 100; // côté du plateau en unités
const TEX = 4096; // résolution de la texture du dessus
const K = TEX / BOARD_PX; // px plateau -> px texture

const toWorld = (x, y) => new THREE.Vector3(x / 100 - S / 2, 0, y / 100 - S / 2);
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

/** Rasterise un SVG (ou une image) en texture nette. */
async function imageTexture(sources, w, h) {
  const img = await loadImage(sources);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
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
export async function createBoard3D({ container, board, groups, geo, squareArt, priceLabel, sideSpace = () => ({ left: 0, right: 0, bottom: 0 }) }) {
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

  const scene = new THREE.Scene();
  const { RoomEnvironment } = await import('/vendor/three-addons/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

  // Lumières : ciel froid + soleil chaud qui projette les ombres, lueurs des deux Nexus
  scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x1a1408, 1.05));
  const sun = new THREE.DirectionalLight(0xffe6c0, 2.1);
  sun.position.set(5, 11, 7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);
  const blueNexus = new THREE.PointLight(0x4aa8ff, 6, 4.5, 2);
  blueNexus.position.set(-3, 0.6, 3);
  const redNexus = new THREE.PointLight(0xff5040, 6, 4.5, 2);
  redNexus.position.set(3, 0.6, -3);
  scene.add(blueNexus, redNexus);

  // Sol qui reçoit l'ombre du plateau
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.45 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.42;
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
    // fond
    const [c1, c2] = SPECIAL_BG[sq.type]
      || (sq.type === 'property' ? [groups[sq.group].color, '#0b1620'] : ['#1a2836', '#0c1822']);
    const grad = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
    grad.addColorStop(0, sq.type === 'property' ? `${c1}55` : c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = '#0c1822';
    ctx.fillRect(-bh, -bh, bh * 2, bh * 2);
    ctx.fillStyle = grad;
    ctx.fillRect(-bh, -bh, bh * 2, bh * 2);

    const img = images.get(i);
    if (sq.type === 'property') {
      const band = bh * 0.24;
      if (img) drawCover(ctx, img, -bw / 2, -bh / 2 + band, bw, bh - band, 0.15);
      const shade = ctx.createLinearGradient(0, -bh / 2 + band, 0, bh / 2);
      shade.addColorStop(0, 'rgba(4,10,16,0)');
      shade.addColorStop(0.55, 'rgba(4,10,16,0.45)');
      shade.addColorStop(1, 'rgba(4,10,16,0.95)');
      ctx.fillStyle = shade;
      ctx.fillRect(-bw / 2, -bh / 2 + band, bw, bh - band);
      const bandGrad = ctx.createLinearGradient(0, -bh / 2, 0, -bh / 2 + band);
      bandGrad.addColorStop(0, '#ffffff66');
      bandGrad.addColorStop(0.4, groups[sq.group].color);
      bandGrad.addColorStop(1, groups[sq.group].color);
      ctx.fillStyle = bandGrad;
      ctx.fillRect(-bw / 2, -bh / 2, bw, band);
    } else if (img && !corner) {
      drawCover(ctx, img, -bw / 2, -bh / 2, bw, bh * 0.8, 0.45);
      const shade = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2);
      shade.addColorStop(0.55, 'rgba(4,10,16,0)');
      shade.addColorStop(0.8, 'rgba(4,10,16,0.8)');
      shade.addColorStop(1, 'rgba(4,10,16,0.95)');
      ctx.fillStyle = shade;
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
    }

    // textes
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 10;
    const name = sq.type === 'go' ? 'FONTAINE' : sq.type === 'jail' ? 'PRISON' : sq.name.toUpperCase();
    const sub = sq.type === 'go' ? '+200 Or' : sq.type === 'jail' ? 'Simple visite'
      : sq.kind === 'sbires' ? '10 % ou 200 Or' : priceLabel(sq);
    if (corner) {
      ctx.fillStyle = '#f0e6d2';
      ctx.font = `700 ${Math.round(17 * K)}px Cinzel, Georgia, serif`;
      const lines = wrapText(ctx, name, bw * 0.9);
      lines.forEach((l, k) => ctx.fillText(l, 0, (k - (lines.length - 1) / 2) * 19 * K));
      ctx.fillStyle = '#c89b3c';
      ctx.font = `600 ${Math.round(10 * K)}px Barlow, Arial, sans-serif`;
      ctx.fillText(sub, 0, (lines.length / 2) * 19 * K + 6 * K);
    } else {
      ctx.fillStyle = '#f0e6d2';
      ctx.font = `700 ${Math.round(10.5 * K)}px Barlow, Arial, sans-serif`;
      const lines = wrapText(ctx, name, bw * 0.92);
      const baseY = bh / 2 - 9 * K - (sub ? 11 * K : 0);
      lines.forEach((l, k) => ctx.fillText(l, 0, baseY - (lines.length - 1 - k) * 11.5 * K));
      if (sub) {
        ctx.fillStyle = '#c89b3c';
        ctx.font = `600 ${Math.round(9.5 * K)}px Barlow, Arial, sans-serif`;
        ctx.fillText(sub, 0, bh / 2 - 6 * K);
      }
    }
    ctx.restore();
    // liseré de la case
    ctx.strokeStyle = 'rgba(200,170,110,0.45)';
    ctx.lineWidth = 1.2 * K;
    ctx.strokeRect(x0 * K, y0 * K, w * K, h * K);
  }

  function drawTop() {
    ctx.fillStyle = '#0a1a24';
    ctx.fillRect(0, 0, TEX, TEX);
    // Centre : la Faille vue du dessus, puis le logo en diagonale
    const c0 = CORNER * K;
    const cs = (BOARD_PX - 2 * CORNER) * K;
    if (riftMap) ctx.drawImage(riftMap, c0, c0, cs, cs);
    ctx.strokeStyle = 'rgba(200,170,110,0.5)';
    ctx.lineWidth = 2 * K;
    ctx.strokeRect(c0, c0, cs, cs);
    ctx.save();
    ctx.translate(TEX / 2, TEX / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#c8aa6e';
    ctx.font = `600 ${Math.round(18 * K)}px Cinzel, Georgia, serif`;
    ctx.fillText('L E A G U E   O F', 0, -40 * K);
    const g = ctx.createLinearGradient(0, -40 * K, 0, 20 * K);
    g.addColorStop(0, '#fff6de');
    g.addColorStop(0.6, '#c89b3c');
    g.addColorStop(1, '#785a28');
    ctx.fillStyle = g;
    ctx.font = `800 ${Math.round(66 * K)}px Cinzel, Georgia, serif`;
    ctx.fillText('MONOPOLY', 0, 22 * K);
    ctx.fillStyle = '#7fe9f0';
    ctx.font = `600 ${Math.round(13 * K)}px Barlow, Arial, sans-serif`;
    ctx.fillText('F A I L L E   D E   L ’ I N V O C A T E U R', 0, 50 * K);
    ctx.restore();
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
  const THICK = 0.32;
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
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.4 });
  };
  const blueSide = sideMat('#3a8ad0', '#081a30');
  const redSide = sideMat('#d0504a', '#2e0a0a');
  const topMat = new THREE.MeshStandardMaterial({ map: topTexture, roughness: 0.62, metalness: 0.05 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x0a0d10 });
  // ordre des faces d'une boîte : +x, -x, +y, -y, +z, -z
  const boardMesh = new THREE.Mesh(
    new THREE.BoxGeometry(S, THICK, S),
    [redSide, blueSide, topMat, bottomMat, blueSide, redSide],
  );
  boardMesh.position.y = -THICK / 2;
  boardMesh.receiveShadow = true;
  boardMesh.castShadow = true;
  scene.add(boardMesh);

  // Cadre doré tout autour
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.85, roughness: 0.3 });
  const frameW = 0.09;
  [[0, -S / 2 - frameW / 2, S + frameW * 2, frameW], [0, S / 2 + frameW / 2, S + frameW * 2, frameW],
    [-S / 2 - frameW / 2, 0, frameW, S], [S / 2 + frameW / 2, 0, frameW, S]].forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, THICK + 0.06, d), frameMat);
    m.position.set(x, -THICK / 2 + 0.03, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  });

  // --- Paquets de cartes ----------------------------------------------------
  async function makeDeck(art, label, colorA, colorB, px, py) {
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
  makeDeck(['/assets/board/real/chest.png', '/assets/board/chest.svg'], 'COFFRE HEXTECH', '#1ad6e0', '#035a76',
    BOARD_PX - CORNER - 0.06 * cArea - 84, CORNER + cArea / 2 - 64);

  // --- Matériaux et géométries partagés -------------------------------------
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb8b2a2, roughness: 0.7 });
  const towerGeo = new THREE.CylinderGeometry(0.075, 0.095, 0.3, 10);
  const merlonGeo = new THREE.BoxGeometry(0.04, 0.05, 0.04);
  const bandGeo = new THREE.CylinderGeometry(0.083, 0.083, 0.05, 10);
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
  const pawnTextures = new Map();
  function pawnTexture(pawn) {
    if (!pawnTextures.has(pawn)) pawnTextures.set(pawn, imageTexture(`/assets/pawns/${pawn}.svg`, 240, 400));
    return pawnTextures.get(pawn);
  }
  const ringGeo = new THREE.RingGeometry(0.17, 0.24, 40);
  const blobGeo = new THREE.CircleGeometry(0.22, 32);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false });

  // Pion classique : une vraie pièce d'échecs tournée, à la couleur du joueur
  const pawnProfile = [
    [0, 0], [0.2, 0], [0.2, 0.05], [0.16, 0.07], [0.14, 0.12], [0.1, 0.22], [0.075, 0.38],
    [0.12, 0.41], [0.12, 0.44], [0.07, 0.46], [0.1, 0.52], [0.105, 0.58], [0.09, 0.64], [0.05, 0.68], [0, 0.69],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const classicGeo = new THREE.LatheGeometry(pawnProfile, 28);

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
    let body;
    if (!pawn || pawn === 'classic') {
      body = new THREE.Mesh(classicGeo, colorMat(color, { metalness: 0.35, roughness: 0.35 }));
      body.castShadow = true;
    } else {
      body = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, alphaTest: 0.08 }));
      body.center.set(0.5, 0);
      body.scale.set(0.58, 0.97, 1);
      pawnTexture(pawn).then((tex) => {
        if (tex) {
          body.material.map = tex;
          body.material.needsUpdate = true;
        }
      });
    }
    group.add(body);
    scene.add(group);
    p = { group, body, ring, from: null, target: null, t0: 0, dur: 0, hop: false, current: false, hidden: false };
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
  scene.add(buildings);
  const animated = []; // objets animés (inhibiteurs, drapeaux, Baron)

  let baronSprite = null;
  imageTexture('/assets/board/baron.svg', 320, 320).then((tex) => {
    baronSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, alphaTest: 0.05 }));
    baronSprite.center.set(0.5, 0);
    baronSprite.scale.set(0.85, 0.85, 1);
    baronSprite.visible = false;
    scene.add(baronSprite);
    if (lastBuildings) setBuildings(lastBuildings);
  });
  const baronLight = new THREE.PointLight(0xb27cff, 0, 3, 2);
  scene.add(baronLight);

  let lastBuildings = null;

  function setBuildings({ towers, inhibs, flags, baron }) {
    lastBuildings = { towers, inhibs, flags, baron };
    buildings.clear();
    animated.length = 0;
    for (const t of towers) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(towerGeo, stoneMat);
      body.position.y = 0.15;
      body.castShadow = true;
      const band = new THREE.Mesh(bandGeo, colorMat(t.color));
      band.position.y = 0.26;
      g.add(body, band);
      for (let k = 0; k < 4; k++) {
        const m = new THREE.Mesh(merlonGeo, stoneMat);
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        m.position.set(Math.cos(a) * 0.06, 0.32, Math.sin(a) * 0.06);
        m.castShadow = true;
        g.add(m);
      }
      g.position.copy(toWorld(t.x, t.y));
      buildings.add(g);
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
    if (baronSprite) {
      baronSprite.visible = Boolean(baron);
      if (baron) {
        const pos = toWorld(baron.x, baron.y);
        baronSprite.position.set(pos.x, 0, pos.z);
        baronSprite.material.opacity = baron.active ? 1 : 0.3;
        baronLight.position.set(pos.x, 0.8, pos.z);
        baronLight.intensity = baron.active ? 4 : 0;
        baronSprite.userData.active = baron.active;
      }
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
      strip.position.set(c.x, 0.018, c.z);
      markers.add(strip);
      if (mortgaged) {
        const veil = new THREE.Mesh(
          new THREE.PlaneGeometry(w / 100, h / 100),
          new THREE.MeshBasicMaterial({ color: 0x05080c, transparent: true, opacity: 0.62, depthWrite: false }),
        );
        veil.rotation.x = -Math.PI / 2;
        const vc = toWorld(x0 + w / 2, y0 + h / 2);
        veil.position.set(vc.x, 0.004, vc.z);
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
      mesh.position.set(c.x, 0.008, c.z);
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
  const cam = { yaw: 0, pitch: 52, dist: 13, tYaw: 0, tPitch: 52, tDist: 13, zoom: 1 };
  function fitDistance() {
    // le canvas couvre tout l'écran, mais le plateau doit tenir entre les panneaux
    const { left, right, bottom = 0 } = sideSpace();
    const w = Math.max(320, container.clientWidth - left - right);
    const h = Math.max(240, container.clientHeight - bottom);
    const aspect = w / Math.max(h, 1);
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const need = S * 1.2;
    const byH = (need * 0.82) / 2 / Math.tan(vFov / 2);
    const byW = need / 2 / Math.tan(hFov / 2);
    return Math.max(byH, byW) + 1.2;
  }
  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
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

  function updateCamera() {
    cam.yaw = lerp(cam.yaw, cam.tYaw, 0.12);
    cam.pitch = lerp(cam.pitch, cam.tPitch, 0.12);
    cam.zoom = lerp(cam.zoom, cam.tZoom ?? 1, 0.15);
    const d = (cam.base || 13) / cam.zoom;
    const yaw = (cam.yaw * Math.PI) / 180;
    const pitch = (cam.pitch * Math.PI) / 180;
    camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * d,
      Math.sin(pitch) * d,
      Math.cos(yaw) * Math.cos(pitch) * d,
    );
    camera.lookAt(0, -0.2, 0.25);
  }

  // Glisser pour tourner / incliner, molette pour zoomer
  const canvas = renderer.domElement;
  let drag = null;
  let dragged = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY, yaw: cam.tYaw, pitch: cam.tPitch };
    dragged = false;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!dragged && Math.hypot(dx, dy) < 6) return;
    dragged = true;
    cam.tYaw = drag.yaw - dx * 0.3;
    cam.tPitch = Math.max(18, Math.min(82, drag.pitch + dy * 0.25));
    api.onDrag?.();
  });
  window.addEventListener('pointerup', () => {
    drag = null;
    setTimeout(() => { dragged = false; }, 0);
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    cam.tZoom = Math.max(0.7, Math.min(2.4, (cam.tZoom ?? 1) * (e.deltaY > 0 ? 0.92 : 1.08)));
  }, { passive: false });

  // --- Survol des cases (rayon souris -> plateau) ----------------------------
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
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
  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    updateCamera();
    const t = now / 1000;

    // pions
    for (const [key, p] of pawns) {
      if (p.from && p.target) {
        const k = Math.min(1, (now - p.t0) / p.dur);
        const e = ease(k);
        p.group.position.lerpVectors(p.from, p.target, e);
        p.group.position.y = p.hop ? Math.sin(Math.PI * k) * 0.28 : 0;
        if (p.hop && p.body.isSprite) {
          const squash = k > 0.8 ? 1 - (1 - k) * 0.5 : 1;
          p.body.scale.set(0.58 * (k > 0.8 ? 1.06 : 0.96), 0.97 * (k > 0.8 ? squash * 0.94 : 1.04), 1);
        }
        if (k >= 1) {
          p.from = null;
          p.group.position.copy(p.target);
          if (p.body.isSprite) p.body.scale.set(0.58, 0.97, 1);
        }
      }
      // le pion actif flotte et son anneau pulse
      const bob = p.current && !p.from ? Math.sin(t * 2.6) * 0.04 + 0.04 : 0;
      p.body.position.y = bob;
      p.ring.material.opacity = p.current ? 0.65 + Math.sin(t * 4) * 0.3 : 0.75;
      p.ring.scale.setScalar(p.current ? 1 + Math.sin(t * 4) * 0.08 : 1);
      if (key === labelKey) {
        tmp.copy(p.group.position);
        tmp.y += (p.body.isSprite ? 1.1 : 0.85) + bob;
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
    if (baronSprite?.visible && baronSprite.userData.active) {
      baronSprite.position.y = Math.sin(t * 2) * 0.06 + 0.06;
      baronLight.intensity = 3 + Math.sin(t * 3) * 1.2;
    }
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

    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  const api = {
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
    rotate(deg) { cam.tYaw += deg; },
    resetCamera() { cam.tYaw = Math.round(cam.tYaw / 360) * 360; cam.tPitch = 52; cam.tZoom = 1; },
    get dragging() { return dragged; },
    pause() { running = false; cancelAnimationFrame(raf); },
    resume() { if (!running) { running = true; raf = requestAnimationFrame(frame); } },
    dispose() {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
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
