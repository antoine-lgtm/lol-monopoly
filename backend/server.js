'use strict';

/**
 * LoL Monopoly — serveur principal
 * Express (fichiers statiques) + Socket.io (présences, amis, lobbies, chat).
 *
 * L'état est gardé en mémoire : c'est un jeu privé entre amis, un redémarrage
 * du serveur remet tout à zéro. La logique du plateau est dans game.js :
 * une partie est créée sur `lobby:start` et vit dans `lobby.game`.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { Game } = require('./game');
const { LEVELS: BOT_LEVELS, botStep, botAnswerTrade } = require('./bot');
const {
  SPELLS, ITEMS, QUESTS, PASSIVES, EVENTS, SKINS, skinUnlocked, DEFAULT_SPELLS, DEFAULT_RULES, sanitizeRules, sanitizeSpells,
} = require('./features');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT) || 3000;
const MAX_PLAYERS = 5;
const MIN_PLAYERS_TO_START = Number(process.env.MIN_PLAYERS) || 2;
const ROLES = ['TOP', 'JGL', 'MID', 'ADC', 'SUPP'];
// Pions du plateau (images dans frontend/assets/pawns/) : un pion différent par joueur
const PAWNS = ['poro', 'teemo', 'ward', 'minion', 'zhonya', 'blade', 'tibbers', 'egg', 'classic'];
const ICON_COUNT = 30; // icônes d'invocateur disponibles côté client (0..29)
const CHAT_MAX_LENGTH = 300;
const CHAT_HISTORY_SIZE = 50;
const CHAT_RATE_LIMIT = { max: 5, windowMs: 3000 };
const RECONNECT_GRACE_MS = 30_000; // rafraîchir la page ne fait pas quitter le lobby
const INVITE_TTL_MS = 60_000;
const AUTOPLAY_DELAY_MS = 15_000; // un joueur déconnecté joue automatiquement après ce délai
const TIMEOUT_STEP_MS = 900; // chrono écoulé : le jeu joue une action toutes les 0,9 s
const BOT_STEP_MS = Number(process.env.BOT_STEP_MS) || 1100; // rythme des bots
const BOT_NAMES = ['Garen', 'Annie', 'Ashe', 'Malphite', 'Ryze', 'Sona', 'Nunu', 'Lux', 'Darius', 'Jinx', 'Thresh', 'Ezreal'];
// Emotes et pings envoyés pendant la partie
const EMOTES = ['gg', 'wp', 'lol', 'question', 'angry', 'cry', 'thumb', 'heart', 'mastery', 'poro'];
const PINGS = ['ping', 'danger', 'omw', 'question'];
const EMOTE_COOLDOWN_MS = 1_200;

const NAME_PATTERN = /^[\p{L}\p{N} _.-]{3,16}$/u;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ---------------------------------------------------------------------------
// Serveur HTTP + Socket.io
// ---------------------------------------------------------------------------

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

// Liste des images officielles déposées dans frontend/assets/board/real/ (dragons, Baron, Prison…)
const REAL_ART_DIR = path.join(__dirname, '..', 'frontend', 'assets', 'board', 'real');
app.get('/board-art.json', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(REAL_ART_DIR).filter((f) => /\.(png|webp|jpe?g|svg)$/i.test(f));
  } catch { /* dossier absent */ }
  res.set('Cache-Control', 'no-cache').json(files);
});
// Modèles 3D des pions déposés dans frontend/assets/pawns/models/ (poro.glb…)
const PAWN_MODELS_DIR = path.join(__dirname, '..', 'frontend', 'assets', 'pawns', 'models');
app.get('/pawn-models.json', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(PAWN_MODELS_DIR).filter((f) => /\.(glb|gltf)$/i.test(f));
  } catch { /* dossier absent */ }
  res.set('Cache-Control', 'no-cache').json(files);
});
// Répliques des champions déposées dans frontend/assets/voices/ (yasuo.mp3, yasuo-2.ogg…)
const VOICES_DIR = path.join(__dirname, '..', 'frontend', 'assets', 'voices');
app.get('/voices.json', (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(VOICES_DIR).filter((f) => /\.(mp3|ogg|wav|m4a|webm)$/i.test(f));
  } catch { /* dossier absent */ }
  res.set('Cache-Control', 'no-cache').json(files);
});
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// Three.js (plateau 3D) servi depuis node_modules : pas besoin d'Internet pour jouer
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));
app.use('/vendor/three-addons', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm')));
app.get('/health', (_req, res) => res.json({ ok: true, users: users.size, lobbies: lobbies.size }));

// ---------------------------------------------------------------------------
// État en mémoire
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} User
 * @property {string} key          pseudo en minuscules (identifiant unique)
 * @property {string} name         pseudo affiché
 * @property {number} icon         index de l'icône d'invocateur
 * @property {string|null} socketId
 * @property {string|null} lobbyId
 * @property {Set<string>} friends
 * @property {Set<string>} incomingRequests  demandes d'ami reçues
 * @property {NodeJS.Timeout|null} disconnectTimer
 * @property {number[]} chatTimestamps
 */

/** @type {Map<string, User>} */
const users = new Map();

