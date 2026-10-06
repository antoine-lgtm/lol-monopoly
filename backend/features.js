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

const DEFAULT_RULES = {
  spells: true,
  quests: true,
  items: true,
  dragons: true, // Âme du Dragon et Dragon Ancien
  herald: true,
  startGold: 1500,
  maxRounds: 0, // 0 = partie normale ; 20 = partie rapide (le plus riche gagne)
  fountainDouble: false, // double gain en s'arrêtant pile sur la Fontaine
};

/** Règles maison reçues du salon : on ne garde que des valeurs valides. */
function sanitizeRules(raw = {}) {
  const rules = { ...DEFAULT_RULES };
  for (const key of ['spells', 'quests', 'items', 'dragons', 'herald', 'fountainDouble']) {
    if (typeof raw[key] === 'boolean') rules[key] = raw[key];
  }
  if ([1000, 1500, 2000].includes(raw.startGold)) rules.startGold = raw.startGold;
  if ([0, 20].includes(raw.maxRounds)) rules.maxRounds = raw.maxRounds;
  return rules;
}

/** Deux sorts différents parmi la liste, sinon les sorts par défaut. */
function sanitizeSpells(list) {
  const valid = Array.isArray(list) ? [...new Set(list)].filter((id) => SPELLS[id]) : [];
  return valid.length === 2 ? valid : [...DEFAULT_SPELLS];
}

module.exports = {
  SPELLS, DEFAULT_SPELLS, ITEMS, MAX_ITEMS, QUESTS,
  SOUL_BONUS, ELDER_BONUS, BUFF_ROUNDS, HERALD_ROUND, ELDER_ROUND,
  DEFAULT_RULES, sanitizeRules, sanitizeSpells,
};
