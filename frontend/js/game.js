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

  // Géométrie du plateau (px, avant zoom) : coins = 1,6 case
  const BOARD_PX = 900;
  const UNIT = BOARD_PX / 12.2;
  const CORNER = UNIT * 1.6;

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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const myKey = () => (App.me?.name || '').toLowerCase();
  const me = () => state?.players.find((p) => p.key === myKey());
  const isMyTurn = () => state && state.current === myKey() && state.phase !== 'over';

  // ---------------------------------------------------------------------------
  // Géométrie : case -> position sur la grille 11 × 11
  // ---------------------------------------------------------------------------

  function cellOf(i) {
    if (i <= 10) return { row: 11, col: 11 - i, side: i === 0 || i === 10 ? 'corner' : 's' };
    if (i <= 20) return { row: 11 - (i - 10), col: 1, side: i === 20 ? 'corner' : 'w' };
    if (i <= 30) return { row: 1, col: 1 + (i - 20), side: i === 30 ? 'corner' : 'n' };
    return { row: 1 + (i - 30), col: 11, side: 'e' };
  }

  /** Début et taille (px) d'une ligne/colonne de la grille. */
  function track(n) {
    if (n === 1) return [0, CORNER];
    if (n === 11) return [CORNER + 9 * UNIT, CORNER];
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
      const noise = (start, dur, gainValue, freq) => {
        const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        src.buffer = buffer;
        filter.type = 'bandpass';
        filter.frequency.value = freq;
        gain.gain.value = gainValue * volume;
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start(now + start);
      };
      switch (kind) {
        case 'dice': // cliquetis des dés qui roulent
          for (let k = 0; k < 7; k++) noise(k * 0.11 + Math.random() * 0.04, 0.05, 0.5, 2200 + Math.random() * 1500);
          break;
        case 'step':
          tone(520 + Math.random() * 60, 0, 0.07, 0.05, 'triangle');
          break;
        case 'gain': // pièces d'or
          tone(1318, 0, 0.18, 0.08);
          tone(1760, 0.07, 0.25, 0.07);
          break;
        case 'loss':
          tone(330, 0, 0.2, 0.06, 'triangle');
          tone(247, 0.08, 0.28, 0.05, 'triangle');
          break;
        case 'card':
          noise(0, 0.35, 0.25, 900);
          tone(660, 0.12, 0.3, 0.05);
          break;
        case 'build':
          tone(196, 0, 0.18, 0.09, 'square');
          tone(294, 0.06, 0.22, 0.06, 'triangle');
          break;
        case 'baron':
          tone(110, 0, 0.9, 0.12, 'sawtooth');
          tone(82, 0.1, 1.1, 0.1, 'sawtooth');
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

  function artSources(name) {
    const drawn = `assets/board/${name}.svg`;
    if (!OFFICIAL_ART[name]) return [drawn];
    return [`assets/board/real/${name}.png`, `assets/board/real/${name}.webp`, ...OFFICIAL_ART[name], drawn];
  }

  /** Illustration des cases spéciales (dragons, potions, cartes, taxes). */
  function specialArt(sq) {
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
    return sq.price ? `${fmt(sq.price)} Or` : sq.amount ? `${sq.amount} Or` : '';
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
      sub.textContent = '+200 Or';
      inner.append(sub);
    } else if (sq.type === 'jail') {
      const sub = document.createElement('span');
      sub.className = 'gv-sq__price';
      sub.textContent = 'Simple visite';
      inner.append(sub);
    } else if (priceLabel(sq)) {
      const price = document.createElement('span');
      price.className = 'gv-sq__price';
      price.textContent = sq.kind === 'sbires' ? '10 % ou 200 Or' : priceLabel(sq);
      inner.append(price);
    }
    const owner = document.createElement('span');
    owner.className = 'gv-sq__owner';
    inner.append(owner);
    el.append(inner);
    return el;
  }

  function buildBoard() {
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

  function webglAvailable() {
    try {
      const c = document.createElement('canvas');
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  }

  /** Sources d'image d'une case pour la texture du plateau 3D. */
  function squareArt(sq) {
    if (sq.type === 'property') {
      const id = champId(sq);
      return [`assets/champions/loading/${id}_0.jpg`, ...imageSources('loading', id)];
    }
    return specialArt(sq);
  }

  async function setup3D() {
    b3?.dispose();
    b3 = null;
    view.classList.remove('is-webgl');
    if (!webglAvailable()) return;
    try {
      const mod = await import('./board3d.js');
      b3 = await mod.createBoard3D({
        container: scene,
        board,
        groups,
        geo: { cellOf, track, CORNER, UNIT },
        squareArt,
        priceLabel,
        sideSpace: () => ({
          left: ($('.gv-players')?.offsetWidth || 250) + 30,
          right: ($('.gv-side')?.offsetWidth || 300) + 30,
          bottom: 110, // barre d'actions
        }),
      });
      view.classList.add('is-webgl');
      b3.onHover = hoverSquare;
      b3.onClick = (i) => { if (matchMedia('(hover: none)').matches) openInspect(i); };
      b3.onDrag = () => hoverSquare(null);
    } catch (err) {
      console.warn('[plateau] WebGL indisponible, plateau CSS utilisé.', err);
      b3 = null;
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
    const inJail = index === 10 && p?.inJail;
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
      const { x, y } = centerOf(20, 0.9);
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
      else for (let t = 0; t < st.level; t++) towers.push({ ...bandPoint(index, st.level === 1 ? 0.5 : t / (st.level - 1)), color });
      flags.push({ ...flagPoint(index), color, mortgaged: st.mortgaged });
    }
    const baron = state.baron.taken ? null : { ...centerOf(20, 0.9), active: state.baron.active };
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
      pos = (pos + dir + 40) % 40;
      placePawn(fx.key, pos, { hop: true });
      await sleep(190);
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
      if (p.pawn && p.pawn !== 'classic') pawn.style.setProperty('--pawn-img', `url("/assets/pawns/${p.pawn}.svg")`);
      const info = document.createElement('div');
      info.className = 'gv-player__info';
      const name = document.createElement('span');
      name.className = 'gv-player__name';
      name.textContent = p.name;
      const gold = document.createElement('span');
      gold.className = 'gv-player__gold';
      gold.textContent = p.bankrupt ? 'Éliminé' : `${fmt(p.gold)} Or`;
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
      if (p.baron) tag('baron', 'Main du Baron', 'Loyers +50 % et +300 Or au prochain passage à la Fontaine');
      if (p.inJail) tag('jail', 'Prison', 'En prison');
      if (p.jailCards) tag('zhonya', `Zhonya ×${p.jailCards}`, 'Carte de sortie de prison');

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
      row.append(pawn, info, tags, owned);
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
  }

  function button(label, action, { primary = false, payload = {}, disabled = false, hint = '' } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `gv-btn${primary ? ' gv-btn--primary' : ''}`;
    b.textContent = label;
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
    switch (state.phase) {
      case 'roll':
        if (mine.inJail) {
          status.textContent = 'Tu es en Prison : tente un double ou paye.';
          box.append(
            button('Tenter un double', 'game:roll', { primary: true }),
            button('Payer 50 Or', 'game:payJail', { disabled: mine.gold < 50 }),
          );
          if (mine.jailCards) box.append(button('Utiliser Zhonya', 'game:useCard'));
        } else {
          status.textContent = state.dice && state.dice[0] === state.dice[1] ? 'Double ! Relance les dés.' : 'À toi de jouer !';
          box.append(button('Lancer les dés', 'game:roll', { primary: true }));
        }
        break;
      case 'buy':
        status.textContent = `${sq.name} est libre — ${fmt(sq.price)} Or`;
        box.append(
          button(`Acheter (${fmt(sq.price)})`, 'game:buy', { primary: true, disabled: mine.gold < sq.price, hint: mine.gold < sq.price ? 'Pas assez d’Or' : '' }),
          button('Passer', 'game:skip'),
        );
        openInspect(state.pendingIndex);
        inspectByHover = false;
        break;
      case 'tax':
        status.textContent = 'Les Sbires réclament leur part : choisis ton impôt.';
        box.append(
          button(`10 % de ta fortune (${fmt(state.taxPercent)})`, 'game:tax', { primary: state.taxPercent <= 200, payload: { choice: 'percent' } }),
          button('200 Or', 'game:tax', { primary: state.taxPercent > 200, payload: { choice: 'flat' } }),
        );
        break;
      case 'debt':
        status.textContent = `Dette de ${fmt(-mine.gold)} Or : vends des tours ou hypothèque des cases (onglet « Mes cases »).`;
        box.append(button('Déclarer faillite', 'game:forfeit'));
        showTab('mine');
        break;
      case 'end':
        status.textContent = 'Construis, hypothèque… ou termine ton tour.';
        box.append(button('Fin du tour', 'game:end', { primary: true }));
        break;
      default:
        status.textContent = '';
    }
  }

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
      lvl.textContent = st.mortgaged ? 'Hypothéquée' : st.level === 5 ? 'Inhibiteur' : st.level ? `T${st.level}` : `${fmt(state.rents[i])} Or`;
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
      sq.rent.forEach((r, l) => line(labels[l], `${fmt(r)} Or`, l === level));
      line('Groupe complet (sans tour)', `${fmt(sq.rent[0] * 2)} Or`);
      line('Prix d’une tour', `${fmt(groups[sq.group].house)} Or`);
    } else if (sq.type === 'dragon') {
      [25, 50, 100, 200].forEach((r, n) => line(`${n + 1} Dragon${n ? 's' : ''}`, `${r} Or`));
    } else if (sq.type === 'potion') {
      line('1 Potion', '4 × les dés');
      line('2 Potions', '10 × les dés');
    } else {
      const texts = {
        go: 'Chaque passage rapporte 200 Or. Avec la Main du Baron : +300 Or de plus, puis le buff disparaît.',
        jail: 'Simple visite… sauf si Blitzcrank t’a attrapé. Pour sortir : un double, 50 Or ou une carte Zhonya.',
        baron: 'Le Baron Nashor apparaît au 3ᵉ tour. Le premier qui tombe ici gagne la Main du Baron : loyers +50 % et +300 Or au prochain passage à la Fontaine.',
        gotojail: 'Le grab de Blitzcrank t’envoie directement en Prison, sans passer par la Fontaine.',
        chance: 'Pioche une carte Ping SS.',
        chest: 'Ouvre un Coffre Hextech.',
        tax: sq.kind === 'sbires' ? 'Paye 10 % de ta fortune ou 200 Or, au choix.' : 'Paye 75 Or à la Boutique.',
      };
      const p = document.createElement('p');
      p.className = 'gv-inspect__text';
      p.textContent = texts[sq.type] || '';
      body.append(p);
    }
    if (sq.price) {
      line('Prix', `${fmt(sq.price)} Or`);
      line('Hypothèque', `${fmt(sq.price / 2)} Or`);
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
    const won = state.winner === myKey();
    box.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = `gv-over__panel ${won ? 'is-victory' : 'is-defeat'}`;
    const title = document.createElement('p');
    title.className = 'gv-over__title';
    title.textContent = won ? 'VICTOIRE' : 'DÉFAITE';
    const sub = document.createElement('p');
    sub.className = 'gv-over__sub';
    const winner = state.players.find((p) => p.key === state.winner);
    sub.textContent = winner ? `${winner.name} domine la Faille en ${state.round} tours.` : 'Partie terminée.';
    const ranking = document.createElement('ol');
    ranking.className = 'gv-over__ranking';
    [...state.players]
      .sort((a, b) => (a.key === state.winner ? -1 : b.key === state.winner ? 1 : b.worth - a.worth))
      .forEach((p) => {
        const li = document.createElement('li');
        li.style.setProperty('--c', p.color);
        const n = document.createElement('span');
        n.textContent = p.name;
        const w = document.createElement('span');
        w.textContent = p.bankrupt ? 'Éliminé' : `${fmt(p.worth)} Or`;
        li.append(n, w);
        ranking.append(li);
      });
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'gv-btn gv-btn--primary';
    back.textContent = 'Retour au salon';
    back.addEventListener('click', closeBoard);
    panel.append(title, sub, ranking, back);
    box.append(panel);
    box.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Réception de l'état
  // ---------------------------------------------------------------------------

  function renderAll() {
    renderTop();
    renderPlayers();
    renderSquares();
    syncPawns();
    syncBuildings();
    renderActions();
    renderLog();
    renderMine();
    renderOver();
    if (inspected !== null && state.phase !== 'buy') openInspect(inspected);
    if (state.phase !== 'buy' && inspected === state.pendingIndex) closeInspect();
  }

  function openBoard() {
    view.hidden = false;
    b3?.resume();
    document.body.classList.add('in-game');
    fitCamera();
  }

  function closeBoard() {
    view.hidden = true;
    b3?.pause();
    document.body.classList.remove('in-game');
    closeInspect();
    App.showView('lobby');
  }

  let queue = Promise.resolve();

  function onGameState(next) {
    queue = queue.then(async () => {
      if (next.id !== gameId) {
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
  // Par sécurité : si l'état est arrivé avant la fin de la connexion, on le réaffiche
  document.addEventListener('app:login', () => { if (state) queue = queue.then(renderAll); });

  function send(event, payload = {}) {
    socket.emit(event, payload, (res) => {
      if (!res?.ok) App.toast(res?.error || 'Action impossible.', 'error');
    });
  }

  $('#gv-forfeit').addEventListener('click', () => {
    if (window.confirm('Abandonner la partie ? Tes cases retourneront à la banque.')) send('game:forfeit');
  });

  // Onglets du panneau de droite
  function showTab(name) {
    $$('.gv-side__tab').forEach((t) => t.classList.toggle('is-active', t.dataset.gvTab === name));
    $$('[data-gv-panel]').forEach((p) => { p.hidden = p.dataset.gvPanel !== name; });
    if (name === 'chat') {
      const list = $('#gv-chat-list');
      list.scrollTop = list.scrollHeight;
    }
  }
  $$('.gv-side__tab').forEach((tab) => tab.addEventListener('click', () => showTab(tab.dataset.gvTab)));

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

  $$('.gv-cam__btn').forEach((btn) => btn.addEventListener('click', () => {
    const action = btn.dataset.cam;
    if (b3) {
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
