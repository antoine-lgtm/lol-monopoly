/**
 * Tests des sorts d'invocateur, quêtes de rôle, objets, Âme du Dragon, Dragon Ancien,
 * Héraut et règles maison : `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, BOARD, MAX_LEVEL } = require('../backend/game');
const { SPELLS, ITEMS, QUESTS } = require('../backend/features');

function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUPP'];
function newGame({ n = 2, seed = 1, rules = {}, roles = [], spells = [] } = {}) {
  return new Game(
    Array.from({ length: n }, (_, i) => ({ key: `p${i}`, name: `Joueur ${i}`, icon: 0, role: roles[i], spells: spells[i] })),
    { random: seeded(seed), rules },
  );
}
const DRAGONS = BOARD.map((sq, i) => (sq.type === 'dragon' ? i : -1)).filter((i) => i >= 0);
const firstProperty = (group) => BOARD.findIndex((sq) => sq.group === group);

test('règles maison : or de départ et nouveautés désactivables', () => {
  const g = newGame({ rules: { startGold: 2000, spells: false, items: false, quests: false } });
  assert.equal(g.players[0].gold, 2000);
  assert.deepEqual(g.players[0].spells, []);
  assert.equal(g.players[0].quest, null);
  const h = newGame({ rules: { startGold: 999999, maxRounds: 7 } });
  assert.equal(h.rules.startGold, 1500, 'valeur invalide ignorée');
  assert.equal(h.rules.maxRounds, 0);
});

test('sorts par défaut : Flash et Soin ; deux sorts différents au choix', () => {
  const g = newGame({ spells: [['teleport', 'ignite'], ['flash', 'flash']] });
  assert.deepEqual(g.players[0].spells.map((sp) => sp.id), ['teleport', 'ignite']);
  assert.deepEqual(g.players[1].spells.map((sp) => sp.id), ['flash', 'heal']);
});

test('Soin : +100 Or puis recharge', () => {
  const g = newGame();
  const p = g.players[0];
  assert.equal(g.useSpell('p0', 'heal').ok, true);
  assert.equal(p.gold, 1600);
  const again = g.useSpell('p0', 'heal');
  assert.equal(again.ok, false);
  assert.match(again.error, /recharge/);
  assert.equal(p.spells[1].cd, SPELLS.heal.cd);
});

test('Flash : une case de plus au prochain lancer', () => {
  const g = newGame({ seed: 3 });
  assert.equal(g.useSpell('p0', 'flash', 1).ok, true);
  g.roll('p0');
  const [a, b] = g.dice;
  assert.equal(g.players[0].pos, a + b + 1);
});

test('Téléportation : va sur une de ses cases au lieu de lancer', () => {
  const g = newGame({ spells: [['teleport', 'heal']] });
  const target = firstProperty('jaune');
  g.props[target] = { owner: 'p0', level: 0, mortgaged: false };
  assert.equal(g.useSpell('p0', 'teleport', 5).ok, false, 'pas une de ses cases');
  assert.equal(g.useSpell('p0', 'teleport', target).ok, true);
  assert.equal(g.players[0].pos, target);
  assert.equal(g.phase, 'end');
  assert.equal(g.players[0].gold, 1500, 'pas de bonus de Fontaine');
});

test('Embrasement ×1,5 et Barrière −300 sur un loyer', () => {
  const g = newGame({ spells: [['ignite', 'heal'], ['barrier', 'heal']] });
  const i = firstProperty('bleu');
  g.props[i] = { owner: 'p0', level: 3, mortgaged: false };
  const base = g.rentFor(i);
  g.players[1].gold = 10000;
  g.players[0].armed.ignite = true;
  g.payRent(g.players[1], g.players[0], i);
  assert.equal(g.players[0].gold, 1500 + Math.round(base * 1.5));
  assert.equal(g.players[0].armed.ignite, false, 'consommé');
  g.players[1].armed.barrier = true;
  const before = g.players[1].gold;
  g.payRent(g.players[1], g.players[0], i);
  assert.equal(before - g.players[1].gold, Math.max(0, base - 300));
});

test('Fantôme : on peut relancer un dé avant de bouger', () => {
  const g = newGame({ spells: [['ghost', 'heal']] });
  g.useSpell('p0', 'ghost');
  g.roll('p0');
  assert.equal(g.phase, 'ghost');
  assert.equal(g.players[0].pos, 0, 'pas encore bougé');
  assert.equal(g.ghostChoice('p0', 1).ok, true);
  const [a, b] = g.dice;
  assert.equal(g.players[0].pos, (a + b) % 40);
});

test('Purge : sortie de Prison immédiate', () => {
  const g = newGame({ spells: [['cleanse', 'heal']] });
  g.sendToJail(g.players[0]);
  g.phase = 'roll';
  assert.equal(g.useSpell('p0', 'cleanse').ok, true);
  assert.equal(g.players[0].inJail, false);
});

test('objets : achat seulement après la Fontaine ou la Boutique, 3 au maximum, revente à moitié prix', () => {
  const g = newGame();
  const p = g.players[0];
  p.gold = 5000;
  assert.equal(g.buyItem('p0', 'doran').ok, false, 'pas à la Fontaine');
  g.passGo(p);
  for (const id of ['doran', 'potion', 'boots']) assert.equal(g.buyItem('p0', id).ok, true, id);
  assert.equal(g.buyItem('p0', 'nashor').ok, false, '3 objets au maximum');
  const gold = p.gold;
  assert.equal(g.sellItem('p0', 'boots').ok, true);
  assert.equal(p.gold, gold + ITEMS.boots.price / 2);
});

test('objets de fin de partie : plus chers que ceux du début', () => {
  const early = Object.values(ITEMS).filter((it) => it.tier === 'early').map((it) => it.price);
  const late = Object.values(ITEMS).filter((it) => it.tier === 'late').map((it) => it.price);
  assert.ok(Math.max(...early) < Math.min(...late));
});

test('Dent de Nashor +12 % et Cœur gelé −12 %', () => {
  const g = newGame();
  const i = firstProperty('rouge');
  g.props[i] = { owner: 'p0', level: 2, mortgaged: false };
  const base = g.rentFor(i);
  g.players[0].items.push({ id: 'nashor', cd: 0 });
  assert.equal(g.rentFor(i), Math.round(base * 1.12));
  g.players[1].items.push({ id: 'frozen', cd: 0 });
  const before = g.players[1].gold;
  g.payRent(g.players[1], g.players[0], i);
  assert.equal(before - g.players[1].gold, Math.round(Math.round(base * 1.12) * 0.88));
});

test('Voile de la banshee : annule une carte négative puis se recharge', () => {
  const g = newGame();
  const p = g.players[0];
  p.items.push({ id: 'banshee', cd: 0 });
  // on force la carte « va en Prison » du Coffre Hextech
  const deck = g.decks.chest;
  const jail = deck.order.findIndex((n) => n === 10); // 11ᵉ carte du Coffre : la Prison
  deck.next = jail;
  g.drawCard(p, 'chest');
  assert.equal(p.inJail, false);
  assert.equal(p.items[0].cd, ITEMS.banshee.cd);
});

test('Ange gardien : sauve une fois de la faillite', () => {
  const g = newGame({ n: 3 });
  const p = g.players[1];
  p.items.push({ id: 'angel', cd: 0 });
  p.gold = 20;
  g.charge(p, 500, g.players[2]);
  assert.equal(p.bankrupt, false);
  assert.equal(p.gold, 0);
  assert.equal(g.players[2].gold, 1500 + 20, 'le créancier ne garde que ce qui existait');
  assert.equal(p.items.length, 0);
  g.charge(p, 500, g.players[2]);
  assert.equal(p.bankrupt, true, 'une seule fois');
});

test('quêtes : chaque rôle a la sienne, récompense quand elle est finie', () => {
  const g = newGame({ n: 5, roles: ROLES });
  assert.deepEqual(g.players.map((p) => p.quest.id), ROLES);
  // Top : passages par la Fontaine
  const top = g.players[0];
  for (let k = 0; k < QUESTS.TOP.goal - 1; k++) g.passGo(top);
  assert.equal(top.quest.done, false);
  g.passGo(top);
  assert.equal(top.quest.done, true);
  assert.equal(top.perks.freeTp, 1);
  // Jungle : arrêts sur des camps (Dragons ou Potions)
  const jgl = g.players[1];
  for (let k = 0; k < QUESTS.JGL.alt; k++) { jgl.pos = DRAGONS[0]; g.land(jgl); g.pendingIndex = null; g.phase = 'roll'; }
  assert.equal(jgl.quest.done, true);
  // Mid : cases possédées, récompense = retour + constructions moins chères
  const mid = g.players[2];
  BOARD.forEach((sq, i) => { if (sq.type === 'property' && !g.props[i] && g.ownedBy(mid.key).length < QUESTS.MID.goal) g.props[i] = { owner: mid.key, level: 0, mortgaged: false }; });
  g.checkQuest(mid);
  assert.equal(mid.quest.done, true);
  assert.equal(g.buildCost(mid, 'bleu'), Math.round(200 * 0.9));
  // ADC : Or de loyers
  const adc = g.players[3];
  const i = firstProperty('bleu');
  g.props[i] = { owner: adc.key, level: 4, mortgaged: false };
  g.payRent(g.players[4], adc, i);
  assert.equal(adc.quest.done, true);
  assert.equal(adc.perks.adc, true);
  // Support : loyers payés
  const supp = g.players[4];
  supp.gold = 1e6;
  assert.equal(supp.quest.paid, 1);
  for (let k = 1; k < QUESTS.SUPP.alt; k++) g.payRent(supp, adc, i);
  assert.equal(supp.quest.done, true);
  assert.equal(supp.perks.cardShield, 1);
});

test('Âme du Dragon : 4 Dragons, +30 % pendant 5 tours', () => {
  const g = newGame();
  for (const i of DRAGONS.slice(0, 3)) g.props[i] = { owner: 'p0', level: 0, mortgaged: false };
  const last = DRAGONS[3];
  g.pendingIndex = last;
  g.phase = 'buy';
  g.buy('p0');
  assert.equal(g.soulTaken, 'p0');
  const base = 200; // 4 dragons : 25 × 2³
  assert.equal(g.rentFor(last), Math.round(base * 1.3));
  g.round += 5;
  assert.equal(g.rentFor(last), base, 'le bonus ne dure que 5 tours');
});

test('Héraut (tour 8) : détruit une construction adverse ; Dragon Ancien (tour 15)', () => {
  const g = newGame();
  g.baron.taken = true;
  while (g.round < 15) { g.phase = 'end'; g.endTurn(g.currentPlayer.key); }
  assert.equal(g.herald.active, true);
  assert.equal(g.elder.active, true);
  const p = g.currentPlayer;
  const foe = g.players.find((q) => q !== p);
  p.pos = 19;
  g.phase = 'roll';
  g.moveBy(p, 1); // case 20 : fosse du Baron
  assert.equal(p.herald, 1);
  const i = firstProperty('vert');
  g.props[i] = { owner: foe.key, level: 3, mortgaged: false };
  g.phase = 'end';
  assert.equal(g.useHerald(p.key, i).ok, true);
  assert.equal(g.props[i].level, 2);
  // Dragon Ancien : la première case Dragon atteinte
  p.pos = DRAGONS[0] - 1;
  g.moveBy(p, 1);
  assert.ok(p.elderUntil > g.round);
});

test('partie rapide : au bout de 20 tours, le plus riche gagne', () => {
  const g = newGame({ n: 3, rules: { maxRounds: 20 } });
  g.players[2].gold = 9000;
  while (g.phase !== 'over') { g.phase = 'end'; g.endTurn(g.currentPlayer.key); }
  assert.equal(g.winner, 'p2');
  assert.equal(g.stats.p2.place, 1);
});

test('300 parties au hasard avec sorts, objets, quêtes et Héraut : aucune incohérence', () => {
  const rnd = seeded(11);
  const spellIds = Object.keys(SPELLS);
  const itemIds = Object.keys(ITEMS);
  for (let n = 0; n < 300; n++) {
    const count = 2 + (n % 4);
    const g = new Game(Array.from({ length: count }, (_, i) => ({
      key: `p${i}`, name: `P${i}`, icon: 0, role: ROLES[(i + n) % 5],
      spells: [spellIds[(i + n) % 7], spellIds[(i + n + 3) % 7]],
    })), { random: rnd, rules: { maxRounds: n % 3 === 0 ? 20 : 0, fountainDouble: n % 2 === 0 } });
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 20000) {
      const p = g.currentPlayer;
      const k = p.key;
      if (rnd() < 0.02) g.forfeit(g.players[Math.floor(rnd() * count)].key);
      if (g.phase === 'over' || p.bankrupt) continue;
      if (rnd() < 0.2) {
        const sp = p.spells[Math.floor(rnd() * p.spells.length)];
        if (sp) g.useSpell(k, sp.id, sp.id === 'flash' ? (rnd() < 0.5 ? 1 : -1) : g.ownedBy(k)[0]);
      }
      if (p.canShop && rnd() < 0.5) g.buyItem(k, itemIds[Math.floor(rnd() * itemIds.length)]);
      if (rnd() < 0.05 && p.items.length) g.sellItem(k, p.items[0].id);
      if (rnd() < 0.1) g.useBoots(k);
      if (p.herald) {
        const target = Object.keys(g.props).map(Number).find((i) => g.props[i].owner !== k && g.props[i].level);
        if (target !== undefined) g.useHerald(k, target);
      }
      if (p.perks.freeRecall && rnd() < 0.3) g.usePerk(k, 'freeRecall');
      if (p.perks.freeTp && rnd() < 0.3) g.usePerk(k, 'freeTp', g.ownedBy(k)[0]);
      for (const i of g.ownedBy(k)) if (rnd() < 0.3) g.build(k, i);
      switch (g.phase) {
        case 'roll': if (p.inJail && rnd() < 0.3) g.payJail(k); g.roll(k); break;
        case 'ghost': g.ghostChoice(k, Math.floor(rnd() * 3) - 1); break;
        case 'buy': if (!(rnd() < 0.8 && g.buy(k).ok)) g.skipBuy(k); break;
        case 'tax': g.payTax(k, 'flat'); break;
        case 'debt': {
          const done = p.items.length ? g.sellItem(k, p.items[0].id).ok
            : g.ownedBy(k).some((i) => g.sell(k, i).ok || g.mortgage(k, i).ok);
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
        assert.ok(st.level >= 0);
      }
      assert.equal(towers + g.supply.towers, 32);
      assert.equal(inhibs + g.supply.inhibs, 12);
      for (const q of g.players) {
        assert.ok(q.items.length <= 3);
        assert.ok(q.spells.every((sp) => sp.cd >= 0));
        if (g.phase !== 'over' && !q.bankrupt && q.gold < 0) assert.ok(q === g.currentPlayer && g.phase === 'debt', 'or négatif hors dette');
      }
      assert.ok(JSON.stringify(g.serialize()));
    }
    assert.equal(g.phase, 'over', `partie ${n} sans fin`);
  }
});
