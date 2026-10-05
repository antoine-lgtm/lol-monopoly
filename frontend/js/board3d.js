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

const BOARD_PX = 900;
const S = BOARD_PX / 100; // côté du plateau en unités
const TEX = 4096; // résolution de la texture du dessus
const K = TEX / BOARD_PX; // px plateau -> px texture

const TOP = 0.16; // dessus des tuiles (cases) ; le centre (la Faille) est en contrebas, à 0
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
  scene.fog = new THREE.Fog(0x050b12, 22, 48); // un peu de brume au loin : profondeur
  const { RoomEnvironment } = await import('/vendor/three-addons/environments/RoomEnvironment.js');
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);

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
  const topMat = new THREE.MeshStandardMaterial({ map: topTexture, roughness: 0.58, metalness: 0.05 });
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
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xc89b3c, metalness: 0.85, roughness: 0.3 });
  const frameW = 0.11;
  const frameH = BASE + TOP + 0.06;
  [[0, -S / 2 - frameW / 2, S + frameW * 2, frameW], [0, S / 2 + frameW / 2, S + frameW * 2, frameW],
    [-S / 2 - frameW / 2, 0, frameW, S], [S / 2 + frameW / 2, 0, frameW, S]].forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, frameH, d), frameMat);
    m.position.set(x, -BASE + frameH / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  });

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

  // Jungle : arbres et rochers, hors des voies, de la rivière, des paquets et des bases
  {
    const spots = [];
    const blocked = (x, y) => {
      if (x < 13 || y < 13 || x > 87 || y > 87) return true; // voies du haut, du bas, des côtés
      if (Math.abs(y - x) < 15) return true; // rivière
      if (Math.abs(y - (100 - x)) < 13) return true; // voie du milieu + logo
      if (Math.hypot(x - 19, y - 60) < 17 || Math.hypot(x - 81, y - 40) < 17) return true; // paquets
      if (Math.hypot(x - 27, y - 22) < 10 || Math.hypot(x - 73, y - 78) < 10) return true; // fosses
      return spots.some(([sx, sy]) => Math.hypot(sx - x, sy - y) < 4.2);
    };
    for (let k = 0; k < 900 && spots.length < 70; k++) {
      const x = rand() * 100;
      const y = rand() * 100;
      if (!blocked(x, y)) spots.push([x, y]);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.16, 6);
    const leafGeo = new THREE.ConeGeometry(0.15, 0.32, 7);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.9 }), spots.length);
    const leaves = new THREE.InstancedMesh(leafGeo, new THREE.MeshStandardMaterial({ color: 0x2f7a3a, roughness: 0.8 }), spots.length * 2);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    spots.forEach(([x, y], k) => {
      const pos = toRift(x, y, 0);
      const size = 0.75 + rand() * 0.6;
      sc.set(size, size, size);
      m.compose(new THREE.Vector3(pos.x, 0.08 * size, pos.z), q, sc);
      trunks.setMatrixAt(k, m);
      m.compose(new THREE.Vector3(pos.x, 0.27 * size, pos.z), q, sc);
      leaves.setMatrixAt(k * 2, m);
      sc.multiplyScalar(0.72);
      m.compose(new THREE.Vector3(pos.x, 0.42 * size, pos.z), q, sc);
      leaves.setMatrixAt(k * 2 + 1, m);
      leaves.setColorAt(k * 2, new THREE.Color().setHSL(0.33 + rand() * 0.06, 0.45, 0.24 + rand() * 0.08));
      leaves.setColorAt(k * 2 + 1, new THREE.Color().setHSL(0.33 + rand() * 0.06, 0.45, 0.3 + rand() * 0.08));
    });
    trunks.castShadow = leaves.castShadow = true;
    scene.add(trunks, leaves);

    // Rochers : les murs de la jungle, le long de la rivière et des voies
    const rockGeo = new THREE.DodecahedronGeometry(0.16, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x5a6258, roughness: 0.95, flatShading: true }), 26);
    let n = 0;
    for (let k = 0; k < 600 && n < 26; k++) {
      const x = 14 + rand() * 72;
      const y = 14 + rand() * 72;
      const dRiver = Math.abs(y - x);
      if (dRiver < 15 || dRiver > 22 || Math.abs(y - (100 - x)) < 13) continue;
      if (Math.hypot(x - 19, y - 60) < 17 || Math.hypot(x - 81, y - 40) < 17) continue;
      const pos = toRift(x, y, 0.04);
      q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
      const s1 = 0.7 + rand() * 0.9;
      sc.set(s1 * 1.4, s1 * 0.6, s1);
      m.compose(pos, q, sc);
      rocks.setMatrixAt(n++, m);
    }
    rocks.count = n;
    rocks.castShadow = rocks.receiveShadow = true;
    scene.add(rocks);
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

  // --- Décors des coins -------------------------------------------------------
  const cornerAt = (i, inward) => {
    const { x0, y0, w, h } = squareRect(i);
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    return toWorld(cx + (BOARD_PX / 2 - cx) * inward, cy + (BOARD_PX / 2 - cy) * inward, TOP + 0.05);
  };
  // Fontaine : bassin de pierre, eau lumineuse et flèche de cristal
  {
    const c = cornerAt(0, -0.06);
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.1, 20), new THREE.MeshStandardMaterial({ color: 0xc8c2b0, roughness: 0.6 }));
    basin.position.set(c.x, c.y + 0.05, c.z);
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x5fe0f0, emissive: 0x2ab8d0, emissiveIntensity: 0.9, roughness: 0.1 }));
    water.position.set(c.x, c.y + 0.1, c.z);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.42, 6), new THREE.MeshStandardMaterial({ color: 0x9ff3f8, emissive: 0x0ac8b9, emissiveIntensity: 1.2 }));
    spire.position.set(c.x, c.y + 0.32, c.z);
    basin.castShadow = spire.castShadow = true;
    const light = new THREE.PointLight(0x5fe0f0, 2.5, 2, 2);
    light.position.set(c.x, c.y + 0.5, c.z);
    scene.add(basin, water, spire, light);
    ambient.push((t) => { spire.rotation.y = t; light.intensity = 2 + Math.sin(t * 3) * 0.8; });
  }
  // Prison : une cage en fer forgé (les prisonniers se tiennent dedans)
  {
    const c = cornerAt(10, 0.06);
    const iron = new THREE.MeshStandardMaterial({ color: 0x3a3e44, metalness: 0.7, roughness: 0.45 });
    const cage = new THREE.Group();
    const barGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6);
    const size = 0.5;
    for (let k = 0; k < 4; k++) {
      for (let b = 0; b < 5; b++) {
        const bar = new THREE.Mesh(barGeo, iron);
        const tt = -size / 2 + (b / 4) * size;
        const [x, z] = [[tt, -size / 2], [size / 2, tt], [-tt, size / 2], [-size / 2, -tt]][k];
        bar.position.set(x, 0.25, z);
        bar.castShadow = true;
        cage.add(bar);
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(size + 0.06, 0.04, size + 0.06), iron);
    roof.position.y = 0.52;
    roof.castShadow = true;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(size + 0.06, 0.03, size + 0.06), iron);
    floor.position.y = 0.015;
    cage.add(roof, floor);
    cage.position.set(c.x, c.y - 0.05, c.z);
    scene.add(cage);
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
    // Pion modélisé en 3D (pawns3d.js), qui se tourne doucement vers la caméra
    const body = buildPawn(pawn || 'classic', color);
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
        baronSprite.position.set(pos.x, TOP, pos.z);
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
  const cam = { yaw: 0, pitch: 40, dist: 13, tYaw: 0, tPitch: 40, tDist: 13, zoom: 1 };
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

  // Clavier : ← → pour tourner, ↑ ↓ pour incliner, + − pour zoomer ; boutons maintenus
  const keys = new Set();
  let spinDir = 0;
  const CAM_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-'];
  const onKeyDown = (e) => {
    if (!running || !container.isConnected || container.closest('[hidden]')) return;
    if (e.target.closest?.('input, textarea, select')) return;
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
  hint.innerHTML = '<b>Glisse</b> sur le plateau pour tourner · <b>molette</b> pour zoomer · <b>← → ↑ ↓</b> au clavier';
  container.append(hint);
  let hintTimer = 0; // démarre au premier affichage du plateau
  function hideHint() {
    clearTimeout(hintTimer);
    hint.classList.add('is-hidden');
  }

  function updateCamera() {
    if (keys.has('ArrowLeft')) cam.tYaw -= 1.8;
    if (keys.has('ArrowRight')) cam.tYaw += 1.8;
    if (keys.has('ArrowUp')) cam.tPitch = Math.min(82, cam.tPitch + 0.9);
    if (keys.has('ArrowDown')) cam.tPitch = Math.max(14, cam.tPitch - 0.9);
    if (keys.has('+') || keys.has('=')) cam.tZoom = Math.min(2.4, (cam.tZoom ?? 1) * 1.012);
    if (keys.has('-')) cam.tZoom = Math.max(0.7, (cam.tZoom ?? 1) / 1.012);
    if (spinDir) cam.tYaw += spinDir * 1.8;
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
    camera.lookAt(0, 0, 0.45);
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
    hideHint();
    cam.tYaw = drag.yaw - dx * 0.3;
    cam.tPitch = Math.max(14, Math.min(82, drag.pitch + dy * 0.25));
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
  // Qualité adaptative : si l'image saccade, on baisse la résolution puis les ombres
  const perf = { frames: 0, since: 0, level: 0 };
  function adaptQuality(now) {
    if (!perf.since) perf.since = now;
    perf.frames++;
    if (now - perf.since < 2500) return;
    const fps = (perf.frames * 1000) / (now - perf.since);
    perf.frames = 0;
    perf.since = now;
    if (fps >= 28 || perf.level >= 2) return;
    perf.level++;
    if (perf.level === 1) {
      renderer.setPixelRatio(1);
      resize();
    } else {
      renderer.shadowMap.enabled = false;
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
    console.info(`[plateau 3D] ${fps.toFixed(0)} images/s : qualité réduite (niveau ${perf.level}).`);
  }

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
    if (baronSprite?.visible && baronSprite.userData.active) {
      baronSprite.position.y = TOP + Math.sin(t * 2) * 0.06 + 0.06;
      baronLight.intensity = 3 + Math.sin(t * 3) * 1.2;
    }
    for (const animate of ambient) animate(t);
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
    rotate(deg) { cam.tYaw += deg; hideHint(); },
    /** Rotation continue (bouton maintenu) : -1, 0 ou 1. */
    spin(dir) { spinDir = dir; if (dir) hideHint(); },
    resetCamera() { cam.tYaw = Math.round(cam.tYaw / 360) * 360; cam.tPitch = 40; cam.tZoom = 1; },
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
