'use strict';

/**
 * LoL Monopoly — sorts d'invocateur, objets, quêtes de rôle et règles maison.
 * Les textes sont envoyés tels quels au client (infobulles, boutique, salon).
 * Les recharges (cd) se comptent en tours du joueur.
 */

const SPELLS = {
  flash: { name: 'Flash', cd: 5, text: 'Ton prochain déplacement fait 1 case de plus ou de moins (à choisir avant de lancer).' },
  teleport: { name: 'Téléportation', cd: 8, text: 'Au lieu de lancer les dés, va directement sur une de tes cases.' },
  heal: { name: 'Soin', cd: 6, text: '+100 PO.' },
  barrier: { name: 'Barrière', cd: 7, text: 'Le prochain loyer que tu dois payer est réduit de 300 PO.' },
  ignite: { name: 'Embrasement', cd: 7, text: 'Le prochain loyer que tu reçois est multiplié par 1,5.' },
  ghost: { name: 'Fantôme', cd: 6, text: 'À ton prochain lancer, tu peux relancer un des deux dés.' },
  cleanse: { name: 'Purge', cd: 5, text: 'Sors de Prison immédiatement, puis lance les dés.' },
};
const DEFAULT_SPELLS = ['flash', 'heal'];

/** early : objets abordables tôt ; late : objets chers pour la fin de partie. */
const ITEMS = {
  doran: { name: 'Anneau de Doran', price: 200, tier: 'early', text: '+10 PO au début de chacun de tes tours.' },
  potion: { name: 'Potion réutilisable', price: 250, tier: 'early', text: '+30 PO à chaque passage par la Fontaine.' },
  boots: { name: 'Bottes', price: 300, tier: 'early', cd: 3, text: '+1 case à ton prochain lancer (une fois tous les 3 tours).' },
  banshee: { name: 'Voile de la banshee', price: 550, tier: 'late', cd: 4, text: 'Annule la prochaine carte négative (puis 4 tours de recharge).' },
  nashor: { name: 'Dent de Nashor', price: 700, tier: 'late', text: '+12 % sur les loyers que tu reçois.' },
  frozen: { name: 'Cœur gelé', price: 800, tier: 'late', text: '−12 % sur les loyers que tu paies.' },
  angel: { name: 'Ange gardien', price: 1000, tier: 'late', text: 'Te sauve d’une faillite, une fois : tu repars avec 0 PO et tu gardes tes cases.' },
};
const MAX_ITEMS = 3;

/** Une quête par rôle (rôle choisi dans le salon). Valeurs réglées par simulation (bots). */
const QUEST_VALUES = {
  TOP: { goal: 4 }, // passages par la Fontaine
  JGL: { goal: 2, alt: 5, types: ['dragon', 'potion'] }, // camps possédés, ou arrêts sur un camp
  MID: { goal: 6 }, // cases possédées (contrôle de la voie)
  ADC: { goal: 350 }, // PO de loyers touchées
  SUPP: { goal: 3, alt: 7 }, // échanges conclus, ou loyers payés
};
const RECALL_GOLD = 200;
const MID_BUILD_DISCOUNT = 0.1; // récompense Mid : constructions moins chères // récompense Mid : retour à la Fontaine
const JUNGLE_GOLD = 3;
const TOP_GOLD = 100; // récompense Top (avec la téléportation gratuite)
const ADC_BONUS = 0.05; // récompense ADC : bonus sur les loyers reçus
const SUPPORT_CUT = 0.04; // récompense Support : réduction des loyers payés // récompense Jungle, par case Dragon traversée
const QUESTS = {
  TOP: { name: 'Le duel', goal: QUEST_VALUES.TOP.goal, text: `Passer ${QUEST_VALUES.TOP.goal} fois par la Fontaine`, reward: `Une téléportation gratuite vers une de tes cases + ${TOP_GOLD} PO` },
  JGL: { name: 'Le chasseur', ...QUEST_VALUES.JGL, text: `Posséder ${QUEST_VALUES.JGL.goal} camps (Dragons ou Potions) ou s’arrêter ${QUEST_VALUES.JGL.alt} fois sur un camp`, reward: `+${JUNGLE_GOLD} PO chaque fois que tu passes sur une case Dragon` },
  MID: { name: 'Maître de la voie', goal: QUEST_VALUES.MID.goal, text: `Posséder ${QUEST_VALUES.MID.goal} cases`, reward: `Un retour gratuit à la Fontaine (+${RECALL_GOLD} PO) et tes constructions coûtent ${Math.round(MID_BUILD_DISCOUNT * 100)} % de moins` },
  ADC: { name: 'La ferme', goal: QUEST_VALUES.ADC.goal, text: `Toucher ${QUEST_VALUES.ADC.goal} PO de loyers`, reward: `+${Math.round(ADC_BONUS * 100)} % sur tes loyers` },
  SUPP: { name: 'Le gardien', ...QUEST_VALUES.SUPP, text: `Conclure ${QUEST_VALUES.SUPP.goal} échanges ou payer ${QUEST_VALUES.SUPP.alt} loyers`, reward: `−${Math.round(SUPPORT_CUT * 100)} % sur les loyers payés, et ta prochaine carte négative est annulée` },
};

