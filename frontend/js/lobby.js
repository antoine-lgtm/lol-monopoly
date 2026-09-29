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

  // ---------------------------------------------------------------------------
  // Les bannières grandissent avec la fenêtre : 5 colonnes sur toute la largeur,
  // sans descendre sous le chat, FIND MATCH et le panneau Partie.
  // ---------------------------------------------------------------------------

  const BANNER_W = 196; // largeur d'une colonne à l'échelle 1 (--col)
  const BANNER_H = 540; // hauteur d'une colonne à l'échelle 1
  const FOOTER_SPACE = 170; // place gardée en bas pour le chat et FIND MATCH

  function fitBanners() {
    const view = $('#view-lobby');
    if (view.hidden) return;
    const width = banners.clientWidth - 32;
    const height = view.clientHeight - FOOTER_SPACE;
    const zoom = Math.max(0.7, Math.min(width / (5 * BANNER_W), height / BANNER_H, 1.6));
    banners.style.setProperty('--banner-zoom', zoom.toFixed(3));
  }

  new ResizeObserver(fitBanners).observe($('#view-lobby'));
  document.addEventListener('app:view', fitBanners);

  const players = (lobby) => lobby.slots.filter((s) => s.player);
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
    renderInvites(lobby);
    renderPartyCard(lobby);
    App.renderProfile();
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
      el.style.order = orderOf.get(slot.index);
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

    $('.banner__name-text', el).textContent = player.name;
    $('.banner__crown', el).hidden = !player.isOwner;
    $('.banner__badge', el).hidden = !player.isOwner;
    $('.banner__status', el).textContent = !player.connected
      ? 'Reconnexion…'
      : lobby.status === 'in-game' ? 'En partie' : player.isOwner ? 'Chef du salon' : 'Prêt';

    const img = $('.summoner-icon__img', el);
    img.src = App.iconUrl(player.icon);
    img.alt = `Icône de ${player.name}`;

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
    return el;
  }

  function renderTools(lobby) {
    $('#lobby-code-value').textContent = lobby.code;
    $('#room-players').textContent = `${players(lobby).length}/${lobby.maxPlayers}`;
    const toggle = $('#lobby-open');
    toggle.checked = lobby.open;
    toggle.disabled = !isOwner();
    toggle.closest('.party-toggle').title = lobby.open
      ? 'Salon ouvert : on peut le rejoindre avec le code'
      : 'Salon fermé : sur invitation uniquement';
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
    App.openContextMenu(event.clientX, event.clientY, {
      kick: () => {
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

  $$('.lobby-panel__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.lobby-panel__tab').forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
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
      if (res?.ok) return;
      button.classList.remove('is-searching');
      renderFindMatch(App.lobby);
      App.toast(res?.error || 'Impossible de lancer la partie.', 'error');
    });
  });

  socket.on('lobby:matchFound', () => {
    const overlay = $('#match-found');
    overlay.hidden = false;
    // Le plateau arrive à l'étape 4 : pour l'instant on referme l'écran après quelques secondes.
    setTimeout(() => {
      overlay.hidden = true;
      App.toast('Partie lancée ! Le plateau arrive à l’étape 4.', 'success', 6000);
    }, 3500);
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

  socket.on('chat:history', (history) => {
    chatList.replaceChildren(...history.map(buildMessage));
    scrollChat();
  });

  socket.on('chat:message', (msg) => {
    const nearBottom = chatList.scrollHeight - chatList.scrollTop - chatList.clientHeight < 40;
    chatList.append(buildMessage(msg));
    if (nearBottom || msg.from === App.me?.name) scrollChat();
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
