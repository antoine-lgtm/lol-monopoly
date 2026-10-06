'use strict';

/**
 * LoL Monopoly — bots (Facile, Normal, Difficile).
 *
 * `botStep(game, key)` fait UNE action pour le bot dont c'est le tour (construire,
 * acheter un objet, lancer les dés…) : le serveur l'appelle à intervalle régulier
 * pour que les joueurs voient le bot jouer. `botAnswerTrade` répond à un échange.
 */

const { BOARD, GROUPS, MAX_LEVEL } = require('./game');
const { ITEMS } = require('./features');

const LEVELS = {
  easy: { name: 'Facile', buyMargin: 250, buyChance: 0.65, reserve: 450, build: 0.4, spells: false, items: [], trade: 1.0 },
  normal: { name: 'Normal', buyMargin: 120, buyChance: 0.95, reserve: 300, build: 1, spells: true, items: ['doran', 'boots', 'potion'], trade: 1.2 },
  hard: { name: 'Difficile', buyMargin: 40, buyChance: 1, reserve: 180, build: 1, spells: true, items: ['nashor', 'frozen', 'doran', 'boots'], trade: 1.35 },
};

const levelOf = (p) => LEVELS[p.bot] || LEVELS.normal;
const members = (group) => BOARD.map((s, i) => (s.group === group ? i : -1)).filter((i) => i >= 0);

/** Achète-t-on la case en attente ? */
function wantsToBuy(game, p, lv) {
  const index = game.pendingIndex;
  const sq = BOARD[index];
  if (p.gold < sq.price) return false;
  const left = p.gold - sq.price;
  if (sq.group) {
    const group = members(sq.group);
    const mine = group.filter((i) => game.props[i]?.owner === p.key).length;
    const theirs = group.filter((i) => game.props[i] && game.props[i].owner !== p.key);
    // compléter son groupe : presque toujours
    if (mine === group.length - 1 && left >= 0 && lv !== LEVELS.easy) return true;
    // bloquer un adversaire qui allait compléter le sien (Difficile)
    if (lv === LEVELS.hard && theirs.length === group.length - 1 && new Set(theirs.map((i) => game.props[i].owner)).size === 1) return left >= 0;
  }
  if (sq.type === 'dragon' && lv === LEVELS.hard) return left >= 0;
  return left >= lv.buyMargin && Math.random() < lv.buyChance;
}

/** Une construction utile (groupe complet, case la moins construite), ou null. */
function buildTarget(game, p, lv) {
  // les bots tirent leur hasard à part : les tirages de la partie restent rejouables
  if (Math.random() > lv.build) return null;
  const groups = new Set(game.ownedBy(p.key).map((i) => BOARD[i].group).filter(Boolean));
  const options = [];
  for (const group of groups) {
    if (!game.controlsGroup(p.key, group)) continue;
    const idx = members(group);
    if (idx.some((i) => game.props[i].mortgaged)) continue;
    const min = Math.min(...idx.map((i) => game.props[i].level));
    if (min >= MAX_LEVEL) continue;
    const cost = game.buildCost(p, group);
    if (p.gold - cost < lv.reserve) continue;
    // on vise d'abord le palier T3 (le plus rentable), puis les groupes les plus chers
    const target = idx.find((i) => game.props[i].level === min && game.props[i].owner === p.key);
    if (target === undefined) continue; // la case la moins construite est à son partenaire
    options.push({ index: target, score: (min < 3 ? 10 : 0) + GROUPS[group].house / 50 });
  }
  options.sort((a, b) => b.score - a.score);
  return options[0]?.index ?? null;
}

/** Sorts et objets à utiliser avant de lancer les dés. */
function preRollAction(game, p, lv) {
  const k = p.key;
  if (lv.spells) {
    for (const sp of p.spells) {
      if (sp.cd > 0) continue;
      if (sp.id === 'heal') return game.useSpell(k, 'heal');
      if (sp.id === 'barrier' && !p.armed.barrier) return game.useSpell(k, 'barrier');
      if (sp.id === 'ignite' && !p.armed.ignite && game.ownedBy(k).length >= 3) return game.useSpell(k, 'ignite');
      if (sp.id === 'cleanse' && p.inJail) return game.useSpell(k, 'cleanse');
      if (sp.id === 'ghost' && !p.inJail && !p.armed.ghost) return game.useSpell(k, 'ghost');
    }
    // Héraut : sur la case adverse la plus construite
    if (p.herald) {
      const target = Object.entries(game.props)
        .filter(([, st]) => st.owner !== k && st.level > 0)
        .sort((a, b) => b[1].level - a[1].level)[0];
      if (target) return game.useHerald(k, Number(target[0]));
    }
    const boots = p.items.find((it) => it.id === 'boots');
    if (boots && !boots.cd && !p.inJail && !p.armed.boots) return game.useBoots(k);
  }
  return null;
}

/** Objet à acheter quand on passe à la Fontaine ou à la Boutique. */
function shopAction(game, p, lv) {
  if (!game.rules.items || !p.canShop || p.items.length >= 3) return null;
  for (const id of lv.items) {
    if (game.hasItem(p, id)) continue;
    const price = game.itemPrice(id);
    if (p.gold - price >= lv.reserve + 150 && ITEMS[id]) return game.buyItem(p.key, id);
  }
  return null;
}

/** Lève une hypothèque quand on est à l'aise. */
function unmortgageAction(game, p, lv) {
  if (lv === LEVELS.easy) return null;
  const i = game.ownedBy(p.key).find((j) => game.props[j].mortgaged);
  if (i === undefined) return null;
  if (p.gold - Math.ceil((BOARD[i].price / 2) * 1.1) < lv.reserve + 200) return null;
  return game.unmortgage(p.key, i);
}