const SOUL_BONUS = 0.3; // Âme du Dragon : +30 % sur les loyers reçus…
const ELDER_BONUS = 0.3; // … Dragon Ancien : +30 % aussi (cumulables)
const BUFF_ROUNDS = 5; // pendant 5 tours de table
const HERALD_ROUND = 8;
const ELDER_ROUND = 15;

/** Passif de chaque pion (règle « passives »). Valeurs réglées par simulation (bots). */
const PASSIVE_VALUES = {
  poro: { gold: 14 },
  teemo: { gold: 4 },
  ward: { gold: 15 },
  minion: { share: 0.4 },
  zhonya: { cd: 35 },
  blade: { chance: 0.14, mult: 1.5 },
  tibbers: { discount: 0.12 },
  egg: { gold: 500, start: 175 },
  classic: { start: 250 },
};
const pct = (x) => `${Math.round(x * 100)} %`;
const V = PASSIVE_VALUES;
const PASSIVES = {
  poro: { name: 'Snax', ...V.poro, text: `+${V.poro.gold} PO à chaque passage par la Fontaine.` },
  teemo: { name: 'Champignon toxique', ...V.teemo, text: `+${V.teemo.gold} PO sur chaque loyer que tu reçois.` },
  ward: { name: 'Contrôle de vision', ...V.ward, text: `+${V.ward.gold} PO chaque fois que tu tires une carte (Ping SS ou Coffre).` },
  minion: { name: 'Vague de sbires', ...V.minion, text: V.minion.share === 0.5 ? 'Tu ne payes que la moitié aux Sbires.' : `Tu ne payes que ${pct(V.minion.share)} aux Sbires.` },
  zhonya: { name: 'Stase', ...V.zhonya, text: `Annule un loyer à payer (puis ${V.zhonya.cd} tours de recharge).` },
  blade: { name: 'Coup critique', ...V.blade, text: `${pct(V.blade.chance)} de chances qu’un loyer reçu soit multiplié par ${String(V.blade.mult).replace('.', ',')}.` },
  tibbers: { name: 'Tibbers', ...V.tibbers, text: `Tes constructions coûtent ${pct(V.tibbers.discount)} de moins.` },
  egg: { name: 'Renaissance', ...V.egg, text: `+${V.egg.start} PO au départ ; une fois par partie, survit à la faillite et repart avec ${V.egg.gold} PO.` },
  classic: { name: 'Classique', ...V.classic, text: `+${V.classic.start} PO au début de la partie.` },
};

/** Événements de la Faille : un tous les 4 tours de table, pendant 1 tour. */
const EVENTS = {
  rush: { name: 'Ruée des sbires', text: 'Passer par la Fontaine rapporte le double ce tour-ci.' },
  patch: { name: 'Nouveau patch', text: 'Tous les loyers +25 % ce tour-ci.' },
  fog: { name: 'Brouillard de guerre', text: 'Tous les loyers −25 % ce tour-ci.' },
  sale: { name: 'Soldes de la Boutique', text: 'Objets et constructions −25 % ce tour-ci.' },
  snowdown: { name: 'Snowdown', text: 'Cadeau de saison : chaque joueur reçoit 75 PO.' },
  bounty: { name: 'Prime de guerre', text: 'Le joueur le plus riche donne 40 PO à chacun des autres.' },
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
  board: 'rift', // plateau : rift (Faille, 40 cases) ou aram (Abîme Hurlant, 28 cases)
  teams: false, // 2 contre 2 (4 joueurs)
  objective: false, // victoire immédiate avec 3 groupes complets
  startGold: 1500,
  maxRounds: 0, // 0 = partie normale ; 20 = partie rapide (le plus riche gagne)
  turnTimer: 60, // secondes par tour (0 = pas de chrono)
  fountainDouble: false, // double gain en s'arrêtant pile sur la Fontaine
};

/** Règles maison reçues du salon : on ne garde que des valeurs valides. */
function sanitizeRules(raw = {}) {
  const rules = { ...DEFAULT_RULES };
  for (const key of ['spells', 'quests', 'items', 'dragons', 'herald', 'passives', 'events', 'teams', 'objective', 'fountainDouble']) {
    if (typeof raw[key] === 'boolean') rules[key] = raw[key];
  }
  if ([1000, 1500, 2000].includes(raw.startGold)) rules.startGold = raw.startGold;
  if ([0, 20].includes(raw.maxRounds)) rules.maxRounds = raw.maxRounds;
  if ([0, 30, 60, 90].includes(raw.turnTimer)) rules.turnTimer = raw.turnTimer;
  if (raw.board === 'rift' || raw.board === 'aram') rules.board = raw.board;
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
  JUNGLE_GOLD, RECALL_GOLD, TOP_GOLD, ADC_BONUS, SUPPORT_CUT, MID_BUILD_DISCOUNT, DEFAULT_RULES, sanitizeRules, sanitizeSpells,
};
