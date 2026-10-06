'use strict';

/**
 * LoL Monopoly — sorts d'invocateur, objets, quêtes de rôle et règles maison.
 * Les textes sont envoyés tels quels au client (infobulles, boutique, salon).
 * Les recharges (cd) se comptent en tours du joueur.
 */

const SPELLS = {
  flash: { name: 'Flash', cd: 5, text: 'Ton prochain déplacement fait 1 case de plus ou de moins (à choisir avant de lancer).' },
  teleport: { name: 'Téléportation', cd: 8, text: 'Au lieu de lancer les dés, va directement sur une de tes cases.' },
  heal: { name: 'Soin', cd: 6, text: '+100 Or.' },
  barrier: { name: 'Barrière', cd: 7, text: 'Le prochain loyer que tu dois payer est réduit de 300 Or.' },
  ignite: { name: 'Embrasement', cd: 7, text: 'Le prochain loyer que tu reçois est multiplié par 1,5.' },
  ghost: { name: 'Fantôme', cd: 6, text: 'À ton prochain lancer, tu peux relancer un des deux dés.' },
  cleanse: { name: 'Purge', cd: 5, text: 'Sors de Prison immédiatement, puis lance les dés.' },
};
const DEFAULT_SPELLS = ['flash', 'heal'];

/** early : objets abordables tôt ; late : objets chers pour la fin de partie. */
const ITEMS = {
  doran: { name: 'Anneau de Doran', price: 200, tier: 'early', text: '+10 Or au début de chacun de tes tours.' },
  potion: { name: 'Potion réutilisable', price: 250, tier: 'early', text: '+30 Or à chaque passage par la Fontaine.' },
  boots: { name: 'Bottes', price: 300, tier: 'early', cd: 3, text: '+1 case à ton prochain lancer (une fois tous les 3 tours).' },
  banshee: { name: 'Voile de la banshee', price: 550, tier: 'late', cd: 4, text: 'Annule la prochaine carte négative (puis 4 tours de recharge).' },
  nashor: { name: 'Dent de Nashor', price: 700, tier: 'late', text: '+12 % sur les loyers que tu reçois.' },
  frozen: { name: 'Cœur gelé', price: 800, tier: 'late', text: '−12 % sur les loyers que tu paies.' },
  angel: { name: 'Ange gardien', price: 1000, tier: 'late', text: 'Te sauve d’une faillite, une fois : tu repars avec 0 Or et tu gardes tes cases.' },
};
const MAX_ITEMS = 3;

/** Une quête par rôle (rôle choisi dans le salon). */
const QUESTS = {
  TOP: { name: 'Le duel', goal: 3, text: 'Passer 3 fois par la Fontaine', reward: 'Une téléportation gratuite vers une de tes cases + 50 Or' },
  JGL: { name: 'Le chasseur', goal: 2, text: 'Posséder 2 Dragons', reward: '+15 Or chaque fois que tu passes sur une case Dragon' },
  MID: { name: 'Maître de la voie', goal: 3, text: 'Construire 3 tours', reward: 'Un retour gratuit à la Fontaine qui rapporte 100 Or' },
  ADC: { name: 'La ferme', goal: 600, text: 'Toucher 600 Or de loyers', reward: '+5 % sur tes loyers' },
  SUPP: { name: 'Le gardien', goal: 2, text: 'Conclure 2 échanges ou payer 3 loyers', reward: '−5 % sur les loyers payés, et ta prochaine carte négative est annulée' },
};

const SOUL_BONUS = 0.3; // Âme du Dragon : +30 % sur les loyers reçus…
const ELDER_BONUS = 0.3; // … Dragon Ancien : +30 % aussi (cumulables)
const BUFF_ROUNDS = 5; // pendant 5 tours de table
const HERALD_ROUND = 8;
const ELDER_ROUND = 15;

