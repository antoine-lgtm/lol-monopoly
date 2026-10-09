'use strict';

/**
 * LoL Monopoly — profil des joueurs : Essence bleue (EB), expérience et niveau, collection
 * (pions, icônes, bannières) et boutique.
 *
 * L'Essence bleue se gagne en fin de partie selon la place ; elle achète des pions
 * (« champions », ~4 800 EB en moyenne), des icônes et des bannières.
 */

const { BUILTIN_PRESETS, sanitizeRules } = require('./features');

// Récompense de fin de partie, selon la place (1er, 2e, …) ; moitié contre des bots uniquement
const PLACE_REWARDS = [1000, 500, 300, 150, 150];
const VS_AI_FACTOR = 0.5;
// Expérience : le niveau monte toutes les 600 XP
const XP_WIN = 250;
const XP_GAME = 100;
const XP_PER_LEVEL = 600;

/** Pions : gratuits (assez pour un salon plein) ou à acheter. */
const PAWN_PRICES = {
  classic: 0,
  poro: 0,
  minion: 0,
  ward: 0,
  egg: 0,
  teemo: 3150,
  blade: 4800,
  zhonya: 4800,
  tibbers: 6300,
};

/** Icônes d'invocateur : les 10 premières sont offertes. */
const ICON_COUNT = 30;
const FREE_ICONS = 10;
const ICON_PRICE = 450;

/** Bannières : la couleur du cadre de ta place dans le salon. */
const BANNERS = {
  default: { name: 'Classique', price: 0 },
  hextech: { name: 'Hextech', price: 1350 },
  shurima: { name: 'Shurima', price: 1350 },
  noxus: { name: 'Noxus', price: 1350 },
  freljord: { name: 'Freljord', price: 1350 },
  targon: { name: 'Targon', price: 1350 },
  ionia: { name: 'Ionia', price: 1350 },
};

