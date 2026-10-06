/**
 * Tests des pouvoirs des pions, des événements de la Faille, des skins et des bots : `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, BOARD, MAX_LEVEL } = require('../backend/game');
const { PASSIVES, EVENTS, SKINS, skinUnlocked, sanitizeRules } = require('../backend/features');
const { botStep, botAnswerTrade } = require('../backend/bot');

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function newGame({ pawns = [], rules = {}, seed = 1, bots = [] } = {}) {
  return new Game(
    Array.from({ length: Math.max(2, pawns.length, bots.length) }, (_, i) => ({
      key: `p${i}`, name: `Joueur ${i}`, icon: 0, pawn: pawns[i], bot: bots[i] || null,
    })),
    { random: seeded(seed), rules },
  );
}
const firstOf = (group) => BOARD.findIndex((sq) => sq.group === group);

test('chaque pion a un pouvoir, et la règle peut les couper', () => {
  for (const pawn of ['poro', 'teemo', 'ward', 'minion', 'zhonya', 'blade', 'tibbers', 'egg', 'classic']) assert.ok(PASSIVES[pawn]?.text);
  assert.equal(newGame({ pawns: ['classic', 'poro'] }).players[0].gold, 1500 + PASSIVES.classic.start, 'pion classique : PO en plus');
  assert.equal(newGame({ pawns: ['classic', 'poro'], rules: { passives: false } }).players[0].gold, 1500);
  assert.equal(sanitizeRules({ turnTimer: 45 }).turnTimer, 60, 'durée de chrono invalide ignorée');
  assert.equal(sanitizeRules({ turnTimer: 0 }).turnTimer, 0);
});

test('Poro : des PO en plus en passant par la Fontaine', () => {
  const g = newGame({ pawns: ['poro', 'teemo'] });
  const p = g.players[0];
  p.pos = 38;
  g.moveBy(p, 4);
  assert.equal(p.gold, 1500 + 200 + PASSIVES.poro.gold);
});

test('Champignon de Teemo : des PO en plus sur les loyers reçus ; Stase de Zhonya : un loyer annulé', () => {
  const g = newGame({ pawns: ['teemo', 'zhonya'] });
  const [teemo, zhonya] = g.players;
  const i = firstOf('marron');
  g.props[i] = { owner: teemo.key, level: 0, mortgaged: false };
  zhonya.pos = i - 1;
  g.current = 1;
  g.moveBy(zhonya, 1);
  assert.equal(zhonya.gold, 1500, 'Zhonya ne paye pas');
  assert.equal(zhonya.passiveCd, PASSIVES.zhonya.cd);
  zhonya.passiveCd = 0; // recharge terminée : on vérifie le champignon sur un joueur sans Stase
  zhonya.pawn = 'poro';
  zhonya.pos = i - 1;
  g.moveBy(zhonya, 1);
  const rent = BOARD[i].rent[0] + PASSIVES.teemo.gold;
  assert.equal(zhonya.gold, 1500 - rent, 'loyer + PO du champignon');
  assert.equal(teemo.gold, 1500 + rent);
});

test('Sbire : moins cher aux Sbires ; Tibbers : constructions moins chères', () => {
  const g = newGame({ pawns: ['minion', 'tibbers'] });
  g.phase = 'tax';
  g.payTax('p0', 'flat');
  assert.equal(g.players[0].gold, 1500 - Math.round(200 * PASSIVES.minion.share));
  const h = newGame({ pawns: ['tibbers', 'poro'] });
  for (const i of BOARD.map((sq, k) => (sq.group === 'marron' ? k : -1)).filter((k) => k >= 0)) h.props[i] = { owner: 'p0', level: 0, mortgaged: false };
  assert.equal(h.build('p0', firstOf('marron')).ok, true);
  assert.equal(h.players[0].gold, 1500 - Math.round(50 * (1 - PASSIVES.tibbers.discount)));
});

test('Œuf d’Anivia : survit une fois à la faillite', () => {
  const g = newGame({ pawns: ['egg', 'poro', 'teemo'] });
  const egg = g.players[0];
  g.current = 1;
  egg.gold = 10;
  g.charge(egg, 5000, g.players[1]);
  assert.equal(egg.bankrupt, false);
  assert.equal(egg.gold, PASSIVES.egg.gold);
  assert.equal(egg.reborn, true);
  g.charge(egg, 5000, g.players[1]);
  assert.equal(egg.bankrupt, true, 'pas deux fois');
});

test('événements de la Faille : un tous les 4 tours, pendant 1 tour', () => {
  const g = newGame({ pawns: ['poro', 'teemo'] });
  for (let r = 1; r < 4; r++) { g.round = r; g.rollEvent(); assert.equal(g.event, null); }
  g.round = 4;
  g.rollEvent();
  assert.ok(EVENTS[g.event.id]);
  g.round = 5;
  g.rollEvent();
  assert.equal(g.event, null, 'fini au tour suivant');
  const h = newGame({ rules: { events: false } });
  h.round = 4;
  h.rollEvent();
  assert.equal(h.event, null, 'règle désactivée');
});

test('événements : Nouveau patch +25 % et Brouillard −25 % sur les loyers ; Soldes −25 %', () => {
  const g = newGame();
  const i = firstOf('bleu');
  g.props[i] = { owner: 'p1', level: 2, mortgaged: false };
  const base = g.rentFor(i);
  g.event = { id: 'patch', until: 99 };
  assert.equal(g.rentFor(i), Math.round(base * 1.25));
  g.event = { id: 'fog', until: 99 };
  assert.equal(g.rentFor(i), Math.round(base * 0.75));
  g.event = { id: 'sale', until: 99 };
  assert.equal(g.itemPrice('nashor'), Math.round(700 * 0.75));
});

test('skins : débloqués selon les parties jouées et les victoires', () => {
  assert.equal(skinUnlocked('base', {}), true);
  assert.equal(skinUnlocked('hextech', { games: 0 }), false);
  assert.equal(skinUnlocked('hextech', { games: 1 }), true);
  assert.equal(skinUnlocked('gold', { games: 5, wins: 0 }), false);
  assert.equal(skinUnlocked('gold', { games: 5, wins: 1 }), true);
  assert.equal(skinUnlocked('nope', { games: 99, wins: 99 }), false);
  assert.ok(Object.keys(SKINS).length >= 5);
});

test('bots : 150 parties entre bots se terminent, sans blocage ni incohérence', () => {
  const rnd = seeded(3);
  const levels = ['easy', 'normal', 'hard'];
  const pawnList = ['poro', 'teemo', 'ward', 'minion', 'zhonya', 'blade', 'tibbers', 'egg', 'classic'];
  let finished = 0;
  for (let n = 0; n < 150; n++) {
    const count = 2 + (n % 3);
    const g = new Game(Array.from({ length: count }, (_, i) => ({
      key: `b${i}`, name: `Bot ${i}`, icon: 0, bot: levels[(n + i) % 3], pawn: pawnList[(n + i) % 9], role: ['TOP', 'JGL', 'MID', 'ADC', 'SUPP'][i],
    })), { random: rnd });
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 80000) {
      if (g.trade) {
        assert.equal(botAnswerTrade(g, g.trade.to).ok, true);
        continue;
      }
      const res = botStep(g, g.currentPlayer.key);
      assert.equal(res.ok, true, `bot bloqué en phase ${g.phase} : ${res.error}`);
      let towers = 0;
      for (const st of Object.values(g.props)) if (st.level < MAX_LEVEL) towers += st.level;
      assert.ok(towers + g.supply.towers <= 32);
      for (const q of g.players) {
        if (g.phase !== 'over' && !q.bankrupt && q.gold < 0) assert.ok(q === g.currentPlayer && g.phase === 'debt', 'or négatif hors dette');
      }
    }
    if (g.phase === 'over') finished += 1;
  }
  assert.ok(finished >= 140, `${finished}/150 parties terminées`);
});

test('un bot répond à un échange : il refuse une offre ridicule, accepte une bonne affaire', () => {
  const g = newGame({ bots: [null, 'hard'] });
  const i = firstOf('bleu');
  g.props[i] = { owner: 'p1', level: 0, mortgaged: false };
  assert.equal(g.proposeTrade('p0', { to: 'p1', getProps: [i], giveGold: 10 }).ok, true);
  botAnswerTrade(g, 'p1');
  assert.equal(g.props[i].owner, 'p1', 'refusé');
  assert.equal(g.proposeTrade('p0', { to: 'p1', getProps: [i], giveGold: 1000 }).ok, true);
  botAnswerTrade(g, 'p1');
  assert.equal(g.props[i].owner, 'p0', 'accepté');
});