/**
 * @typedef {Object} Lobby
 * @property {string} id
 * @property {string} code         code à partager pour "Rejoindre un lobby"
 * @property {string} ownerKey
 * @property {'lobby'|'in-game'} status
 * @property {Array<{key: string, role: string|null, pawn: string}|null>} slots
 * @property {Map<string, {slot: number, from: string, expiresAt: number}>} invites
 * @property {Array<Object>} chat
 * @property {Game|null} game
 */

/** @type {Map<string, Lobby>} */
const lobbies = new Map();
/** @type {Map<string, string>} code -> lobbyId */
const lobbyCodes = new Map();

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

const keyOf = (name) => String(name || '').trim().toLowerCase();
const userRoom = (key) => `user:${key}`;
const lobbyRoom = (id) => `lobby:${id}`;

function generateCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  } while (lobbyCodes.has(code));
  return code;
}

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function fail(ack, error) {
  reply(ack, { ok: false, error });
}

function notify(key, level, message) {
  io.to(userRoom(key)).emit('notify', { level, message });
}

const isBot = (key) => Boolean(users.get(key)?.bot);

function presenceOf(user) {
  if (!user.socketId) return { status: 'offline', label: 'Hors ligne' };
  const lobby = user.lobbyId && lobbies.get(user.lobbyId);
  if (lobby && lobby.status === 'in-game') return { status: 'in-game', label: 'En partie' };
  if (lobby) {
    const count = lobby.slots.filter(Boolean).length;
    if (count > 1) return { status: 'in-lobby', label: `Dans un salon (${count}/${MAX_PLAYERS})` };
  }
  return { status: 'online', label: 'En ligne' };
}

// ---------------------------------------------------------------------------
// Amis & présences
// ---------------------------------------------------------------------------

function serializeFriend(user) {
  return { name: user.name, icon: user.icon, ...presenceOf(user) };
}

function sendFriendList(key) {
  const user = users.get(key);
  if (!user || !user.socketId) return;
  const friends = [...user.friends].map((k) => users.get(k)).filter(Boolean).map(serializeFriend);
  const requests = [...user.incomingRequests]
    .map((k) => users.get(k))
    .filter(Boolean)
    .map((u) => ({ name: u.name, icon: u.icon }));
  io.to(userRoom(key)).emit('friends:update', { friends, requests });
}

/** Prévient tous les amis d'un joueur que sa présence a changé. */
function broadcastPresence(key) {
  const user = users.get(key);
  if (!user) return;
  for (const friendKey of user.friends) sendFriendList(friendKey);
}

function broadcastLobbyPresence(lobby) {
  for (const slot of lobby.slots) if (slot) broadcastPresence(slot.key);
}

// ---------------------------------------------------------------------------
// Lobbies
// ---------------------------------------------------------------------------

function serializeLobby(lobby) {
  const now = Date.now();
  const pendingBySlot = new Map();
  for (const [key, invite] of lobby.invites) {
    if (invite.expiresAt > now) pendingBySlot.set(invite.slot, users.get(key)?.name ?? key);
  }
  return {
    id: lobby.id,
    code: lobby.code,
    status: lobby.status,
    open: lobby.open,
    owner: users.get(lobby.ownerKey)?.name ?? null,
    maxPlayers: MAX_PLAYERS,
    minPlayers: MIN_PLAYERS_TO_START,
    roles: ROLES,
    pawns: PAWNS,
    rules: lobby.rules,
    spellList: Object.entries(SPELLS).map(([id, sp]) => ({ id, name: sp.name, cd: sp.cd, text: sp.text })),
    quests: QUESTS,
    items: ITEMS,
    passives: PASSIVES,
    events: EVENTS,
    skins: SKINS,
    botLevels: Object.fromEntries(Object.entries(BOT_LEVELS).map(([id, lv]) => [id, lv.name])),
    slots: lobby.slots.map((slot, index) => {
      if (!slot) return { index, player: null, pendingInvite: pendingBySlot.get(index) ?? null };
      const user = users.get(slot.key);
      return {
        index,
        player: {
          name: user.name,
          icon: user.icon,
          role: slot.role,
          pawn: slot.pawn,
          spells: slot.spells || [...DEFAULT_SPELLS],
          skin: slot.skin || 'base',
          bot: user.bot || null,
          stats: user.stats || { games: 0, wins: 0 },
          isOwner: slot.key === lobby.ownerKey,
          connected: Boolean(user.socketId) || Boolean(user.bot),
        },
        pendingInvite: null,
      };
    }),
  };
}

function broadcastLobby(lobby) {
  io.to(lobbyRoom(lobby.id)).emit('lobby:state', serializeLobby(lobby));
}

function pushChat(lobby, message) {
  const entry = { id: crypto.randomUUID(), ts: Date.now(), ...message };
  lobby.chat.push(entry);
  if (lobby.chat.length > CHAT_HISTORY_SIZE) lobby.chat.shift();
  io.to(lobbyRoom(lobby.id)).emit('chat:message', entry);
}

function systemMessage(lobby, text) {
  pushChat(lobby, { type: 'system', from: null, text });
}

