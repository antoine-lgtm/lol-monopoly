'use strict';

/**
 * LoL Monopoly — profil des joueurs : Essence bleue (EB), expérience et niveau, collection
 * (pions, icônes, bannières) et boutique.
 *
 * L'Essence bleue se gagne en fin de partie selon la place ; elle achète des pions
 * (« champions », ~4 800 EB en moyenne), des icônes et des bannières.
 */

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

const CATALOG = {
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
    stats: user.stats,
    banner: user.banner,
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
function reward(user, { place, won, vsAi }) {
  ensureProfile(user);
  const base = PLACE_REWARDS[Math.max(0, (place || PLACE_REWARDS.length) - 1)] ?? PLACE_REWARDS[PLACE_REWARDS.length - 1];
  const essence = Math.round(base * (vsAi ? VS_AI_FACTOR : 1));
  const xp = won ? XP_WIN : XP_GAME;
  const before = levelOf(user.xp);
  user.essence += essence;
  user.xp += xp;
  user.stats.games += 1;
  if (won) user.stats.wins += 1;
  return { essence, xp, levelUp: levelOf(user.xp) > before, level: levelOf(user.xp) };
}

module.exports = {
  CATALOG, PAWN_PRICES, BANNERS, ICON_COUNT, FREE_ICONS, ICON_PRICE, PLACE_REWARDS,
  ensureProfile, profileOf, ownsPawn, ownsIcon, ownsBanner, buy, reward, levelOf,
};