/** Passif de chaque pion (règle « passives »). */
const PASSIVES = {
  poro: { name: 'Snax', text: '+20 Or à chaque passage par la Fontaine.' },
  teemo: { name: 'Champignon toxique', text: '+10 Or sur chaque loyer que tu reçois.' },
  ward: { name: 'Contrôle de vision', text: '+10 Or chaque fois que tu tires une carte (Ping SS ou Coffre).' },
  minion: { name: 'Vague de sbires', text: 'Tu ne payes que la moitié aux Sbires.' },
  zhonya: { name: 'Stase', text: 'Annule un loyer à payer (puis 10 tours de recharge).', cd: 10 },
  blade: { name: 'Coup critique', text: '10 % de chances qu’un loyer reçu soit multiplié par 1,5.' },
  tibbers: { name: 'Tibbers', text: 'Tes constructions coûtent 10 % de moins.' },
  egg: { name: 'Renaissance', text: 'Une fois par partie, survit à la faillite : tu repars avec 0 Or.' },
  classic: { name: 'Classique', text: '+100 Or au début de la partie.' },
};

/** Événements de la Faille : un tous les 4 tours de table, pendant 1 tour. */
const EVENTS = {
  rush: { name: 'Ruée des sbires', text: 'Passer par la Fontaine rapporte le double ce tour-ci.' },
  patch: { name: 'Nouveau patch', text: 'Tous les loyers +25 % ce tour-ci.' },
  fog: { name: 'Brouillard de guerre', text: 'Tous les loyers −25 % ce tour-ci.' },
  sale: { name: 'Soldes de la Boutique', text: 'Objets et constructions −25 % ce tour-ci.' },
  snowdown: { name: 'Snowdown', text: 'Cadeau de saison : chaque joueur reçoit 75 Or.' },
  bounty: { name: 'Prime de guerre', text: 'Le joueur le plus riche donne 40 Or à chacun des autres.' },
};
const EVENT_EVERY = 4;

/** Skins de pions, débloqués en jouant (parties jouées / victoires). */
const SKINS = {
  base: { name: 'Classique', games: 0, wins: 0 },
  hextech: { name: 'Hextech', games: 1, wins: 0 },
  shadow: { name: 'Obscur', games: 3, wins: 0 },
  gold: { name: 'Prestige', games: 0, wins: 1 },
  crystal: { name: 'Cristal', games: 0, wins: 3 },
  infernal: { name: 'Infernal', games: 10, wins: 0 },
};
const skinUnlocked = (id, stats = {}) => Boolean(SKINS[id]) && (stats.games || 0) >= SKINS[id].games && (stats.wins || 0) >= SKINS[id].wins;

const DEFAULT_RULES = {
  spells: true,
  quests: true,
  items: true,
  dragons: true, // Âme du Dragon et Dragon Ancien
  herald: true,
  passives: true, // pouvoir de chaque pion
  events: true, // événements de la Faille
  startGold: 1500,
  maxRounds: 0, // 0 = partie normale ; 20 = partie rapide (le plus riche gagne)
  turnTimer: 60, // secondes par tour (0 = pas de chrono)
  fountainDouble: false, // double gain en s'arrêtant pile sur la Fontaine
};

/** Règles maison reçues du salon : on ne garde que des valeurs valides. */
function sanitizeRules(raw = {}) {
  const rules = { ...DEFAULT_RULES };
  for (const key of ['spells', 'quests', 'items', 'dragons', 'herald', 'passives', 'events', 'fountainDouble']) {
    if (typeof raw[key] === 'boolean') rules[key] = raw[key];
  }
  if ([1000, 1500, 2000].includes(raw.startGold)) rules.startGold = raw.startGold;
  if ([0, 20].includes(raw.maxRounds)) rules.maxRounds = raw.maxRounds;
  if ([0, 30, 60, 90].includes(raw.turnTimer)) rules.turnTimer = raw.turnTimer;
  return rules;
}

/** Deux sorts différents parmi la liste, sinon les sorts par défaut. */
function sanitizeSpells(list) {
  const valid = Array.isArray(list) ? [...new Set(list)].filter((id) => SPELLS[id]) : [];
  return valid.length === 2 ? valid : [...DEFAULT_SPELLS];
}

module.exports = {
  SPELLS, DEFAULT_SPELLS, ITEMS, MAX_ITEMS, QUESTS, PASSIVES, EVENTS, EVENT_EVERY, SKINS, skinUnlocked,
  SOUL_BONUS, ELDER_BONUS, BUFF_ROUNDS, HERALD_ROUND, ELDER_ROUND,
  DEFAULT_RULES, sanitizeRules, sanitizeSpells,
};