function createLobby(ownerKey) {
  const id = crypto.randomUUID();
  const code = generateCode();
  const lobby = {
    id,
    code,
    ownerKey,
    status: 'lobby',
    open: true, // salon ouvert : on peut le rejoindre avec le code
    slots: Array(MAX_PLAYERS).fill(null),
    invites: new Map(),
    chat: [],
    game: null,
    autoplayTimer: null,
    rules: { ...DEFAULT_RULES }, // règles maison, réglées par le chef du salon
  };
  lobbies.set(id, lobby);
  lobbyCodes.set(code, id);
  return lobby;
}

function deleteLobby(lobby) {
  lobbies.delete(lobby.id);
  lobbyCodes.delete(lobby.code);
}

/** Place un joueur dans un lobby (slot demandé si libre, sinon le premier libre). */
function addToLobby(user, lobby, preferredSlot = null) {
  let index = Number.isInteger(preferredSlot) && lobby.slots[preferredSlot] === null ? preferredSlot : -1;
  if (index === -1) index = lobby.slots.indexOf(null);
  if (index === -1) return false;

  const taken = new Set(lobby.slots.filter(Boolean).map((s) => s.pawn));
  lobby.slots[index] = { key: user.key, role: null, pawn: PAWNS.find((p) => !taken.has(p)), spells: [...DEFAULT_SPELLS], skin: 'base' };
  lobby.invites.delete(user.key);
  user.lobbyId = lobby.id;

  const socket = user.socketId && io.sockets.sockets.get(user.socketId);
  if (socket) {
    socket.join(lobbyRoom(lobby.id));
    socket.emit('chat:history', lobby.chat);
  }
  return true;
}

/** Retire un joueur de son lobby courant. Transfère la couronne ou supprime le lobby si besoin. */
function removeFromLobby(user, reason = 'left') {
  const lobby = user.lobbyId && lobbies.get(user.lobbyId);
  user.lobbyId = null;
  if (!lobby) return;

  const index = lobby.slots.findIndex((s) => s && s.key === user.key);
  if (index !== -1) lobby.slots[index] = null;

  // Quitter le salon pendant une partie = abandon
  if (lobby.game && lobby.status === 'in-game' && lobby.game.player(user.key)) {
    lobby.game.forfeit(user.key);
    broadcastGame(lobby);
  }

  const socket = user.socketId && io.sockets.sockets.get(user.socketId);
  if (socket) socket.leave(lobbyRoom(lobby.id));

  if (user.bot) users.delete(user.key); // un bot retiré disparaît
  const remaining = lobby.slots.filter(Boolean);
  if (!remaining.some((s) => !isBot(s.key))) {
    // plus aucun humain : on ferme le salon et ses bots
    clearTimeout(lobby.autoplayTimer);
    for (const s of remaining) users.delete(s.key);
    deleteLobby(lobby);
    return;
  }

  const verb = reason === 'kicked' ? 'a été exclu du salon' : 'a quitté le salon';
  systemMessage(lobby, `${user.name} ${verb}.`);

  if (lobby.ownerKey === user.key) {
    lobby.ownerKey = remaining.find((s) => !isBot(s.key)).key;
    systemMessage(lobby, `${users.get(lobby.ownerKey).name} est maintenant le chef du salon.`);
  }
  broadcastLobby(lobby);
  broadcastLobbyPresence(lobby);
}

/** Chaque joueur connecté est toujours dans un lobby (comme dans le client LoL). */
function putInFreshLobby(user) {
  removeFromLobby(user);
  const lobby = createLobby(user.key);
  addToLobby(user, lobby, 0);
  broadcastLobby(lobby);
  broadcastPresence(user.key);
  return lobby;
}

