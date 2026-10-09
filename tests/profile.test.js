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
