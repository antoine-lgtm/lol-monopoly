/**
 * Tests du profil : Essence bleue, niveau, boutique et collection : `npm test`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Profile = require('../backend/profile');

const newUser = () => Profile.ensureProfile({ key: 'anto', name: 'anto' });

test('profil de départ : 0 EB, niveau 1, pions et icônes de base offerts', () => {
  const u = newUser();
  const p = Profile.profileOf(u);
  assert.equal(p.essence, 0);
  assert.equal(p.level, 1);
  assert.deepEqual(p.collection.pawns.sort(), ['classic', 'egg', 'minion', 'poro', 'ward']);
  assert.equal(p.collection.icons.length, Profile.FREE_ICONS);
  assert.deepEqual(p.collection.banners, ['default']);
});

test('récompenses : 1 000 EB pour le premier, moins pour les autres, moitié contre l’IA', () => {
  const u = newUser();
  assert.equal(Profile.reward(u, { place: 1, won: true, vsAi: false }).essence, 1000);
  assert.equal(Profile.reward(u, { place: 2, won: false, vsAi: false }).essence, 500);
  assert.equal(Profile.reward(u, { place: 1, won: true, vsAi: true }).essence, 500);
  assert.equal(Profile.reward(u, { place: 5, won: false, vsAi: false }).essence, 150);
  assert.equal(u.essence, 2150);
  assert.equal(u.stats.games, 4);
  assert.equal(u.stats.wins, 2);
  assert.ok(Profile.profileOf(u).level >= 2, 'le niveau monte avec l’expérience');
});

test('boutique : un pion coûte de l’Essence bleue (≈ 4 800 en moyenne) et rejoint la collection', () => {
  const paid = Object.values(Profile.PAWN_PRICES).filter((p) => p > 0);
  const avg = paid.reduce((a, b) => a + b, 0) / paid.length;
  assert.ok(avg > 4500 && avg < 5100, `prix moyen ${avg}`);
  const u = newUser();
  assert.equal(Profile.buy(u, 'pawn', 'zhonya').ok, false, 'pas assez d’EB');
  u.essence = 5500;
  assert.equal(Profile.buy(u, 'pawn', 'zhonya').ok, true);
  assert.equal(u.essence, 5500 - Profile.PAWN_PRICES.zhonya);
  assert.equal(Profile.ownsPawn(u, 'zhonya'), true);
  assert.equal(Profile.buy(u, 'pawn', 'zhonya').ok, false, 'déjà possédé');
  assert.equal(Profile.buy(u, 'icon', 3).ok, false, 'icône déjà offerte');
  assert.equal(Profile.buy(u, 'icon', 12).ok, true);
  assert.equal(Profile.ownsIcon(u, 12), true);
  assert.equal(Profile.buy(u, 'banner', 'noxus').ok, false, 'plus assez d’EB');
  assert.equal(Profile.buy(u, 'nope', 'x').ok, false);
});

test('profil détaillé : parties par plateau, pion préféré, plus gros loyer, historique et succès', () => {
  const u = newUser();
  Profile.reward(u, { place: 1, won: true, vsAi: false, board: 'aram', pawn: 'poro', bestRent: 1200, rentEarned: 3000, rounds: 18, players: ['Bob'] });
  Profile.reward(u, { place: 2, won: false, vsAi: false, board: 'rift', pawn: 'poro', bestRent: 400, rentEarned: 800, rounds: 30, players: ['Bob'] });
  Profile.reward(u, { place: 1, won: true, vsAi: true, board: 'rift', pawn: 'ward', team: true, rounds: 25 });
  const card = Profile.profileCard(u);
  assert.equal(card.games, 3);
  assert.equal(card.wins, 2);
  assert.equal(card.winRate, 67);
  assert.deepEqual(card.boards.aram, { games: 1, wins: 1 });
  assert.deepEqual(card.boards.rift, { games: 2, wins: 1 });
  assert.deepEqual(card.favouritePawn, { pawn: 'poro', games: 2 });
  assert.equal(card.bestRent, 1200);
  assert.equal(card.rentEarned, 3800);
  assert.equal(card.history.length, 3);
  assert.equal(card.history[0].pawn, 'ward', 'la plus récente en premier');
  const done = new Set(card.achievements.filter((a) => a.done).map((a) => a.id));
  for (const id of ['first-game', 'first-blood', 'baron-rent', 'aram', 'duo']) assert.ok(done.has(id), id);
  assert.ok(!done.has('pentakill'));
});

test('ancienne sauvegarde : le profil détaillé se complète sans rien perdre', () => {
  const u = Profile.ensureProfile({ key: 'old', name: 'old', stats: { games: 4, wins: 1 } });
  const card = Profile.profileCard(u);
  assert.equal(card.games, 4);
  assert.equal(card.favouritePawn, null);
  assert.deepEqual(card.history, []);
});

test('préréglages : 5 au maximum, remplacement par nom, noms tout faits réservés, règles nettoyées', () => {
  const u = newUser();
  for (let k = 1; k <= 5; k++) assert.equal(Profile.savePreset(u, `Soirée ${k}`, { board: 'aram' }).ok, true);
  assert.equal(Profile.savePreset(u, 'Sixième', {}).ok, false);
  const replaced = Profile.savePreset(u, 'soirée 1', { startGold: 2000, hack: true, turnTimer: 7 });
  assert.equal(replaced.ok, true);
  assert.equal(u.presets.length, 5);
  assert.equal(u.presets[0].rules.startGold, 2000);
  assert.equal(u.presets[0].rules.turnTimer, 60, 'valeur invalide remplacée par défaut');
  assert.equal('hack' in u.presets[0].rules, false);
  assert.equal(Profile.savePreset(u, 'Classique', {}).ok, false, 'nom réservé');
  assert.equal(Profile.savePreset(u, '', {}).ok, false);
  assert.equal(Profile.deletePreset(u, 'Soirée 2').ok, true);
  assert.equal(Profile.deletePreset(u, 'Soirée 2').ok, false);
  assert.equal(u.presets.length, 4);
  assert.deepEqual(Profile.CATALOG.presets.map((p) => p.name), ['Classique', 'ARAM rapide', 'Équipes 2v2']);
});
