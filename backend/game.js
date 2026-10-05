'use strict';

/**
 * LoL Monopoly — logique de la partie (Étape 4).
 *
 * Le serveur fait autorité : le client n'envoie que des intentions (lancer, acheter,
 * construire…) et reçoit l'état complet après chaque action. Toutes les méthodes
 * publiques renvoient { ok: true } ou { ok: false, error }.
 *
 * Vocabulaire : Or = argent, Tours T1–T4 = maisons, Inhibiteur = hôtel,
 * Dragons = gares, Potions = compagnies, Fontaine = Départ.
 */

const START_GOLD = 1500;
const GO_BONUS = 200;
const JAIL_FINE = 50;
const JAIL_INDEX = 10;
const BARON_INDEX = 20;
const BARON_ROUND = 3; // le Baron apparaît au 3e tour de table
const BARON_GO_BONUS = 300;
const BARON_RENT_MULT = 1.5;
const MAX_LEVEL = 5; // 1–4 = tours, 5 = inhibiteur
// Réserve de la banque (règle officielle de la pénurie) : 32 tours et 12 inhibiteurs
const TOWER_SUPPLY = 32;
const INHIB_SUPPLY = 12;
const LOG_SIZE = 80;

const PLAYER_COLORS = ['#0ac8b9', '#e84057', '#b27cff', '#f0a030', '#6fd16a'];

const GROUPS = {
  marron: { label: 'Ixtal', color: '#8a5a3c', house: 50 },
  gris: { label: 'Freljord', color: '#9aa4ad', house: 50 },
  rose: { label: 'Ionia', color: '#d6519b', house: 100 },
  orange: { label: 'Shurima', color: '#e98a2c', house: 100 },
  rouge: { label: 'Noxus', color: '#d8343f', house: 150 },
  jaune: { label: 'Targon', color: '#e6c440', house: 150 },
  vert: { label: 'Zaun', color: '#2f9e57', house: 200 },
  bleu: { label: 'Les Frères', color: '#2f6fd6', house: 200 },
};

const prop = (name, group, price, rent) => ({ type: 'property', name, group, price, rent });
const dragon = (name, element) => ({ type: 'dragon', name: `Dragon ${name}`, element, price: 200 });
const potion = (name, kind) => ({ type: 'potion', name, kind, price: 150 });