/** Préréglages de règles enregistrés par joueur. */
const MAX_PRESETS = 5;
const PRESET_NAME = /^[\p{L}\p{N} '’_.!-]{1,20}$/u;
/** Parties gardées dans l'historique du profil. */
const HISTORY_SIZE = 20;

/** Succès : calculés à partir des statistiques du profil. */
const ACHIEVEMENTS = [
  { id: 'first-game', name: 'Premiers pas', text: 'Jouer une partie', test: (s) => s.games >= 1 },
  { id: 'first-blood', name: 'Premier sang', text: 'Gagner une partie', test: (s) => s.wins >= 1 },
  { id: 'regular', name: 'Habitué de la Faille', text: 'Jouer 10 parties', test: (s) => s.games >= 10 },
  { id: 'pentakill', name: 'Pentakill', text: 'Gagner 5 parties', test: (s) => s.wins >= 5 },
  { id: 'veteran', name: 'Vétéran', text: 'Jouer 50 parties', test: (s) => s.games >= 50 },
  { id: 'legend', name: 'Légendaire', text: 'Gagner 20 parties', test: (s) => s.wins >= 20 },
  { id: 'baron-rent', name: 'Loyer du Baron', text: 'Toucher un loyer de 1 000 PO ou plus', test: (s) => s.bestRent >= 1000 },
  { id: 'tycoon', name: 'Magnat', text: 'Toucher 10 000 PO de loyers au total', test: (s) => s.rentEarned >= 10000 },
  { id: 'aram', name: 'Roi de l’Abîme', text: 'Gagner sur l’Abîme Hurlant', test: (s) => (s.boards.aram?.wins || 0) >= 1 },
  { id: 'duo', name: 'Duo de choc', text: 'Gagner une partie en 2 contre 2', test: (s) => s.teamWins >= 1 },
  { id: 'collector', name: 'Collectionneur', text: 'Jouer avec 5 pions différents', test: (s) => Object.keys(s.pawns).length >= 5 },
];

const CATALOG = {
  presets: BUILTIN_PRESETS,
  maxPresets: MAX_PRESETS,
  pawns: PAWN_PRICES,
  icons: { count: ICON_COUNT, free: FREE_ICONS, price: ICON_PRICE },
  banners: BANNERS,
  rewards: PLACE_REWARDS,
  vsAiFactor: VS_AI_FACTOR,
};

/** Complète un utilisateur (nouveau ou chargé d'une ancienne sauvegarde) avec ses champs de profil. */
function ensureProfile(user) {
  user.essence ??= 0;
  user.xp ??= 0;
  user.stats ||= { games: 0, wins: 0 };
  const st = user.stats;
  st.boards ||= {};
  st.pawns ||= {};
  st.history ||= [];
  st.bestRent ??= 0;
  st.rentEarned ??= 0;
  st.teamWins ??= 0;
  user.presets ||= [];
  user.folders ||= {};
  user.unread ||= {};
  user.collection ||= {};
  user.collection.pawns ||= [];
  user.collection.icons ||= [];
  user.collection.banners ||= [];
  user.banner ||= 'default';
  return user;
}

const ownsPawn = (user, pawn) => PAWN_PRICES[pawn] === 0 || Boolean(user.collection?.pawns.includes(pawn));
const ownsIcon = (user, icon) => icon < FREE_ICONS || Boolean(user.collection?.icons.includes(icon));
const ownsBanner = (user, banner) => BANNERS[banner]?.price === 0 || Boolean(user.collection?.banners.includes(banner));

const levelOf = (xp) => 1 + Math.floor(xp / XP_PER_LEVEL);

/** Ce que le client affiche : porte-monnaie, niveau, collection. */
function profileOf(user) {
  ensureProfile(user);
  const level = levelOf(user.xp);
  return {
    essence: user.essence,
    xp: user.xp,
    level,
    levelXp: user.xp - (level - 1) * XP_PER_LEVEL,
    levelSize: XP_PER_LEVEL,
    stats: { games: user.stats.games, wins: user.stats.wins },
    banner: user.banner,
    presets: user.presets,
    collection: {
      pawns: Object.keys(PAWN_PRICES).filter((p) => ownsPawn(user, p)),
      icons: Array.from({ length: ICON_COUNT }, (_, i) => i).filter((i) => ownsIcon(user, i)),
      banners: Object.keys(BANNERS).filter((b) => ownsBanner(user, b)),
    },
  };
}

/** Achat dans la boutique : { kind: 'pawn' | 'icon' | 'banner', id }. */
function buy(user, kind, id) {
  ensureProfile(user);
  let price;
  if (kind === 'pawn') {
    if (!(id in PAWN_PRICES)) return { ok: false, error: 'Pion inconnu.' };
    if (ownsPawn(user, id)) return { ok: false, error: 'Tu as déjà ce pion.' };
    price = PAWN_PRICES[id];
  } else if (kind === 'icon') {
    if (!Number.isInteger(id) || id < 0 || id >= ICON_COUNT) return { ok: false, error: 'Icône inconnue.' };
    if (ownsIcon(user, id)) return { ok: false, error: 'Tu as déjà cette icône.' };
    price = ICON_PRICE;
  } else if (kind === 'banner') {
    if (!BANNERS[id]) return { ok: false, error: 'Bannière inconnue.' };
    if (ownsBanner(user, id)) return { ok: false, error: 'Tu as déjà cette bannière.' };
    price = BANNERS[id].price;
  } else {
    return { ok: false, error: 'Article inconnu.' };
  }
  if (user.essence < price) return { ok: false, error: `Il te manque ${price - user.essence} Essence bleue.` };
  user.essence -= price;
  user.collection[`${kind}s`].push(id);
  return { ok: true, price };
}

/**
 * Récompenses de fin de partie pour un joueur humain.
 * @returns {{ essence: number, xp: number, levelUp: boolean }}
 */
function reward(user, { place, won, vsAi, board = 'rift', pawn = null, team = false, bestRent = 0, rentEarned = 0, rounds = 0, players = [] }) {
  ensureProfile(user);
  const base = PLACE_REWARDS[Math.max(0, (place || PLACE_REWARDS.length) - 1)] ?? PLACE_REWARDS[PLACE_REWARDS.length - 1];
  const essence = Math.round(base * (vsAi ? VS_AI_FACTOR : 1));
  const xp = won ? XP_WIN : XP_GAME;
  const before = levelOf(user.xp);
  user.essence += essence;
  user.xp += xp;
  const st = user.stats;
  st.games += 1;
  if (won) st.wins += 1;
  const b = (st.boards[board] ||= { games: 0, wins: 0 });
  b.games += 1;
  if (won) b.wins += 1;
  if (pawn) st.pawns[pawn] = (st.pawns[pawn] || 0) + 1;
  if (won && team) st.teamWins += 1;
  st.bestRent = Math.max(st.bestRent, bestRent || 0);
  st.rentEarned += rentEarned || 0;
  st.history.unshift({ date: Date.now(), board, place: place ?? null, won: Boolean(won), pawn, team: Boolean(team), rounds, vsAi: Boolean(vsAi), players });
  st.history.length = Math.min(st.history.length, HISTORY_SIZE);
  return { essence, xp, levelUp: levelOf(user.xp) > before, level: levelOf(user.xp) };
}

/** Pion le plus joué (null si aucune partie). */
function favouritePawn(stats) {
  const entries = Object.entries(stats.pawns || {});
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return { pawn: entries[0][0], games: entries[0][1] };
}

/** Profil détaillé affiché aux amis (et à soi) : statistiques, historique, succès. */
function profileCard(user) {
  ensureProfile(user);
  const s = user.stats;
  return {
    name: user.name,
    icon: user.icon,
    banner: user.banner,
    level: levelOf(user.xp),
    games: s.games,
    wins: s.wins,
    winRate: s.games ? Math.round((s.wins / s.games) * 100) : 0,
    boards: s.boards,
    favouritePawn: favouritePawn(s),
    bestRent: s.bestRent,
    rentEarned: s.rentEarned,
    history: s.history.slice(0, 10),
    achievements: ACHIEVEMENTS.map(({ id, name, text, test }) => ({ id, name, text, done: Boolean(test(s)) })),
  };
}

/** Enregistre (ou remplace, même nom) un préréglage de règles. */
function savePreset(user, name, rules) {
  ensureProfile(user);
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  if (!PRESET_NAME.test(clean)) return { ok: false, error: 'Nom du préréglage invalide (1 à 20 caractères).' };
  if (BUILTIN_PRESETS.some((p) => p.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: 'Ce nom est déjà pris par un préréglage tout fait.' };
  const preset = { name: clean, rules: sanitizeRules(rules || {}) };
  const index = user.presets.findIndex((p) => p.name.toLowerCase() === clean.toLowerCase());
  if (index !== -1) user.presets[index] = preset;
  else if (user.presets.length >= MAX_PRESETS) return { ok: false, error: `${MAX_PRESETS} préréglages maximum : supprimes-en un d’abord.` };
  else user.presets.push(preset);
  return { ok: true, preset };
}

function deletePreset(user, name) {
  ensureProfile(user);
  const before = user.presets.length;
  user.presets = user.presets.filter((p) => p.name !== name);
  return before === user.presets.length ? { ok: false, error: 'Préréglage introuvable.' } : { ok: true };
}

module.exports = {
  ACHIEVEMENTS, MAX_PRESETS, profileCard, favouritePawn, savePreset, deletePreset,
  CATALOG, PAWN_PRICES, BANNERS, ICON_COUNT, FREE_ICONS, ICON_PRICE, PLACE_REWARDS,
  ensureProfile, profileOf, ownsPawn, ownsIcon, ownsBanner, buy, reward, levelOf,
};
