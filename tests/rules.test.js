/**
 * Tests des règles du jeu (backend/game.js), sans navigateur : `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, BOARD, GROUPS, START_GOLD, MAX_LEVEL } = require('../backend/game');

/** Générateur pseudo-aléatoire reproductible. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function newGame(n = 2, seed = 1) {
  return new Game(
    Array.from({ length: n }, (_, i) => ({ key: `p${i}`, name: `Joueur ${i}`, icon: 0 })),
    { random: seeded(seed) },
  );
}

/** Donne tout un groupe à un joueur. */
function giveGroup(game, key, group) {
  BOARD.forEach((sq, i) => {
    if (sq.group === group) game.props[i] = { owner: key, level: 0, mortgaged: false };
  });
  return BOARD.map((sq, i) => (sq.group === group ? i : -1)).filter((i) => i >= 0);
}

test('une partie commence avec l’or de départ, au tour du premier joueur', () => {
  const g = newGame(3);
  assert.equal(g.players.length, 3);
  assert.ok(g.players.every((p) => p.gold === START_GOLD && p.pos === 0));
  assert.equal(g.currentPlayer.key, 'p0');
  assert.equal(g.phase, 'roll');
});

test('construction équilibrée : on construit et on vend de façon égale dans un groupe', () => {
  const g = newGame();
  const [a, b] = giveGroup(g, 'p0', 'marron');
  assert.equal(g.build('p0', a).ok, true);
  const second = g.build('p0', a);
  assert.equal(second.ok, false, 'pas deux tours de suite sur la même case');
  assert.equal(g.build('p0', b).ok, true);
  assert.equal(g.build('p0', a).ok, true);
  assert.equal(g.sell('p0', b).ok, false, 'on vend d’abord sur la case la plus construite');
  assert.equal(g.sell('p0', a).ok, true);
});

test('il faut tout le groupe pour construire', () => {
  const g = newGame();
  const [a] = giveGroup(g, 'p0', 'marron');
  const other = BOARD.findIndex((sq, i) => sq.group === 'marron' && i !== a);
  g.props[other].owner = 'p1';
  assert.equal(g.build('p0', a).ok, false);
});

test('réserve de la banque : 32 tours et 12 inhibiteurs, et elle se vide', () => {
  const g = newGame();
  const [a, b] = giveGroup(g, 'p0', 'marron');
  g.players[0].gold = 1e6;
  assert.deepEqual(g.supply, { towers: 32, inhibs: 12 });
  g.supply.towers = 1;
  assert.equal(g.build('p0', a).ok, true);
  const blocked = g.build('p0', b);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /réserve/);
});

test('un inhibiteur rend ses 4 tours à la banque', () => {
  const g = newGame();
  const idx = giveGroup(g, 'p0', 'marron');
  g.players[0].gold = 1e6;
  for (let level = 0; level < MAX_LEVEL; level++) for (const i of idx) assert.equal(g.build('p0', i).ok, true);
  assert.equal(g.props[idx[0]].level, MAX_LEVEL);
  assert.deepEqual(g.supply, { towers: 32, inhibs: 12 - idx.length });
});

test('faillite : les cases retournent à la banque et le créancier ne garde que l’or disponible', () => {
  const g = newGame(3);
  const [, debtor, creditor] = g.players;
  const [a] = giveGroup(g, debtor.key, 'marron');
  g.props[a].level = 2;
  g.supply.towers -= 2;
  debtor.gold = 40;
  g.charge(debtor, 300, creditor); // ce n'est pas son tour : liquidation automatique
  assert.equal(debtor.bankrupt, true);
  assert.equal(g.props[a], undefined, 'les cases sont libres');
  assert.equal(g.supply.towers, 32, 'les tours retournent dans la réserve');
  // il avait 40 PO + la revente de ses tours et l'hypothèque de ses cases
  assert.ok(creditor.gold - START_GOLD < 300, 'le créancier ne touche pas la dette entière');
  assert.ok(creditor.gold - START_GOLD >= 40);
});

test('échange : proposé par le joueur dont c’est le tour, accepté par l’autre', () => {
  const g = newGame();
  const [mine] = giveGroup(g, 'p0', 'marron').slice(0, 1);
  const [theirs] = giveGroup(g, 'p1', 'gris');
  const res = g.proposeTrade('p0', { to: 'p1', giveProps: [mine], getProps: [theirs], giveGold: 100, getGold: 0 });
  assert.equal(res.ok, true);
  assert.equal(g.proposeTrade('p0', { to: 'p1', giveGold: 1 }).ok, false, 'un seul échange à la fois');
  assert.equal(g.respondTrade('p0', true).ok, false, 'seul le destinataire répond');
  assert.equal(g.respondTrade('p1', true).ok, true);
  assert.equal(g.props[mine].owner, 'p1');
  assert.equal(g.props[theirs].owner, 'p0');
  assert.equal(g.players[0].gold, START_GOLD - 100);
  assert.equal(g.players[1].gold, START_GOLD + 100);
  assert.equal(g.stats.p0.trades, 1);
});