/** Les 40 cases, dans l'ordre, en partant de la Fontaine. */
const BOARD = [
  { type: 'go', name: 'Fontaine' },
  prop('Sivir', 'marron', 60, [2, 10, 30, 90, 160, 250]),
  { type: 'chest', name: 'Coffre Hextech' },
  prop('Skarner', 'marron', 60, [4, 20, 60, 180, 320, 450]),
  { type: 'tax', name: 'Sbires', kind: 'sbires' },
  dragon('Océan', 'ocean'),
  prop('Lissandra', 'gris', 100, [6, 30, 90, 270, 400, 550]),
  { type: 'chance', name: 'Ping SS' },
  prop('Volibear', 'gris', 100, [6, 30, 90, 270, 400, 550]),
  prop('Ornn', 'gris', 120, [8, 40, 100, 300, 450, 600]),
  { type: 'jail', name: 'Prison' },
  prop('Shen', 'rose', 140, [10, 50, 150, 450, 625, 750]),
  potion('Potion de vie', 'hp'),
  prop('Karma', 'rose', 140, [10, 50, 150, 450, 625, 750]),
  prop('Irelia', 'rose', 160, [12, 60, 180, 500, 700, 900]),
  dragon('Montagne', 'mountain'),
  prop('Azir', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  { type: 'chest', name: 'Coffre Hextech' },
  prop('Renekton', 'orange', 180, [14, 70, 200, 550, 750, 950]),
  prop('Nasus', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
  { type: 'baron', name: 'Baron Nashor' },
  prop('Sion', 'rouge', 220, [18, 90, 250, 700, 875, 1050]),
  { type: 'chance', name: 'Ping SS' },
  prop('Kled', 'rouge', 220, [18, 90, 250, 700, 875, 1050]),
  prop('Swain', 'rouge', 240, [20, 100, 300, 750, 925, 1100]),
  dragon('Infernal', 'infernal'),
  prop('Taric', 'jaune', 260, [22, 110, 330, 800, 975, 1150]),
  prop('Leona', 'jaune', 260, [22, 110, 330, 800, 975, 1150]),
  potion('Potion de mana', 'mana'),
  prop('Diana', 'jaune', 280, [24, 120, 360, 850, 1025, 1200]),
  { type: 'gotojail', name: 'Grab de Blitzcrank' },
  prop('Warwick', 'vert', 300, [26, 130, 390, 900, 1100, 1275]),
  prop('Singed', 'vert', 300, [26, 130, 390, 900, 1100, 1275]),
  { type: 'chest', name: 'Coffre Hextech' },
  prop('Urgot', 'vert', 320, [28, 150, 450, 1000, 1200, 1400]),
  dragon('Vent', 'cloud'),
  { type: 'chance', name: 'Ping SS' },
  prop('Yone', 'bleu', 350, [35, 175, 500, 1100, 1300, 1500]),
  { type: 'tax', name: 'Boutique', kind: 'boutique', amount: 75 },
  prop('Yasuo', 'bleu', 400, [50, 200, 600, 1400, 1700, 2000]),
];

const DRAGON_INDEXES = BOARD.map((s, i) => (s.type === 'dragon' ? i : -1)).filter((i) => i >= 0);
const BUYABLE = new Set(['property', 'dragon', 'potion']);
const groupMembers = (group) => BOARD.map((s, i) => (s.group === group ? i : -1)).filter((i) => i >= 0);

// ---------------------------------------------------------------------------
// Cartes
// ---------------------------------------------------------------------------

/** Ping SS (Chance) */
const CHANCE_CARDS = [
  { text: 'Téléportation ! Va sur le Dragon le plus proche.', act: (g, p) => g.moveTo(p, g.nextIndexOf(p.pos, DRAGON_INDEXES)) },
  { text: 'Ekko remonte le temps : recule de 3 cases.', act: (g, p) => g.moveBy(p, -3, { direct: true }) },
  { text: 'Flash vers la Fontaine ! Reçois 200 Or.', act: (g, p) => g.moveTo(p, 0) },
  { text: 'Tu pars farmer chez Yasuo.', act: (g, p) => g.moveTo(p, 39) },
  { text: 'Roaming bot : va sur Sion. Si tu passes par la Fontaine, reçois 200 Or.', act: (g, p) => g.moveTo(p, 21) },
  { text: 'Gank réussi chez Shen : avance jusqu’à lui.', act: (g, p) => g.moveTo(p, 11) },
  { text: 'Blitzcrank t’attrape ! Va directement en Prison.', act: (g, p) => g.sendToJail(p) },
  { text: 'First Blood ! Reçois 150 Or.', act: (g, p) => g.gain(p, 150) },
  { text: 'Tu voles le buff bleu adverse : reçois 50 Or.', act: (g, p) => g.gain(p, 50) },
  { text: 'Gank raté, tu offres un kill : paye 15 Or.', act: (g, p) => g.charge(p, 15, null) },
  { text: 'Élu shotcaller de l’équipe : paye 50 Or à chaque joueur.', act: (g, p) => g.payEachPlayer(p, 50) },
  { text: 'Réparation des structures : 25 Or par tour, 100 Or par inhibiteur.', act: (g, p) => g.repairs(p, 25, 100) },
  { text: 'Zhonya ! Garde cette carte pour sortir de Prison.', act: (g, p) => { p.jailCards += 1; } },
];

/** Coffre Hextech (Caisse de communauté) */
const CHEST_CARDS = [
  { text: 'Tu vends un skin Prestige : reçois 200 Or.', act: (g, p) => g.gain(p, 200) },
  { text: 'Erreur de la banque de Piltover en ta faveur : reçois 200 Or.', act: (g, p) => g.gain(p, 200) },
  { text: 'Retour à la Fontaine : reçois 200 Or.', act: (g, p) => g.moveTo(p, 0) },
  { text: 'C’est ton anniversaire dans la Faille : chaque joueur te donne 10 Or.', act: (g, p) => g.collectFromEachPlayer(p, 10) },
  { text: 'Soins de Soraka : reçois 100 Or.', act: (g, p) => g.gain(p, 100) },
  { text: 'Tu hérites des économies de Gangplank : reçois 100 Or.', act: (g, p) => g.gain(p, 100) },
  { text: 'Honorable mention de ton équipe : reçois 25 Or.', act: (g, p) => g.gain(p, 25) },
  { text: 'Frais de l’hôpital de Zaun : paye 100 Or.', act: (g, p) => g.charge(p, 100, null) },
  { text: 'Tu achètes une Zhonya trop tôt : paye 50 Or.', act: (g, p) => g.charge(p, 50, null) },
  { text: 'Taxe du Conseil de Piltover : 40 Or par tour, 115 Or par inhibiteur.', act: (g, p) => g.repairs(p, 40, 115) },
  { text: 'Report de ta partie classée : va directement en Prison.', act: (g, p) => g.sendToJail(p) },
  { text: 'Zhonya ! Garde cette carte pour sortir de Prison.', act: (g, p) => { p.jailCards += 1; } },
];

function shuffle(list, random) {
  const a = list.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------

class Game {
  /**
   * @param {Array<{key: string, name: string, icon: number}>} players  dans l'ordre de jeu
   * @param {{random?: () => number}} [options]
   */
  constructor(players, { random = Math.random } = {}) {
    this.random = random;
    this.id = Math.floor(random() * 1e9).toString(36);
    this.players = players.map((p, i) => ({
      key: p.key,
      name: p.name,
      icon: p.icon,
      pawn: p.pawn || 'classic',
      color: PLAYER_COLORS[i % PLAYER_COLORS.length],
      pos: 0,
      gold: START_GOLD,
      inJail: false,
      jailTurns: 0,
      jailCards: 0,
      baron: false,
      bankrupt: false,
    }));
    /** @type {Record<number, {owner: string, level: number, mortgaged: boolean}>} */
    this.props = {};
    this.current = 0;
    this.round = 1;
    this.phase = 'roll'; // roll | buy | tax | debt | end | over
    this.dice = null;
    this.doubles = 0;
    this.rollAgain = false;
    this.pendingIndex = null;
    this.baron = { active: false, taken: false, holder: null };
    this.supply = { towers: TOWER_SUPPLY, inhibs: INHIB_SUPPLY };
    /** Échange proposé par le joueur dont c'est le tour, en attente de réponse. */
    this.trade = null;
    this.decks = {
      chance: { order: shuffle(CHANCE_CARDS, random), next: 0 },
      chest: { order: shuffle(CHEST_CARDS, random), next: 0 },
    };
    this.winner = null;
    this.seq = 0;
    this.fx = [];
    this.log = [];
    this.lastRent = 0;
    this.say(`La partie commence ! ${this.players[0].name} ouvre le bal.`);
  }

  // --- Lecture ---------------------------------------------------------------

  player(key) {
    return this.players.find((p) => p.key === key) || null;
  }

  get currentPlayer() {
    return this.players[this.current];
  }

  alivePlayers() {
    return this.players.filter((p) => !p.bankrupt);
  }

  ownedBy(key) {
    return Object.entries(this.props).filter(([, s]) => s.owner === key).map(([i]) => Number(i));
  }

  ownsGroup(key, group) {
    return groupMembers(group).every((i) => this.props[i]?.owner === key);
  }

  netWorth(p) {
    let total = p.gold;
    for (const i of this.ownedBy(p.key)) {
      const sq = BOARD[i];
      const st = this.props[i];
      total += st.mortgaged ? sq.price / 2 : sq.price;
      if (st.level) total += st.level * GROUPS[sq.group].house;
    }
    return total;
  }

  rentFor(index, diceTotal) {
    const sq = BOARD[index];
    const st = this.props[index];
    if (!st || st.mortgaged) return 0;
    const owner = this.player(st.owner);
    let rent = 0;
    if (sq.type === 'property') {
      rent = sq.rent[st.level];
      if (st.level === 0 && this.ownsGroup(st.owner, sq.group)) rent *= 2;
    } else if (sq.type === 'dragon') {
      const count = DRAGON_INDEXES.filter((i) => this.props[i]?.owner === st.owner).length;
      rent = 25 * 2 ** (count - 1);
    } else if (sq.type === 'potion') {
      const both = BOARD.every((s, i) => s.type !== 'potion' || this.props[i]?.owner === st.owner);
      rent = (diceTotal || 7) * (both ? 10 : 4);
    }
    if (owner?.baron) rent = Math.round(rent * BARON_RENT_MULT);
    return rent;
  }

  // --- Journal & effets --------------------------------------------------------

  say(text) {
    this.log.push({ id: ++this.seq, text });
    if (this.log.length > LOG_SIZE) this.log.shift();
  }

  effect(fx) {
    this.fx.push({ id: ++this.seq, ...fx });
  }

  // --- Argent ------------------------------------------------------------------

  gain(p, amount) {
    p.gold += amount;
    this.effect({ type: 'gold', key: p.key, amount });
  }

  /** Débite un joueur (et crédite `to` s'il y en a un). Gère la dette si besoin. */
  charge(p, amount, to) {
    if (amount <= 0) return;
    p.gold -= amount;
    this.effect({ type: 'gold', key: p.key, amount: -amount });
    if (to) {
      to.gold += amount;
      this.effect({ type: 'gold', key: to.key, amount });
    }
    if (p.gold < 0) {
      // on note qui a été payé « à crédit » : en cas de faillite, il rend ce qui n'existait pas
      (p.owes ||= []).push({ key: to ? to.key : null, amount });
      this.enterDebt(p);
    } else {
      p.owes = [];
    }
  }

  payEachPlayer(p, amount) {
    for (const other of this.alivePlayers()) if (other !== p) this.charge(p, amount, other);
  }

  collectFromEachPlayer(p, amount) {
    for (const other of this.alivePlayers()) if (other !== p) this.charge(other, amount, p);
  }

  repairs(p, perTower, perInhib) {
    let total = 0;
    for (const i of this.ownedBy(p.key)) {
      const level = this.props[i].level;
      total += level === MAX_LEVEL ? perInhib : level * perTower;
    }
    if (total) {
      this.say(`${p.name} paye ${total} Or de réparations.`);
      this.charge(p, total, null);
    } else {
      this.say(`${p.name} n’a aucune structure à réparer.`);
    }
  }

  /**
   * Solde négatif : le joueur dont c'est le tour gère lui-même sa dette (vendre,
   * hypothéquer ou abandonner). Les autres sont liquidés automatiquement.
   */
  enterDebt(p) {
    if (p === this.currentPlayer && this.phase !== 'over') {
      if (this.phase !== 'debt') {
        this.resumePhase = this.phase;
        this.phase = 'debt';
      }
      return;
    }
    this.autoLiquidate(p);
  }

  autoLiquidate(p) {
    while (p.gold < 0) {
      const owned = this.ownedBy(p.key);
      const built = owned.filter((i) => this.props[i].level > 0).sort((a, b) => this.props[b].level - this.props[a].level);
      if (built.length) {
        this.sellLevel(p, built[0]);
        continue;
      }
      const free = owned.find((i) => !this.props[i].mortgaged);
      if (free !== undefined) {
        this.doMortgage(p, free);
        continue;
      }
      this.bankrupt(p);
      return;
    }
    p.owes = [];
  }

  // --- Déplacements ------------------------------------------------------------

  nextIndexOf(from, targets) {
    for (let step = 1; step <= 40; step++) {
      const i = (from + step) % 40;
      if (targets.includes(i)) return i;
    }
    return from;
  }

  passGo(p) {
    this.gain(p, GO_BONUS);
    this.say(`${p.name} passe par la Fontaine : +${GO_BONUS} Or.`);
    if (p.baron) {
      p.baron = false;
      this.baron.holder = null;
      this.gain(p, BARON_GO_BONUS);
      this.say(`La Main du Baron rapporte ${BARON_GO_BONUS} Or à ${p.name}, puis se dissipe.`);
    }
  }

  /** Avance (ou recule) de `steps` cases puis résout la case d'arrivée. */
  moveBy(p, steps, { direct = false } = {}) {
    const from = p.pos;
    const to = (((from + steps) % 40) + 40) % 40;
    if (steps > 0 && from + steps >= 40) this.passGo(p);
    p.pos = to;
    this.effect({ type: 'move', key: p.key, from, to, steps, direct });
    this.land(p);
  }

  /** Avance jusqu'à une case précise (toujours vers l'avant, bonus Fontaine compris). */
  moveTo(p, index) {
    const steps = (index - p.pos + 40) % 40;
    if (steps === 0) return this.land(p);
    this.moveBy(p, steps, { direct: true });
  }

  sendToJail(p) {
    const from = p.pos;
    p.pos = JAIL_INDEX;
    p.inJail = true;
    p.jailTurns = 0;
    this.rollAgain = false;
    this.effect({ type: 'move', key: p.key, from, to: JAIL_INDEX, steps: 0, direct: true });
    this.say(`${p.name} est envoyé en Prison.`);
  }

  land(p) {
    const index = p.pos;
    const sq = BOARD[index];
    if (BUYABLE.has(sq.type)) {
      const st = this.props[index];
      if (!st) {
        this.pendingIndex = index;
        this.phase = 'buy';
        return;
      }
      if (st.owner === p.key) return;
      if (st.mortgaged) {
        this.say(`${sq.name} est hypothéqué : pas de loyer.`);
        return;
      }
      const owner = this.player(st.owner);
      const rent = this.rentFor(index, this.dice ? this.dice[0] + this.dice[1] : 7);
      this.say(`${p.name} paye ${rent} Or de loyer à ${owner.name} (${sq.name}).`);
      this.charge(p, rent, owner);
      return;
    }
    switch (sq.type) {
      case 'tax':
        if (sq.kind === 'boutique') {
          this.say(`${p.name} passe à la Boutique : -${sq.amount} Or.`);
          this.charge(p, sq.amount, null);
        } else {
          this.phase = 'tax';
        }
        return;
      case 'chance':
      case 'chest':
        this.drawCard(p, sq.type);
        return;
      case 'gotojail':
        this.say(`Grab de Blitzcrank sur ${p.name} !`);
        this.sendToJail(p);
        return;
      case 'baron':
        if (this.baron.active && !this.baron.taken) {
          this.baron.taken = true;
          this.baron.active = false;
          this.baron.holder = p.key;
          p.baron = true;
          this.effect({ type: 'baron', key: p.key });
          this.say(`${p.name} tue le Baron Nashor ! Main du Baron : loyers +50 % et +${BARON_GO_BONUS} Or au prochain passage à la Fontaine.`);
        } else if (!this.baron.taken) {
          this.say(`Le Baron Nashor n’est pas encore apparu (tour ${BARON_ROUND}).`);
        }
        return;
      default:
    }
  }

  drawCard(p, deckName) {
    const deck = this.decks[deckName];
    const cards = deckName === 'chance' ? CHANCE_CARDS : CHEST_CARDS;
    const card = cards[deck.order[deck.next]];
    deck.next = (deck.next + 1) % deck.order.length;
    const title = deckName === 'chance' ? 'Ping SS' : 'Coffre Hextech';
    this.effect({ type: 'card', key: p.key, deck: deckName, title, text: card.text });
    this.say(`${p.name} — ${title} : ${card.text}`);
    card.act(this, p);
  }

  // --- Tour de jeu -------------------------------------------------------------

  guard(key, phases) {
    if (this.phase === 'over') return 'La partie est terminée.';
    const p = this.player(key);
    if (!p || p.bankrupt) return 'Tu ne participes plus à cette partie.';
    if (p !== this.currentPlayer) return 'Ce n’est pas ton tour.';
    if (phases && !phases.includes(this.phase)) return 'Action impossible maintenant.';
    return null;
  }

  rollDice() {
    const d = () => 1 + Math.floor(this.random() * 6);
    this.dice = [d(), d()];
    return this.dice;
  }

  /** Après une action qui termine la résolution de la case. */
  settle() {
    if (this.phase === 'over' || this.phase === 'debt') return;
    if (this.phase === 'buy' || this.phase === 'tax') return;
    this.phase = this.rollAgain && !this.currentPlayer.inJail ? 'roll' : 'end';
  }

  roll(key) {
    const error = this.guard(key, ['roll']);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    const [a, b] = this.rollDice();
    const isDouble = a === b;
    this.effect({ type: 'dice', key, values: [a, b] });
    this.phase = 'moving';

    if (p.inJail) {
      if (isDouble) {
        p.inJail = false;
        p.jailTurns = 0;
        this.rollAgain = false;
        this.say(`${p.name} fait un double (${a}+${b}) et s’évade de Prison !`);
        this.moveBy(p, a + b);
      } else {
        p.jailTurns += 1;
        if (p.jailTurns >= 3) {
          this.say(`${p.name} paye ${JAIL_FINE} Or et sort de Prison.`);
          p.inJail = false;
          p.jailTurns = 0;
          this.rollAgain = false;
          this.charge(p, JAIL_FINE, null);
          if (this.phase !== 'debt') this.moveBy(p, a + b);
        } else {
          this.say(`${p.name} rate son double (${a}+${b}) et reste en Prison.`);
          this.rollAgain = false;
          this.phase = 'end';
          return { ok: true };
        }
      }
      if (this.phase === 'moving') this.phase = 'end';
      this.settle();
      return { ok: true };
    }

    this.doubles = isDouble ? this.doubles + 1 : 0;
    if (this.doubles === 3) {
      this.say(`${p.name} fait trois doubles d’affilée : direction la Prison !`);
      this.doubles = 0;
      this.sendToJail(p);
      this.phase = 'end';
      return { ok: true };
    }
    this.rollAgain = isDouble;
    this.say(`${p.name} lance les dés : ${a} + ${b}${isDouble ? ' (double !)' : ''}.`);
    this.moveBy(p, a + b);
    if (this.phase === 'moving') this.phase = 'end';
    this.settle();
    return { ok: true };
  }

  buy(key) {
    const error = this.guard(key, ['buy']);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    const sq = BOARD[this.pendingIndex];
    if (p.gold < sq.price) return { ok: false, error: 'Pas assez d’Or.' };
    p.gold -= sq.price;
    this.effect({ type: 'gold', key, amount: -sq.price });
    this.props[this.pendingIndex] = { owner: key, level: 0, mortgaged: false };
    this.effect({ type: 'buy', key, index: this.pendingIndex });
    this.say(`${p.name} achète ${sq.name} pour ${sq.price} Or.`);
    this.pendingIndex = null;
    this.phase = 'end';
    this.settle();
    return { ok: true };
  }

  skipBuy(key) {
    const error = this.guard(key, ['buy']);
    if (error) return { ok: false, error };
    this.say(`${this.currentPlayer.name} laisse ${BOARD[this.pendingIndex].name} à la banque.`);
    this.pendingIndex = null;
    this.phase = 'end';
    this.settle();
    return { ok: true };
  }

  payTax(key, choice) {
    const error = this.guard(key, ['tax']);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    const amount = choice === 'percent' ? Math.round(this.netWorth(p) * 0.1) : 200;
    this.say(`${p.name} paye ${amount} Or aux Sbires.`);
    this.phase = 'end';
    this.charge(p, amount, null);
    this.settle();
    return { ok: true };
  }

  payJail(key) {
    const error = this.guard(key, ['roll']);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    if (!p.inJail) return { ok: false, error: 'Tu n’es pas en Prison.' };
    if (p.gold < JAIL_FINE) return { ok: false, error: 'Pas assez d’Or.' };
    p.inJail = false;
    p.jailTurns = 0;
    p.gold -= JAIL_FINE;
    this.effect({ type: 'gold', key, amount: -JAIL_FINE });
    this.say(`${p.name} paye ${JAIL_FINE} Or et sort de Prison.`);
    return { ok: true };
  }

  useJailCard(key) {
    const error = this.guard(key, ['roll']);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    if (!p.inJail || p.jailCards < 1) return { ok: false, error: 'Aucune carte Zhonya.' };
    p.jailCards -= 1;
    p.inJail = false;
    p.jailTurns = 0;
    this.say(`${p.name} active Zhonya et sort de Prison.`);
    return { ok: true };
  }

  endTurn(key) {
    const error = this.guard(key, ['end']);
    if (error) return { ok: false, error };
    this.nextTurn();
    return { ok: true };
  }

  nextTurn() {
    const before = this.current;
    let next = before;
    do {
      next = (next + 1) % this.players.length;
    } while (this.players[next].bankrupt && next !== before);
    if (next <= before) {
      this.round += 1;
      if (this.round >= BARON_ROUND && !this.baron.active && !this.baron.taken) {
        this.baron.active = true;
        this.effect({ type: 'baron-spawn' });
        this.say('Le Baron Nashor apparaît dans la fosse !');
      }
    }
    this.current = next;
    this.phase = 'roll';
    this.doubles = 0;
    this.rollAgain = false;
    this.pendingIndex = null;
    this.trade = null;
    this.say(`Au tour de ${this.currentPlayer.name}.`);
  }

  // --- Constructions & hypothèques --------------------------------------------

  ownProperty(key, index, types = ['property']) {
    const sq = BOARD[index];
    const st = this.props[index];
    if (!sq || !types.includes(sq.type)) return 'Case invalide.';
    if (!st || st.owner !== key) return 'Cette case ne t’appartient pas.';
    return null;
  }

  build(key, index) {
    const error = this.guard(key, ['roll', 'end']) || this.ownProperty(key, index);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    const sq = BOARD[index];
    const st = this.props[index];
    const members = groupMembers(sq.group);
    if (!this.ownsGroup(key, sq.group)) return { ok: false, error: `Il te faut toutes les cases ${GROUPS[sq.group].label}.` };
    if (members.some((i) => this.props[i].mortgaged)) return { ok: false, error: 'Une case du groupe est hypothéquée.' };
    if (st.level >= MAX_LEVEL) return { ok: false, error: 'Inhibiteur déjà construit.' };
    const minLevel = Math.min(...members.map((i) => this.props[i].level));
    if (st.level > minLevel) return { ok: false, error: 'Construis d’abord sur les autres cases du groupe.' };
    const cost = GROUPS[sq.group].house;
    if (p.gold < cost) return { ok: false, error: 'Pas assez d’Or.' };
    const inhib = st.level + 1 === MAX_LEVEL;
    if (inhib && this.supply.inhibs <= 0) return { ok: false, error: 'La banque n’a plus d’Inhibiteur en réserve.' };
    if (!inhib && this.supply.towers <= 0) return { ok: false, error: 'La banque n’a plus de tour en réserve.' };
    if (inhib) {
      this.supply.inhibs -= 1;
      this.supply.towers += MAX_LEVEL - 1; // les 4 tours retournent à la banque
    } else {
      this.supply.towers -= 1;
    }
    p.gold -= cost;
    st.level += 1;
    this.effect({ type: 'gold', key, amount: -cost });
    this.effect({ type: 'build', key, index, level: st.level });
    this.say(st.level === MAX_LEVEL
      ? `${p.name} érige un Inhibiteur sur ${sq.name} !`
      : `${p.name} construit une tour T${st.level} sur ${sq.name}.`);
    return { ok: true };
  }

  sellLevel(p, index) {
    const sq = BOARD[index];
    const st = this.props[index];
    let removed = 1;
    if (st.level === MAX_LEVEL) {
      // un Inhibiteur redevient 4 tours… s'il en reste assez à la banque, sinon moins
      const back = Math.min(MAX_LEVEL - 1, this.supply.towers);
      this.supply.inhibs += 1;
      this.supply.towers -= back;
      removed = MAX_LEVEL - back;
    } else {
      this.supply.towers += 1;
    }
    const refund = (GROUPS[sq.group].house / 2) * removed;
    st.level -= removed;
    p.gold += refund;
    this.effect({ type: 'gold', key: p.key, amount: refund });
    this.effect({ type: 'build', key: p.key, index, level: st.level });
    this.say(`${p.name} vend une structure sur ${sq.name} (+${refund} Or).`);
  }

  sell(key, index) {
    const error = this.guard(key, ['roll', 'end', 'debt']) || this.ownProperty(key, index);
    if (error) return { ok: false, error };
    const sq = BOARD[index];
    const st = this.props[index];
    if (st.level === 0) return { ok: false, error: 'Aucune structure à vendre.' };
    const maxLevel = Math.max(...groupMembers(sq.group).map((i) => this.props[i].level));
    if (st.level < maxLevel) return { ok: false, error: 'Vends d’abord sur les cases les plus construites.' };
    this.sellLevel(this.currentPlayer, index);
    this.checkDebt();
    return { ok: true };
  }

  doMortgage(p, index) {
    const sq = BOARD[index];
    this.props[index].mortgaged = true;
    const value = sq.price / 2;
    p.gold += value;
    this.effect({ type: 'gold', key: p.key, amount: value });
    this.say(`${p.name} hypothèque ${sq.name} (+${value} Or).`);
  }

  mortgage(key, index) {
    const error = this.guard(key, ['roll', 'end', 'debt']) || this.ownProperty(key, index, [...BUYABLE]);
    if (error) return { ok: false, error };
    const sq = BOARD[index];
    const st = this.props[index];
    if (st.mortgaged) return { ok: false, error: 'Déjà hypothéquée.' };
    if (sq.group && groupMembers(sq.group).some((i) => this.props[i]?.level > 0)) {
      return { ok: false, error: 'Vends d’abord les structures du groupe.' };
    }
    this.doMortgage(this.currentPlayer, index);
    this.checkDebt();
    return { ok: true };
  }

  unmortgage(key, index) {
    const error = this.guard(key, ['roll', 'end']) || this.ownProperty(key, index, [...BUYABLE]);
    if (error) return { ok: false, error };
    const p = this.currentPlayer;
    const sq = BOARD[index];
    const st = this.props[index];
    if (!st.mortgaged) return { ok: false, error: 'Cette case n’est pas hypothéquée.' };
    const cost = Math.ceil((sq.price / 2) * 1.1);
    if (p.gold < cost) return { ok: false, error: 'Pas assez d’Or.' };
    p.gold -= cost;
    st.mortgaged = false;
    this.effect({ type: 'gold', key, amount: -cost });
    this.say(`${p.name} lève l’hypothèque de ${sq.name} (-${cost} Or).`);
    return { ok: true };
  }

  checkDebt() {
    if (this.phase === 'debt' && this.currentPlayer.gold >= 0) {
      this.phase = this.resumePhase === 'moving' ? 'end' : this.resumePhase || 'end';
      this.resumePhase = null;
      this.currentPlayer.owes = [];
      this.settle();
    }
  }

  // --- Échanges ----------------------------------------------------------------

  /** Vérifie qu'une liste de cases peut changer de main (à `owner`, sans construction). */
  tradableProps(owner, list) {
    if (!Array.isArray(list) || list.length > 28) return 'Échange invalide.';
    const seen = new Set();
    for (const raw of list) {
      const i = Number(raw);
      if (!Number.isInteger(i) || seen.has(i)) return 'Échange invalide.';
      seen.add(i);
      const sq = BOARD[i];
      if (!sq || !BUYABLE.has(sq.type) || this.props[i]?.owner !== owner) return 'Une des cases n’appartient plus à ce joueur.';
      if (sq.group && groupMembers(sq.group).some((j) => this.props[j]?.level > 0)) {
        return `Vends d’abord les tours du groupe ${GROUPS[sq.group].label} (${sq.name}).`;
      }
    }
    return null;
  }

  validTrade(t) {
    const from = this.player(t.from);
    const to = this.player(t.to);
    if (!from || !to || from.bankrupt || to.bankrupt || from === to) return 'Joueur invalide.';
    for (const g of [t.give.gold, t.get.gold]) if (!Number.isInteger(g) || g < 0) return 'Montant invalide.';
    if (t.give.gold > Math.max(0, from.gold)) return 'Tu n’as pas assez d’Or pour cet échange.';
    if (t.get.gold > Math.max(0, to.gold)) return `${to.name} n’a pas assez d’Or pour cet échange.`;
    if (!t.give.gold && !t.get.gold && !t.give.props.length && !t.get.props.length) return 'L’échange est vide.';
    return this.tradableProps(from.key, t.give.props) || this.tradableProps(to.key, t.get.props);
  }

  /** Le joueur dont c'est le tour propose un échange (cases et/ou Or) à un autre joueur. */
  proposeTrade(key, { to, giveGold = 0, giveProps = [], getGold = 0, getProps = [] } = {}) {
    const error = this.guard(key, ['roll', 'end', 'debt']);
    if (error) return { ok: false, error };
    if (this.trade) return { ok: false, error: 'Un échange attend déjà une réponse.' };
    const trade = {
      id: ++this.seq,
      from: key,
      to: String(to || ''),
      give: { gold: Number(giveGold), props: (Array.isArray(giveProps) ? giveProps : []).map(Number) },
      get: { gold: Number(getGold), props: (Array.isArray(getProps) ? getProps : []).map(Number) },
    };
    const invalid = this.validTrade(trade);
    if (invalid) return { ok: false, error: invalid };
    this.trade = trade;
    this.effect({ type: 'trade-offer', from: key, to: trade.to });
    this.say(`${this.player(key).name} propose un échange à ${this.player(trade.to).name}.`);
    return { ok: true };
  }

  /** Le destinataire accepte ou refuse l'échange. */
  respondTrade(key, accept) {
    const t = this.trade;
    if (!t || t.to !== key) return { ok: false, error: 'Aucun échange ne t’attend.' };
    const from = this.player(t.from);
    const to = this.player(t.to);
    this.trade = null;
    if (!accept) {
      this.effect({ type: 'trade-done', accepted: false, from: t.from, to: t.to });
      this.say(`${to.name} refuse l’échange de ${from.name}.`);
      return { ok: true };
    }
    const invalid = this.validTrade(t);
    if (invalid) return { ok: false, error: `Échange annulé : ${invalid}` };
    for (const i of t.give.props) this.props[i].owner = to.key;
    for (const i of t.get.props) this.props[i].owner = from.key;
    const move = (a, b, gold) => {
      if (!gold) return;
      a.gold -= gold;
      b.gold += gold;
      this.effect({ type: 'gold', key: a.key, amount: -gold });
      this.effect({ type: 'gold', key: b.key, amount: gold });
    };
    move(from, to, t.give.gold);
    move(to, from, t.get.gold);
    this.effect({ type: 'trade-done', accepted: true, from: t.from, to: t.to, give: t.give, get: t.get });
    const part = ({ gold, props }) => [...props.map((i) => BOARD[i].name), ...(gold ? [`${gold} Or`] : [])].join(', ') || 'rien';
    this.say(`Échange conclu : ${from.name} donne ${part(t.give)} à ${to.name} contre ${part(t.get)}.`);
    this.checkDebt();
    return { ok: true };
  }

  cancelTrade(key) {
    if (!this.trade || this.trade.from !== key) return { ok: false, error: 'Aucun échange à annuler.' };
    this.trade = null;
    this.say(`${this.player(key).name} retire sa proposition d’échange.`);
    return { ok: true };
  }

  // --- Faillite ----------------------------------------------------------------

  bankrupt(p) {
    if (p.bankrupt) return;
    // Le créancier ne garde que l'or que le joueur avait vraiment : on reprend le reste
    let deficit = Math.max(0, -p.gold);
    for (const debt of [...(p.owes || [])].reverse()) {
      if (!deficit) break;
      const back = Math.min(deficit, debt.amount);
      deficit -= back;
      const creditor = debt.key && this.player(debt.key);
      if (creditor && !creditor.bankrupt) {
        creditor.gold -= back;
        this.effect({ type: 'gold', key: creditor.key, amount: -back });
        this.say(`${creditor.name} ne touche que ${debt.amount - back} Or sur les ${debt.amount} dus.`);
      }
    }
    p.owes = [];
    p.bankrupt = true;
    p.gold = 0;
    p.baron = false;
    // toutes ses cases retournent à la banque, libres ; ses constructions rejoignent la réserve
    const owned = this.ownedBy(p.key);
    for (const i of owned) {
      const level = this.props[i].level;
      if (level === MAX_LEVEL) this.supply.inhibs += 1;
      else this.supply.towers += level;
      delete this.props[i];
    }
    if (this.trade && (this.trade.from === p.key || this.trade.to === p.key)) this.trade = null;
    this.effect({ type: 'bankrupt', key: p.key });
    this.say(`${p.name} est éliminé !${owned.length ? ' Ses cases retournent à la banque.' : ''}`);

    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.phase = 'over';
      this.winner = alive[0]?.key ?? null;
      if (alive[0]) this.say(`Victoire de ${alive[0].name} !`);
      return;
    }
    if (p === this.currentPlayer) this.nextTurn();
  }

  /** Abandon volontaire (bouton, départ du salon) ou faillite déclarée pendant une dette. */
  forfeit(key) {
    const p = this.player(key);
    if (!p || p.bankrupt || this.phase === 'over') return { ok: false, error: 'Action impossible.' };
    this.say(`${p.name} abandonne la partie.`);
    this.bankrupt(p);
    return { ok: true };
  }

  /**
   * Joue à la place d'un joueur déconnecté : on lance, on n'achète rien, on paye
   * la taxe la moins chère, on liquide si besoin et on passe la main.
   */
  autoStep() {
    const p = this.currentPlayer;
    switch (this.phase) {
      case 'roll':
        if (p.inJail && p.jailCards) return this.useJailCard(p.key);
        return this.roll(p.key);
      case 'buy':
        return this.skipBuy(p.key);
      case 'tax':
        return this.payTax(p.key, Math.round(this.netWorth(p) * 0.1) < 200 ? 'percent' : 'flat');
      case 'debt':
        this.autoLiquidate(p);
        this.checkDebt();
        return { ok: true };
      case 'end':
        return this.endTurn(p.key);
      default:
        return { ok: false };
    }
  }

  // --- Sérialisation -----------------------------------------------------------

  /** État public envoyé à tous les joueurs. Les effets sont vidés après envoi. */
  serialize() {
    const state = {
      id: this.id,
      seq: this.seq,
      round: this.round,
      phase: this.phase,
      current: this.currentPlayer.key,
      dice: this.dice,
      pendingIndex: this.pendingIndex,
      baron: { ...this.baron },
      winner: this.winner,
      supply: { ...this.supply },
      trade: this.trade,
      players: this.players.map((p) => ({
        key: p.key,
        name: p.name,
        icon: p.icon,
        pawn: p.pawn,
        color: p.color,
        pos: p.pos,
        gold: p.gold,
        inJail: p.inJail,
        jailCards: p.jailCards,
        baron: p.baron,
        bankrupt: p.bankrupt,
        worth: this.netWorth(p),
      })),
      props: this.props,
      rents: Object.fromEntries(Object.keys(this.props).map((i) => [i, this.rentFor(Number(i))])),
      taxPercent: Math.round(this.netWorth(this.currentPlayer) * 0.1),
      board: BOARD,
      groups: GROUPS,
      log: this.log.slice(-30),
      fx: this.fx,
    };
    this.fx = [];
    return state;
  }
}

module.exports = { Game, BOARD, GROUPS, START_GOLD, GO_BONUS, JAIL_FINE, BARON_ROUND, MAX_LEVEL };
