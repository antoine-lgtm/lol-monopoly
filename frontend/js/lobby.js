/**
 * LoL Monopoly — client : salon
 *
 * Bannières des joueurs (le joueur local au centre), invitations (bouton « + »,
 * clic droit, glisser-déposer), rôles, chat en direct, code du salon,
 * interrupteur « salon ouvert » et FIND MATCH (chef du salon uniquement).
 * S'appuie sur `App` (main.js).
 */
(() => {
  'use strict';

  const { socket, $, $$ } = App;

  const ROLE_LABELS = { TOP: 'Top', JGL: 'Jgl', MID: 'Mid', ADC: 'Adc', SUPP: 'Supp' };
  // Ordre visuel des colonnes : le joueur local au centre (3), puis alternance autour.
  const VISUAL_ORDER = [3, 2, 4, 1, 5];

  const banners = $('#banners');
  const tplPlayer = $('#tpl-banner-player');
  const tplEmpty = $('#tpl-banner-empty');

  let previousLobbyId = null;
  let previousPlayers = 0;


  const players = (lobby) => lobby.slots.filter((s) => s.player);

  // Titre affiché sous le pseudo (comme « Sweaty » ou « Playmaker » dans le client) : toujours le même pour un pseudo
  const TITLES = [
    'Baron de l’immobilier', 'Roi des loyers', 'Farmeur d’or', 'Chasseur de Dragons',
    'Main du Baron', 'Collectionneur de tours', 'Banquier de la Faille', 'Rusé comme Teemo',
    'Stratège de Piltover', 'Magnat de Zaun', 'Seigneur des hypothèques', 'Voleur de Baron',
    'Tank à loyers', 'Carry immobilier', 'Invocateur fortuné', 'Prince de Shurima',
  ];
  const titleFor = (name) => {
    let hash = 0;
    for (const ch of name.toLowerCase()) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
    return TITLES[hash % TITLES.length];
  };
  const isOwner = () => Boolean(App.lobby && App.me && App.lobby.owner === App.me.name);

  // ---------------------------------------------------------------------------
  // État du salon
  // ---------------------------------------------------------------------------

  socket.on('lobby:state', (lobby) => {
    App.lobby = lobby;
    const count = players(lobby).length;

    // On passe au salon quand on en rejoint un autre, ou quand quelqu'un nous rejoint.
    const joinedAnother = previousLobbyId && lobby.id !== previousLobbyId && count > 1;
    const someoneArrived = lobby.id === previousLobbyId && count > previousPlayers && previousPlayers > 0;
    if ((joinedAnother || someoneArrived) && App.view !== 'lobby') App.showView('lobby');
    previousLobbyId = lobby.id;
    previousPlayers = count;

    renderLobby();
  });

  function renderLobby() {
    const lobby = App.lobby;
    if (!lobby || !App.me) return;
    renderBanners(lobby);
    renderTools(lobby);
    renderFindMatch(lobby);
    renderMyRoleButton(lobby);
    renderInvites(lobby);
    renderPartyCard(lobby);
    App.renderProfile();
    if (document.getElementById('modal-rules')?.open) fillRules();
  }
  // L'icône ou le pseudo peuvent arriver après le premier état du salon
  document.addEventListener('app:login', renderLobby);

  let shownPlayers = new Set(); // pour n'animer que les nouveaux arrivants

  function renderBanners(lobby) {
    const mySlot = lobby.slots.find((s) => s.player?.name === App.me.name)?.index ?? 0;
    const others = lobby.slots.map((s) => s.index).filter((i) => i !== mySlot);
    const orderOf = new Map([[mySlot, VISUAL_ORDER[0]], ...others.map((i, n) => [i, VISUAL_ORDER[n + 1]])]);
    const canInvite = lobby.status === 'lobby';

    const nodes = lobby.slots.map((slot) => {
      const el = slot.player ? buildPlayerBanner(slot, lobby) : buildEmptyBanner(slot, canInvite);
      el.dataset.slot = slot.index;
      const order = orderOf.get(slot.index);
      el.style.order = order;
      el.dataset.pos = order === 3 ? 'center' : order === 2 || order === 4 ? 'inner' : 'outer';
      if (slot.player && !shownPlayers.has(`${lobby.id}/${slot.player.name}`)) el.classList.add('is-new');
      return el;
    });
    banners.replaceChildren(...nodes);
    shownPlayers = new Set(players(lobby).map((s) => `${lobby.id}/${s.player.name}`));
  }

  function buildPlayerBanner(slot, lobby) {
    const { player } = slot;
    const me = player.name === App.me.name;
    const el = tplPlayer.content.firstElementChild.cloneNode(true);
    el.dataset.name = player.name;
    el.classList.toggle('is-me', me);
    el.classList.toggle('is-owner', player.isOwner);
    el.classList.toggle('is-disconnected', !player.connected);
    el.classList.toggle('is-bot', Boolean(player.bot));

    $('.banner__name-text', el).textContent = player.name;
    $('.banner__crown', el).hidden = !player.isOwner;
    const status = $('.banner__status', el);
    status.textContent = player.bot
      ? `Bot · ${lobby.botLevels?.[player.bot] || player.bot}`
      : !player.connected ? 'Reconnexion…' : titleFor(player.name);
    status.title = player.isOwner ? 'Chef du salon' : '';
    const removeBot = $('.banner__remove-bot', el);
    removeBot.hidden = !player.bot || !isOwner() || lobby.status !== 'lobby';
    removeBot.dataset.slot = slot.index;


    renderPawnPicker(el, player, lobby, me);
    renderSkins(el, player, lobby, me);
    renderSpells(el, player, lobby, me);
    const quest = $('.banner__quest', el);
    const q = player.role && lobby.rules?.quests !== false ? lobby.quests?.[player.role] : null;
    quest.hidden = !q;
    if (q) {
      quest.textContent = `Quête : ${q.text}`;
      quest.title = `${q.name} — récompense : ${q.reward}`;
    }

    const current = $('.role-picker__current', el);
    $('.role-icon', current).dataset.role = player.role || '';
    $('.role-picker__label', current).textContent = player.role
      ? ROLE_LABELS[player.role]
      : me ? 'Choisir un rôle' : 'Aucun rôle';
    current.disabled = !me || lobby.status !== 'lobby';
    current.setAttribute('aria-label', me ? 'Choisir mon rôle' : `Rôle de ${player.name}`);
    $$('.role-picker__option', el).forEach((opt) => {
      opt.setAttribute('aria-selected', String(opt.dataset.role === player.role));
      opt.tabIndex = 0;
    });
    return el;
  }

  function buildEmptyBanner(slot, canInvite) {
    const el = tplEmpty.content.firstElementChild.cloneNode(true);
    const button = $('.banner__invite', el);
    button.dataset.inviteSlot = slot.index;
    button.disabled = !canInvite;
    button.setAttribute('aria-label', `Inviter un ami dans l'emplacement ${slot.index + 1}`);
    if (slot.pendingInvite) {
      el.classList.add('is-pending');
      el.dataset.dropzone = 'false';
      const pending = $('.banner__pending', el);
      pending.hidden = false;
      $('.banner__pending-name', pending).textContent = slot.pendingInvite;
    }
    const bots = $('.banner__bots', el);
    bots.hidden = !canInvite || !isOwner() || Boolean(slot.pendingInvite);
    $$('.banner__bot-btn', bots).forEach((b) => { b.dataset.slot = slot.index; });
    return el;
  }

  // Bots : ajoutés par le chef sur une place libre, retirés par lui
  banners.addEventListener('click', (event) => {
    const add = event.target.closest('.banner__bot-btn');
    if (add) {
      add.disabled = true;
      socket.emit('lobby:addBot', { slot: Number(add.dataset.slot), level: add.dataset.bot }, (res) => {
        if (!res?.ok) App.toast(res?.error || 'Impossible d’ajouter un bot.', 'error');
      });
      return;
    }
    const remove = event.target.closest('.banner__remove-bot');
    if (remove) {
      socket.emit('lobby:removeBot', { slot: Number(remove.dataset.slot) }, (res) => {
        if (!res?.ok) App.toast(res?.error || 'Impossible de retirer ce bot.', 'error');
      });
    }
  });

  function renderTools(lobby) {
    $('#lobby-code-value').textContent = lobby.code;
    $('#tab-room-code').textContent = lobby.code;
    $('#room-players').textContent = `${players(lobby).length}/${lobby.maxPlayers}`;
    const toggle = $('#lobby-open');
    toggle.checked = lobby.open;
    toggle.disabled = !isOwner();
    toggle.closest('.party-toggle').title = lobby.open
      ? 'Salon ouvert : on peut le rejoindre avec le code'
      : 'Salon fermé : sur invitation uniquement';
  }

  function renderMyRoleButton(lobby) {
    const me = lobby.slots.find((s) => s.player?.name === App.me.name)?.player;
    const button = $('#my-role-btn');
    $('.role-icon', button).dataset.role = me?.role || '';
    button.disabled = lobby.status !== 'lobby';
    button.title = me?.role ? `Mon rôle : ${ROLE_LABELS[me.role]}` : 'Choisir mon rôle';
  }

  function renderFindMatch(lobby) {
    const button = $('#find-match');
    const hint = $('#find-match-hint');
    const count = players(lobby).length;
    button.classList.remove('is-searching');
    if (lobby.status !== 'lobby') {
      button.disabled = true;
      hint.textContent = 'Partie en cours.';
    } else if (!isOwner()) {
      button.disabled = true;
      hint.textContent = `Seul le chef du salon (${lobby.owner}) peut lancer la partie.`;
    } else if (count < lobby.minPlayers) {
      button.disabled = true;
      hint.textContent = `Il faut au moins ${lobby.minPlayers} invocateurs pour lancer.`;
    } else {
      button.disabled = false;
      hint.textContent = `${count} invocateurs prêts.`;
    }
  }

  function renderInvites(lobby) {
    const pending = lobby.slots.filter((s) => s.pendingInvite).map((s) => s.pendingInvite);
    $('#invites-count').textContent = pending.length;
    const list = $('#pending-invites');
    list.replaceChildren(
      ...pending.map((name) => {
        const li = document.createElement('li');
        li.className = 'invite-item';
        const friend = App.friends.find((f) => f.name === name);
        li.append(buildIcon(friend?.icon), buildInfo(name, 'Invitation envoyée…'));
        return li;
      }),
    );
    list.nextElementSibling.hidden = pending.length > 0;
  }

  function renderPartyCard(lobby) {
    const count = players(lobby).length;
    const card = $('#party-card');
    card.hidden = count < 2 && App.view !== 'lobby';
    $('.party-card__title', card).textContent = lobby.open ? 'Salon ouvert' : 'Salon privé';
    $$('.party-card__member', card).forEach((m, i) => m.classList.toggle('is-filled', i < count));
    $('#party-members').setAttribute('aria-label', `${count} joueur(s) sur ${lobby.maxPlayers}`);
  }

  document.addEventListener('app:view', () => App.lobby && renderPartyCard(App.lobby));
  document.addEventListener('app:friends', () => App.lobby && renderInvites(App.lobby));

  function buildIcon(icon) {
    const wrap = document.createElement('div');
    wrap.className = 'summoner-icon summoner-icon--friend';
    const img = document.createElement('img');
    img.className = 'summoner-icon__img';
    img.src = App.iconUrl(icon ?? 0);
    img.alt = '';
    wrap.append(img);
    return wrap;
  }

  function buildInfo(name, status) {
    const info = document.createElement('div');
    info.className = 'friend__info';
    const n = document.createElement('span');
    n.className = 'friend__name';
    n.textContent = name;
    const s = document.createElement('span');
    s.className = 'friend__status';
    s.textContent = status;
    info.append(n, s);
    return info;
  }

  // ---------------------------------------------------------------------------
  // Invitations
  // ---------------------------------------------------------------------------

  /** Invite un ami (dans une place précise si `slot` est donné). Exposé pour le clic droit. */
  App.invite = (name, slot) => {
    socket.emit('lobby:invite', { name, slot }, (res) => {
      if (!res?.ok) return App.toast(res?.error || 'Invitation impossible.', 'error');
      App.toast(`Invitation envoyée à ${name}.`, 'success', 2500);
    });
  };

  let inviteSlot = null;

  function openInviteModal(slot) {
    inviteSlot = slot;
    const inLobby = new Set(App.lobby.slots.map((s) => s.player?.name || s.pendingInvite).filter(Boolean));
    const candidates = App.friends.filter((f) => f.status !== 'offline' && !inLobby.has(f.name));
    const list = $('#invite-list');
    list.replaceChildren(
      ...candidates.map((friend) => {
        const li = document.createElement('li');
        li.className = 'invite-item';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--primary btn--sm';
        button.textContent = 'Inviter';
        button.dataset.name = friend.name;
        li.append(buildIcon(friend.icon), buildInfo(friend.name, friend.label), button);
        return li;
      }),
    );
    $('#invite-empty').hidden = candidates.length > 0;
    $('#invite-empty').textContent = App.friends.length
      ? 'Aucun ami disponible en ligne.'
      : 'Aucun ami pour l’instant : ajoute-en depuis le panneau Social.';
    App.openModal('modal-invite');
  }

  $('#invite-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-name]');
    if (!button) return;
    button.disabled = true;
    socket.emit('lobby:invite', { name: button.dataset.name, slot: inviteSlot }, (res) => {
      if (!res?.ok) {
        button.disabled = false;
        return App.toast(res?.error || 'Invitation impossible.', 'error');
      }
      button.textContent = 'Invité';
      button.closest('.invite-item').classList.add('is-invited');
    });
  });

  banners.addEventListener('click', (event) => {
    const button = event.target.closest('.banner__invite');
    if (button && !button.disabled) openInviteModal(Number(button.dataset.inviteSlot));
  });

  // Glisser-déposer un ami sur une place libre
  document.addEventListener('app:friend-drag', ({ detail }) => {
    $$('.banner--empty:not(.is-pending)', banners).forEach((b) => {
      b.classList.toggle('is-drop-target', detail.active && App.lobby?.status === 'lobby');
      if (!detail.active) b.classList.remove('is-drag-over');
    });
  });

  const dropTarget = (event) => {
    const banner = event.target.closest('.banner--empty:not(.is-pending)');
    return banner && App.lobby?.status === 'lobby' ? banner : null;
  };

  banners.addEventListener('dragover', (event) => {
    const banner = dropTarget(event);
    if (!banner) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    banner.classList.add('is-drag-over');
  });
  banners.addEventListener('dragleave', (event) => {
    const banner = dropTarget(event);
    if (banner && !banner.contains(event.relatedTarget)) banner.classList.remove('is-drag-over');
  });
  banners.addEventListener('drop', (event) => {
    const banner = dropTarget(event);
    if (!banner) return;
    event.preventDefault();
    banner.classList.remove('is-drag-over');
    const name = event.dataTransfer.getData('text/plain');
    if (name) App.invite(name, Number(banner.dataset.slot));
  });

  // Clic droit sur un joueur du salon : le chef peut l'exclure
  banners.addEventListener('contextmenu', (event) => {
    const banner = event.target.closest('.banner--filled');
    if (!banner) return;
    event.preventDefault();
    const name = banner.dataset.name;
    if (!isOwner() || name === App.me.name) return;
    const bot = banner.classList.contains('is-bot');
    App.openContextMenu(event.clientX, event.clientY, {
      kick: () => {
        if (bot) {
          socket.emit('lobby:removeBot', { slot: Number(banner.dataset.slot) }, (res) => {
            if (!res?.ok) App.toast(res?.error, 'error');
          });
          return;
        }
        socket.emit('lobby:kick', { name }, (res) => {
          if (!res?.ok) App.toast(res?.error, 'error');
        });
      },
    });
  });

  // Invitation reçue
  const tplInviteToast = $('#tpl-invite-toast');

  socket.on('lobby:invited', ({ lobbyId, from, fromIcon, expiresIn }) => {
    const toast = tplInviteToast.content.firstElementChild.cloneNode(true);
    $('.toast__title', toast).textContent = from;
    $('.summoner-icon__img', toast).src = App.iconUrl(fromIcon);
    toast.style.setProperty('--toast-duration', `${expiresIn}ms`);
    const timer = setTimeout(() => App.removeToast(toast), expiresIn);

    toast.addEventListener('click', (event) => {
      const button = event.target.closest('[data-invite-response]');
      if (!button) return;
      const accept = button.dataset.inviteResponse === 'accept';
      clearTimeout(timer);
      App.removeToast(toast);
      socket.emit('lobby:invite:respond', { lobbyId, accept }, (res) => {
        if (!res?.ok) return App.toast(res?.error || 'Invitation expirée.', 'error');
        if (accept) App.showView('lobby');
      });
    });

    $('#notifications').append(toast);
    if (App.settings.inviteSound) App.playChime();
  });

  socket.on('lobby:kicked', ({ by }) => {
    App.toast(`${by} t'a exclu du salon.`, 'error', 6000);
    App.showView('home');
  });

  // ---------------------------------------------------------------------------
  // Pions (un pion différent par joueur, affiché ensuite sur le plateau)
  // ---------------------------------------------------------------------------

  const PAWN_LABELS = {
    poro: 'Poro',
    teemo: 'Champignon de Teemo',
    ward: 'Balise',
    minion: 'Sbire',
    zhonya: 'Sablier de Zhonya',
    blade: 'Lame de Doran',
    tibbers: 'Tibbers',
    egg: 'Œuf d’Anivia',
    classic: 'Pion classique',
  };
  const pawnImage = (pawn) => `assets/pawns/${pawn}.svg`;

  function renderPawnPicker(el, player, lobby, me) {
    const current = $('.pawn-picker__current', el);
    const pawn = player.pawn || 'classic';
    const passive = lobby.rules?.passives !== false ? lobby.passives?.[pawn] : null;
    const img = $('.pawn-picker__img', current);
    img.src = pawnImage(pawn);
    img.dataset.skin = player.skin || 'base';
    const skin = player.skin && player.skin !== 'base' ? ` · ${lobby.skins?.[player.skin]?.name || ''}` : '';
    $('.pawn-picker__label', current).textContent = `${PAWN_LABELS[pawn]}${skin}`;
    current.disabled = !me || lobby.status !== 'lobby';
    current.title = `${me ? 'Choisir mon pion' : `Pion de ${player.name}`}${passive ? `\nPouvoir — ${passive.name} : ${passive.text}` : ''}`;
    if (!me) return;

    // Liste des pions : ceux déjà pris par un autre joueur sont grisés
    const takenBy = new Map(lobby.slots.filter((s) => s.player && s.player.name !== player.name)
      .map((s) => [s.player.pawn, s.player.name]));
    const list = $('.pawn-picker__list', el);
    list.replaceChildren(...(lobby.pawns || Object.keys(PAWN_LABELS)).map((id) => {
      const li = document.createElement('li');
      li.className = 'pawn-picker__option';
      li.setAttribute('role', 'option');
      li.dataset.pawn = id;
      li.tabIndex = 0;
      li.setAttribute('aria-selected', String(id === pawn));
      const owner = takenBy.get(id);
      if (owner) li.setAttribute('aria-disabled', 'true');
      const pv = lobby.rules?.passives !== false ? lobby.passives?.[id] : null;
      li.title = owner ? `${PAWN_LABELS[id]} — pris par ${owner}` : `${PAWN_LABELS[id]}${pv ? ` — ${pv.name} : ${pv.text}` : ''}`;
      const img = document.createElement('img');
      img.src = pawnImage(id);
      img.alt = '';
      const label = document.createElement('span');
      label.textContent = PAWN_LABELS[id];
      if (pv) {
        const small = document.createElement('small');
        small.className = 'pawn-picker__passive';
        small.textContent = pv.text;
        label.append(small);
      }
      li.append(img, label);
      return li;
    }));
  }

  // ---------------------------------------------------------------------------
  // Skins du pion : débloqués en jouant (parties jouées, victoires)
  // ---------------------------------------------------------------------------

  const unlocked = (skin, stats = {}) => (stats.games || 0) >= skin.games && (stats.wins || 0) >= skin.wins;
  const unlockHint = (skin) => [
    skin.games ? `${skin.games} partie${skin.games > 1 ? 's' : ''} jouée${skin.games > 1 ? 's' : ''}` : '',
    skin.wins ? `${skin.wins} victoire${skin.wins > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' et ');

  function renderSkins(el, player, lobby, me) {
    const box = $('.skin-picker', el);
    box.hidden = !me || !lobby.skins;
    if (box.hidden) return;
    const current = player.skin || 'base';
    box.replaceChildren(...Object.entries(lobby.skins).map(([id, skin]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin-picker__chip';
      b.dataset.skin = id;
      const open = unlocked(skin, player.stats);
      b.disabled = !open || lobby.status !== 'lobby';
      b.classList.toggle('is-locked', !open);
      b.setAttribute('aria-pressed', String(id === current));
      b.title = open ? `Skin ${skin.name}` : `${skin.name} — se débloque après ${unlockHint(skin)}`;
      b.setAttribute('aria-label', b.title);
      return b;
    }));
  }
  banners.addEventListener('click', (event) => {
    const chip = event.target.closest('.skin-picker__chip');
    if (!chip || chip.disabled) return;
    socket.emit('lobby:setSkin', { skin: chip.dataset.skin }, (res) => {
      if (!res?.ok) App.toast(res?.error || 'Skin indisponible.', 'error');
    });
  });

  // ---------------------------------------------------------------------------
  // Sorts d'invocateur : deux emplacements, un clic ouvre la liste des sorts
  // ---------------------------------------------------------------------------

  const spellIcon = (id) => `assets/spells/${id}.svg`;

  function renderSpells(el, player, lobby, me) {
    const box = $('.spell-slots', el);
    const enabled = lobby.rules?.spells !== false;
    box.hidden = !enabled;
    if (!enabled) return;
    const byId = new Map((lobby.spellList || []).map((sp) => [sp.id, sp]));
    const spells = player.spells || ['flash', 'heal'];
    $$('.spell-slot', box).forEach((btn, k) => {
      const sp = byId.get(spells[k]);
      $('img', btn).src = spellIcon(spells[k]);
      btn.title = sp ? `${sp.name} — ${sp.text} (recharge ${sp.cd} tours)` : '';
      btn.disabled = !me || lobby.status !== 'lobby';
      btn.setAttribute('aria-label', sp ? `Sort ${k + 1} : ${sp.name}` : `Sort ${k + 1}`);
    });
    if (!me) return;
    const picker = $('.spell-picker', box);
    picker.replaceChildren(...(lobby.spellList || []).map((sp) => {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'spell-picker__option';
      opt.dataset.spell = sp.id;
      opt.setAttribute('role', 'option');
      opt.setAttribute('aria-selected', String(spells.includes(sp.id)));
      const img = document.createElement('img');
      img.src = spellIcon(sp.id);
      img.alt = '';
      const txt = document.createElement('span');
      const name = document.createElement('b');
      name.textContent = `${sp.name} · ${sp.cd} tours`;
      const desc = document.createElement('small');
      desc.textContent = sp.text;
      txt.append(name, desc);
      opt.append(img, txt);
      return opt;
    }));
  }

  let spellSlotOpen = null;
  function closeSpellPickers() {
    $$('.spell-picker', banners).forEach((p) => { p.hidden = true; });
    spellSlotOpen = null;
  }
  banners.addEventListener('click', (event) => {
    const slot = event.target.closest('.spell-slot');
    if (slot && !slot.disabled) {
      const picker = slot.parentElement.querySelector('.spell-picker');
      const k = Number(slot.dataset.spellSlot);
      const reopen = picker.hidden || spellSlotOpen !== k;
      closeSpellPickers();
      closePawnPickers();
      closeRolePickers();
      if (reopen) {
        picker.hidden = false;
        spellSlotOpen = k;
      }
      return;
    }
    const option = event.target.closest('.spell-picker__option');
    if (option && spellSlotOpen !== null) {
      const me = App.lobby.slots.find((s) => s.player?.name === App.me.name)?.player;
      const spells = [...(me?.spells || ['flash', 'heal'])];
      const chosen = option.dataset.spell;
      const other = spells[1 - spellSlotOpen];
      // choisir le sort de l'autre emplacement les échange
      if (chosen === other) spells[1 - spellSlotOpen] = spells[spellSlotOpen];
      spells[spellSlotOpen] = chosen;
      closeSpellPickers();
      socket.emit('lobby:setSpells', { spells }, (res) => {
        if (!res?.ok) App.toast(res?.error || 'Choix impossible.', 'error');
      });
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.spell-slots')) closeSpellPickers();
  });

  // ---------------------------------------------------------------------------
  // Règles de la partie : règles maison (réglées par le chef) et aide
  // ---------------------------------------------------------------------------

  const rulesForm = document.getElementById('rules-form');
  function fillRules() {
    const lobby = App.lobby;
    if (!lobby) return;
    const rules = lobby.rules || {};
    const owner = isOwner() && lobby.status === 'lobby';
    for (const el of rulesForm.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') el.checked = rules[el.name] !== false;
      else if (el.tagName === 'SELECT') el.value = String(rules[el.name] ?? el.value);
      el.disabled = !owner;
    }
    rulesForm.elements.fountainDouble.checked = Boolean(rules.fountainDouble);
    document.getElementById('rules-who').textContent = owner
      ? 'Tu es le chef du salon : tes réglages s’appliquent à toute la partie.'
      : `Réglées par le chef du salon (${lobby.owner}).`;
    // aide : sorts, objets, quêtes
    const help = document.getElementById('rules-help-body');
    const section = (title, rows) => {
      const h = document.createElement('h3');
      h.textContent = title;
      const ul = document.createElement('ul');
      for (const [name, text] of rows) {
        const li = document.createElement('li');
        const b = document.createElement('b');
        b.textContent = name;
        li.append(b, ` — ${text}`);
        ul.append(li);
      }
      return [h, ul];
    };
    help.replaceChildren(
      ...section('Sorts d’invocateur (2 par joueur)', (lobby.spellList || []).map((sp) => [`${sp.name} (${sp.cd} tours)`, sp.text])),
      ...section('Quêtes de rôle', Object.entries(lobby.quests || {}).map(([role, q]) => [`${ROLE_LABELS[role]} — ${q.name}`, `${q.text}. Récompense : ${q.reward}.`])),
      ...section('Objets (3 au maximum, achetés à la Fontaine ou à la Boutique)', Object.values(lobby.items || {}).map((it) => [`${it.name} (${it.price} PO${it.tier === 'late' ? ', fin de partie' : ''})`, it.text])),
      ...(lobby.rules?.passives !== false ? section('Pouvoirs des pions', Object.entries(lobby.passives || {}).map(([id, pv]) => [`${PAWN_LABELS[id]} — ${pv.name}`, pv.text])) : []),
      ...(lobby.rules?.events !== false ? section('Événements de la Faille (un tous les 4 tours)', Object.values(lobby.events || {}).map((ev) => [ev.name, ev.text])) : []),
      ...section('Grands objectifs', [
        ['Âme du Dragon', 'Posséder les 4 Dragons : +30 % sur tous tes loyers pendant 5 tours.'],
        ['Dragon Ancien (tour 15)', 'Le premier à tomber sur une case Dragon : +30 % sur tous ses loyers pendant 5 tours (cumulable avec l’Âme).'],
        ['Héraut de la Faille (tour 8)', 'Apparaît dans la fosse du Baron : le joueur qui le récupère détruit une construction adverse.'],
        ['Baron Nashor (tour 3)', 'Loyers +50 % et +300 PO au prochain passage par la Fontaine.'],
      ]),
    );
  }
  App.openRules = () => {
    fillRules();
    App.openModal('modal-rules');
  };
  rulesForm.addEventListener('change', () => {
    if (!isOwner()) return;
    const el = rulesForm.elements;
    const rules = {
      spells: el.spells.checked,
      quests: el.quests.checked,
      items: el.items.checked,
      dragons: el.dragons.checked,
      herald: el.herald.checked,
      passives: el.passives.checked,
      events: el.events.checked,
      fountainDouble: el.fountainDouble.checked,
      startGold: Number(el.startGold.value),
      maxRounds: Number(el.maxRounds.value),
      turnTimer: Number(el.turnTimer.value),
    };
    socket.emit('lobby:setRules', { rules }, (res) => {
      if (!res?.ok) App.toast(res?.error || 'Réglage impossible.', 'error');
    });
  });

  function closePawnPickers() {
    $$('.pawn-picker__list', banners).forEach((list) => {
      list.hidden = true;
      list.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }

  function choosePawn(option) {
    if (option.getAttribute('aria-disabled') === 'true') {
      App.toast(option.title, 'info');
      return;
    }
    closePawnPickers();
    socket.emit('lobby:setPawn', { pawn: option.dataset.pawn }, (res) => {
      if (!res?.ok) App.toast(res?.error, 'error');
    });
  }

  banners.addEventListener('click', (event) => {
    const current = event.target.closest('.pawn-picker__current');
    if (current && !current.disabled) {
      const list = current.nextElementSibling;
      const open = list.hidden;
      closePawnPickers();
      closeRolePickers();
      list.hidden = !open;
      current.setAttribute('aria-expanded', String(open));
      if (open) $('.pawn-picker__option[aria-selected="true"]', list)?.focus();
      return;
    }
    const option = event.target.closest('.pawn-picker__option');
    if (option) choosePawn(option);
  });
  banners.addEventListener('keydown', (event) => {
    const option = event.target.closest('.pawn-picker__option');
    if (!option) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choosePawn(option);
    } else if (event.key === 'Escape') {
      closePawnPickers();
    }
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.pawn-picker')) closePawnPickers();
  });

  // ---------------------------------------------------------------------------
  // Rôles
  // ---------------------------------------------------------------------------

  function closeRolePickers(except) {
    $$('.role-picker__list', banners).forEach((list) => {
      if (list === except) return;
      list.hidden = true;
      list.previousElementSibling.setAttribute('aria-expanded', 'false');
    });
  }

  banners.addEventListener('click', (event) => {
    const current = event.target.closest('.role-picker__current');
    if (current && !current.disabled) {
      const list = current.nextElementSibling;
      closeRolePickers(list);
      list.hidden = !list.hidden;
      current.setAttribute('aria-expanded', String(!list.hidden));
      if (!list.hidden) $('.role-picker__option[aria-selected="true"], .role-picker__option', list).focus();
      return;
    }
    const option = event.target.closest('.role-picker__option');
    if (option) chooseRole(option.dataset.role);
  });

  banners.addEventListener('keydown', (event) => {
    const option = event.target.closest('.role-picker__option');
    if (!option) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseRole(option.dataset.role);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const sibling = event.key === 'ArrowRight' ? option.nextElementSibling : option.previousElementSibling;
      sibling?.focus();
    } else if (event.key === 'Escape') {
      closeRolePickers();
      option.closest('.role-picker').querySelector('.role-picker__current').focus();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.role-picker')) closeRolePickers();
  });

  $('#my-role-btn').addEventListener('click', (event) => {
    event.stopPropagation();
    $('.banner.is-me .role-picker__current', banners)?.click();
  });

  function chooseRole(role) {
    closeRolePickers();
    socket.emit('lobby:setRole', { role }, (res) => {
      if (!res?.ok) App.toast(res?.error, 'error');
    });
  }

  // ---------------------------------------------------------------------------
  // En-tête, onglets, code, quitter
  // ---------------------------------------------------------------------------

  $('#lobby-open').addEventListener('change', (event) => {
    socket.emit('lobby:setOpen', { open: event.target.checked }, (res) => {
      if (!res?.ok) {
        event.target.checked = !event.target.checked;
        App.toast(res?.error, 'error');
      }
    });
  });

  $('#lobby-code').addEventListener('click', async () => {
    const code = App.lobby?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      App.toast(`Code ${code} copié !`, 'success', 2500);
    } catch {
      App.toast(`Code du salon : ${code}`, 'info');
    }
  });

  // Panneau du bas : replié par défaut (onglets seuls), un clic l'ouvre, un 2ᵉ clic sur l'onglet actif le replie
  const lobbyPanel = $('.lobby-panel');
  $$('.lobby-panel__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const collapse = tab.classList.contains('is-active') && !lobbyPanel.classList.contains('is-collapsed');
      lobbyPanel.classList.toggle('is-collapsed', collapse);
      $$('.lobby-panel__tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
        t.setAttribute('aria-expanded', String(on && !collapse));
        document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      });
    });
  });

  $('#leave-lobby').addEventListener('click', () => {
    if (!App.inGroup()) return App.showView('home');
    socket.emit('lobby:leave', {}, (res) => {
      if (!res?.ok) return App.toast(res?.error, 'error');
      App.toast('Tu as quitté le salon.', 'info', 2500);
      App.showView('home');
    });
  });

  // ---------------------------------------------------------------------------
  // FIND MATCH
  // ---------------------------------------------------------------------------

  $('#find-match').addEventListener('click', (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.classList.add('is-searching');
    socket.emit('lobby:start', {}, (res) => {
      button.classList.remove('is-searching');
      if (res?.ok) return;
      renderFindMatch(App.lobby);
      App.toast(res?.error || 'Impossible de lancer la partie.', 'error');
    });
  });

  socket.on('lobby:matchFound', () => {
    const overlay = $('#match-found');
    overlay.hidden = false;
    // Le plateau (game.js) s'ouvre derrière cet écran ; on le révèle après l'animation.
    setTimeout(() => { overlay.hidden = true; }, 2600);
  });

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  const chatList = $('#chat-messages');
  const chatForm = $('#chat-form');
  const chatInput = $('#chat-input');
  const tplMessage = $('#tpl-chat-message');
  const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

  function buildMessage(msg) {
    const li = tplMessage.content.firstElementChild.cloneNode(true);
    const time = $('.chat__time', li);
    time.textContent = timeFormat.format(msg.ts);
    time.dateTime = new Date(msg.ts).toISOString();
    if (msg.type === 'system') {
      li.classList.add('chat__message--system');
    } else {
      $('.chat__author', li).textContent = msg.from;
      if (msg.from === App.me?.name) li.classList.add('chat__message--self');
    }
    // textContent : le texte des joueurs n'est jamais interprété comme du HTML
    $('.chat__text', li).textContent = msg.text;
    return li;
  }

  function scrollChat() {
    chatList.scrollTop = chatList.scrollHeight;
  }

  // Comme dans le client : les messages s'effacent après un moment sans activité,
  // et réapparaissent au survol du chat ou quand on écrit.
  const chatBox = $('#chat');
  let idleTimer = 0;
  function wakeChat() {
    chatBox.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => chatBox.classList.add('is-idle'), 12000);
  }

  socket.on('chat:history', (history) => {
    chatList.replaceChildren(...history.map(buildMessage));
    scrollChat();
    wakeChat();
  });

  socket.on('chat:message', (msg) => {
    const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    chatList.append(buildMessage(msg));
    if (nearBottom || msg.from === App.me?.name) scrollChat();
    wakeChat();
  });

  chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    socket.emit('chat:send', { text }, (res) => {
      if (!res?.ok) {
        chatInput.value = text;
        App.toast(res?.error || 'Message non envoyé.', 'error');
      }
    });
  });

  // Entrée depuis n'importe où dans le salon = écrire dans le chat
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || App.view !== 'lobby') return;
    if (event.target.closest('input, textarea, button, dialog, [role="option"]')) return;
    event.preventDefault();
    chatInput.focus();
  });
})();
