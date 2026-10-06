/**
 * Mesure l'équilibre des rôles (quêtes) et des pions : parties entre bots, rôles et pions tirés au hasard.
 *   npm run balance            (2 000 parties, 4 joueurs, bots Difficile)
 *   node tools/balance.js 10000 4 hard
 * Indice = victoires / victoires attendues (1,00 = équilibré). Partie arrêtée au tour 100 : le plus riche gagne.
 */
const { Game } = require('../backend/game');
const { botStep, botAnswerTrade } = require('../backend/bot');

const [N = 2000, PLAYERS = 4, LEVEL = 'hard', SEED = 1] = process.argv.slice(2).map((v, i) => (i === 2 ? v : Number(v)));
const CAP = 100;
const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUPP'];
const PAWNS = ['poro', 'teemo', 'ward', 'minion', 'zhonya', 'blade', 'tibbers', 'egg', 'classic'];
let s = SEED;
const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

const stats = { role: {}, pawn: {}, quest: {} };
const add = (map, key, win) => {
  map[key] ||= { n: 0, w: 0 };
  map[key].n += 1;
  map[key].w += win;
};
let bankrupt = 0;
for (let n = 0; n < N; n++) {
  const roles = shuffle(ROLES).slice(0, PLAYERS);
  const pawns = shuffle(PAWNS).slice(0, PLAYERS);
  const g = new Game(roles.map((role, i) => ({ key: `b${i}`, name: `Bot ${i}`, icon: 0, bot: LEVEL, pawn: pawns[i], role })), { random: rnd });
  const doneAt = {};
  while (g.phase !== 'over') {
    if (g.round > CAP) {
      g.endByRounds();
      break;
    }
    if (g.trade) botAnswerTrade(g, g.trade.to);
    else botStep(g, g.currentPlayer.key);
    for (const p of g.players) if (p.quest?.done && !doneAt[p.key]) doneAt[p.key] = g.round;
  }
  if (g.round <= CAP) bankrupt += 1;
  for (const p of g.players) {
    const win = p.key === g.winner ? 1 : 0;
    add(stats.role, p.role, win);
    add(stats.pawn, p.pawn, win);
    stats.quest[p.role] ||= { n: 0, done: 0, round: 0 };
    stats.quest[p.role].n += 1;
    if (doneAt[p.key]) {
      stats.quest[p.role].done += 1;
      stats.quest[p.role].round += doneAt[p.key];
    }
  }
}

console.log(`${N} parties, ${PLAYERS} joueurs (bots ${LEVEL}), ${Math.round((100 * bankrupt) / N)} % finies par faillite`);
const show = (title, map) => {
  console.log(`\n${title} — indice (1,00 = équilibré)`);
  for (const [key, v] of Object.entries(map).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n)) {
    const margin = Math.sqrt((1 / PLAYERS) * (1 - 1 / PLAYERS) / v.n) * PLAYERS * 2;
    console.log(`  ${key.padEnd(8)} ${((v.w / v.n) * PLAYERS).toFixed(2)} ±${margin.toFixed(2)}`);
  }
};
show('Rôles', stats.role);
show('Pions', stats.pawn);
console.log('\nQuêtes : réussite, tour moyen');
for (const [role, q] of Object.entries(stats.quest)) {
  console.log(`  ${role.padEnd(5)} ${Math.round((100 * q.done) / q.n)} %  tour ${(q.round / Math.max(1, q.done)).toFixed(1)}`);
}