test('échange refusé ou impossible', () => {
  const g = newGame();
  assert.equal(g.proposeTrade('p1', { to: 'p0', giveGold: 10 }).ok, false, 'pas pendant le tour d’un autre');
  assert.equal(g.proposeTrade('p0', { to: 'p1' }).ok, false, 'échange vide');
  assert.equal(g.proposeTrade('p0', { to: 'p1', giveGold: START_GOLD + 1 }).ok, false, 'pas assez d’or');
  const idx = giveGroup(g, 'p0', 'marron');
  g.props[idx[1]].level = 1;
  assert.equal(g.proposeTrade('p0', { to: 'p1', giveProps: [idx[0]] }).ok, false, 'groupe construit');
  assert.equal(g.proposeTrade('p0', { to: 'p1', giveGold: 50 }).ok, true);
  assert.equal(g.respondTrade('p1', false).ok, true);
  assert.equal(g.players[0].gold, START_GOLD);
  assert.equal(g.trade, null);
});

test('sauvegarde : une partie rechargée est identique et jouable', () => {
  const g = newGame(3, 7);
  for (let k = 0; k < 80 && g.phase !== 'over'; k++) {
    const p = g.currentPlayer;
    if (g.phase === 'roll') g.roll(p.key);
    else if (g.phase === 'buy') g.buy(p.key);
    else if (g.phase === 'tax') g.payTax(p.key, 'flat');
    else if (g.phase === 'debt') g.forfeit(p.key);
    else if (g.phase === 'end') g.endTurn(p.key);
  }
  const json = JSON.stringify(g);
  const copy = Game.fromJSON(JSON.parse(json));
  assert.equal(JSON.stringify(copy), json);
  assert.ok(copy.serialize().players.length === 3);
});

test('400 parties au hasard (échanges compris) se terminent sans incohérence', () => {
  const rnd = seeded(1);
  for (let n = 0; n < 400; n++) {
    const count = 2 + (n % 4);
    const g = new Game(Array.from({ length: count }, (_, i) => ({ key: `p${i}`, name: `P${i}`, icon: 0 })), { random: rnd });
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 20000) {
      const p = g.currentPlayer;
      const k = p.key;
      if (rnd() < 0.03) g.forfeit(g.players[Math.floor(rnd() * count)].key);
      for (const i of g.ownedBy(k)) {
        if (rnd() < 0.3) g.build(k, i);
        if (rnd() < 0.05) g.mortgage(k, i);
        if (rnd() < 0.05) g.unmortgage(k, i);
      }
      if (rnd() < 0.05) {
        const others = g.alivePlayers().filter((q) => q !== p);
        const o = others[Math.floor(rnd() * others.length)];
        if (o && g.proposeTrade(k, {
          to: o.key,
          giveProps: g.ownedBy(k).filter(() => rnd() < 0.3),
          getProps: g.ownedBy(o.key).filter(() => rnd() < 0.3),
          giveGold: Math.floor(rnd() * Math.max(0, p.gold) * 0.3),
        }).ok) g.respondTrade(o.key, rnd() < 0.6);
      }
      switch (g.phase) {
        case 'roll': g.roll(k); break;
        case 'buy': if (!(rnd() < 0.8 && g.buy(k).ok)) g.skipBuy(k); break;
        case 'tax': g.payTax(k, rnd() < 0.5 ? 'percent' : 'flat'); break;
        case 'debt': {
          const done = g.ownedBy(k).some((i) => g.sell(k, i).ok || g.mortgage(k, i).ok);
          if (!done) g.forfeit(k);
          break;
        }
        case 'end': g.endTurn(k); break;
        default: break;
      }
      let towers = 0;
      let inhibs = 0;
      for (const st of Object.values(g.props)) {
        if (st.level === MAX_LEVEL) inhibs += 1;
        else towers += st.level;
        assert.ok(!g.player(st.owner).bankrupt, 'une case appartient à un joueur éliminé');
      }
      assert.equal(towers + g.supply.towers, 32);
      assert.equal(inhibs + g.supply.inhibs, 12);
      for (const q of g.players) {
        if (g.phase !== 'over' && !q.bankrupt && q.gold < 0) {
          assert.ok(q === g.currentPlayer && g.phase === 'debt', 'or négatif hors dette');
        }
      }
    }
    assert.equal(g.phase, 'over', `partie ${n} sans fin`);
  }
});

test('les groupes du plateau ont tous un nom de région et un prix de tour', () => {
  for (const [id, group] of Object.entries(GROUPS)) {
    assert.ok(group.label, `groupe ${id} sans nom`);
    assert.ok(group.house > 0, `groupe ${id} sans prix de tour`);
  }
});