function currentLobby(user) {
  return (user.lobbyId && lobbies.get(user.lobbyId)) || null;
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------

/** Chrono du tour : une nouvelle échéance à chaque nouveau tour de jeu. */
function updateDeadline(lobby) {
  const game = lobby.game;
  const seconds = game.rules.turnTimer;
  const current = game.currentPlayer;
  if (!seconds || game.phase === 'over' || isBot(current.key)) {
    lobby.deadline = null;
    lobby.turnSig = null;
    return;
  }
  const sig = `${game.id}:${game.turnId}`;
  if (lobby.turnSig !== sig) {
    lobby.turnSig = sig;
    lobby.deadline = Date.now() + seconds * 1000;
  }
}

/** État envoyé aux joueurs, avec le temps restant du tour (en ms, pour éviter les écarts d'horloge). */
function gameState(lobby, { keepFx = true } = {}) {
  const state = lobby.game.serialize();
  if (!keepFx) state.fx = [];
  state.timer = lobby.deadline ? { left: Math.max(0, lobby.deadline - Date.now()), total: lobby.game.rules.turnTimer * 1000 } : null;
  return state;
}

function broadcastGame(lobby) {
  const game = lobby.game;
  if (!game) return;
  updateDeadline(lobby);
  io.to(lobbyRoom(lobby.id)).emit('game:state', gameState(lobby));

  // Fin de partie : le salon redevient disponible pour une revanche
  if (game.phase === 'over' && lobby.status === 'in-game') {
    lobby.status = 'lobby';
    const winner = game.player(game.winner);
    systemMessage(lobby, winner ? `${winner.name} remporte la partie !` : 'Partie terminée.');
    // profil : parties jouées et victoires (débloquent les skins)
    for (const p of game.players) {
      const u = users.get(p.key);
      if (!u || u.bot) continue;
      u.stats ||= { games: 0, wins: 0 };
      u.stats.games += 1;
      if (p.key === game.winner) u.stats.wins += 1;
    }
    broadcastLobby(lobby);
    broadcastLobbyPresence(lobby);
  }
  scheduleAutoplay(lobby);
}

/**
 * Qui joue la prochaine action ? Un bot (à son rythme), le jeu à la place d'un joueur
 * dont le chrono est écoulé, ou d'un joueur déconnecté depuis un moment.
 */
function scheduleAutoplay(lobby) {
  clearTimeout(lobby.autoplayTimer);
  lobby.autoplayTimer = null;
  const game = lobby.game;
  if (!game || game.phase === 'over') return;
  const run = (delay, fn) => {
    lobby.autoplayTimer = setTimeout(() => {
      lobby.autoplayTimer = null;
      if (lobby.game !== game || game.phase === 'over') return;
      try {
        fn();
      } catch (err) {
        console.error('[autoplay]', err);
        game.autoStep();
      }
      broadcastGame(lobby);
    }, Math.max(0, delay));
  };
  // un bot à qui l'on propose un échange répond d'abord
  if (game.trade && isBot(game.trade.to)) return run(BOT_STEP_MS * 1.5, () => botAnswerTrade(game, game.trade.to));
  const key = game.currentPlayer.key;
  const user = users.get(key);
  if (user?.bot) {
    return run(BOT_STEP_MS, () => {
      const res = botStep(game, key);
      if (!res.ok) game.autoStep(); // filet de sécurité : jamais bloqué
    });
  }
  const delays = [];
  if (lobby.deadline) delays.push(lobby.deadline - Date.now());
  if (!user || !user.socketId) delays.push(AUTOPLAY_DELAY_MS);
  if (!delays.length) return;
  const delay = Math.min(...delays);
  run(delay <= 0 ? TIMEOUT_STEP_MS : delay, () => {
    if (game.trade && game.trade.from === key) game.cancelTrade(key);
    game.autoStep();
  });
}

// Purge périodique des invitations expirées
setInterval(() => {
  const now = Date.now();
  for (const lobby of lobbies.values()) {
    let changed = false;
    for (const [key, invite] of lobby.invites) {
      if (invite.expiresAt <= now) {
        lobby.invites.delete(key);
        changed = true;
      }
    }
    if (changed) broadcastLobby(lobby);
  }
}, 5_000).unref();

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  /** @type {User|null} */
  let me = null;

  /** Garde : l'événement exige une session ouverte. */
  const authed = (handler) => (payload, ack) => {
    if (typeof payload === 'function') [payload, ack] = [{}, payload];
    if (!me) return fail(ack, 'Connecte-toi d’abord.');
    try {
      handler(payload || {}, ack);
    } catch (err) {
      console.error('[socket]', err);
      fail(ack, 'Erreur serveur.');
    }
  };

  // --- Session ---------------------------------------------------------------

  socket.on('session:login', (payload = {}, ack) => {
    if (me) return fail(ack, 'Déjà connecté.');

    const name = String(payload.name || '').trim();
    if (!NAME_PATTERN.test(name)) {
      return fail(ack, 'Pseudo invalide (3 à 16 caractères : lettres, chiffres, espace, _ . -).');
    }
    const icon = Number.isInteger(payload.icon) && payload.icon >= 0 && payload.icon < ICON_COUNT ? payload.icon : 0;
    const key = keyOf(name);

    let user = users.get(key);
    if (user && user.socketId) return fail(ack, 'Ce pseudo est déjà connecté.');

    if (!user) {
      user = {
        key,
        name,
        icon,
        socketId: null,
        lobbyId: null,
        friends: new Set(),
        incomingRequests: new Set(),
        disconnectTimer: null,
        chatTimestamps: [],
      };
      users.set(key, user);
    }
    user.icon = icon;
    user.socketId = socket.id;
    clearTimeout(user.disconnectTimer);
    user.disconnectTimer = null;

    me = user;
    socket.join(userRoom(key));

    // Reconnexion dans la fenêtre de grâce : on retrouve son lobby
    const lobby = currentLobby(user);
    if (lobby) {
      socket.join(lobbyRoom(lobby.id));
      socket.emit('chat:history', lobby.chat);
      broadcastLobby(lobby);
      broadcastPresence(key);

    } else {
      putInFreshLobby(user);
    }

    reply(ack, { ok: true, user: { name: user.name, icon: user.icon }, roles: ROLES });
    sendFriendList(key);

    // Partie en cours : l'état part après la confirmation, pour que le client sache déjà qui il est
    if (lobby && lobby.game && lobby.status === 'in-game') {
      updateDeadline(lobby);
      socket.emit('game:state', gameState(lobby, { keepFx: false }));
      scheduleAutoplay(lobby);
    }
  });

  socket.on('session:setIcon', authed(({ icon }, ack) => {
    if (!Number.isInteger(icon) || icon < 0 || icon >= ICON_COUNT) return fail(ack, 'Icône inconnue.');
    me.icon = icon;
    const lobby = currentLobby(me);
    if (lobby) broadcastLobby(lobby);
    broadcastPresence(me.key);
    reply(ack, { ok: true, icon });
  }));

  // --- Amis ------------------------------------------------------------------

  socket.on('friends:add', authed(({ name }, ack) => {
    const target = users.get(keyOf(name));
    if (!target) return fail(ack, 'Aucun invocateur trouvé avec ce pseudo.');
    if (target.key === me.key) return fail(ack, 'Tu ne peux pas t’ajouter toi-même.');
    if (me.friends.has(target.key)) return fail(ack, 'Vous êtes déjà amis.');

    // Demande croisée : on accepte directement
    if (me.incomingRequests.has(target.key)) {
      me.incomingRequests.delete(target.key);
      me.friends.add(target.key);
      target.friends.add(me.key);
      sendFriendList(me.key);
      sendFriendList(target.key);
      notify(target.key, 'success', `${me.name} a accepté ta demande d’ami.`);
      return reply(ack, { ok: true, accepted: true });
    }

    target.incomingRequests.add(me.key);
    sendFriendList(target.key);
    notify(target.key, 'info', `${me.name} veut t’ajouter en ami.`);
    reply(ack, { ok: true, accepted: false });
  }));

  socket.on('friends:respond', authed(({ name, accept }, ack) => {
    const target = users.get(keyOf(name));
    if (!target || !me.incomingRequests.has(target.key)) return fail(ack, 'Demande introuvable.');

    me.incomingRequests.delete(target.key);
    if (accept) {
      me.friends.add(target.key);
      target.friends.add(me.key);
      notify(target.key, 'success', `${me.name} a accepté ta demande d’ami.`);
      sendFriendList(target.key);
    }
    sendFriendList(me.key);
    reply(ack, { ok: true });
  }));

  socket.on('friends:remove', authed(({ name }, ack) => {
    const target = users.get(keyOf(name));
    if (!target) return fail(ack, 'Invocateur introuvable.');
    me.friends.delete(target.key);
    target.friends.delete(me.key);
    sendFriendList(me.key);
    sendFriendList(target.key);
    reply(ack, { ok: true });
  }));

  // --- Lobby -----------------------------------------------------------------

  socket.on('lobby:create', authed((_payload, ack) => {
    const lobby = putInFreshLobby(me);
    reply(ack, { ok: true, code: lobby.code });
  }));

  socket.on('lobby:join', authed(({ code }, ack) => {
    const lobbyId = lobbyCodes.get(String(code || '').trim().toUpperCase());
    const lobby = lobbyId && lobbies.get(lobbyId);
    if (!lobby) return fail(ack, 'Aucun salon ne correspond à ce code.');
    if (lobby.id === me.lobbyId) return fail(ack, 'Tu es déjà dans ce salon.');
    if (!lobby.open) return fail(ack, 'Ce salon est fermé : demande une invitation au chef.');
    if (lobby.status !== 'lobby') return fail(ack, 'Ce salon est déjà en partie.');
    if (!lobby.slots.includes(null)) return fail(ack, 'Ce salon est complet.');

    removeFromLobby(me);
    addToLobby(me, lobby);
    systemMessage(lobby, `${me.name} a rejoint le salon.`);
    broadcastLobby(lobby);
    broadcastLobbyPresence(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:leave', authed((_payload, ack) => {
    putInFreshLobby(me);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:setOpen', authed(({ open }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby || lobby.ownerKey !== me.key) return fail(ack, 'Seul le chef du salon peut changer ça.');
    lobby.open = Boolean(open);
    systemMessage(lobby, lobby.open ? 'Le salon est ouvert : on peut le rejoindre avec le code.' : 'Le salon est fermé : sur invitation uniquement.');
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:invite', authed(({ name, slot }, ack) => {
    const lobby = currentLobby(me);
    const target = users.get(keyOf(name));
    if (!lobby || lobby.status !== 'lobby') return fail(ack, 'Impossible d’inviter pour le moment.');
    if (!target || !me.friends.has(target.key)) return fail(ack, 'Tu ne peux inviter que tes amis.');
    if (!target.socketId) return fail(ack, `${target.name} est hors ligne.`);
    if (target.lobbyId === lobby.id) return fail(ack, `${target.name} est déjà dans le salon.`);
    if (!lobby.slots.includes(null)) return fail(ack, 'Le salon est complet.');

    const wanted = Number.isInteger(slot) && lobby.slots[slot] === null ? slot : lobby.slots.indexOf(null);
    lobby.invites.set(target.key, { slot: wanted, from: me.key, expiresAt: Date.now() + INVITE_TTL_MS });

    io.to(userRoom(target.key)).emit('lobby:invited', {
      lobbyId: lobby.id,
      from: me.name,
      fromIcon: me.icon,
      players: lobby.slots.filter(Boolean).length,
      expiresIn: INVITE_TTL_MS,
    });
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:invite:respond', authed(({ lobbyId, accept }, ack) => {
    const lobby = lobbies.get(lobbyId);
    const invite = lobby && lobby.invites.get(me.key);
    if (!invite || invite.expiresAt <= Date.now()) return fail(ack, 'Cette invitation a expiré.');

    lobby.invites.delete(me.key);
    if (!accept) {
      notify(invite.from, 'info', `${me.name} a refusé ton invitation.`);
      broadcastLobby(lobby);
      return reply(ack, { ok: true });
    }
    if (lobby.status !== 'lobby' || !lobby.slots.includes(null)) {
      broadcastLobby(lobby);
      return fail(ack, 'Le salon n’est plus disponible.');
    }

    removeFromLobby(me);
    addToLobby(me, lobby, invite.slot);
    systemMessage(lobby, `${me.name} a rejoint le salon.`);
    broadcastLobby(lobby);
    broadcastLobbyPresence(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:setRole', authed(({ role }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby) return fail(ack, 'Aucun salon.');
    if (role !== null && !ROLES.includes(role)) return fail(ack, 'Rôle inconnu.');
    const slot = lobby.slots.find((s) => s && s.key === me.key);
    slot.role = role;
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:setPawn', authed(({ pawn }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby) return fail(ack, 'Aucun salon.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    if (!PAWNS.includes(pawn)) return fail(ack, 'Pion inconnu.');
    const owner = lobby.slots.find((s) => s && s.pawn === pawn && s.key !== me.key);
    if (owner) return fail(ack, `${users.get(owner.key)?.name ?? 'Un joueur'} a déjà ce pion.`);
    lobby.slots.find((s) => s && s.key === me.key).pawn = pawn;
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:setSpells', authed(({ spells }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby) return fail(ack, 'Aucun salon.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    const clean = sanitizeSpells(spells);
    if (!Array.isArray(spells) || clean.join() !== spells.join()) return fail(ack, 'Choisis deux sorts différents.');
    lobby.slots.find((s) => s && s.key === me.key).spells = clean;
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:setRules', authed(({ rules }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby) return fail(ack, 'Aucun salon.');
    if (lobby.ownerKey !== me.key) return fail(ack, 'Seul le chef du salon règle la partie.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    lobby.rules = sanitizeRules({ ...lobby.rules, ...(rules || {}) });
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:setSkin', authed(({ skin }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby) return fail(ack, 'Aucun salon.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    if (!SKINS[skin]) return fail(ack, 'Skin inconnu.');
    if (!skinUnlocked(skin, me.stats)) return fail(ack, 'Ce skin n’est pas encore débloqué.');
    lobby.slots.find((s) => s && s.key === me.key).skin = skin;
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:addBot', authed(({ slot, level }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby || lobby.ownerKey !== me.key) return fail(ack, 'Seul le chef du salon ajoute des bots.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    if (!BOT_LEVELS[level]) return fail(ack, 'Niveau inconnu.');
    const index = Number.isInteger(slot) && lobby.slots[slot] === null ? slot : lobby.slots.indexOf(null);
    if (index === -1) return fail(ack, 'Le salon est complet.');
    const usedNames = new Set(lobby.slots.filter(Boolean).map((s) => users.get(s.key)?.name));
    const name = BOT_NAMES.find((n) => !usedNames.has(`${n} (bot)`)) || 'Bot';
    const bot = {
      key: `bot:${crypto.randomUUID().slice(0, 8)}`,
      name: `${name} (bot)`,
      icon: crypto.randomInt(ICON_COUNT),
      bot: level,
      socketId: null,
      lobbyId: null,
      friends: new Set(),
      incomingRequests: new Set(),
      disconnectTimer: null,
      chatTimestamps: [],
    };
    users.set(bot.key, bot);
    addToLobby(bot, lobby, index);
    const s = lobby.slots[index];
    const roles = new Set(lobby.slots.filter(Boolean).map((x) => x.role));
    s.role = ROLES.find((r) => !roles.has(r)) || null;
    s.spells = level === 'easy' ? [...DEFAULT_SPELLS] : ['heal', 'barrier'];
    systemMessage(lobby, `${bot.name} (${BOT_LEVELS[level].name}) rejoint le salon.`);
    broadcastLobby(lobby);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:removeBot', authed(({ slot }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby || lobby.ownerKey !== me.key) return fail(ack, 'Seul le chef du salon retire les bots.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    const s = lobby.slots[slot];
    const bot = s && users.get(s.key);
    if (!bot || !bot.bot) return fail(ack, 'Aucun bot à cette place.');
    removeFromLobby(bot, 'kicked');
    reply(ack, { ok: true });
  }));

  socket.on('lobby:kick', authed(({ name }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby || lobby.ownerKey !== me.key) return fail(ack, 'Seul le chef du salon peut exclure.');
    const target = users.get(keyOf(name));
    if (!target || target.lobbyId !== lobby.id || target.key === me.key) return fail(ack, 'Joueur introuvable.');

    removeFromLobby(target, 'kicked');
    io.to(userRoom(target.key)).emit('lobby:kicked', { by: me.name });
    if (target.socketId) putInFreshLobby(target);
    reply(ack, { ok: true });
  }));

  socket.on('lobby:start', authed((_payload, ack) => {
    const lobby = currentLobby(me);
    if (!lobby || lobby.ownerKey !== me.key) return fail(ack, 'Seul le chef du salon peut lancer la partie.');
    if (lobby.status !== 'lobby') return fail(ack, 'La partie est déjà lancée.');
    const players = lobby.slots.filter(Boolean);
    if (players.length < MIN_PLAYERS_TO_START) {
      return fail(ack, `Il faut au moins ${MIN_PLAYERS_TO_START} invocateurs pour lancer.`);
    }

    lobby.status = 'in-game';
    lobby.invites.clear();
    // Ordre de jeu : l'ordre visuel des colonnes (slots), le chef en premier
    const order = [...players].sort((a, b) => (a.key === lobby.ownerKey ? -1 : b.key === lobby.ownerKey ? 1 : 0));
    lobby.game = new Game(order.map((s) => {
      const u = users.get(s.key);
      return { key: u.key, name: u.name, icon: u.icon, pawn: s.pawn, role: s.role, spells: s.spells, skin: s.skin, bot: u.bot || null };
    }), { rules: lobby.rules });
    systemMessage(lobby, 'Partie trouvée ! Chargement de la Faille…');
    broadcastLobby(lobby);
    broadcastLobbyPresence(lobby);
    io.to(lobbyRoom(lobby.id)).emit('lobby:matchFound', {
      lobbyId: lobby.id,
      players: players.map((s) => ({ name: users.get(s.key).name, role: s.role })),
    });
    broadcastGame(lobby);
    reply(ack, { ok: true });
  }));

  // --- Partie ----------------------------------------------------------------

  const GAME_ACTIONS = {
    'game:roll': (g) => g.roll(me.key),
    'game:buy': (g) => g.buy(me.key),
    'game:skip': (g) => g.skipBuy(me.key),
    'game:tax': (g, { choice }) => g.payTax(me.key, choice),
    'game:payJail': (g) => g.payJail(me.key),
    'game:useCard': (g) => g.useJailCard(me.key),
    'game:build': (g, { index }) => g.build(me.key, Number(index)),
    'game:sell': (g, { index }) => g.sell(me.key, Number(index)),
    'game:mortgage': (g, { index }) => g.mortgage(me.key, Number(index)),
    'game:unmortgage': (g, { index }) => g.unmortgage(me.key, Number(index)),
    'game:end': (g) => g.endTurn(me.key),
    'game:forfeit': (g) => g.forfeit(me.key),
    'game:trade': (g, offer) => g.proposeTrade(me.key, offer || {}),
    'game:tradeRespond': (g, { accept } = {}) => g.respondTrade(me.key, Boolean(accept)),
    'game:tradeCancel': (g) => g.cancelTrade(me.key),
    'game:spell': (g, { spell, arg } = {}) => g.useSpell(me.key, String(spell), arg),
    'game:perk': (g, { perk, arg } = {}) => g.usePerk(me.key, String(perk), arg),
    'game:buyItem': (g, { item } = {}) => g.buyItem(me.key, String(item)),
    'game:sellItem': (g, { item } = {}) => g.sellItem(me.key, String(item)),
    'game:boots': (g) => g.useBoots(me.key),
    'game:ghost': (g, { die } = {}) => g.ghostChoice(me.key, Number(die)),
    'game:herald': (g, { index } = {}) => g.useHerald(me.key, Number(index)),
  };
  for (const [event, action] of Object.entries(GAME_ACTIONS)) {
    socket.on(event, authed((payload, ack) => {
      const lobby = currentLobby(me);
      const game = lobby && lobby.game;
      if (!game || lobby.status !== 'in-game') return fail(ack, 'Aucune partie en cours.');
      const result = action(game, payload);
      if (result.ok) broadcastGame(lobby);
      reply(ack, result);
    }));
  }

  socket.on('game:sync', authed((_payload, ack) => {
    const lobby = currentLobby(me);
    if (!lobby || !lobby.game) return fail(ack, 'Aucune partie.');
    socket.emit('game:state', gameState(lobby, { keepFx: false }));
    reply(ack, { ok: true });
  }));

  // --- Emotes et pings sur le plateau ------------------------------------------

  let lastEmote = 0;
  const inGame = () => {
    const lobby = currentLobby(me);
    return lobby && lobby.game && lobby.status === 'in-game' && lobby.game.player(me.key) ? lobby : null;
  };
  socket.on('game:emote', authed(({ emote }, ack) => {
    const lobby = inGame();
    if (!lobby) return fail(ack, 'Aucune partie en cours.');
    if (!EMOTES.includes(emote)) return fail(ack, 'Emote inconnue.');
    if (Date.now() - lastEmote < EMOTE_COOLDOWN_MS) return fail(ack, 'Doucement !');
    lastEmote = Date.now();
    io.to(lobbyRoom(lobby.id)).emit('game:emote', { key: me.key, name: me.name, emote });
    reply(ack, { ok: true });
  }));
  socket.on('game:ping', authed(({ index, kind }, ack) => {
    const lobby = inGame();
    if (!lobby) return fail(ack, 'Aucune partie en cours.');
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= 40) return fail(ack, 'Case invalide.');
    if (Date.now() - lastEmote < EMOTE_COOLDOWN_MS) return fail(ack, 'Doucement !');
    lastEmote = Date.now();
    const color = lobby.game.player(me.key).color;
    io.to(lobbyRoom(lobby.id)).emit('game:ping', { key: me.key, name: me.name, index: i, kind: PINGS.includes(kind) ? kind : 'ping', color });
    reply(ack, { ok: true });
  }));

  // --- Chat ------------------------------------------------------------------

  socket.on('chat:send', authed(({ text }, ack) => {
    const lobby = currentLobby(me);
    if (!lobby) return fail(ack, 'Aucun salon.');

    // Le client affiche le texte via textContent : pas d'échappement HTML ici.
    const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return fail(ack, 'Message vide.');

    const now = Date.now();
    me.chatTimestamps = me.chatTimestamps.filter((t) => now - t < CHAT_RATE_LIMIT.windowMs);
    if (me.chatTimestamps.length >= CHAT_RATE_LIMIT.max) return fail(ack, 'Doucement ! Tu envoies trop de messages.');
    me.chatTimestamps.push(now);

    pushChat(lobby, { type: 'player', from: me.name, icon: me.icon, text: clean });
    reply(ack, { ok: true });
  }));

  // --- Déconnexion -----------------------------------------------------------

  socket.on('disconnect', () => {
    if (!me || me.socketId !== socket.id) return;
    const user = me;
    user.socketId = null;

    const lobby = currentLobby(user);
    if (lobby) broadcastLobby(lobby);
    if (lobby && lobby.game) scheduleAutoplay(lobby);
    broadcastPresence(user.key);

    // Fenêtre de grâce avant de libérer sa place (F5, micro-coupure…)
    user.disconnectTimer = setTimeout(() => {
      user.disconnectTimer = null;
      if (user.socketId) return;
      const current = currentLobby(user);
      if (current && current.status === 'lobby') removeFromLobby(user);
      broadcastPresence(user.key);
    }, RECONNECT_GRACE_MS);
  });
});

