/**
 * Tests des parties rejouables (replays), du mode 2 contre 2, de la victoire à l'objectif
 * et de l'historique de richesse : `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, BOARD, OBJECTIVE_GROUPS } = require('../backend/game');
const { botStep, botAnswerTrade } = require('../backend/bot');

const members = (group) => BOARD.map((sq, i) => (sq.group === group ? i : -1)).filter((i) => i >= 0);
const players = (n, extra = () => ({})) => Array.from({ length: n }, (_, i) => ({ key: `p${i}`, name: `Joueur ${i}`, icon: 0, ...extra(i) }));

test('replay : une partie entre bots rejouée depuis son enregistrement arrive au même état', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const g = new Game(players(3, (i) => ({ bot: ['easy', 'normal', 'hard'][i], pawn: ['poro', 'zhonya', 'egg'][i], role: ['TOP', 'JGL', 'SUPP'][i] })), { seed: seed * 7919 });
    let steps = 0;
    while (g.phase !== 'over' && steps++ < 6000) {
      if (g.trade) botAnswerTrade(g, g.trade.to);
      else botStep(g, g.currentPlayer.key);
    }
    if (g.phase !== 'over') g.forfeit(g.currentPlayer.key);
    const frames = [];
    const copy = Game.replay(JSON.parse(JSON.stringify(g.record)), (state) => frames.push(state));
    assert.equal(frames.length, g.record.actions.length + 1);
    const strip = (x) => JSON.stringify({ ...x.toJSON(), record: null, recordDepth: 0 });
    assert.equal(strip(copy), strip(g), `partie ${seed} : état final différent`);
  }
});

test('replay : la sauvegarde garde la graine et le journal, la partie continue de s’enregistrer', () => {
  const g = new Game(players(2), { seed: 42 });
  g.roll('p0');
  const copy = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.equal(copy.record.actions.length, 1);
  assert.equal(copy.random(), g.random(), 'même suite de tirages après rechargement');
});

test('2 contre 2 : pas de loyer entre partenaires, groupe complété avec le partenaire, dons de PO', () => {
  const teams = ['blue', 'red', 'blue', 'red'];
  const g = new Game(players(4, (i) => ({ team: teams[i] })), { rules: { teams: true } });
  const [a, b, c] = g.players;
  assert.equal(a.team, 'blue');
  const [x, y] = members('marron');
  g.props[x] = { owner: a.key, level: 0, mortgaged: false };
  g.props[y] = { owner: c.key, level: 0, mortgaged: false };
  // c (partenaire de a) tombe chez a : pas de loyer
  c.pos = x - 1;
  g.current = 2;
  g.moveBy(c, 1);
  assert.equal(c.gold, 1500);
  // b (adversaire) paye un loyer doublé : le groupe est tenu par l'équipe
  b.pos = x - 1;
  g.current = 1;
  g.moveBy(b, 1);
  assert.equal(b.gold, 1500 - BOARD[x].rent[0] * 2);
  // a construit sur sa case grâce au groupe tenu avec c
  g.current = 0;
  g.phase = 'roll';
  assert.equal(g.build(a.key, x).ok, true);
  assert.equal(g.build(a.key, y).ok, false, 'pas sur la case du partenaire');
  // dons
  assert.equal(g.giveGold(a.key, c.key, 100).ok, true);
  assert.equal(c.gold, 1600);
  assert.equal(g.giveGold(a.key, b.key, 10).ok, false, 'pas aux adversaires');
});

test('2 contre 2 : l’équipe gagne quand les deux adversaires sont éliminés', () => {
  const g = new Game(players(4, (i) => ({ team: i % 2 ? 'red' : 'blue' })), { rules: { teams: true } });
  g.forfeit('p1');
  assert.notEqual(g.phase, 'over');
  g.forfeit('p3');
  assert.equal(g.phase, 'over');
  assert.equal(g.winnerTeam, 'blue');
  assert.ok(['p0', 'p2'].includes(g.winner));
});

test('victoire à l’objectif : 3 groupes complets et sans hypothèque', () => {
  const g = new Game(players(2), { rules: { objective: true } });
  const give = (group) => members(group).forEach((i) => { g.props[i] = { owner: 'p0', level: 0, mortgaged: false }; });
  give('marron');
  give('gris');
  const rose = members('rose');
  rose.slice(0, -1).forEach((i) => { g.props[i] = { owner: 'p0', level: 0, mortgaged: false }; });
  g.pendingIndex = rose[rose.length - 1];
  g.phase = 'buy';
  assert.equal(g.buy('p0').ok, true);
  assert.equal(OBJECTIVE_GROUPS, 3);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p0');
  const h = new Game(players(2));
  assert.equal(h.rules.objective, false, 'variante désactivée par défaut');
});

test('historique : la valeur de chaque joueur est notée à chaque tour de table', () => {
  const g = new Game(players(2), { seed: 3 });
  assert.equal(g.history.length, 1);
  for (let k = 0; k < 40 && g.round < 4; k++) {
    if (g.phase === 'roll') g.roll(g.currentPlayer.key);
    else if (g.phase === 'buy') g.skipBuy(g.currentPlayer.key);
    else if (g.phase === 'tax') g.payTax(g.currentPlayer.key, 'flat');
    else if (g.phase === 'ghost') g.ghostChoice(g.currentPlayer.key, -1);
    else if (g.phase === 'debt') g.autoStep();
    else g.endTurn(g.currentPlayer.key);
  }
  assert.ok(g.history.length >= 3);
  assert.deepEqual(Object.keys(g.history[0].worth), ['p0', 'p1']);
  assert.ok(g.serialize().history.length === g.history.length);
});

test('Abîme Hurlant : plateau de 28 cases, déplacements, Prison, cartes et parties entre bots', () => {
  const g = new Game(players(2), { rules: { board: 'aram' }, seed: 5 });
  assert.equal(g.size, 28);
  assert.equal(g.board.length, 28);
  assert.equal(g.serialize().boardId, 'aram');
  assert.equal(g.board[g.layout.jail].type, 'jail');
  assert.equal(g.layout.jail, 7);
  assert.deepEqual(g.dragons, [5, 19]);
  // un tour complet : passage par la Fontaine sur 28 cases
  const p = g.players[0];
  p.pos = 26;
  g.moveBy(p, 3);
  assert.equal(p.pos, 1);
  assert.ok(p.gold >= 1700, 'bonus de la Fontaine');
  // Grab de Blitzcrank (case 21) -> Prison (case 7)
  p.pos = 20;
  g.moveBy(p, 1);
  assert.equal(p.pos, 7);
  assert.equal(p.inJail, true);
  // les cartes visent des cases de ce plateau
  assert.equal(g.board[g.layout.targets.far].name, 'Veigar');
  // groupes : la construction marche avec les groupes ARAM
  const glacier = g.members('glacier');
  assert.equal(glacier.length, 2);
  glacier.forEach((i) => { g.props[i] = { owner: 'p1', level: 0, mortgaged: false }; });
  g.current = 1;
  g.phase = 'roll';
  assert.equal(g.build('p1', glacier[0]).ok, true);
  // la Faille reste le plateau par défaut
  assert.equal(new Game(players(2)).size, 40);
});

test('Abîme Hurlant : 40 parties entre bots se terminent, et le replay reste identique', () => {
  for (let n = 0; n < 40; n++) {
    const g = new Game(players(3, (i) => ({ bot: ['easy', 'normal', 'hard'][i], pawn: ['poro', 'egg', 'ward'][i] })), { rules: { board: 'aram' }, seed: 100 + n });
    let steps = 0;
    let forced = false;
    while (g.phase !== 'over' && steps++ < 40000) {
      if (g.round > 150) {
        g.endByRounds(); // arrêt forcé par le test : pas une action de la partie, donc pas dans le replay
        forced = true;
        break;
      }
      if (g.trade) botAnswerTrade(g, g.trade.to);
      else assert.equal(botStep(g, g.currentPlayer.key).ok, true, `bot bloqué en ${g.phase}`);
      for (const q of g.players) assert.ok(q.pos >= 0 && q.pos < 28);
    }
    assert.equal(g.phase, 'over');
    if (n < 6 && !forced) {
      const copy = Game.replay(JSON.parse(JSON.stringify(g.record)), () => {});
      assert.equal(JSON.stringify({ ...copy.toJSON(), record: null }), JSON.stringify({ ...g.toJSON(), record: null }));
    }
  }
});