// Échanges proposés par les bots : un essai par tour, 20 s pour répondre
const tradeMemo = new WeakMap(); // game -> { turnId, sentAt }
const TRADE_WAIT_MS = 20_000;

/** Propose un échange qui complète un groupe du bot (contre une case utile à l'autre, ou des PO). */
function tradeAction(game, p, lv) {
  if (lv === LEVELS.easy || game.trade) return null;
  const memo = tradeMemo.get(game);
  if (memo && memo.turnId === game.turnId) return null;
  tradeMemo.set(game, { turnId: game.turnId, sentAt: Date.now() });
  const tradable = (owner, i) => !game.tradableProps(owner, [i]);
  for (const group of Object.keys(GROUPS)) {
    const idx = members(group);
    const missing = idx.filter((i) => game.props[i]?.owner !== p.key);
    if (missing.length !== 1) continue;
    const want = missing[0];
    const st = game.props[want];
    if (!st || !tradable(st.owner, want) || !idx.filter((i) => i !== want).every((i) => tradable(p.key, i))) continue;
    const other = game.player(st.owner);
    // une de mes cases qui complète un groupe de l'autre : échange gagnant-gagnant
    const swap = game.ownedBy(p.key).find((i) => {
      const g2 = BOARD[i].group;
      if (!g2 || g2 === group || !tradable(p.key, i)) return false;
      return members(g2).every((j) => j === i || game.props[j]?.owner === other.key);
    });
    if (swap !== undefined) {
      const res = game.proposeTrade(p.key, { to: other.key, giveProps: [swap], getProps: [want] });
      if (res.ok) return res;
    }
    const offer = Math.round(BOARD[want].price * 2.6 * (lv === LEVELS.hard ? 1.1 : 1));
    if (p.gold - offer >= lv.reserve) {
      const res = game.proposeTrade(p.key, { to: other.key, getProps: [want], giveGold: offer });
      if (res.ok) return res;
    }
  }
  return null;
}

/** Fait une action ; renvoie le résultat de la méthode du jeu. */
function botStep(game, key) {
  const p = game.currentPlayer;
  if (!p || p.key !== key || game.phase === 'over') return { ok: false };
  const lv = levelOf(p);
  if (game.trade && game.trade.from === key) {
    // on attend la réponse… pas trop longtemps
    const memo = tradeMemo.get(game);
    if (memo && Date.now() - memo.sentAt < TRADE_WAIT_MS) return { ok: true, waiting: true };
    return game.cancelTrade(key);
  }
  const tryAll = (...fns) => {
    for (const fn of fns) {
      const res = fn();
      if (res && res.ok) return res;
    }
    return null;
  };
  switch (game.phase) {
    case 'roll': {
      if (p.inJail) {
        if (p.jailCards) return game.useJailCard(key);
        if (lv !== LEVELS.easy && p.gold > 600 && game.round < 12) return game.payJail(key);
      }
      const extra = tryAll(
        () => preRollAction(game, p, lv),
        () => shopAction(game, p, lv),
        () => { const i = buildTarget(game, p, lv); return i === null ? null : game.build(key, i); },
        () => unmortgageAction(game, p, lv),
      );
      return extra || game.roll(key);
    }
    case 'ghost': {
      // garde le lancer, sauf Difficile qui relance le plus petit dé
      const [a, b] = game.ghostDice;
      if (lv !== LEVELS.hard) return game.ghostChoice(key, -1);
      return game.ghostChoice(key, Math.min(a, b) <= 2 ? (a <= b ? 0 : 1) : -1);
    }
    case 'buy':
      return wantsToBuy(game, p, lv) && game.buy(key).ok ? { ok: true } : game.skipBuy(key);
    case 'tax':
      return game.payTax(key, game.netWorth(p) * 0.1 < 200 ? 'percent' : 'flat');
    case 'debt': {
      // revendre un objet, puis les constructions et hypothèques (automatique)
      if (p.items.length) return game.sellItem(key, p.items[p.items.length - 1].id);
      return game.autoStep(); // liquidation automatique (action enregistrée pour le replay)
    }
    case 'end': {
      const extra = tryAll(
        () => tradeAction(game, p, lv),
        () => shopAction(game, p, lv),
        () => { const i = buildTarget(game, p, lv); return i === null ? null : game.build(key, i); },
        () => unmortgageAction(game, p, lv),
      );
      return extra || game.endTurn(key);
    }
    default:
      return { ok: false };
  }
}

/** Valeur d'un lot de cases pour `who` (compléter un groupe vaut plus cher). */
function lotValue(game, props, who) {
  let value = 0;
  for (const i of props) {
    const sq = BOARD[i];
    value += sq.price;
    if (sq.group) {
      const group = members(sq.group);
      const after = group.filter((j) => j === i || game.props[j]?.owner === who || props.includes(j)).length;
      if (after === group.length) value += sq.price * 1.5;
    }
  }
  return value;
}

/** Le bot `key` accepte-t-il l'échange qu'on lui propose ? */
function botAnswerTrade(game, key) {
  const t = game.trade;
  if (!t || t.to !== key) return { ok: false };
  const p = game.player(key);
  const lv = levelOf(p);
  const gets = lotValue(game, t.give.props, key) + t.give.gold;
  // ce qu'il cède compte double s'il permet à l'autre de compléter un groupe
  const gives = lotValue(game, t.get.props, t.from) + t.get.gold;
  const accept = gets >= gives * lv.trade && p.gold - t.get.gold >= 50;
  return game.respondTrade(key, accept);
}

module.exports = { LEVELS, botStep, botAnswerTrade };