// ---------------------------------------------------------------------------
// Sauvegarde sur disque : joueurs, amis, salons et parties survivent à un
// redémarrage du serveur. SAVE_FILE=off pour la désactiver (tests).
// ---------------------------------------------------------------------------

const SAVE_FILE = process.env.SAVE_FILE === 'off' ? null
  : path.resolve(process.env.SAVE_FILE || path.join(__dirname, '..', 'data', 'save.json'));
let lastSaved = '';

function snapshot() {
  return JSON.stringify({
    version: 1,
    users: [...users.values()].map((u) => ({
      key: u.key,
      name: u.name,
      icon: u.icon,
      bot: u.bot || null,
      stats: u.stats || { games: 0, wins: 0 },
      lobbyId: u.lobbyId,
      friends: [...u.friends],
      incomingRequests: [...u.incomingRequests],
    })),
    lobbies: [...lobbies.values()].map((l) => ({
      id: l.id,
      code: l.code,
      ownerKey: l.ownerKey,
      status: l.status,
      open: l.open,
      slots: l.slots,
      chat: l.chat,
      rules: l.rules,
      game: l.game ? l.game.toJSON() : null,
    })),
  });
}

function saveNow() {
  if (!SAVE_FILE) return;
  try {
    const json = snapshot();
    if (json === lastSaved) return;
    fs.mkdirSync(path.dirname(SAVE_FILE), { recursive: true });
    const tmp = `${SAVE_FILE}.tmp`;
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, SAVE_FILE); // écriture atomique : jamais de fichier à moitié écrit
    lastSaved = json;
  } catch (err) {
    console.error('[sauvegarde]', err.message);
  }
}

