/**
 * LoL Monopoly — client : plateau 3D et partie (Étape 4).
 *
 * Le plateau est une vraie scène 3D en CSS (perspective + preserve-3d) :
 * cases à plat, bords épais, pions et tours debout qui font face à la caméra,
 * dés cubiques. Le serveur fait autorité : on envoie des intentions (`game:*`)
 * et on reçoit `game:state`, accompagné d'effets (dés, déplacements, cartes)
 * que l'on joue en animation avant d'afficher le nouvel état.
 */
'use strict';

(() => {
  const { socket, $, $$ } = App;

  // Géométrie du plateau (px, avant zoom) : coins = 1,6 case. SIDE = cases par côté (coin compris) :
  // 10 sur la Faille (40 cases), 7 sur l'Abîme Hurlant (28 cases).
  const BOARD_PX = 900;
  let SIDE = 10;
  let UNIT = BOARD_PX / 12.2;
  let CORNER = UNIT * 1.6;
  function setGeometry(count) {
    SIDE = count / 4;
    UNIT = BOARD_PX / (SIDE - 1 + 3.2);
    CORNER = UNIT * 1.6;
  }
  const jailIndex = () => board.findIndex((sq) => sq.type === 'jail');
  const baronIndex = () => board.findIndex((sq) => sq.type === 'baron');

  const view = $('#board-view');
  const scene = $('#gv-scene');
  const camera = $('#gv-camera');
  const boardEl = $('#gv-board');
  const piecesEl = $('#gv-pieces');
  const diceEl = $('#gv-dice');

  let board = null; // définition des 40 cases (reçue du serveur)
  let groups = null;
  let gameId = null;
  let state = null; // dernier état affiché
  const squares = []; // éléments DOM des cases
  const pawns = new Map(); // key -> élément du pion
  const shownPos = new Map(); // key -> case affichée (pendant les animations)
  let inspected = null; // case ouverte dans la fiche
  let inspectByHover = false; // fiche ouverte au survol : elle se ferme quand la souris quitte la case
  let b3 = null; // plateau WebGL (board3d.js) ; null = plateau CSS de secours

  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);
  let animSpeed = 1; // replay : animations accélérées (×2, ×4)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms / animSpeed));
  const myKey = () => (App.me?.name || '').toLowerCase();
  const me = () => state?.players.find((p) => p.key === myKey());
  const isMyTurn = () => state && state.current === myKey() && state.phase !== 'over';

  // ---------------------------------------------------------------------------
  // Géométrie : case -> position sur la grille 11 × 11
  // ---------------------------------------------------------------------------

  function cellOf(i) {
    const n = SIDE;
    const last = n + 1;
    if (i <= n) return { row: last, col: last - i, side: i === 0 || i === n ? 'corner' : 's' };
    if (i <= 2 * n) return { row: last - (i - n), col: 1, side: i === 2 * n ? 'corner' : 'w' };
    if (i <= 3 * n) return { row: 1, col: 1 + (i - 2 * n), side: i === 3 * n ? 'corner' : 'n' };
    return { row: 1 + (i - 3 * n), col: last, side: 'e' };
  }

  /** Début et taille (px) d'une ligne/colonne de la grille. */
  function track(n) {
    if (n === 1) return [0, CORNER];
    if (n === SIDE + 1) return [CORNER + (SIDE - 1) * UNIT, CORNER];
    return [CORNER + (n - 2) * UNIT, UNIT];
  }

  /** Centre d'une case, avec un décalage optionnel vers l'intérieur (0..1). */
  function centerOf(i, inward = 0) {
    const { row, col } = cellOf(i);
    const [x0, w] = track(col);
    const [y0, h] = track(row);
    let x = x0 + w / 2;
    let y = y0 + h / 2;
    const c = BOARD_PX / 2;
    x += (c - x) * inward * 0.12;
    y += (c - y) * inward * 0.12;
    return { x, y };
  }

  /** Point sur la bande de couleur (côté intérieur) d'une case, pour les tours. */
  function bandPoint(i, t) {
    const { row, col, side } = cellOf(i);
    const [x0, w] = track(col);
    const [y0, h] = track(row);
    const along = 0.2 + 0.6 * t;
    switch (side) {
      case 's': return { x: x0 + w * along, y: y0 + CORNER * 0.13 };
      case 'n': return { x: x0 + w * (1 - along), y: y0 + h - CORNER * 0.13 };
      case 'w': return { x: x0 + w - CORNER * 0.13, y: y0 + h * along };
      default: return { x: x0 + CORNER * 0.13, y: y0 + h * (1 - along) };
    }
  }

  /** Bout de la bande de couleur d'une case, où l'on plante le drapeau du propriétaire
   *  (les tours occupent le milieu de la bande). */
  function flagPoint(i) {
    const { row, col, side } = cellOf(i);
    const [x0, w] = track(col);
    const [y0, h] = track(row);
    const d = CORNER * 0.12;
    switch (side) {
      case 's': return { x: x0 + w * 0.9, y: y0 + d };
      case 'n': return { x: x0 + w * 0.1, y: y0 + h - d };
      case 'w': return { x: x0 + w - d, y: y0 + h * 0.9 };
      default: return { x: x0 + d, y: y0 + h * 0.1 };
    }
  }

  // ---------------------------------------------------------------------------
  // Sons (générés, sans fichier), au volume des paramètres
  // ---------------------------------------------------------------------------

  function sfx(kind) {
    const volume = (App.settings?.volume ?? 60) / 100;
    if (!volume || view.hidden) return;
    try {
      const ctx = App.audio ?? (App.audio = new AudioContext());
      const now = ctx.currentTime;
      const tone = (freq, start, dur, gainValue, type = 'sine') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + start);
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(gainValue * volume, now + start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
        return osc;
      };
      const noise = (start, dur, gainValue, freq, type = 'bandpass', q = 1) => {
        const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        src.buffer = buffer;
        filter.type = type;
        filter.frequency.value = freq;
        filter.Q.value = q;
        gain.gain.value = gainValue * volume;
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start(now + start);
        return filter;
      };
      /** Cloche cristalline (partiels inharmoniques) : or, cartes, sorts. */
      const bell = (freq, start, dur, gainValue) => {
        tone(freq, start, dur, gainValue);
        tone(freq * 2.76, start, dur * 0.5, gainValue * 0.35);
        tone(freq * 5.4, start, dur * 0.25, gainValue * 0.15);
      };
      switch (kind) {
        case 'dice': // cliquetis des dés qui roulent
          for (let k = 0; k < 7; k++) noise(k * 0.11 + Math.random() * 0.04, 0.05, 0.5, 2200 + Math.random() * 1500);
          break;
        case 'step': // pas feutré sur la pierre
          noise(0, 0.06, 0.35, 380 + Math.random() * 120, 'lowpass');
          tone(140 + Math.random() * 20, 0, 0.06, 0.04, 'sine');
          break;
        case 'gain': // pièces d'or qui tintent, comme à la boutique
          bell(1568, 0, 0.35, 0.06);
          bell(2093, 0.07, 0.4, 0.05);
          for (let k = 0; k < 4; k++) noise(0.02 + k * 0.045, 0.04, 0.12, 6000 + k * 600, 'highpass');
          break;
        case 'loss':
          tone(392, 0, 0.18, 0.05, 'triangle');
          tone(294, 0.09, 0.3, 0.05, 'triangle');
          noise(0, 0.12, 0.08, 1800);
          break;
        case 'card': // souffle hextech puis carillon
          noise(0, 0.45, 0.22, 700, 'bandpass', 0.7).frequency.exponentialRampToValueAtTime(3200, now + 0.4);
          bell(880, 0.18, 0.6, 0.05);
          bell(1320, 0.3, 0.7, 0.04);
          break;
        case 'build': // coup de marteau puis note magique
          noise(0, 0.08, 0.5, 900, 'lowpass');
          tone(110, 0, 0.12, 0.12, 'square');
          bell(1046, 0.1, 0.5, 0.045);
          bell(1568, 0.2, 0.55, 0.035);
          break;
        case 'baron': { // rugissement grave du Baron
          const roar = noise(0, 1.4, 0.55, 220, 'lowpass', 4);
          roar.frequency.setValueAtTime(160, now);
          roar.frequency.linearRampToValueAtTime(520, now + 0.35);
          roar.frequency.exponentialRampToValueAtTime(90, now + 1.3);
          tone(73, 0, 1.3, 0.13, 'sawtooth');
          tone(55, 0.1, 1.4, 0.1, 'sawtooth');
          break;
        }
        case 'spell': // sort lancé : souffle et éclat
          noise(0, 0.25, 0.25, 1800, 'bandpass', 0.8).frequency.exponentialRampToValueAtTime(5000, now + 0.22);
          bell(1175, 0.05, 0.4, 0.045);
          break;
        case 'quest': // fanfare courte
          [659, 784, 988, 1319].forEach((f, k) => bell(f, k * 0.09, 0.6, 0.05));
          break;
        case 'turn': // « à toi de jouer » : deux notes claires
          bell(784, 0, 0.5, 0.05);
          bell(1175, 0.12, 0.7, 0.05);
          break;
        case 'trade':
          bell(988, 0, 0.5, 0.045);
          bell(1319, 0.1, 0.5, 0.04);
          bell(1760, 0.2, 0.7, 0.035);
          break;
        case 'eliminated': // descente sombre
          [392, 330, 262, 196].forEach((f, k) => tone(f, k * 0.14, 0.45, 0.06, 'triangle'));
          break;
        case 'victory':
          [523, 659, 784, 1046].forEach((f, k) => bell(f, k * 0.13, 1.2, 0.055));
          tone(131, 0, 1.6, 0.07, 'triangle');
          break;
        case 'defeat':
          [440, 415, 349, 262].forEach((f, k) => tone(f, k * 0.22, 0.7, 0.05, 'sawtooth'));
          break;
        case 'tick': // chrono presque écoulé
          tone(1400, 0, 0.06, 0.05, 'square');
          break;
        case 'ping': // ping LoL : deux bips montants
          tone(880, 0, 0.12, 0.06, 'triangle');
          tone(1320, 0.08, 0.18, 0.06, 'triangle');
          break;
        case 'danger':
          tone(660, 0, 0.12, 0.07, 'square');
          tone(440, 0.12, 0.2, 0.07, 'square');
          break;
        case 'emote':
          bell(1568, 0, 0.3, 0.035);
          break;
        case 'event': // annonce d'un événement de la Faille
          tone(196, 0, 0.9, 0.06, 'sawtooth');
          [523, 659, 784].forEach((f, k) => bell(f, 0.15 + k * 0.1, 0.8, 0.045));
          break;
        default:
      }
    } catch { /* audio indisponible */ }
  }

  // ---------------------------------------------------------------------------
  // Construction du plateau
  // ---------------------------------------------------------------------------

  // Illustrations des champions. Copie locale d'abord (téléchargée par `npm start`),
  // puis CommunityDragon et Data Dragon (Riot). Si rien ne charge, la case garde son style.
  const champId = (sq) => sq.name.replace(/[^A-Za-z]/g, '');
  const portraitUrl = (sq) => `loading/${champId(sq)}_0.jpg`;
  const splashUrl = (sq) => `splash/${champId(sq)}_0.jpg`;

  function imageSources(kind, id) {
    const cdragon = `https://cdn.communitydragon.org/latest/champion/${id}`;
    const square = `https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/${id}.png`;
    return kind === 'splash'
      ? [`${cdragon}/splash-art/centered`, `${cdragon}/splash-art`, `${cdragon}/tile`, `${cdragon}/square`, square]
      : [`${cdragon}/tile`, `${cdragon}/portrait`, `${cdragon}/square`, square];
  }

  function champImage(className, file) {
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    const [kind, name] = file.split('/');
    const sources = [`assets/champions/${file}`, ...imageSources(kind, name.replace('_0.jpg', ''))];
    img.addEventListener('error', () => {
      sources.shift();
      if (sources.length) img.src = sources[0];
      else img.remove();
    });
    img.src = sources[0];
    return img;
  }

  // Images officielles du jeu pour le Coffre Hextech et le ping « ? » : d'abord celles
  // déposées dans frontend/assets/board/real/ (chest.png, ping.png), puis CommunityDragon,
  // et en dernier recours notre dessin.
  const CDRAGON_RAW = 'https://raw.communitydragon.org/latest';
  const OFFICIAL_ART = {
    chest: [
      `${CDRAGON_RAW}/plugins/rcp-fe-lol-loot/global/default/assets/loot_item_icons/chest.png`,
      `${CDRAGON_RAW}/plugins/rcp-fe-lol-loot/global/default/assets/loot_item_icons/chest_generic.png`,
      `${CDRAGON_RAW}/plugins/rcp-fe-lol-loot/global/default/assets/loot_item_icons/chest_masterwork.png`,
    ],
    ping: [
      `${CDRAGON_RAW}/game/assets/ux/minimap/pings/ping_enemymissing.png`,
      `${CDRAGON_RAW}/game/assets/ux/minimap/pings/enemymissing.png`,
      `${CDRAGON_RAW}/game/assets/ux/minimap/pings/mia.png`,
    ],
  };

  // Images déposées dans frontend/assets/board/real/ : la liste vient du serveur
  let realArt = null; // Set des noms de fichiers, ou null tant que la liste n'est pas arrivée
  const realArtReady = fetch('/board-art.json').then((r) => r.json()).then((list) => {
    realArt = new Set(list.map((f) => f.toLowerCase()));
  }).catch(() => { realArt = new Set(); });
  const DRAWN = new Set(['chest', 'ping', 'sbires', 'boutique', 'baron', 'dragon-ocean', 'dragon-mountain', 'dragon-infernal',
    'dragon-cloud', 'potion-hp', 'potion-mana']);

  /** Sources d'une illustration : ton image (real/), puis l'image officielle en ligne, puis notre dessin. */
  function artSources(name, { drawnFallback = true } = {}) {
    const mine = realArt
      ? ['png', 'webp', 'jpg', 'jpeg', 'svg'].filter((ext) => realArt.has(`${name}.${ext}`)).map((ext) => `assets/board/real/${name}.${ext}`)
      : [`assets/board/real/${name}.png`, `assets/board/real/${name}.webp`];
    const drawn = drawnFallback && DRAWN.has(name) ? [`assets/board/${name}.svg`] : [];
    return [...mine, ...(OFFICIAL_ART[name] || []), ...drawn];
  }

  /** Illustration des cases spéciales (dragons, potions, cartes, taxes). */
  function specialArt(sq) {
    // coins : seulement ton image s'il y en a une (pas de dessin par défaut)
    const corner = { go: 'fountain', jail: 'jail', baron: 'baron', gotojail: 'blitzcrank' }[sq.type];
    if (corner) {
      const list = artSources(corner, { drawnFallback: false });
      return list.length ? list : null;
    }
    const name = {
      dragon: `dragon-${sq.element}`,
      potion: `potion-${sq.kind}`,
      chest: 'chest',
      chance: 'ping',
      tax: sq.kind,
    }[sq.type];
    return name ? artSources(name) : null;
  }

  /** Image qui essaie ses sources dans l'ordre ; les images officielles (PNG) sont marquées. */
  function artImage(className, srcs) {
    const sources = [].concat(srcs);
    const img = document.createElement('img');
    img.className = className;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      sources.shift();
      if (sources.length) img.src = sources[0];
      else img.remove();
    });
    img.addEventListener('load', () => img.classList.toggle('is-official', !img.src.endsWith('.svg')));
    img.src = sources[0];
    return img;
  }

  function priceLabel(sq) {
    return sq.price ? `${fmt(sq.price)} PO` : sq.amount ? `${sq.amount} PO` : '';
  }

  function buildSquare(sq, i) {
    const { row, col, side } = cellOf(i);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `gv-sq gv-sq--${sq.type} gv-sq--${side}`;
    el.dataset.index = i;
    el.style.gridRow = row;
    el.style.gridColumn = col;
    if (sq.group) el.style.setProperty('--group', groups[sq.group].color);
    if (sq.element) el.dataset.element = sq.element;
    if (sq.kind) el.dataset.kind = sq.kind;
    el.setAttribute('aria-label', sq.name);

    const inner = document.createElement('span');
    inner.className = 'gv-sq__inner';
    if (sq.type === 'property') {
      inner.innerHTML = '<span class="gv-sq__band"></span>';
      inner.append(champImage('gv-sq__art', portraitUrl(sq)));
    } else if (specialArt(sq)) {
      el.classList.add('has-art');
      inner.append(artImage('gv-sq__art', specialArt(sq)));
    }
    const name = document.createElement('span');
    name.className = 'gv-sq__name';
    name.textContent = sq.type === 'go' ? 'Fontaine' : sq.type === 'jail' ? 'Prison' : sq.name;
    inner.append(name);
    if (sq.type === 'go') {
      const sub = document.createElement('span');
      sub.className = 'gv-sq__price';
      sub.textContent = '+200 PO';
      inner.append(sub);
    } else if (sq.type === 'jail') {
      const sub = document.createElement('span');
      sub.className = 'gv-sq__price';
      sub.textContent = 'Simple visite';
      inner.append(sub);
    } else if (priceLabel(sq)) {
      const price = document.createElement('span');
      price.className = 'gv-sq__price';
      price.textContent = sq.kind === 'sbires' ? '10 % ou 200 PO' : priceLabel(sq);
      inner.append(price);
    }
    const owner = document.createElement('span');
    owner.className = 'gv-sq__owner';
    inner.append(owner);
    el.append(inner);
    return el;
  }

  function buildBoard() {
    setGeometry(board.length);
    boardEl.style.setProperty('--unit', `${UNIT}px`);
    boardEl.style.setProperty('--cells', String(SIDE - 1));
    view.dataset.board = state?.boardId || 'rift';
    $('.gv-center', boardEl).style.gridArea = `2 / 2 / ${SIDE + 1} / ${SIDE + 1}`;
    $('.gv-center__sub', boardEl).textContent = state?.boardId === 'aram' ? 'Abîme Hurlant' : 'Faille de l’Invocateur';
    $$('.gv-sq', boardEl).forEach((el) => el.remove());
    squares.length = 0;
    board.forEach((sq, i) => {
      const el = buildSquare(sq, i);
      squares.push(el);
      boardEl.insertBefore(el, boardEl.firstChild);
    });
    // Paquets de cartes du centre
    $$('.gv-deck__art', boardEl).forEach((old) => {
      const art = artImage('gv-deck__art', artSources(old.dataset.art));
      art.dataset.art = old.dataset.art;
      old.replaceWith(art);
    });
    diceEl.innerHTML = '';
    for (let d = 0; d < 2; d++) {
      const die = document.createElement('div');
      die.className = 'gv-die';
      die.innerHTML = [1, 2, 3, 4, 5, 6].map((v) => `<span class="gv-die__face gv-die__face--${v}">${'<i></i>'.repeat(v)}</span>`).join('');
      diceEl.append(die);
    }
    piecesEl.innerHTML = '';
    pawns.clear();
    shownPos.clear();
  }

  // ---------------------------------------------------------------------------
  // Plateau en vraie 3D (WebGL). Si le navigateur ne sait pas faire, on garde
  // le plateau CSS, qui reste construit en dessous.
  // ---------------------------------------------------------------------------

  /**
   * WebGL disponible ET accéléré par une carte graphique. Un rendu logiciel
   * (SwiftShader, llvmpipe…) serait injouable : on garde alors le plateau CSS.
   * `?3d=1` dans l'adresse force la 3D (tests), `?3d=0` la désactive.
   */
  /** '' si le plateau 3D peut s'afficher, sinon la raison ('off', 'nogl', 'software'). */
  function webglStatus() {
    const force = new URLSearchParams(location.search).get('3d');
    if (force === '0') return 'off';
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      if (!gl) return 'nogl';
      if (force === '1') return '';
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software|basic render/i.test(renderer) ? 'software' : '';
    } catch {
      return 'nogl';
    }
  }

  /** Bandeau qui explique pourquoi le plateau est plat, avec un bouton pour forcer la 3D. */
  function notice3D(reason, detail = '') {
    view.querySelector('.gv-3dnotice')?.remove();
    if (!reason || reason === 'off') return;
    const text = {
      software: 'Plateau 3D désactivé : ton navigateur n’utilise pas la carte graphique (accélération matérielle coupée). Active-la dans les réglages de Chrome (Système → « Utiliser l’accélération graphique »), ou force la 3D (elle risque d’être lente).',
      nogl: 'Plateau 3D indisponible : WebGL est désactivé dans ce navigateur.',
      error: `Le plateau 3D n’a pas pu se charger${detail ? ` (${detail})` : ''}.`,
    }[reason];
    const box = document.createElement('div');
    box.className = 'gv-3dnotice';
    const p = document.createElement('p');
    p.textContent = text;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gv-3dnotice__btn';
    btn.textContent = reason === 'error' ? 'Réessayer' : 'Forcer la 3D';
    btn.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('3d', '1');
      location.href = url.toString();
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'gv-3dnotice__close';
    close.setAttribute('aria-label', 'Fermer');
    close.textContent = '×';
    close.addEventListener('click', () => box.remove());
    box.append(p, btn, close);
    view.append(box);
  }

  /** Sources d'image d'une case pour la texture du plateau 3D. */
  function squareArt(sq) {
    if (sq.type === 'property') {
      const id = champId(sq);
      return [`assets/champions/loading/${id}_0.jpg`, ...imageSources('loading', id)];
    }
    // pour la texture 3D : images locales seulement (dessin ou image officielle déposée)
    return specialArt(sq)?.filter((src) => !src.startsWith('http')) ?? null;
  }

  async function setup3D() {
    b3?.dispose();
    b3 = null;
    view.classList.remove('is-webgl');
    const status = webglStatus();
    notice3D(status);
    if (status) return;
    try {
      const mod = await import('./board3d.js');
      b3 = await mod.createBoard3D({
        container: scene,
        board,
        groups,
        geo: { cellOf, track, CORNER, UNIT, side: SIDE },
        boardId: state?.boardId || 'rift',
        squareArt,
        priceLabel,
        quality: App.settings?.quality || 'auto',
        sideSpace: () => (isPhone()
          ? { left: 0, right: 0, bottom: 170 } // téléphone : panneaux en haut et en bas
          : {
            left: ($('.gv-players')?.offsetWidth || 250) + 30,
            right: ($('.gv-side')?.offsetWidth || 300) + 30,
            bottom: 110, // barre d'actions
          }),
      });
      view.classList.add('is-webgl');
      b3.onHover = hoverSquare;
      b3.onClick = (i) => {
        if (maybePing(i)) return;
        if (matchMedia('(hover: none)').matches) openInspect(i);
      };
      b3.onDrag = () => hoverSquare(null);
    } catch (err) {
      console.warn('[plateau] WebGL indisponible, plateau CSS utilisé.', err);
      b3 = null;
      notice3D('error', err?.message?.slice(0, 120));
    }
  }

  // ---------------------------------------------------------------------------
  // Pièces debout : pions, tours, Baron
  // ---------------------------------------------------------------------------

  function standing(className, x, y) {
    const el = document.createElement('div');
    el.className = `gv-standee ${className}`;
    el.style.setProperty('--x', `${x}px`);
    el.style.setProperty('--y', `${y}px`);
    el.innerHTML = '<span class="gv-standee__shadow"></span><span class="gv-standee__body"></span>';
    return el;
  }

  function placePawn(key, index, { hop = false } = {}) {
    const el = pawns.get(key);
    if (!el) return;
    const p = state.players.find((q) => q.key === key);
    const same = [...shownPos.entries()].filter(([k, i]) => i === index && k !== key).length;
    const inJail = index === jailIndex() && p?.inJail;
    const { x, y } = centerOf(index, inJail ? 0.7 : 0);
    const angle = (same * 2.1) + (key.length * 0.7);
    const r = same ? 22 : 0;
    el.style.setProperty('--x', `${x + Math.cos(angle) * r}px`);
    el.style.setProperty('--y', `${y + Math.sin(angle) * r}px`);
    shownPos.set(key, index);
    b3?.setPawn(key, {
      x: x + Math.cos(angle) * r,
      y: y + Math.sin(angle) * r,
      color: p?.color,
      pawn: p?.pawn,
      skin: p?.skin,
      hop,
      glide: el.classList.contains('is-gliding'),
      current: p?.key === state.current,
      hidden: Boolean(p?.bankrupt),
    });
    if (hop) {
      sfx('step');
      el.classList.remove('is-hopping');
      void el.offsetWidth;
      el.classList.add('is-hopping');
    }
  }

  function syncPawns() {
    for (const p of state.players) {
      let el = pawns.get(p.key);
      if (!el) {
        el = standing('gv-pawn', 0, 0);
        el.style.setProperty('--c', p.color);
        // Pion choisi dans le salon (le pion classique garde la couleur du joueur)
        el.dataset.pawn = p.pawn || 'classic';
        el.dataset.skin = p.skin || 'base';
        if (p.pawn && p.pawn !== 'classic') el.style.setProperty('--pawn-img', `url("/assets/pawns/${p.pawn}.svg")`);
        el.dataset.key = p.key;
        const label = document.createElement('span');
        label.className = 'gv-pawn__label';
        label.textContent = p.name;
        $('.gv-standee__body', el).after(label);
        piecesEl.append(el);
        pawns.set(p.key, el);
      }
      el.hidden = p.bankrupt;
      el.classList.toggle('is-current', p.key === state.current);
      if (!shownPos.has(p.key) || shownPos.get(p.key) !== p.pos) placePawn(p.key, p.pos);
    }
    // Repositionne tout le monde pour bien répartir les pions sur une même case
    for (const p of state.players) placePawn(p.key, shownPos.get(p.key));
    const current = state.players.find((p) => p.key === state.current);
    b3?.setLabel(state.phase === 'over' ? null : current?.key, current?.name, current?.color);
  }

  function syncBuildings() {
    $$('.gv-tower, .gv-inhib', piecesEl).forEach((el) => el.remove());
    for (const [i, st] of Object.entries(state.props)) {
      if (!st.level) continue;
      const index = Number(i);
      const owner = state.players.find((p) => p.key === st.owner);
      if (st.level === 5) {
        const { x, y } = bandPoint(index, 0.5);
        const el = standing('gv-inhib', x, y);
        el.style.setProperty('--c', owner?.color || '#c8aa6e');
        piecesEl.append(el);
        continue;
      }
      for (let t = 0; t < st.level; t++) {
        const { x, y } = bandPoint(index, st.level === 1 ? 0.5 : t / (st.level - 1));
        const el = standing('gv-tower', x, y);
        el.style.setProperty('--c', owner?.color || '#c8aa6e');
        piecesEl.append(el);
      }
    }
    // Drapeau du propriétaire planté dans chaque case achetée
    $$('.gv-flag', piecesEl).forEach((el) => el.remove());
    for (const [i, st] of Object.entries(state.props)) {
      const owner = state.players.find((p) => p.key === st.owner);
      const { x, y } = flagPoint(Number(i));
      const el = standing('gv-flag', x, y);
      el.style.setProperty('--c', owner?.color || '#c8aa6e');
      el.classList.toggle('is-mortgaged', st.mortgaged);
      piecesEl.append(el);
    }
    // Baron Nashor dans sa fosse
    $$('.gv-baron', piecesEl).forEach((el) => el.remove());
    if (!state.baron.taken) {
      const { x, y } = centerOf(baronIndex(), 0.9);
      const el = standing('gv-baron', x, y);
      el.classList.toggle('is-active', state.baron.active);
      piecesEl.append(el);
    }
    if (b3) b3.setBuildings(buildingsFor3D());
  }

  /** Mêmes constructions que ci-dessus, en coordonnées plateau pour la scène 3D. */
  function buildingsFor3D() {
    const towers = [];
    const inhibs = [];
    const flags = [];
    for (const [i, st] of Object.entries(state.props)) {
      const index = Number(i);
      const color = state.players.find((p) => p.key === st.owner)?.color || '#c8aa6e';
      if (st.level === 5) inhibs.push({ ...bandPoint(index, 0.5), color });
      else for (let t = 0; t < st.level; t++) towers.push({ ...bandPoint(index, st.level === 1 ? 0.5 : t / (st.level - 1)), color, slot: t, count: st.level });
      flags.push({ ...flagPoint(index), color, mortgaged: st.mortgaged });
    }
    const baron = state.baron.taken ? null : { ...centerOf(baronIndex(), 0.9), active: state.baron.active };
    return { towers, inhibs, flags, baron };
  }

  // ---------------------------------------------------------------------------
  // Dés 3D
  // ---------------------------------------------------------------------------

  // Rotation qui amène la face v sur le dessus du cube
  const FACE_UP = {
    1: 'rotateX(0deg) rotateY(0deg)',
    2: 'rotateX(90deg) rotateY(0deg)',
    3: 'rotateX(0deg) rotateY(-90deg)',
    4: 'rotateX(0deg) rotateY(90deg)',
    5: 'rotateX(-90deg) rotateY(0deg)',
    6: 'rotateX(180deg) rotateY(0deg)',
  };
  let spins = 0;

  function showDice(values, animate) {
    if (!values) return;
    b3?.rollDice(values, animate);
    diceEl.classList.add('is-visible');
    spins += 2;
    $$('.gv-die', diceEl).forEach((die, d) => {
      const turn = animate ? spins * 360 : 0;
      const z = (d ? 17 : -11) + (animate ? turn : 0);
      die.style.transition = animate ? '' : 'none';
      const [rx, ry] = FACE_UP[values[d]].match(/-?\d+deg/g).map((v) => parseInt(v, 10));
      die.style.transform = `translateZ(var(--half)) rotateZ(${z}deg) rotateX(${rx + turn}deg) rotateY(${ry + (d ? turn : -turn)}deg)`;
    });
  }

  // ---------------------------------------------------------------------------
  // Effets (animations avant d'afficher l'état)
  // ---------------------------------------------------------------------------

  function showRollTotal(values) {
    let box = $('#gv-roll');
    if (!box) {
      box = document.createElement('div');
      box.id = 'gv-roll';
      box.className = 'gv-roll';
      view.append(box);
    }
    const [a, b] = values;
    box.innerHTML = '';
    const total = document.createElement('span');
    total.className = 'gv-roll__total';
    total.textContent = a + b;
    const detail = document.createElement('span');
    detail.className = 'gv-roll__detail';
    detail.textContent = a === b ? `Double ${a} !` : `${a} + ${b}`;
    box.append(total, detail);
    box.classList.toggle('is-double', a === b);
    box.classList.remove('is-shown');
    void box.offsetWidth;
    box.classList.add('is-shown');
  }

  function flashLanding(key, index) {
    const sq = squares[index];
    const p = state.players.find((q) => q.key === key);
    if (!sq) return;
    b3?.flash(index, p?.color || '#c8aa6e');
    sq.style.setProperty('--land', p?.color || '#c8aa6e');
    sq.classList.remove('is-landed');
    void sq.offsetWidth;
    sq.classList.add('is-landed');
    setTimeout(() => sq.classList.remove('is-landed'), 1600);
  }

  async function animateMove(fx) {
    if (!pawns.has(fx.key)) return;
    if (fx.direct || fx.steps === 0) {
      pawns.get(fx.key).classList.add('is-gliding');
      placePawn(fx.key, fx.to);
      await sleep(650);
      pawns.get(fx.key).classList.remove('is-gliding');
      flashLanding(fx.key, fx.to);
      return;
    }
    const dir = fx.steps > 0 ? 1 : -1;
    let pos = fx.from;
    for (let s = 0; s < Math.abs(fx.steps); s++) {
      pos = (pos + dir + board.length) % board.length;
      placePawn(fx.key, pos, { hop: true });
      sfx('step');
      await sleep(200);
    }
    flashLanding(fx.key, fx.to);
    await sleep(120);
  }

  function showCard(fx) {
    const box = $('#gv-cardfx');
    box.className = `gv-cardfx gv-cardfx--${fx.deck}`;
    box.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'gv-cardfx__card';
    const title = document.createElement('p');
    title.className = 'gv-cardfx__title';
    title.textContent = fx.title;
    const text = document.createElement('p');
    text.className = 'gv-cardfx__text';
    text.textContent = fx.text;
    const who = document.createElement('p');
    who.className = 'gv-cardfx__who';
    who.textContent = state.players.find((p) => p.key === fx.key)?.name || '';
    const art = artImage('gv-cardfx__art', artSources(fx.deck === 'chance' ? 'ping' : 'chest'));
    card.append(art, title, text, who);
    box.append(card);
    box.hidden = false;
    clearTimeout(showCard.timer);
    showCard.timer = setTimeout(() => { box.hidden = true; }, 4200);
  }

  function floatGold(fx) {
    const row = $(`.gv-player[data-key="${CSS.escape(fx.key)}"]`);
    if (!row) return;
    const tag = document.createElement('span');
    tag.className = `gv-float ${fx.amount < 0 ? 'is-loss' : 'is-gain'}`;
    tag.textContent = `${fx.amount > 0 ? '+' : ''}${fmt(fx.amount)}`;
    row.append(tag);
    setTimeout(() => tag.remove(), 1600);
  }

  async function playEffects(list, next) {
    for (const fx of list) {
      switch (fx.type) {
        case 'dice':
          sfx('dice');
          showDice(fx.values, true);
          await sleep(950);
          showRollTotal(fx.values);
          await sleep(250);
          break;
        case 'move':
          await animateMove(fx);
          break;
        case 'card':
          sfx('card');
          if (fx.deck === 'chest') b3?.openChest();
          showCard(fx);
          await sleep(900);
          break;
        case 'gold':
          floatGold(fx);
          sfx(fx.amount > 0 ? 'gain' : 'loss');
          break;
        case 'build':
          sfx('build');
          break;
        case 'baron':
          sfx('baron');
          view.classList.add('is-baron-flash');
          setTimeout(() => view.classList.remove('is-baron-flash'), 1400);
          break;
        case 'baron-spawn':
          App.toast('Le Baron Nashor apparaît dans la fosse !', 'info', 5000);
          sfx('baron');
          break;
        case 'bankrupt':
          sfx('eliminated');
          break;
        case 'spell':
          sfx('spell');
          break;
        case 'item':
          sfx('gain');
          break;
        case 'quest': {
          sfx('quest');
          const who = state.players.find((p) => p.key === fx.key);
          App.toast(`${fx.key === myKey() ? 'Quête accomplie' : `${who?.name} accomplit sa quête`} : ${catalog().quests[fx.role]?.name || ''}`, 'success', 4500);
          break;
        }
        case 'soul':
        case 'elder':
          sfx('baron');
          App.toast(`${state.players.find((p) => p.key === fx.key)?.name} obtient ${fx.type === 'soul' ? 'l’Âme du Dragon' : 'le Dragon Ancien'} : +30 % sur ses loyers pendant 5 tours !`, 'info', 5000);
          break;
        case 'elder-spawn':
          sfx('baron');
          App.toast('Le Dragon Ancien s’éveille : le premier sur une case Dragon le terrasse !', 'info', 5000);
          break;
        case 'herald-spawn':
          App.toast('Le Héraut de la Faille apparaît dans la fosse du Baron !', 'info', 5000);
          break;
        case 'herald':
        case 'herald-charge':
          sfx('build');
          break;
        case 'angel':
          sfx('victory');
          App.toast(`L’Ange gardien sauve ${state.players.find((p) => p.key === fx.key)?.name} !`, 'info', 4500);
          break;
        case 'card-blocked':
          sfx('spell');
          break;
        case 'trade-offer':
          if (fx.to === myKey()) sfx('card');
          break;
        case 'event': {
          const ev = catalog().events?.[fx.event];
          sfx('event');
          showEventBanner(ev);
          await sleep(600);
          break;
        }
        case 'passive': {
          const who = state.players.find((p) => p.key === fx.key);
          const pv = catalog().passives?.[fx.pawn];
          sfx('spell');
          App.toast(`${who?.name} — ${pv?.name || 'Pouvoir'} !`, 'info', 3500);
          break;
        }
        case 'rent':
          if (Math.random() < 0.45) championQuote(fx.index, 'rent');
          break;
        case 'buy':
          championQuote(fx.index, 'buy');
          break;
        case 'trade-done':
          if (fx.from === myKey() || fx.to === myKey()) {
            sfx(fx.accepted ? 'trade' : 'loss');
            App.toast(fx.accepted ? 'Échange conclu !' : 'Échange refusé.', fx.accepted ? 'success' : 'info', 3500);
          }
          break;
        default:
      }
    }
    return next;
  }

  // ---------------------------------------------------------------------------
  // Rendu de l'interface
  // ---------------------------------------------------------------------------

  function renderSquares() {
    squares.forEach((el, i) => {
      const st = state.props[i];
      const owner = st && state.players.find((p) => p.key === st.owner);
      el.classList.toggle('is-owned', Boolean(owner));
      el.classList.toggle('is-mortgaged', Boolean(st?.mortgaged));
      el.classList.toggle('is-pending', state.pendingIndex === i);
      if (owner) el.style.setProperty('--owner', owner.color);
      else el.style.removeProperty('--owner');
    });
    if (b3) {
      b3.setOwners(Object.entries(state.props).map(([i, st]) => ({
        index: Number(i),
        color: state.players.find((p) => p.key === st.owner)?.color || '#c8aa6e',
        mortgaged: st.mortgaged,
      })));
      b3.setPending(state.pendingIndex);
      b3.setObjectives?.({ herald: state.herald?.active, elder: state.elder?.active });
      b3.setAtmosphere?.({ round: state.round, baron: state.baron?.active, elder: state.elder?.active });
    }
  }

  function renderPlayers() {
    const list = $('#gv-players');
    list.replaceChildren(...state.players.map((p) => {
      const row = document.createElement('div');
      row.className = 'gv-player';
      row.dataset.key = p.key;
      row.style.setProperty('--c', p.color);
      row.classList.toggle('is-current', p.key === state.current);
      row.classList.toggle('is-bankrupt', p.bankrupt);
      row.classList.toggle('is-me', p.key === myKey());

      const pawn = document.createElement('span');
      pawn.className = 'gv-player__pawn';
      pawn.dataset.pawn = p.pawn || 'classic';
      pawn.dataset.skin = p.skin || 'base';
      if (p.pawn && p.pawn !== 'classic') pawn.style.setProperty('--pawn-img', `url("/assets/pawns/${p.pawn}.svg")`);
      const info = document.createElement('div');
      info.className = 'gv-player__info';
      const name = document.createElement('span');
      name.className = 'gv-player__name';
      name.textContent = p.name;
      const gold = document.createElement('span');
      gold.className = 'gv-player__gold';
      gold.textContent = p.bankrupt ? 'Éliminé' : `${fmt(p.gold)} PO`;
      info.append(name, gold);

      const tags = document.createElement('div');
      tags.className = 'gv-player__tags';
      const tag = (cls, text, title) => {
        const t = document.createElement('span');
        t.className = `gv-tag gv-tag--${cls}`;
        t.textContent = text;
        t.title = title;
        tags.append(t);
      };
      if (p.baron) tag('baron', 'Main du Baron', 'Loyers +50 % et +300 PO au prochain passage à la Fontaine');
      if (p.inJail) tag('jail', 'Prison', 'En prison');
      if (p.jailCards) tag('zhonya', `Zhonya ×${p.jailCards}`, 'Carte de sortie de prison');
      if (p.soul) tag('soul', `Âme ${p.soul}t`, `Âme du Dragon : +30 % sur ses loyers (${p.soul} tours)`);
      if (p.elderBuff) tag('elder', `Ancien ${p.elderBuff}t`, `Dragon Ancien : +30 % sur ses loyers (${p.elderBuff} tours)`);
      if (p.herald) tag('herald', 'Héraut', 'Peut détruire une construction adverse');
      if (p.team) tag(`team-${p.team}`, p.team === 'blue' ? 'Bleue' : 'Rouge', `Équipe ${p.team === 'blue' ? 'Bleue' : 'Rouge'}`);
      if (state.rules?.objective && !p.bankrupt && p.objective) tag('objective', `Nexus ${p.objective}/${state.objectiveGoal || 3}`, 'Groupes complets (sans hypothèque) : 3 = victoire');
      if (p.bot) tag('bot', 'Bot', `Joué par l’ordinateur (${{ easy: 'Facile', normal: 'Normal', hard: 'Difficile' }[p.bot] || p.bot})`);
      const pv = state.rules?.passives !== false ? catalog().passives?.[p.pawn || 'classic'] : null;
      if (pv && !p.bankrupt) {
        const used = (p.pawn === 'egg' && p.reborn) || (p.pawn === 'zhonya' && p.passiveCd);
        tag('passive', used ? `${pv.name} ${p.passiveCd ? `${p.passiveCd}t` : '✓'}` : pv.name, `Pouvoir du pion — ${pv.text}`);
      }

      // Petites pastilles des groupes possédés
      const owned = document.createElement('div');
      owned.className = 'gv-player__owned';
      for (const [i, st] of Object.entries(state.props)) {
        if (st.owner !== p.key) continue;
        const dot = document.createElement('span');
        const sq = board[i];
        dot.className = 'gv-owned-dot';
        dot.style.background = sq.group ? groups[sq.group].color : sq.type === 'dragon' ? '#b9c3cc' : '#7fd1ff';
        dot.title = sq.name;
        owned.append(dot);
      }
      // quête du rôle : barre de progression
      if (p.quest && !p.bankrupt) {
        const def = catalog().quests[p.quest.id] || {};
        const q = el('div', `gv-player__quest${p.quest.done ? ' is-done' : ''}`);
        q.title = `${def.name} — ${def.text}. Récompense : ${def.reward}.`;
        const label = el('span', '', p.quest.done ? `✓ Quête ${ROLE_NAMES[p.quest.id]}` : `Quête ${ROLE_NAMES[p.quest.id]} · ${def.text}`);
        const bar = el('span', 'gv-player__bar');
        const fill = el('span');
        const goal = def.goal || 1;
        fill.style.width = `${Math.min(100, (p.quest.progress / goal) * 100)}%`;
        bar.append(fill);
        q.append(label, bar);
        row.append(q);
      }
      if (p.items?.length) {
        const items = el('div', 'gv-player__items');
        for (const it of p.items) {
          const img = el('img');
          img.src = itemIcon(it.id);
          img.alt = catalog().items[it.id]?.name || '';
          img.title = img.alt;
          items.append(img);
        }
        row.append(items);
      }
      // 2 contre 2 : donner des PO à son partenaire
      const mineNow = me();
      if (!replay && mineNow && !mineNow.bankrupt && !p.bankrupt && p.key !== mineNow.key && p.team && p.team === mineNow.team && state.phase !== 'over') {
        const give = el('button', 'gv-player__give', 'Donner des PO');
        give.type = 'button';
        give.addEventListener('click', () => {
          const raw = window.prompt(`Combien de PO donner à ${p.name} ? (tu as ${fmt(mineNow.gold)} PO)`, '100');
          const amount = Number(String(raw || '').replace(/\D/g, ''));
          if (amount > 0) send('game:give', { to: p.key, amount });
        });
        row.append(give);
      }
      row.dataset.team = p.team || '';
      row.prepend(pawn, info, tags, owned);
      return row;
    }));
  }

  function renderTop() {
    $('#gv-round').textContent = state.round;
    const baron = $('#gv-baron');
    const holder = state.players.find((p) => p.key === state.baron.holder);
    baron.classList.toggle('is-active', state.baron.active);
    baron.textContent = state.baron.active
      ? 'Baron Nashor apparu !'
      : holder ? `Main du Baron : ${holder.name}`
        : state.baron.taken ? 'Baron vaincu' : 'Baron au 3ᵉ tour';
    $('#gv-forfeit').hidden = !me() || me().bankrupt || state.phase === 'over';
    const event = $('#gv-event');
    const events = [];
    if (state.herald?.active) events.push('Héraut dans la fosse');
    if (state.elder?.active) events.push('Dragon Ancien éveillé');
    if (state.event) events.unshift(`⚡ ${state.event.name}`);
    if (state.rules?.maxRounds) events.push(`Partie rapide : ${state.round}/${state.rules.maxRounds}`);
    event.hidden = !events.length;
    event.textContent = events.join(' · ');
    event.title = state.event ? `${state.event.name} : ${state.event.text}` : '';
    renderTimer();
  }

  // ---------------------------------------------------------------------------
  // Chrono du tour
  // ---------------------------------------------------------------------------

  let timerTick = null;
  let lastTickSecond = null;
  function renderTimer() {
    const pill = $('#gv-timer');
    clearInterval(timerTick);
    if (!state.timer || state.phase === 'over' || !state.timerDeadline) {
      pill.hidden = true;
      return;
    }
    const mineTurn = isMyTurn();
    const update = () => {
      const left = Math.max(0, Math.ceil((state.timerDeadline - performance.now()) / 1000));
      pill.hidden = false;
      pill.textContent = `⏱ ${left} s`;
      pill.classList.toggle('is-low', left <= 10);
      pill.classList.toggle('is-mine', mineTurn);
      pill.style.setProperty('--left', String(Math.min(1, left / (state.timer.total / 1000))));
      pill.title = left ? `Temps restant pour ${mineTurn ? 'ton' : 'ce'} tour` : 'Temps écoulé : le jeu joue à sa place';
      if (mineTurn && left <= 5 && left > 0 && left !== lastTickSecond) {
        lastTickSecond = left;
        sfx('tick');
      }
    };
    update();
    timerTick = setInterval(update, 250);
  }

  // ---------------------------------------------------------------------------
  // Événements de la Faille, répliques des champions
  // ---------------------------------------------------------------------------

  function showEventBanner(ev) {
    if (!ev) return;
    const box = $('#gv-eventfx');
    box.replaceChildren();
    const title = el('p', 'gv-eventfx__title', ev.name);
    const text = el('p', 'gv-eventfx__text', ev.text);
    box.append(el('p', 'gv-eventfx__kicker', 'Événement de la Faille'), title, text);
    box.hidden = false;
    box.classList.remove('is-shown');
    void box.offsetWidth;
    box.classList.add('is-shown');
    clearTimeout(showEventBanner.timer);
    showEventBanner.timer = setTimeout(() => { box.hidden = true; }, 3800);
  }

  // Répliques (bulles) : une ou deux par champion, pour l'achat et le loyer
  const QUOTES = {
    Sivir: ['Payez-moi et on en reste là.', 'Une affaire, c’est une affaire.'],
    Skarner: ['Les cristaux m’appartiennent.', 'Je protège ce qui est à moi.'],
    Lissandra: ['La glace ne pardonne pas.', 'Tout finit par geler.'],
    Volibear: ['La tempête gronde !', 'Je suis le tonnerre.'],
    Ornn: ['Du travail bien forgé.', 'Je n’ai besoin de personne.'],
    Shen: ['L’équilibre a un prix.', 'Je veille.'],
    Karma: ['L’âme s’élève.', 'Tout acte a ses conséquences.'],
    Irelia: ['Les lames dansent pour Ionia.', 'Je ne plierai pas.'],
    Azir: ['Shurima ! Ton empereur est revenu.', 'Inclinez-vous devant l’empereur.'],
    Renekton: ['Tout est fureur !', 'Je les dévorerai tous.'],
    Nasus: ['Ce qui est à moi revient toujours.', 'Le cycle de la vie continue.'],
    Sion: ['Plus de sang !', 'Noxus ne tombe jamais.'],
    Kled: ['C’est MON terrain !', 'Skaarl, à l’attaque !'],
    Swain: ['Noxus prospère.', 'Chaque faiblesse se paie.'],
    Taric: ['Quelle magnifique fortune.', 'La beauté protège.'],
    Leona: ['L’aube arrive.', 'Le soleil se lève sur Targon.'],
    Diana: ['La lune se lève.', 'Ma lumière est froide.'],
    Warwick: ['Je sens l’odeur de l’or.', 'La chasse commence.'],
    Singed: ['Hé hé hé… tu vas payer.', 'Une petite expérience ?'],
    Urgot: ['La douleur est un rappel.', 'Zaun réclame son dû.'],
    Yone: ['Une lame pour les vivants, une pour les morts.', 'Je ne serai pas oublié.'],
    Yasuo: ['La mort, c’est comme le vent : toujours à mes côtés.', 'Ma route n’est pas finie.'],
  };
  const LINES = {
    buy: (name) => `${name} rejoint ton camp !`,
    rent: (name) => `${name} encaisse le loyer.`,
  };
  let voiceFiles = [];
  fetch('/voices.json').then((r) => r.json()).then((list) => { voiceFiles = list; }).catch(() => {});
  /** Son déposé dans frontend/assets/voices/ : yasuo.mp3, yasuo-2.ogg… (au hasard s'il y en a plusieurs). */
  function playVoice(champ) {
    const volume = (App.settings?.volume ?? 60) / 100;
    if (!volume || view.hidden) return false;
    const id = champ.toLowerCase();
    const files = voiceFiles.filter((f) => new RegExp(`^${id}(-\\d+)?\\.[a-z0-9]+$`, 'i').test(f));
    if (!files.length) return false;
    const audio = new Audio(`assets/voices/${files[Math.floor(Math.random() * files.length)]}`);
    audio.volume = Math.min(1, volume);
    audio.play().catch(() => {});
    return true;
  }
  function championQuote(index, kind) {
    const sq = board?.[index];
    if (!sq || sq.type !== 'property') return;
    const champ = champId(sq);
    const quotes = QUOTES[champ];
    if (!quotes) return;
    const box = $('#gv-quote');
    box.replaceChildren();
    const portrait = champImage('gv-quote__img', portraitUrl(sq));
    const body = el('div', 'gv-quote__body');
    body.append(el('p', 'gv-quote__text', `« ${quotes[Math.floor(Math.random() * quotes.length)]} »`), el('p', 'gv-quote__who', LINES[kind](sq.name)));
    box.append(portrait, body);
    box.hidden = false;
    box.classList.remove('is-shown');
    void box.offsetWidth;
    box.classList.add('is-shown');
    playVoice(champ);
    clearTimeout(championQuote.timer);
    championQuote.timer = setTimeout(() => { box.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Emotes et pings
  // ---------------------------------------------------------------------------

  const EMOTES = {
    gg: { label: 'GG' },
    wp: { label: 'Bien joué !' },
    lol: { label: '😂' },
    question: { label: '?' },
    angry: { label: '😠' },
    cry: { label: '😢' },
    thumb: { label: '👍' },
    heart: { label: '❤️' },
    mastery: { label: 'M7', cls: 'mastery', title: 'Maîtrise 7' },
    poro: { img: 'assets/pawns/poro.svg', title: 'Poro' },
  };
  const PINGS = {
    ping: { label: 'Signal', glyph: '◎' },
    danger: { label: 'Danger', glyph: '!', color: '#ff4655', sound: 'danger' },
    omw: { label: 'J’arrive', glyph: '➜', color: '#3fa7ff' },
    question: { label: 'Question', glyph: '?', color: '#f0c040' },
  };

  function emoteContent(id) {
    const e = EMOTES[id];
    if (!e) return null;
    if (e.img) {
      const img = document.createElement('img');
      img.src = e.img;
      img.alt = e.title || '';
      return img;
    }
    const span = el('span', e.cls ? `gv-emote--${e.cls}` : '', e.label);
    return span;
  }

  /** Point (px dans la vue) au-dessus d'un pion, en 3D comme sur le plateau plat. */
  function pawnScreenPoint(key) {
    const viewRect = view.getBoundingClientRect();
    if (b3) {
      const pos = b3.screenOf(key);
      const canvas = $('canvas.gv-webgl', view);
      if (pos && canvas) {
        const r = canvas.getBoundingClientRect();
        return { x: r.left - viewRect.left + pos.x, y: r.top - viewRect.top + pos.y };
      }
    }
    const pawn = pawns.get(key);
    if (!pawn) return null;
    const r = $('.gv-standee__body', pawn)?.getBoundingClientRect() || pawn.getBoundingClientRect();
    return { x: r.left - viewRect.left + r.width / 2, y: r.top - viewRect.top };
  }

  function showEmote({ key, name, emote }) {
    if (!state || view.hidden) return;
    const content = emoteContent(emote);
    if (!content) return;
    sfx('emote');
    const layer = $('#gv-bubbles');
    $$(`.gv-bubble[data-key="${CSS.escape(key)}"]`, layer).forEach((b) => b.remove());
    const bubble = el('div', 'gv-bubble');
    bubble.dataset.key = key;
    const color = state.players.find((p) => p.key === key)?.color || '#c8aa6e';
    bubble.style.setProperty('--c', color);
    bubble.append(content, el('span', 'gv-bubble__who', name));
    layer.append(bubble);
    const place = () => {
      const pt = pawnScreenPoint(key);
      if (!pt) return false;
      bubble.style.left = `${pt.x}px`;
      bubble.style.top = `${pt.y}px`;
      return true;
    };
    if (!place()) {
      bubble.classList.add('is-floating'); // pion introuvable : bulle près de la liste des joueurs
    }
    // la bulle suit le pion (rotation de la caméra) pendant 2,8 s
    const until = performance.now() + 2800;
    const follow = () => {
      if (!bubble.isConnected) return;
      if (performance.now() > until) {
        bubble.remove();
        return;
      }
      place();
      requestAnimationFrame(follow);
    };
    requestAnimationFrame(follow);
  }
  socket.on('game:emote', showEmote);

  function showPing({ name, index, kind, color }) {
    if (!state || view.hidden) return;
    const def = PINGS[kind] || PINGS.ping;
    const c = def.color || color;
    sfx(def.sound || 'ping');
    b3?.ping(index, c);
    const sq = squares[index];
    if (sq) {
      const mark = el('span', 'gv-ping', def.glyph);
      mark.style.setProperty('--c', c);
      sq.append(mark);
      setTimeout(() => mark.remove(), 2300);
    }
    if (board?.[index]) {
      const log = $('#gv-log');
      const li = el('li', 'gv-log__ping', `${name} — ${def.label} : ${board[index].name}`);
      li.style.setProperty('--c', c);
      log?.prepend(li);
    }
  }
  socket.on('game:ping', showPing);

  // Bouton emote : roue d'emotes ; bouton ping : choisir le type puis cliquer une case
  let pingMode = null;
  function setPingMode(kind) {
    pingMode = kind;
    view.classList.toggle('is-pinging', Boolean(kind));
    $('#gv-ping').setAttribute('aria-pressed', String(Boolean(kind)));
    if (kind) App.toast(`${PINGS[kind].label} : clique sur une case (Échap pour annuler).`, 'info', 2500);
  }
  function sendPing(index, kind = 'ping') {
    socket.emit('game:ping', { index, kind }, (res) => {
      if (!res?.ok && res?.error) App.toast(res.error, 'error', 1500);
    });
  }
  function buildEmotePanel() {
    const panel = $('#gv-emotes');
    const row = (title, entries) => {
      const wrap = el('div', 'gv-emotes__row');
      wrap.append(el('p', 'gv-emotes__title', title), ...entries);
      return wrap;
    };
    const emoteBtns = Object.keys(EMOTES).map((id) => {
      const b = el('button', 'gv-emotes__btn');
      b.type = 'button';
      b.dataset.emote = id;
      b.title = EMOTES[id].title || EMOTES[id].label;
      b.append(emoteContent(id));
      return b;
    });
    const pingBtns = Object.entries(PINGS).map(([id, def]) => {
      const b = el('button', 'gv-emotes__btn gv-emotes__btn--ping', def.glyph);
      b.type = 'button';
      b.dataset.ping = id;
      b.title = `${def.label} (puis clique une case)`;
      if (def.color) b.style.setProperty('--c', def.color);
      return b;
    });
    panel.replaceChildren(row('Emotes', emoteBtns), row('Pings — Alt + clic sur une case', pingBtns));
  }
  buildEmotePanel();
  $('#gv-emote').addEventListener('click', (event) => {
    event.stopPropagation();
    const panel = $('#gv-emotes');
    panel.hidden = !panel.hidden;
  });
  $('#gv-ping').addEventListener('click', (event) => {
    event.stopPropagation();
    setPingMode(pingMode ? null : 'ping');
  });
  $('#gv-emotes').addEventListener('click', (event) => {
    const b = event.target.closest('button');
    if (!b) return;
    $('#gv-emotes').hidden = true;
    if (b.dataset.ping) return setPingMode(b.dataset.ping);
    socket.emit('game:emote', { emote: b.dataset.emote }, (res) => {
      if (!res?.ok && res?.error) App.toast(res.error, 'error', 1500);
    });
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#gv-emotes, #gv-emote')) $('#gv-emotes').hidden = true;
  });
  let altDown = false;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') altDown = true;
    if (e.key === 'Escape' && pingMode) setPingMode(null);
  });
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt') altDown = false; });
  window.addEventListener('blur', () => { altDown = false; });
  /** Clic sur une case : ping si le mode ping est actif ou si Alt est enfoncé. Renvoie true si consommé. */
  function maybePing(index, event) {
    if (!state || index === null || index === undefined) return false;
    if (pingMode) {
      sendPing(index, pingMode);
      setPingMode(null);
      return true;
    }
    if (event?.altKey || altDown) {
      sendPing(index, 'ping');
      return true;
    }
    return false;
  }

  function button(label, action, { primary = false, payload = {}, disabled = false, hint = '' } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `gv-btn${primary ? ' gv-btn--primary' : ''}`;
    b.textContent = label;
    b.dataset.action = action;
    b.disabled = disabled;
    if (hint) b.title = hint;
    b.addEventListener('click', () => send(action, payload));
    return b;
  }

  function renderActions() {
    const status = $('#gv-status');
    const box = $('#gv-buttons');
    box.replaceChildren();
    const current = state.players.find((p) => p.key === state.current);
    const mine = me();

    if (state.phase === 'over') {
      status.textContent = 'Partie terminée';
      return;
    }
    if (!mine || mine.bankrupt) {
      status.textContent = `Tu regardes la partie — tour de ${current.name}`;
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'gv-btn';
      back.textContent = 'Retour au salon';
      back.addEventListener('click', closeBoard);
      box.append(back);
      return;
    }
    if (!isMyTurn()) {
      status.innerHTML = '';
      const dot = document.createElement('span');
      dot.className = 'gv-status-dot';
      dot.style.background = current.color;
      status.append(dot, `Tour de ${current.name}…`);
      return;
    }

    const sq = state.pendingIndex !== null ? board[state.pendingIndex] : null;
    if (state.trade && state.trade.from === myKey()) {
      const target = state.players.find((p) => p.key === state.trade.to);
      status.textContent = `Échange proposé : en attente de la réponse de ${target?.name || '…'}.`;
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'gv-btn';
      cancel.textContent = 'Retirer l’offre';
      cancel.addEventListener('click', () => send('game:tradeCancel'));
      box.append(cancel);
      return;
    }
    switch (state.phase) {
      case 'roll':
        if (mine.inJail) {
          status.textContent = 'Tu es en Prison : tente un double ou paye.';
          box.append(
            button('Tenter un double', 'game:roll', { primary: true }),
            button('Payer 50 PO', 'game:payJail', { disabled: mine.gold < 50 }),
          );
          if (mine.jailCards) box.append(button('Utiliser Zhonya', 'game:useCard'));
        } else {
          status.textContent = state.dice && state.dice[0] === state.dice[1] ? 'Double ! Relance les dés.' : 'À toi de jouer !';
          box.append(button('Lancer les dés', 'game:roll', { primary: true }));
        }
        break;
      case 'buy':
        status.textContent = `${sq.name} est libre — ${fmt(sq.price)} PO`;
        box.append(
          button(`Acheter (${fmt(sq.price)})`, 'game:buy', { primary: true, disabled: mine.gold < sq.price, hint: mine.gold < sq.price ? 'Pas assez de PO' : '' }),
          button('Passer', 'game:skip'),
        );
        openInspect(state.pendingIndex);
        inspectByHover = false;
        break;
      case 'tax':
        status.textContent = 'Les Sbires réclament leur part : choisis ton impôt.';
        box.append(
          button(`10 % de ta fortune (${fmt(state.taxPercent)})`, 'game:tax', { primary: state.taxPercent <= 200, payload: { choice: 'percent' } }),
          button('200 PO', 'game:tax', { primary: state.taxPercent > 200, payload: { choice: 'flat' } }),
        );
        break;
      case 'debt':
        status.textContent = `Dette de ${fmt(-mine.gold)} PO : vends des tours ou hypothèque des cases (onglet « Mes cases »).`;
        box.append(button('Déclarer faillite', 'game:forfeit'));
        showTab('mine');
        break;
      case 'ghost': {
        const [a, b] = state.ghostDice || [0, 0];
        status.textContent = `Fantôme : tu as fait ${a} + ${b}. Garde-les ou relance un dé.`;
        box.append(
          button(`Garder (${a + b})`, 'game:ghost', { primary: true, payload: { die: -1 } }),
          button(`Relancer le ${a}`, 'game:ghost', { payload: { die: 0 } }),
          button(`Relancer le ${b}`, 'game:ghost', { payload: { die: 1 } }),
        );
        break;
      }
      case 'end':
        status.textContent = 'Construis, hypothèque, échange… ou termine ton tour.';
        box.append(button('Fin du tour', 'game:end', { primary: true }));
        break;
      default:
        status.textContent = '';
    }
    // pendant son tour, on peut proposer un échange à un autre joueur
    if (['roll', 'end', 'debt'].includes(state.phase) && state.players.some((p) => !p.bankrupt && p.key !== myKey())) {
      const trade = document.createElement('button');
      trade.type = 'button';
      trade.className = 'gv-btn gv-btn--trade';
      trade.textContent = 'Échanger';
      trade.addEventListener('click', openTradeComposer);
      box.append(trade);
    }
  }

  // ---------------------------------------------------------------------------
  // Kit du joueur : sorts d'invocateur, objets, récompenses de quête, Héraut, boutique
  // ---------------------------------------------------------------------------

  const spellIcon = (id) => `assets/spells/${id}.svg`;
  const itemIcon = (id) => `assets/items/${id}.svg`;
  const catalog = () => state.catalog || { spells: {}, items: {}, quests: {}, maxItems: 3 };
  const ROLE_NAMES = { TOP: 'Top', JGL: 'Jungle', MID: 'Mid', ADC: 'ADC', SUPP: 'Support' };

  let kitPop = null; // petite bulle de choix au-dessus du kit
  function closeKitPop() {
    kitPop?.remove();
    kitPop = null;
  }
  document.addEventListener('pointerdown', (e) => {
    if (kitPop && !e.target.closest('.gv-kit__pop, .gv-kit__btn')) closeKitPop();
  });

  /** Ouvre une bulle de choix au-dessus d'un bouton du kit. */
  function openKitPop(anchor, title, choices) {
    closeKitPop();
    const pop = el('div', 'gv-kit__pop');
    pop.append(el('p', 'gv-kit__pop-title', title));
    const list = el('div', 'gv-kit__pop-list');
    if (!choices.length) list.append(el('p', 'gv-kit__pop-empty', 'Aucun choix possible.'));
    for (const { label, onPick, primary = false } of choices) {
      const b = el('button', `gv-btn${primary ? ' gv-btn--primary' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => { closeKitPop(); onPick(); });
      list.append(b);
    }
    pop.append(list);
    $('#gv-kit').append(pop);
    const r = anchor.getBoundingClientRect();
    const kr = $('#gv-kit').getBoundingClientRect();
    pop.style.left = `${r.left + r.width / 2 - kr.left}px`;
    kitPop = pop;
  }

  /** Cases du joueur où se téléporter (sauf celle où il est). */
  const myTargets = (mine) => Object.entries(state.props)
    .filter(([i, st]) => st.owner === mine.key && Number(i) !== mine.pos)
    .map(([i]) => Number(i)).sort((a, b) => a - b);

  function spellUsable(id, mine) {
    const before = state.phase === 'roll';
    switch (id) {
      case 'flash': case 'ghost': return before && !mine.inJail && !mine.armed[id];
      case 'teleport': return before && !mine.inJail && myTargets(mine).length > 0;
      case 'cleanse': return before && mine.inJail;
      case 'heal': return ['roll', 'end', 'debt'].includes(state.phase);
      case 'barrier': case 'ignite': return ['roll', 'end', 'debt'].includes(state.phase) && !mine.armed[id];
      default: return false;
    }
  }

  function kitButton({ icon, title, cd = 0, armed = false, usable = false, onClick, cls = '', badge = '' }) {
    const b = el('button', `gv-kit__btn ${cls}`);
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title.split(' — ')[0]);
    b.classList.toggle('is-armed', armed);
    b.classList.toggle('is-ready', usable);
    b.classList.toggle('is-cooldown', cd > 0);
    if (icon) {
      const img = el('img');
      img.src = icon;
      img.alt = '';
      b.append(img);
    }
    if (cd > 0) b.append(el('span', 'gv-kit__cd', String(cd)));
    if (badge) b.append(el('span', 'gv-kit__badge', badge));
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick?.(b); });
    return b;
  }

  function useSpell(id, anchor) {
    const mine = me();
    const name = catalog().spells[id]?.name || id;
    if (id === 'flash') {
      openKitPop(anchor, `${name} : au prochain lancer…`, [
        { label: '+1 case', primary: true, onPick: () => send('game:spell', { spell: 'flash', arg: 1 }) },
        { label: '−1 case', onPick: () => send('game:spell', { spell: 'flash', arg: -1 }) },
      ]);
    } else if (id === 'teleport') {
      openKitPop(anchor, `${name} : aller sur…`, myTargets(mine).map((i) => ({
        label: board[i].name, onPick: () => send('game:spell', { spell: 'teleport', arg: i }),
      })));
    } else {
      send('game:spell', { spell: id });
    }
  }

  function renderKit() {
    const box = $('#gv-kit');
    closeKitPop();
    box.replaceChildren();
    const mine = me();
    if (!mine || mine.bankrupt || state.phase === 'over') return;
    const myTurn = isMyTurn() && !state.trade;
    const cat = catalog();

    // sorts d'invocateur
    if (mine.spells?.length) {
      const group = el('div', 'gv-kit__group');
      for (const sp of mine.spells) {
        const def = cat.spells[sp.id] || {};
        const armed = sp.id === 'flash' ? Boolean(mine.armed?.flash) : Boolean(mine.armed?.[sp.id]);
        const usable = myTurn && !sp.cd && spellUsable(sp.id, mine);
        group.append(kitButton({
          icon: spellIcon(sp.id),
          title: `${def.name} — ${def.text}${sp.cd ? ` (encore ${sp.cd} tour${sp.cd > 1 ? 's' : ''})` : ''}${armed ? ' (prêt)' : ''}`,
          cd: sp.cd,
          armed,
          usable,
          cls: 'gv-kit__btn--spell',
          onClick: (b) => { if (usable) useSpell(sp.id, b); },
        }));
      }
      box.append(group);
    }

    // objets (3 emplacements)
    if (state.rules?.items) {
      const group = el('div', 'gv-kit__group');
      for (let k = 0; k < (cat.maxItems || 3); k++) {
        const it = mine.items?.[k];
        if (!it) {
          group.append(el('span', 'gv-kit__slot'));
          continue;
        }
        const def = cat.items[it.id] || {};
        const canSell = myTurn && ['roll', 'end', 'debt'].includes(state.phase);
        const bootsReady = it.id === 'boots' && myTurn && state.phase === 'roll' && !mine.inJail && !it.cd && !mine.armed?.boots;
        group.append(kitButton({
          icon: itemIcon(it.id),
          title: `${def.name} — ${def.text}`,
          cd: it.cd,
          armed: it.id === 'boots' && Boolean(mine.armed?.boots),
          usable: bootsReady,
          cls: 'gv-kit__btn--item',
          onClick: (b) => {
            const choices = [];
            if (bootsReady) choices.push({ label: 'Lacer les Bottes (+1 case)', primary: true, onPick: () => send('game:boots') });
            if (canSell) choices.push({ label: `Revendre (+${Math.floor(def.price / 2)} PO)`, onPick: () => send('game:sellItem', { item: it.id }) });
            openKitPop(b, `${def.name} — ${def.text}`, choices);
          },
        }));
      }
      // boutique ouverte après un passage par la Fontaine ou la Boutique
      if (myTurn && mine.canShop) {
        const shop = el('button', 'gv-btn gv-btn--shop', 'Boutique');
        shop.type = 'button';
        shop.addEventListener('click', openShop);
        group.append(shop);
      }
      box.append(group);
    }

    // récompenses de quête et Héraut
    const extras = el('div', 'gv-kit__group');
    if (mine.perks?.freeTp) {
      extras.append(kitButton({
        icon: spellIcon('teleport'), title: 'Téléportation gratuite (quête Top)', badge: 'Q',
        usable: myTurn && state.phase === 'roll' && !mine.inJail, cls: 'gv-kit__btn--perk',
        onClick: (b) => openKitPop(b, 'Téléportation gratuite : aller sur…', myTargets(mine).map((i) => ({
          label: board[i].name, onPick: () => send('game:perk', { perk: 'freeTp', arg: i }),
        }))),
      }));
    }
    if (mine.perks?.freeRecall) {
      extras.append(kitButton({
        icon: itemIcon('potion'), title: 'Retour gratuit à la Fontaine, +100 PO (quête Mid)', badge: 'Q',
        usable: myTurn && state.phase === 'roll' && !mine.inJail, cls: 'gv-kit__btn--perk',
        onClick: () => send('game:perk', { perk: 'freeRecall' }),
      }));
    }
    if (mine.herald) {
      const targets = Object.entries(state.props).filter(([, st]) => st.owner !== mine.key && st.level > 0).map(([i]) => Number(i));
      extras.append(kitButton({
        icon: itemIcon('herald'), title: 'Héraut de la Faille — détruit une construction adverse', badge: '×' + mine.herald,
        usable: myTurn && ['roll', 'end'].includes(state.phase) && targets.length > 0, cls: 'gv-kit__btn--herald',
        onClick: (b) => openKitPop(b, 'Le Héraut charge…', targets.map((i) => {
          const owner = state.players.find((p) => p.key === state.props[i].owner);
          return { label: `${board[i].name} (${owner?.name})`, onPick: () => send('game:herald', { index: i }) };
        })),
      }));
    }
    if (extras.children.length) box.append(extras);
  }

  // --- Boutique ------------------------------------------------------------------
  const shopBox = document.createElement('div');
  shopBox.className = 'gv-trade gv-shop';
  shopBox.hidden = true;
  view.append(shopBox);
  function closeShop() { shopBox.hidden = true; }
  function openShop() {
    shopBox.hidden = false;
    renderShop();
  }
  function renderShop() {
    if (shopBox.hidden) return;
    const mine = me();
    if (!mine || !isMyTurn() || !mine.canShop) return closeShop();
    const cat = catalog();
    const card = el('div', 'gv-trade__card gv-shop__card');
    card.setAttribute('role', 'dialog');
    card.append(el('h3', 'gv-trade__title', 'Boutique'));
    card.append(el('p', 'gv-trade__note', `${fmt(mine.gold)} PO · ${mine.items.length}/${cat.maxItems} objets · revente à moitié prix`));
    for (const [tier, title] of [['early', 'Début de partie'], ['late', 'Fin de partie']]) {
      card.append(el('h4', 'gv-trade__subtitle', title));
      const grid = el('div', 'gv-shop__grid');
      for (const [id, it] of Object.entries(cat.items).filter(([, x]) => x.tier === tier)) {
        const owned = mine.items.some((x) => x.id === id);
        const full = mine.items.length >= cat.maxItems;
        const item = el('div', `gv-shop__item${owned ? ' is-owned' : ''}`);
        const img = el('img');
        img.src = itemIcon(id);
        img.alt = '';
        const info = el('div', 'gv-shop__info');
        info.append(el('b', '', it.name), el('small', '', it.text));
        const buy = el('button', 'gv-btn gv-btn--primary', owned ? 'Possédé' : `${it.price} PO`);
        buy.type = 'button';
        buy.disabled = owned || full || mine.gold < it.price;
        buy.title = owned ? '' : full ? '3 objets au maximum : revends-en un' : mine.gold < it.price ? 'Pas assez de PO' : 'Acheter';
        buy.addEventListener('click', () => send('game:buyItem', { item: id }));
        item.append(img, info, buy);
        grid.append(item);
      }
      card.append(grid);
    }
    const foot = el('div', 'gv-trade__foot');
    const close = el('button', 'gv-btn', 'Fermer');
    close.type = 'button';
    close.addEventListener('click', closeShop);
    foot.append(close);
    card.append(foot);
    shopBox.replaceChildren(card);
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeShop(); });

  // ---------------------------------------------------------------------------
  // Échanges entre joueurs
  // ---------------------------------------------------------------------------

  const TRADABLE = new Set(['property', 'dragon', 'potion']);
  const tradeBox = document.createElement('div');
  tradeBox.className = 'gv-trade';
  tradeBox.hidden = true;
  view.append(tradeBox);
  let tradeDraft = null; // { to, give: Set, get: Set } pendant qu'on compose
  let reviewedTrade = null; // id de l'échange affiché au destinataire

  /** Cases d'un joueur, avec la raison si elles ne peuvent pas être échangées. */
  function tradableOf(key) {
    return Object.entries(state.props)
      .filter(([, st]) => st.owner === key)
      .map(([i]) => Number(i))
      .filter((i) => TRADABLE.has(board[i].type))
      .sort((a, b) => a - b)
      .map((i) => {
        const sq = board[i];
        const built = sq.group && Object.entries(state.props).some(([j, st]) => board[j].group === sq.group && st.level > 0);
        return { i, reason: built ? `Vends d’abord les tours du groupe ${groups[sq.group].label}` : '' };
      });
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function propChip(i, extra = '') {
    const sq = board[i];
    const st = state.props[i];
    const chip = el('span', `gv-trade__chip ${extra}`);
    chip.style.setProperty('--group', sq.group ? groups[sq.group].color : sq.type === 'dragon' ? '#9fb3c4' : '#7fd1ff');
    chip.append(el('span', 'gv-trade__swatch'), el('span', 'gv-trade__name', sq.name));
    if (st?.mortgaged) chip.append(el('span', 'gv-trade__flag', 'hypothéquée'));
    return chip;
  }

  function closeTrade() {
    tradeBox.hidden = true;
    tradeBox.replaceChildren();
    tradeDraft = null;
  }

  function openTradeComposer() {
    const others = state.players.filter((p) => !p.bankrupt && p.key !== myKey());
    if (!others.length) return;
    if (!tradeDraft || !others.some((p) => p.key === tradeDraft.to)) {
      tradeDraft = { to: others[0].key, give: new Set(), get: new Set(), giveGold: 0, getGold: 0 };
    }
    renderTradeComposer();
  }

  function renderTradeComposer() {
    const mine = me();
    const target = state.players.find((p) => p.key === tradeDraft.to);
    const others = state.players.filter((p) => !p.bankrupt && p.key !== myKey());
    const card = el('div', 'gv-trade__card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Proposer un échange');
    card.append(el('h3', 'gv-trade__title', 'Proposer un échange'));

    const pick = el('div', 'gv-trade__players');
    for (const p of others) {
      const b = el('button', `gv-trade__player${p.key === tradeDraft.to ? ' is-active' : ''}`);
      b.type = 'button';
      b.style.setProperty('--c', p.color);
      b.append(el('span', 'gv-trade__dot'), p.name);
      b.addEventListener('click', () => {
        tradeDraft = { to: p.key, give: tradeDraft.give, get: new Set(), giveGold: tradeDraft.giveGold, getGold: 0 };
        renderTradeComposer();
      });
      pick.append(b);
    }
    card.append(pick);

    const column = (title, owner, set, goldKey, maxGold) => {
      const col = el('section', 'gv-trade__col');
      col.append(el('h4', 'gv-trade__subtitle', title));
      const list = el('div', 'gv-trade__list');
      const items = tradableOf(owner.key);
      if (!items.length) list.append(el('p', 'gv-trade__empty', 'Aucune case.'));
      for (const { i, reason } of items) {
        const label = el('label', `gv-trade__item${reason ? ' is-locked' : ''}`);
        if (reason) label.title = reason;
        const box = el('input');
        box.type = 'checkbox';
        box.checked = set.has(i);
        box.disabled = Boolean(reason);
        box.addEventListener('change', () => { if (box.checked) set.add(i); else set.delete(i); });
        label.append(box, propChip(i));
        list.append(label);
      }
      const gold = el('label', 'gv-trade__gold');
      gold.append(el('span', '', 'PO'));
      const input = el('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(Math.max(0, maxGold));
      input.step = '10';
      input.value = String(tradeDraft[goldKey] || 0);
      input.addEventListener('input', () => {
        tradeDraft[goldKey] = Math.max(0, Math.min(Math.max(0, maxGold), Math.floor(Number(input.value) || 0)));
      });
      gold.append(input, el('span', 'gv-trade__max', `max ${fmt(Math.max(0, maxGold))}`));
      col.append(list, gold);
      return col;
    };
    const cols = el('div', 'gv-trade__cols');
    cols.append(
      column('Tu donnes', mine, tradeDraft.give, 'giveGold', mine.gold),
      column(`Tu reçois de ${target.name}`, target, tradeDraft.get, 'getGold', target.gold),
    );
    card.append(cols);
    card.append(el('p', 'gv-trade__note', 'Les cases d’un groupe avec des tours ne peuvent pas être échangées. Une case hypothéquée le reste.'));

    const foot = el('div', 'gv-trade__foot');
    const cancel = el('button', 'gv-btn', 'Annuler');
    cancel.type = 'button';
    cancel.addEventListener('click', closeTrade);
    const go = el('button', 'gv-btn gv-btn--primary', 'Proposer');
    go.type = 'button';
    go.addEventListener('click', () => {
      const offer = {
        to: tradeDraft.to,
        giveProps: [...tradeDraft.give],
        getProps: [...tradeDraft.get],
        giveGold: tradeDraft.giveGold || 0,
        getGold: tradeDraft.getGold || 0,
      };
      socket.emit('game:trade', offer, (res) => {
        if (!res?.ok) return App.toast(res?.error || 'Échange impossible.', 'error');
        closeTrade();
        App.toast('Proposition envoyée.', 'info', 2500);
      });
    });
    foot.append(cancel, go);
    card.append(foot);
    tradeBox.replaceChildren(card);
    tradeBox.hidden = false;
  }

  /** Fenêtre du destinataire : le détail de l'offre, accepter ou refuser. */
  function renderTradeReview(t) {
    const from = state.players.find((p) => p.key === t.from);
    const card = el('div', 'gv-trade__card gv-trade__card--review');
    card.setAttribute('role', 'dialog');
    card.append(el('h3', 'gv-trade__title', `${from.name} te propose un échange`));
    const side = (title, part) => {
      const col = el('section', 'gv-trade__col');
      col.append(el('h4', 'gv-trade__subtitle', title));
      const list = el('div', 'gv-trade__list');
      for (const i of part.props) list.append(propChip(i));
      if (part.gold) list.append(el('span', 'gv-trade__chip gv-trade__chip--gold', `${fmt(part.gold)} PO`));
      if (!part.props.length && !part.gold) list.append(el('p', 'gv-trade__empty', 'Rien'));
      col.append(list);
      return col;
    };
    const cols = el('div', 'gv-trade__cols');
    cols.append(side('Tu reçois', t.give), side('Tu donnes', t.get));
    card.append(cols);
    const foot = el('div', 'gv-trade__foot');
    const no = el('button', 'gv-btn', 'Refuser');
    no.type = 'button';
    no.addEventListener('click', () => send('game:tradeRespond', { accept: false }));
    const yes = el('button', 'gv-btn gv-btn--primary', 'Accepter');
    yes.type = 'button';
    yes.addEventListener('click', () => send('game:tradeRespond', { accept: true }));
    foot.append(no, yes);
    card.append(foot);
    tradeBox.replaceChildren(card);
    tradeBox.hidden = false;
  }

  function renderTrade() {
    const t = state.trade;
    if (t && t.to === myKey()) {
      if (reviewedTrade !== t.id) {
        reviewedTrade = t.id;
        tradeDraft = null;
        renderTradeReview(t);
      }
      return;
    }
    if (reviewedTrade !== null && (!t || t.id !== reviewedTrade)) {
      reviewedTrade = null;
      if (!tradeDraft) closeTrade();
    }
    // on ne compose que pendant son tour, sans offre déjà envoyée
    if (tradeDraft && (!isMyTurn() || !['roll', 'end', 'debt'].includes(state.phase) || t)) closeTrade();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tradeDraft) closeTrade();
  });

  function renderLog() {
    const log = $('#gv-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.replaceChildren(...state.log.map((entry) => {
      const li = document.createElement('li');
      li.textContent = entry.text;
      return li;
    }));
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  function renderMine() {
    const box = $('#gv-mine');
    const mine = me();
    box.replaceChildren();
    const owned = Object.entries(state.props).filter(([, st]) => st.owner === myKey()).map(([i]) => Number(i));
    if (state.supply) {
      const supply = document.createElement('p');
      supply.className = 'gv-supply';
      supply.textContent = `Réserve de la banque : ${state.supply.towers} tours · ${state.supply.inhibs} inhibiteurs`;
      box.append(supply);
    }
    if (!mine || !owned.length) {
      const empty = document.createElement('p');
      empty.className = 'gv-empty';
      empty.textContent = 'Tu ne possèdes encore aucune case. Tombe sur une case libre pour l’acheter !';
      box.append(empty);
      return;
    }
    for (const i of owned.sort((a, b) => a - b)) {
      const sq = board[i];
      const st = state.props[i];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'gv-mine__row';
      row.classList.toggle('is-mortgaged', st.mortgaged);
      row.style.setProperty('--group', sq.group ? groups[sq.group].color : '#6b7c8c');
      const name = document.createElement('span');
      name.className = 'gv-mine__name';
      name.textContent = sq.name;
      const lvl = document.createElement('span');
      lvl.className = 'gv-mine__level';
      lvl.textContent = st.mortgaged ? 'Hypothéquée' : st.level === 5 ? 'Inhibiteur' : st.level ? `T${st.level}` : `${fmt(state.rents[i])} PO`;
      if (sq.type === 'property') row.append(champImage('gv-mine__art', portraitUrl(sq)));
      else if (specialArt(sq)) row.append(artImage('gv-mine__art', specialArt(sq)));
      row.append(name, lvl);
      row.addEventListener('click', () => {
        openInspect(i);
        inspectByHover = false;
      });
      box.append(row);
    }
  }

  // ---------------------------------------------------------------------------
  // Fiche d'une case (clic sur le plateau)
  // ---------------------------------------------------------------------------

  function openInspect(index) {
    const sq = board[index];
    const box = $('#gv-inspect');
    inspected = index;
    box.innerHTML = '';
    const st = state.props[index];
    const owner = st && state.players.find((p) => p.key === st.owner);

    const card = document.createElement('div');
    card.className = `gv-inspect__card gv-inspect__card--${sq.type}`;
    card.style.setProperty('--group', sq.group ? groups[sq.group].color : sq.type === 'dragon' ? '#5d6f80' : '#3a5a7a');

    const head = document.createElement('div');
    head.className = 'gv-inspect__head';
    const kicker = document.createElement('span');
    kicker.className = 'gv-inspect__kicker';
    kicker.textContent = sq.group ? groups[sq.group].label : sq.type === 'dragon' ? 'Dragon' : sq.type === 'potion' ? 'Potion' : 'Case spéciale';
    const title = document.createElement('h3');
    title.className = 'gv-inspect__title';
    title.textContent = sq.name;
    head.append(kicker, title);
    if (sq.type === 'property') {
      card.classList.add('has-art');
      head.prepend(champImage('gv-inspect__art', splashUrl(sq)));
    } else if (specialArt(sq)) {
      card.classList.add('has-art');
      head.prepend(artImage('gv-inspect__art', specialArt(sq)));
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'gv-inspect__close';
    close.setAttribute('aria-label', 'Fermer');
    close.addEventListener('click', closeInspect);
    card.append(close, head);

    const body = document.createElement('div');
    body.className = 'gv-inspect__body';
    const line = (label, value, strong = false) => {
      const row = document.createElement('div');
      row.className = `gv-inspect__line${strong ? ' is-strong' : ''}`;
      const a = document.createElement('span');
      a.textContent = label;
      const b = document.createElement('span');
      b.textContent = value;
      row.append(a, b);
      body.append(row);
    };

    if (sq.type === 'property') {
      const level = st?.level ?? -1;
      const labels = ['Loyer', 'Avec 1 tour', 'Avec 2 tours', 'Avec 3 tours', 'Avec 4 tours', 'Avec Inhibiteur'];
      sq.rent.forEach((r, l) => line(labels[l], `${fmt(r)} PO`, l === level));
      line('Groupe complet (sans tour)', `${fmt(sq.rent[0] * 2)} PO`);
      line('Prix d’une tour', `${fmt(groups[sq.group].house)} PO`);
    } else if (sq.type === 'dragon') {
      [25, 50, 100, 200].forEach((r, n) => line(`${n + 1} Dragon${n ? 's' : ''}`, `${r} PO`));
    } else if (sq.type === 'potion') {
      line('1 Potion', '4 × les dés');
      line('2 Potions', '10 × les dés');
    } else {
      const texts = {
        go: 'Chaque passage rapporte 200 PO. Avec la Main du Baron : +300 PO de plus, puis le buff disparaît.',
        jail: 'Simple visite… sauf si Blitzcrank t’a attrapé. Pour sortir : un double, 50 PO ou une carte Zhonya.',
        baron: 'Le Baron Nashor apparaît au 3ᵉ tour. Le premier qui tombe ici gagne la Main du Baron : loyers +50 % et +300 PO au prochain passage à la Fontaine.',
        gotojail: 'Le grab de Blitzcrank t’envoie directement en Prison, sans passer par la Fontaine.',
        chance: 'Pioche une carte Ping SS.',
        chest: 'Ouvre un Coffre Hextech.',
        tax: sq.kind === 'sbires' ? 'Paye 10 % de ta fortune ou 200 PO, au choix.' : 'Paye 75 PO à la Boutique.',
      };
      const p = document.createElement('p');
      p.className = 'gv-inspect__text';
      p.textContent = texts[sq.type] || '';
      body.append(p);
    }
    if (sq.price) {
      line('Prix', `${fmt(sq.price)} PO`);
      line('Hypothèque', `${fmt(sq.price / 2)} PO`);
    }
    card.append(body);

    const foot = document.createElement('div');
    foot.className = 'gv-inspect__foot';
    if (owner) {
      const who = document.createElement('p');
      who.className = 'gv-inspect__owner';
      who.style.setProperty('--c', owner.color);
      who.textContent = `${owner.name}${st.mortgaged ? ' · hypothéquée' : ''}${st.level === 5 ? ' · Inhibiteur' : st.level ? ` · ${st.level} tour${st.level > 1 ? 's' : ''}` : ''}`;
      foot.append(who);
    } else if (sq.price) {
      const who = document.createElement('p');
      who.className = 'gv-inspect__owner is-free';
      who.textContent = 'À vendre';
      foot.append(who);
    }

    // Actions sur mes cases pendant mon tour
    if (owner && owner.key === myKey() && isMyTurn() && ['roll', 'end', 'debt'].includes(state.phase)) {
      const actions = document.createElement('div');
      actions.className = 'gv-inspect__actions';
      if (sq.type === 'property' && !st.mortgaged && st.level < 5 && state.phase !== 'debt') {
        actions.append(button(st.level === 4 ? 'Inhibiteur' : 'Construire', 'game:build', { primary: true, payload: { index } }));
      }
      if (sq.type === 'property' && st.level > 0) actions.append(button('Vendre', 'game:sell', { payload: { index } }));
      if (!st.mortgaged && !st.level) actions.append(button('Hypothéquer', 'game:mortgage', { payload: { index } }));
      if (st.mortgaged && state.phase !== 'debt') actions.append(button(`Lever (${fmt(Math.ceil(sq.price * 0.55))})`, 'game:unmortgage', { payload: { index } }));
      foot.append(actions);
    }
    card.append(foot);
    box.append(card);
    box.hidden = false;
    squares.forEach((el, i) => el.classList.toggle('is-inspected', i === index));
    b3?.setInspected(index);
  }

  function closeInspect() {
    inspected = null;
    inspectByHover = false;
    $('#gv-inspect').hidden = true;
    squares.forEach((el) => el.classList.remove('is-inspected'));
    b3?.setInspected(null);
  }

  // Fiche d'une case : on garde la souris 2 secondes dessus (un contour se remplit
  // pendant l'attente), et elle disparaît dès que la souris quitte la case.
  // Pour construire ou hypothéquer, la fiche ouverte depuis « Mes cases » reste affichée.
  const HOVER_DELAY = 2000;
  let hoverTimer = 0;
  let hoveredIndex = null; // case dont le contour se remplit
  let pointerIndex = null; // case sous la souris

  function cancelHover() {
    clearTimeout(hoverTimer);
    if (hoveredIndex !== null) squares[hoveredIndex]?.classList.remove('is-hovering');
    b3?.setHover(null);
    hoveredIndex = null;
  }

  /** La souris arrive sur une case (index) ou quitte les cases (null). Plateau CSS ou 3D. */
  function hoverSquare(index) {
    if (index === pointerIndex) return;
    const previous = pointerIndex;
    pointerIndex = index;
    // la fiche ouverte au survol disparaît quand on quitte sa case
    if (inspectByHover && previous !== null && previous === inspected && index !== inspected) closeInspect();
    cancelHover();
    if (index === null || index === inspected || drag || b3?.dragging) return;
    hoveredIndex = index;
    squares[index]?.classList.add('is-hovering');
    b3?.setHover(index);
    hoverTimer = setTimeout(() => {
      cancelHover();
      openInspect(index);
      inspectByHover = true;
    }, HOVER_DELAY);
  }

  boardEl.addEventListener('pointerover', (event) => {
    const sq = event.target.closest('.gv-sq');
    if (sq && event.pointerType !== 'touch') hoverSquare(Number(sq.dataset.index));
  });
  boardEl.addEventListener('pointerout', (event) => {
    if (!event.relatedTarget?.closest?.('.gv-sq')) hoverSquare(null);
  });
  // Sur écran tactile, pas de survol : on garde le toucher pour ouvrir la fiche
  boardEl.addEventListener('click', (event) => {
    const sq = event.target.closest('.gv-sq');
    if (sq && !dragMoved && maybePing(Number(sq.dataset.index), event)) return;
    if (!sq || dragMoved || !matchMedia('(hover: none)').matches) return;
    openInspect(Number(sq.dataset.index));
  });

  // ---------------------------------------------------------------------------
  // Fin de partie
  // ---------------------------------------------------------------------------

  function renderOver() {
    const box = $('#gv-over');
    if (state.phase !== 'over') {
      box.hidden = true;
      return;
    }
    closeInspect();
    const mine = me();
    const won = state.winnerTeam ? Boolean(mine && mine.team === state.winnerTeam) : state.winner === myKey();
    box.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = `gv-over__panel ${won ? 'is-victory' : 'is-defeat'}`;
    const title = document.createElement('p');
    title.className = 'gv-over__title';
    title.textContent = won ? 'VICTOIRE' : 'DÉFAITE';
    const sub = document.createElement('p');
    sub.className = 'gv-over__sub';
    const winner = state.players.find((p) => p.key === state.winner);
    const teamName = { blue: 'Bleue', red: 'Rouge' }[state.winnerTeam];
    sub.textContent = teamName
      ? `L’équipe ${teamName} (${state.players.filter((p) => p.team === state.winnerTeam).map((p) => p.name).join(' et ')}) domine la Faille en ${state.round} tours.`
      : winner ? `${winner.name} domine la Faille en ${state.round} tours.` : 'Partie terminée.';
    if (replay) title.textContent = `${title.textContent} — REPLAY`;
    // classement : le vainqueur, puis les éliminés du dernier au premier ; statistiques de chacun
    const stats = state.stats || {};
    const ordered = [...state.players].sort((a, b) => {
      const pa = stats[a.key]?.place ?? (a.key === state.winner ? 1 : 99);
      const pb = stats[b.key]?.place ?? (b.key === state.winner ? 1 : 99);
      return pa - pb || b.worth - a.worth;
    });
    const table = document.createElement('table');
    table.className = 'gv-over__table';
    const head = document.createElement('tr');
    for (const label of ['#', 'Joueur', 'Fortune', 'Cases', 'Tours', 'Loyers touchés', 'Loyers payés', 'Échanges']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.append(th);
    }
    const thead = document.createElement('thead');
    thead.append(head);
    const tbody = document.createElement('tbody');
    ordered.forEach((p, k) => {
      const st = stats[p.key] || {};
      const tr = document.createElement('tr');
      tr.style.setProperty('--c', p.color);
      tr.classList.toggle('is-winner', p.key === state.winner);
      tr.classList.toggle('is-me', p.key === myKey());
      const cells = [
        k + 1,
        p.name,
        p.bankrupt ? `Éliminé${st.eliminatedRound ? ` (tour ${st.eliminatedRound})` : ''}` : `${fmt(p.worth)} PO`,
        st.bought ?? '–',
        st.built ?? '–',
        st.rentEarned !== undefined ? `${fmt(st.rentEarned)} PO` : '–',
        st.rentPaid !== undefined ? `${fmt(st.rentPaid)} PO` : '–',
        st.trades ?? '–',
      ];
      cells.forEach((v, c) => {
        const td = document.createElement('td');
        td.textContent = v;
        if (c === 1) td.className = 'gv-over__name';
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(thead, tbody);
    const ranking = document.createElement('div');
    ranking.className = 'gv-over__stats';
    ranking.append(table);
    // petits titres honorifiques
    const best = (field) => {
      const top = [...state.players].sort((a, b) => (stats[b.key]?.[field] ?? 0) - (stats[a.key]?.[field] ?? 0))[0];
      return top && stats[top.key]?.[field] ? top : null;
    };
    const awards = document.createElement('ul');
    awards.className = 'gv-over__awards';
    for (const [field, label] of [['rentEarned', 'Seigneur des loyers'], ['built', 'Grand bâtisseur'], ['trades', 'Roi du marchandage']]) {
      const p = best(field);
      if (!p) continue;
      const li = document.createElement('li');
      li.style.setProperty('--c', p.color);
      const b = document.createElement('b');
      b.textContent = label;
      li.append(b, ` ${p.name}`);
      awards.append(li);
    }
    if (awards.children.length) ranking.append(awards);
    if (state.history?.length > 1) {
      const chart = wealthChart(state.history, state.players, { width: 620, height: 210 });
      chart.classList.add('gv-over__chart');
      ranking.append(chart);
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'gv-btn gv-btn--primary';
    back.textContent = replay ? 'Quitter le replay' : 'Retour au salon';
    back.addEventListener('click', () => (replay ? stopReplay() : closeBoard()));
    const buttons = el('div', 'gv-over__buttons');
    if (!replay && state.id) {
      const again = el('button', 'gv-btn', 'Revoir la partie');
      again.type = 'button';
      again.addEventListener('click', () => App.playReplay(state.id));
      buttons.append(again);
    }
    buttons.append(back);
    panel.append(title, sub, ranking, buttons);
    box.append(panel);
    box.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Réception de l'état
  // ---------------------------------------------------------------------------

  // Sons d'annonce : début de son tour, victoire ou défaite (une seule fois chacun)
  let lastTurnCue = null;
  let overCue = null;
  function cueSounds() {
    const turn = `${state.id}:${state.round}:${state.current}`;
    if (state.phase === 'roll' && state.current === myKey() && turn !== lastTurnCue) {
      if (lastTurnCue !== null) sfx('turn');
      lastTurnCue = turn;
    } else if (lastTurnCue === null) {
      lastTurnCue = '';
    }
    if (state.phase === 'over' && overCue !== state.id) {
      overCue = state.id;
      if (me()) sfx(state.winner === myKey() ? 'victory' : 'defeat');
    }
  }

  // ---------------------------------------------------------------------------
  // Statistiques : courbe de la valeur de chaque joueur au fil des tours
  // ---------------------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  };
  // Les couleurs des joueurs sont aussi celles de leur pion : chaque courbe a en plus son style de
  // trait et le nom du joueur au bout, pour ne jamais dépendre de la couleur seule.
  const DASHES = ['', '7 4', '2 4', '10 4 2 4', '4 3'];
  const compact = (n) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace('.', ',')} k` : String(Math.round(n)));

  /** Courbe de richesse (valeur totale : PO + cases + constructions), un point par tour de table. */
  function wealthChart(history, players, { width = 300, height = 190 } = {}) {
    const wrap = el('figure', 'gv-chart');
    const pad = { l: 40, r: 64, t: 12, b: 24 };
    const w = width - pad.l - pad.r;
    const h = height - pad.t - pad.b;
    const rounds = history.map((pt) => pt.round);
    const r0 = Math.min(...rounds);
    const r1 = Math.max(r0 + 1, ...rounds);
    const max = Math.max(1000, ...history.flatMap((pt) => Object.values(pt.worth))) * 1.08;
    const x = (r) => pad.l + ((r - r0) / (r1 - r0)) * w;
    const y = (v) => pad.t + h - (v / max) * h;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, class: 'gv-chart__svg', role: 'img' });
    svg.setAttribute('aria-label', `Valeur de chaque joueur, tours ${r0} à ${r1}`);
    // grille horizontale discrète + graduations
    const steps = 4;
    for (let k = 0; k <= steps; k++) {
      const v = (max / steps) * k;
      svg.append(svgEl('line', { x1: pad.l, x2: pad.l + w, y1: y(v), y2: y(v), class: k ? 'gv-chart__grid' : 'gv-chart__axis' }));
      const t = svgEl('text', { x: pad.l - 6, y: y(v) + 3, class: 'gv-chart__tick', 'text-anchor': 'end' });
      t.textContent = compact(v);
      svg.append(t);
    }
    const tickEvery = Math.max(1, Math.ceil((r1 - r0) / 6));
    for (let r = r0; r <= r1; r += tickEvery) {
      const t = svgEl('text', { x: x(r), y: height - 6, class: 'gv-chart__tick', 'text-anchor': 'middle' });
      t.textContent = `T${r}`;
      svg.append(t);
    }
    // une ligne par joueur (2 px), étiquette au bout
    const ends = [];
    players.forEach((p, i) => {
      const pts = history.filter((pt) => pt.worth[p.key] !== undefined).map((pt) => [x(pt.round), y(pt.worth[p.key])]);
      if (!pts.length) return;
      const line = svgEl('polyline', { points: pts.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' '), class: 'gv-chart__line' });
      line.style.stroke = p.color;
      if (DASHES[i % DASHES.length]) line.setAttribute('stroke-dasharray', DASHES[i % DASHES.length]);
      if (p.bankrupt) line.classList.add('is-out');
      svg.append(line);
      const [ex, ey] = pts[pts.length - 1];
      ends.push({ p, ex, ey });
    });
    // étiquettes de fin de courbe, écartées pour ne pas se chevaucher
    ends.sort((a, b) => a.ey - b.ey);
    let lastY = -Infinity;
    for (const e of ends) {
      const ly = Math.max(e.ey, lastY + 12);
      lastY = ly;
      svg.append(svgEl('circle', { cx: e.ex, cy: e.ey, r: 3, class: 'gv-chart__dot', fill: e.p.color }));
      const t = svgEl('text', { x: e.ex + 6, y: ly + 3, class: 'gv-chart__label' });
      t.textContent = e.p.name.length > 9 ? `${e.p.name.slice(0, 8)}…` : e.p.name;
      svg.append(t);
    }
    // survol : ligne verticale + infobulle du tour le plus proche
    const cross = svgEl('line', { y1: pad.t, y2: pad.t + h, class: 'gv-chart__cross' });
    cross.style.display = 'none';
    const hit = svgEl('rect', { x: pad.l, y: pad.t, width: w, height: h, fill: 'transparent' });
    svg.append(cross, hit);
    const tip = el('div', 'gv-chart__tip');
    tip.hidden = true;
    hit.addEventListener('pointermove', (event) => {
      const box = svg.getBoundingClientRect();
      const px = ((event.clientX - box.left) / box.width) * width;
      const r = Math.round(r0 + ((px - pad.l) / w) * (r1 - r0));
      const pt = history.reduce((best, q) => (Math.abs(q.round - r) < Math.abs(best.round - r) ? q : best), history[0]);
      cross.setAttribute('x1', x(pt.round));
      cross.setAttribute('x2', x(pt.round));
      cross.style.display = '';
      tip.replaceChildren(el('b', '', `Tour ${pt.round}`), ...players
        .filter((p) => pt.worth[p.key] !== undefined)
        .sort((a, b) => pt.worth[b.key] - pt.worth[a.key])
        .map((p) => {
          const row = el('span', 'gv-chart__tiprow');
          const sw = el('i');
          sw.style.background = p.color;
          row.append(sw, `${p.name} : ${fmt(pt.worth[p.key])} PO`);
          return row;
        }));
      tip.hidden = false;
      tip.style.left = `${(x(pt.round) / width) * 100}%`;
    });
    hit.addEventListener('pointerleave', () => {
      cross.style.display = 'none';
      tip.hidden = true;
    });
    // légende (toujours présente) + tableau pour les lecteurs d'écran
    const legend = el('figcaption', 'gv-chart__legend');
    players.forEach((p, i) => {
      const item = el('span', 'gv-chart__key');
      const sw = svgEl('svg', { viewBox: '0 0 22 6', width: 22, height: 6 });
      const l = svgEl('line', { x1: 0, x2: 22, y1: 3, y2: 3, 'stroke-width': 2 });
      l.style.stroke = p.color;
      if (DASHES[i % DASHES.length]) l.setAttribute('stroke-dasharray', DASHES[i % DASHES.length]);
      sw.append(l);
      item.append(sw, p.name);
      legend.append(item);
    });
    const table = el('table', 'visually-hidden');
    const head = el('tr');
    head.append(el('th', '', 'Tour'), ...players.map((p) => el('th', '', p.name)));
    table.append(head, ...history.map((pt) => {
      const tr = el('tr');
      tr.append(el('td', '', String(pt.round)), ...players.map((p) => el('td', '', pt.worth[p.key] !== undefined ? `${pt.worth[p.key]} PO` : '–')));
      return tr;
    }));
    wrap.append(svg, tip, legend, table);
    return wrap;
  }

  function renderStats() {
    const box = $('#gv-stats');
    if (!box) return;
    if (box.hidden && !isPhone()) {
      box.dataset.dirty = '1';
      return;
    }
    box.dataset.dirty = '';
    const history = [...(state.history || [])];
    // point « maintenant » pour suivre le tour en cours
    const now = { round: state.round + (state.phase === 'over' ? 0 : 0.5), worth: Object.fromEntries(state.players.map((p) => [p.key, p.bankrupt ? 0 : p.worth])) };
    if (!history.length || history[history.length - 1].round !== state.round || state.phase !== 'over') history.push(now);
    const title = el('p', 'gv-stats__title', 'Valeur de chaque joueur (PO + cases + constructions)');
    const table = el('div', 'gv-stats__now');
    for (const p of [...state.players].sort((a, b) => b.worth - a.worth)) {
      const row = el('span', 'gv-stats__row');
      const sw = el('i');
      sw.style.background = p.color;
      row.append(sw, el('b', '', p.name), el('span', '', p.bankrupt ? 'Éliminé' : `${fmt(p.worth)} PO`));
      table.append(row);
    }
    box.replaceChildren(title, wealthChart(history, state.players, { width: 300, height: 200 }), table);
  }

  // ---------------------------------------------------------------------------
  // Musique : plus intense quand le Baron ou l'Ancien sont en jeu, puis en fin de partie
  // ---------------------------------------------------------------------------

  function musicIntensity() {
    if (!state || state.phase === 'over') return 0;
    const alive = state.players.filter((p) => !p.bankrupt);
    const danger = alive.some((p) => p.gold < 150 && p.worth < 700);
    const nearGoal = state.rules?.objective && alive.some((p) => p.objective >= (state.objectiveGoal || 3) - 1);
    const lastRounds = state.rules?.maxRounds && state.round >= state.rules.maxRounds - 3;
    if (danger || nearGoal || lastRounds || (alive.length <= 2 && state.players.length > 2) || state.round >= 30) return 2;
    if (state.baron?.active || state.elder?.active || state.event) return 1;
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Pause : le chef du salon fige la partie et la reprend
  // ---------------------------------------------------------------------------

  const isLobbyOwner = () => Boolean(App.lobby && App.me && App.lobby.owner === App.me.name);
  function renderPause() {
    const btn = $('#gv-pause-btn');
    const box = $('#gv-pause');
    const paused = Boolean(state.paused) && !replay;
    btn.hidden = replay || !isLobbyOwner() || state.phase === 'over';
    btn.textContent = paused ? '▶' : '⏸';
    btn.title = paused ? 'Reprendre la partie' : 'Mettre la partie en pause';
    view.classList.toggle('is-paused', paused);
    box.hidden = !paused;
    if (!paused) return;
    box.replaceChildren();
    const panel = el('div', 'gv-pause__panel');
    panel.append(el('p', 'gv-pause__title', 'Partie en pause'), el('p', 'gv-pause__sub', `Mise en pause par ${state.paused.by}. Le chrono et les bots sont arrêtés ; la partie est sauvegardée.`));
    if (isLobbyOwner()) {
      const resume = el('button', 'gv-btn gv-btn--primary', 'Reprendre la partie');
      resume.type = 'button';
      resume.addEventListener('click', () => send('game:pause', { paused: false }));
      panel.append(resume);
    } else {
      panel.append(el('p', 'gv-pause__sub', 'Le chef du salon reprendra la partie.'));
    }
    box.append(panel);
  }
  $('#gv-pause-btn').addEventListener('click', () => send('game:pause', { paused: !state?.paused }));
  $('#gv-keys-btn').addEventListener('click', () => toggleShortcutHelp());

  // ---------------------------------------------------------------------------
  // Raccourcis clavier : Espace lancer, A acheter, P passer, F fin du tour, D/S sorts,
  // E échange, Échap fermer, ? aide
  // ---------------------------------------------------------------------------

  const SHORTCUTS = [
    ['Espace', 'Lancer les dés'],
    ['A', 'Acheter la case'],
    ['P', 'Passer (ne pas acheter)'],
    ['F', 'Fin du tour'],
    ['D', 'Sort 1'],
    ['S', 'Sort 2'],
    ['E', 'Proposer un échange'],
    ['Alt + clic', 'Ping sur une case'],
    ['Échap', 'Fermer la fenêtre ouverte'],
    ['?', 'Afficher cette aide'],
  ];
  function toggleShortcutHelp(force) {
    const box = $('#gv-keys');
    const open = force ?? box.hidden;
    box.hidden = !open;
    if (!open) return;
    const list = el('dl', 'gv-keys__list');
    for (const [key, label] of SHORTCUTS) list.append(el('dt', '', key), el('dd', '', label));
    box.replaceChildren(el('p', 'gv-keys__title', 'Raccourcis clavier'), list);
  }
  const clickAction = (action) => {
    const b = $(`#gv-buttons button[data-action="${action}"]:not([disabled])`);
    if (!b) return false;
    b.click();
    return true;
  };
  document.addEventListener('keydown', (event) => {
    if (view.hidden || !state || event.ctrlKey || event.metaKey || event.altKey) return;
    const t = event.target;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return;
    if (document.querySelector('dialog[open]')) return;
    const key = event.key;
    if (key === 'Escape') {
      toggleShortcutHelp(false);
      closeInspect();
      closeShop();
      closeKitPop();
      $('#gv-emotes').hidden = true;
      return;
    }
    if (key === '?') {
      toggleShortcutHelp();
      event.preventDefault();
      return;
    }
    if (replay) {
      if (key === ' ') {
        $('[data-replay="toggle"]', replayBar)?.click();
        event.preventDefault();
      }
      return;
    }
    let done = false;
    switch (key.toLowerCase()) {
      case ' ': done = clickAction('game:roll'); break;
      case 'a': done = clickAction('game:buy'); break;
      case 'p': done = clickAction('game:skip'); break;
      case 'f': done = clickAction('game:end'); break;
      case 'd':
      case 's': {
        const spell = $$('#gv-kit .gv-kit__btn--spell')[key.toLowerCase() === 'd' ? 0 : 1];
        if (spell && !spell.disabled) {
          spell.click();
          done = true;
        }
        break;
      }
      case 'e': {
        const trade = $('.gv-btn--trade:not([disabled])');
        if (trade) {
          trade.click();
          done = true;
        }
        break;
      }
      default:
    }
    if (done || key === ' ') event.preventDefault(); // Espace ne fait pas défiler la page
  });

  function renderAll() {
    window.LolMusic?.setIntensity?.(musicIntensity());
    cueSounds();
    renderTop();
    renderPlayers();
    renderSquares();
    syncPawns();
    syncBuildings();
    renderActions();
    renderLog();
    renderMine();
    renderKit();
    renderShop();
    renderTrade();
    renderStats();
    renderPause();
    renderOver();
    if (inspected !== null && state.phase !== 'buy') openInspect(inspected);
    if (state.phase !== 'buy' && inspected === state.pendingIndex) closeInspect();
  }

  function openBoard() {
    view.hidden = false;
    b3?.resume();
    window.LolMusic?.setVolume((App.settings?.music ?? 35) / 100);
    window.LolMusic?.start();
    syncMusicButton();
    document.body.classList.add('in-game');
    fitCamera();
  }

  function closeBoard() {
    window.LolMusic?.stop();
    view.hidden = true;
    b3?.pause();
    document.body.classList.remove('in-game');
    closeInspect();
    App.showView('lobby');
  }

  let queue = Promise.resolve();

  function onGameState(next) {
    if (replay) stopReplay({ silent: true }); // une vraie partie démarre : on quitte le replay
    applyState(next);
  }

  function applyState(next) {
    // échéance du chrono, calculée à la réception (avant les animations)
    if (next.timer) next.timerDeadline = performance.now() + next.timer.left;
    queue = queue.then(async () => {
      // état d'un replay qu'on vient de quitter : ignoré
      if (next.replayOf && next.replayOf !== replay?.token) return;
      if (next.id !== gameId) {
        await realArtReady; // liste de tes images, pour que les cases les utilisent dès le départ
        gameId = next.id;
        board = next.board;
        groups = next.groups;
        state = next;
        buildBoard();
        await setup3D();
        showDice(next.dice || [5, 2], false);
        diceEl.classList.toggle('is-visible', Boolean(next.dice));
        if (!next.dice) b3?.hideDice();
        renderAll();
        if (next.phase !== 'over') openBoard();
        return;
      }
      const fx = next.fx || [];
      // Les pions animés partent de leur position actuelle
      await playEffects(fx);
      state = next;
      renderAll();
    }).catch((err) => console.error('[game]', err));
  }
  socket.on('game:state', onGameState);

  // ---------------------------------------------------------------------------
  // Replay : une partie terminée rejouée coup par coup sur le plateau
  // ---------------------------------------------------------------------------

  let replay = null; // { id, frames, total, index, state, static, playing, speed, loading }
  const replayBar = $('#gv-replay');

  /** Reconstitue un état complet à partir du précédent et des changements envoyés par le serveur. */
  function decodeFrame(prev, delta, statics) {
    const { fx, logAdd, playersDelta, ...rest } = delta;
    const next = { ...(prev || {}), ...statics, ...rest };
    next.fx = fx || [];
    next.log = [...(prev?.log || []), ...(logAdd || [])].slice(-30);
    const players = (prev?.players || []).map((p) => ({ ...p }));
    for (const [i, diff] of playersDelta || []) players[i] = { ...(players[i] || {}), ...diff };
    next.players = players;
    return next;
  }

  async function loadReplayFrames() {
    if (!replay || replay.loading || replay.frames.length >= replay.total) return;
    replay.loading = true;
    const from = replay.frames.length;
    const res = await new Promise((resolve) => socket.emit('replay:frames', { id: replay.id, from }, resolve));
    if (!replay) return;
    replay.loading = false;
    if (!res?.ok) {
      App.toast(res?.error || 'Replay indisponible.', 'error');
      stopReplay();
      return;
    }
    if (res.static) replay.static = res.static;
    replay.total = res.total;
    replay.frames.push(...res.frames);
  }

  function renderReplayBar() {
    if (!replay) return;
    const shown = Math.max(0, replay.index);
    $('#gv-replay-fill').style.width = `${(shown / Math.max(1, replay.total - 1)) * 100}%`;
    $('#gv-replay-label').textContent = `Tour ${replay.state?.round ?? 1} · ${shown + 1}/${replay.total}`;
    $('[data-replay="toggle"]', replayBar).textContent = replay.playing ? '⏸' : '▶';
    $$('[data-speed]', replayBar).forEach((b) => b.classList.toggle('is-active', Number(b.dataset.speed) === replay.speed));
  }

  /** Avance d'un état ; `quiet` : sans animation (saut au tour suivant). */
  async function replayStep(quiet = false) {
    if (!replay) return false;
    if (replay.index + 1 >= replay.frames.length) await loadReplayFrames();
    if (!replay || replay.index + 1 >= replay.frames.length) return false;
    replay.index += 1;
    replay.state = decodeFrame(replay.state, replay.frames[replay.index], replay.static);
    const shown = quiet ? { ...replay.state, fx: [] } : replay.state;
    applyState({ ...structuredClone(shown), replayOf: replay.token });
    await queue;
    if (!replay) return false;
    if (replay.frames.length - replay.index < 40) loadReplayFrames();
    return true;
  }

  async function replayLoop() {
    while (replay && replay.playing) {
      const ok = await replayStep();
      if (!replay) return;
      renderReplayBar();
      if (!ok) {
        replay.playing = false;
        renderReplayBar();
        return;
      }
      const hasFx = replay.state.fx?.length;
      await new Promise((r) => setTimeout(r, (hasFx ? 220 : 90) / replay.speed));
    }
  }

  App.playReplay = async (id) => {
    if (state && !state.replayOf && state.phase !== 'over' && !replay && state.players.some((p) => p.key === myKey() && !p.bankrupt)) {
      App.toast('Termine d’abord ta partie en cours.', 'info');
      return;
    }
    stopReplay({ silent: true });
    replay = { id, token: Symbol('replay'), frames: [], total: 1, index: -1, state: null, static: null, playing: false, speed: 1, loading: false };
    view.classList.add('is-replay');
    replayBar.hidden = false;
    gameId = null; // nouveau plateau
    animSpeed = 1;
    App.toast('Chargement du replay…', 'info', 1500);
    await loadReplayFrames();
    if (!replay) return;
    await replayStep(true);
    replay.playing = true;
    renderReplayBar();
    replayLoop();
  };

  function stopReplay({ silent = false } = {}) {
    if (!replay) return;
    replay = null;
    animSpeed = 1;
    view.classList.remove('is-replay');
    replayBar.hidden = true;
    gameId = null; // la prochaine partie reconstruit le plateau
    if (!silent) closeBoard();
  }

  replayBar.addEventListener('click', async (event) => {
    const b = event.target.closest('button');
    if (!b || !replay) return;
    if (b.dataset.speed) {
      replay.speed = Number(b.dataset.speed);
      animSpeed = replay.speed;
    } else if (b.dataset.replay === 'toggle') {
      replay.playing = !replay.playing;
      if (replay.playing) replayLoop();
    } else if (b.dataset.replay === 'next') {
      // au tour de table suivant, sans animation
      const wasPlaying = replay.playing;
      replay.playing = false;
      const round = replay.state?.round ?? 1;
      while (replay && replay.state && replay.state.round === round && replay.state.phase !== 'over') {
        if (!(await replayStep(true))) break;
      }
      if (replay && wasPlaying) {
        replay.playing = true;
        replayLoop();
      }
    } else if (b.dataset.replay === 'quit') {
      stopReplay();
    }
    renderReplayBar();
  });
  // Par sécurité : si l'état est arrivé avant la fin de la connexion, on le réaffiche
  document.addEventListener('app:login', () => { if (state) queue = queue.then(renderAll); });

  function send(event, payload = {}) {
    socket.emit(event, payload, (res) => {
      if (!res?.ok) App.toast(res?.error || 'Action impossible.', 'error');
    });
  }

  $('#gv-settings').addEventListener('click', () => App.openSettings?.());
  document.addEventListener('lolm:settings', (e) => {
    b3?.setQuality(e.detail.quality || 'auto');
    const music = window.LolMusic;
    if (!music) return;
    music.setVolume((e.detail.music ?? 35) / 100);
    if (!view.hidden && !music.playing) music.start();
  });

  // Musique : bouton ♪ (choix mémorisé) ; le navigateur n'autorise le son qu'après un clic
  function syncMusicButton() {
    const on = window.LolMusic?.enabled ?? false;
    const btn = $('#gv-music');
    btn.setAttribute('aria-pressed', String(on));
    btn.title = on ? 'Couper la musique' : 'Activer la musique';
  }
  $('#gv-music').addEventListener('click', () => {
    const music = window.LolMusic;
    if (!music) return;
    music.setEnabled(!music.enabled);
    if (music.enabled) {
      music.setVolume((App.settings?.music ?? 35) / 100);
      music.start();
    } else {
      music.stop();
    }
    syncMusicButton();
  });
  document.addEventListener('pointerdown', () => {
    if (App.audio?.state === 'suspended') App.audio.resume();
  });

  $('#gv-forfeit').addEventListener('click', () => {
    if (window.confirm('Abandonner la partie ? Tes cases retourneront à la banque.')) send('game:forfeit');
  });

  // Onglets du panneau de droite
  function showTab(name) {
    $$('.gv-side__tab').forEach((t) => t.classList.toggle('is-active', t.dataset.gvTab === name));
    $$('[data-gv-panel]').forEach((p) => { p.hidden = p.dataset.gvPanel !== name; });
    if (name === 'stats' && state) renderStats();
    if (name === 'chat') {
      const list = $('#gv-chat-list');
      list.scrollTop = list.scrollHeight;
    }
  }
  // Sur téléphone, le panneau (journal, cases, chat) est un tiroir en bas de l'écran :
  // toucher un onglet l'ouvre, retoucher l'onglet actif le referme.
  const isPhone = () => matchMedia('(max-width: 760px)').matches;
  $$('.gv-side__tab').forEach((tab) => tab.addEventListener('click', () => {
    const side = $('.gv-side');
    if (isPhone() && tab.classList.contains('is-active') && side.classList.contains('is-open')) {
      side.classList.remove('is-open');
      return;
    }
    side.classList.add('is-open');
    showTab(tab.dataset.gvTab);
  }));

  // Fermer la fiche / la carte avec Échap ou un clic
  $('#gv-cardfx').addEventListener('click', () => { $('#gv-cardfx').hidden = true; });
  document.addEventListener('keydown', (event) => {
    if (view.hidden) return;
    if (event.key === 'Escape') closeInspect();
    if (event.key === ' ' && isMyTurn() && document.activeElement?.tagName !== 'INPUT') {
      const primary = $('#gv-buttons .gv-btn--primary:not(:disabled)');
      if (primary) {
        event.preventDefault();
        primary.click();
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Chat en partie (mêmes messages que le salon)
  // ---------------------------------------------------------------------------

  function chatLine(msg) {
    const li = document.createElement('li');
    li.className = msg.type === 'system' ? 'is-system' : '';
    if (msg.from) {
      const b = document.createElement('b');
      b.textContent = `${msg.from} : `;
      li.append(b);
    }
    li.append(msg.text);
    return li;
  }
  socket.on('chat:history', (history) => {
    $('#gv-chat-list').replaceChildren(...history.map(chatLine));
  });
  socket.on('chat:message', (msg) => {
    const list = $('#gv-chat-list');
    list.append(chatLine(msg));
    list.scrollTop = list.scrollHeight;
    const tab = $('.gv-side__tab[data-gv-tab="chat"]');
    if (!view.hidden && !tab.classList.contains('is-active') && msg.type !== 'system') tab.classList.add('has-news');
  });
  $('.gv-side__tab[data-gv-tab="chat"]').addEventListener('click', (e) => e.currentTarget.classList.remove('has-news'));
  $('#gv-chat-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#gv-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    socket.emit('chat:send', { text }, (res) => {
      if (!res?.ok) App.toast(res?.error || 'Message non envoyé.', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // Caméra : glisser pour tourner / incliner, molette pour zoomer
  // ---------------------------------------------------------------------------

  const cam = { yaw: 0, tilt: 52, zoom: 1, fit: 1 };
  let dragMoved = false;

  function applyCamera() {
    camera.style.setProperty('--tilt', `${cam.tilt}deg`);
    camera.style.setProperty('--yaw', `${cam.yaw}deg`);
    camera.style.setProperty('--zoom', cam.fit * cam.zoom);
  }

  function fitCamera() {
    const w = scene.clientWidth;
    const h = scene.clientHeight;
    if (!w || !h) return;
    cam.fit = Math.min(w / (BOARD_PX * 1.14), h / (BOARD_PX * 0.8));
    applyCamera();
  }
  window.addEventListener('resize', () => { if (!view.hidden) fitCamera(); });

  // En 3D : clic = quart de tour, bouton maintenu = rotation continue
  let spinHold = null;
  $$('.gv-cam__btn').forEach((btn) => {
    const dir = btn.dataset.cam === 'left' ? -1 : btn.dataset.cam === 'right' ? 1 : 0;
    btn.addEventListener('pointerdown', () => {
      if (!b3 || !dir) return;
      spinHold = { spinning: false, timer: setTimeout(() => { spinHold.spinning = true; b3.spin(dir); }, 260) };
    });
    const release = () => {
      if (!spinHold) return;
      clearTimeout(spinHold.timer);
      if (spinHold.spinning) {
        b3?.spin(0);
        btn.dataset.spun = '1'; // le clic qui suit ne doit pas ajouter un quart de tour
      }
      spinHold = null;
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
  });
  $$('.gv-cam__btn').forEach((btn) => btn.addEventListener('click', () => {
    const action = btn.dataset.cam;
    if (b3) {
      if (btn.dataset.spun) {
        delete btn.dataset.spun;
        return;
      }
      if (action === 'reset') b3.resetCamera();
      else b3.rotate(action === 'left' ? -90 : 90);
      return;
    }
    if (action === 'left') cam.yaw -= 90;
    if (action === 'right') cam.yaw += 90;
    if (action === 'reset') {
      cam.yaw = Math.round(cam.yaw / 360) * 360;
      cam.tilt = 52;
      cam.zoom = 1;
    }
    applyCamera();
  }));

  let drag = null;
  scene.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || b3) return; // en 3D, la caméra est gérée par board3d.js
    drag = { x: event.clientX, y: event.clientY, yaw: cam.yaw, tilt: cam.tilt };
    dragMoved = false;
  });
  window.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!dragMoved && Math.hypot(dx, dy) < 6) return;
    if (!dragMoved) {
      view.classList.add('is-dragging');
      cancelHover();
    }
    dragMoved = true;
    cam.yaw = drag.yaw - dx * 0.3;
    cam.tilt = Math.max(20, Math.min(68, drag.tilt - dy * 0.2));
    applyCamera();
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    view.classList.remove('is-dragging');
    setTimeout(() => { dragMoved = false; }, 0);
  });
  scene.addEventListener('wheel', (event) => {
    if (b3) return;
    event.preventDefault();
    cam.zoom = Math.max(0.6, Math.min(1.8, cam.zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    applyCamera();
  }, { passive: false });

  applyCamera();

  // Au retour dans le salon après une partie, on peut rouvrir le plateau
  App.openBoard = () => { if (state && state.phase !== 'over') openBoard(); };
})();