function loadSave() {
  if (!SAVE_FILE || !fs.existsSync(SAVE_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    for (const l of data.lobbies || []) {
      const lobby = {
        ...l,
        rules: sanitizeRules(l.rules || {}),
        invites: new Map(),
        autoplayTimer: null,
        game: l.game ? Game.fromJSON(l.game) : null,
      };
      lobbies.set(lobby.id, lobby);
      lobbyCodes.set(lobby.code, lobby.id);
    }
    for (const u of data.users || []) {
      const user = {
        key: u.key,
        name: u.name,
        icon: u.icon,
        bot: u.bot || null,
        stats: u.stats || { games: 0, wins: 0 },
        socketId: null,
        lobbyId: u.lobbyId && lobbies.has(u.lobbyId) ? u.lobbyId : null,
        friends: new Set(u.friends),
        incomingRequests: new Set(u.incomingRequests),
        disconnectTimer: null,
        chatTimestamps: [],
      };
      users.set(user.key, user);
      if (user.bot) continue;
      // comme après une déconnexion : on garde sa place un moment, le temps qu'il revienne
      user.disconnectTimer = setTimeout(() => {
        user.disconnectTimer = null;
        if (user.socketId) return;
        const current = currentLobby(user);
        if (current && current.status === 'lobby') removeFromLobby(user);
      }, RECONNECT_GRACE_MS * 4);
    }
    // les parties reprennent : les joueurs absents jouent automatiquement après le délai habituel
    for (const lobby of lobbies.values()) if (lobby.game && lobby.status === 'in-game') scheduleAutoplay(lobby);
    lastSaved = snapshot();
    console.log(`Sauvegarde chargée : ${users.size} joueurs, ${lobbies.size} salons.`);
  } catch (err) {
    console.error('[sauvegarde] fichier illisible, on repart de zéro :', err.message);
  }
}

if (SAVE_FILE) {
  loadSave();
  setInterval(saveNow, 3_000).unref();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      saveNow();
      process.exit(0);
    });
  }
}

server.listen(PORT, () => {
  console.log(`LoL Monopoly en écoute sur http://localhost:${PORT}`);
});

module.exports = { app, server, io };
