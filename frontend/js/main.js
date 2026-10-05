/**
 * LoL Monopoly — client : socle commun
 *
 * Connexion Socket.io, session (pseudo + icône), navigation Accueil ↔ Salon,
 * cartes de mode, fenêtres, notifications, panneau social et menu clic droit.
 * La logique du salon (bannières, invitations, chat, FIND MATCH) est dans lobby.js,
 * qui s'appuie sur l'objet global `App` exposé ici.
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const ICON_COUNT = 30; // même valeur que le serveur
  const STORAGE_SESSION = 'lolm.session';
  const STORAGE_SETTINGS = 'lolm.settings';
  const DEFAULT_SETTINGS = { volume: 60, music: 35, quality: 'auto', chatTimestamps: true, inviteSound: true, reduceMotion: false };

  // Le stockage local peut être indisponible (navigation privée…) : on ne plante jamais dessus.
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignoré */ }
    },
    remove(key) {
      try { localStorage.removeItem(key); } catch { /* ignoré */ }
    },
  };

  const socket = io();

  const App = {
    socket,
    $,
    $$,
    me: null, // { name, icon }
    lobby: null, // dernier `lobby:state` reçu (rempli par lobby.js)
    friends: [],
    settings: { ...DEFAULT_SETTINGS, ...store.get(STORAGE_SETTINGS, {}) },
    view: 'home',
  };
  window.App = App;

  // ---------------------------------------------------------------------------
  // Icônes d'invocateur (générées en SVG : aucun fichier à charger)
  // ---------------------------------------------------------------------------

  const ICON_GLYPHS = [
    'M44 12h8v8L32 40l4 4-4 4-4-4-6 6 2 2-4 4-6-6 4-4 2 2 6-6-4-4 4-4 4 4z', // épée
    'M32 12l16 6v12c0 11-7 18-16 22-9-4-16-11-16-22V18z', // bouclier
    'M32 12l5.9 12.6L52 26.4l-10.2 9.7 2.5 13.9L32 43.4 19.7 50l2.5-13.9L12 26.4l14.1-1.8z', // étoile
    'M32 10c4 8 14 13 14 26a14 14 0 0 1-28 0c0-7 4-11 7-14 0 5 2 8 5 9-2-8 0-15 2-21z', // flamme
    'M32 10c8 12 14 20 14 28a14 14 0 0 1-28 0c0-8 6-16 14-28z', // goutte
    'M38 12a20 20 0 1 0 14 30 16 16 0 1 1-14-30z', // lune
    'M12 22l10 9 10-15 10 15 10-9-4 24H16z', // couronne
    'M8 32c6-10 14-15 24-15s18 5 24 15c-6 10-14 15-24 15S14 42 8 32zm24-8a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', // œil
    'M48 14C24 14 14 26 14 44c0 2 0 4 1 6 4-10 12-18 22-22-8 6-14 13-17 22 22 2 30-14 28-36z', // feuille
    'M36 8L16 36h12l-4 20 20-28H32z', // éclair
  ];

  const iconCache = new Map();
  App.iconUrl = (index) => {
    const i = Number.isInteger(index) ? ((index % ICON_COUNT) + ICON_COUNT) % ICON_COUNT : 0;
    if (iconCache.has(i)) return iconCache.get(i);
    const hue = (i * 47) % 360;
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<defs><radialGradient id='b' cx='.35' cy='.3' r='.9'>` +
      `<stop offset='0' stop-color='hsl(${hue},55%,50%)'/>` +
      `<stop offset='1' stop-color='hsl(${(hue + 25) % 360},60%,11%)'/>` +
      `</radialGradient></defs>` +
      `<rect width='64' height='64' fill='url(#b)'/>` +
      `<path fill-rule='evenodd' d='${ICON_GLYPHS[i % ICON_GLYPHS.length]}' fill='hsl(${hue},70%,88%)' fill-opacity='.92'/>` +
      `</svg>`;
    const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    iconCache.set(i, url);
    return url;
  };

  /** Remplit une grille de choix d'icône (<label class="icon-option">…). */
  function fillIconPicker(grid, inputName, selected) {
    grid.replaceChildren();
    for (let i = 0; i < ICON_COUNT; i++) {
      const label = document.createElement('label');
      label.className = 'icon-option';
      label.title = `Icône ${i + 1}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = inputName;
      input.value = String(i);
      input.checked = i === selected;
      const img = document.createElement('img');
      img.src = App.iconUrl(i);
      img.alt = `Icône ${i + 1}`;
      label.append(input, img);
      grid.append(label);
    }
  }

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------

  const notifications = $('#notifications');

  App.removeToast = (toast) => {
    if (!toast.isConnected || toast.classList.contains('is-leaving')) return;
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 400); // si les animations sont coupées
  };

  App.toast = (message, level = 'info', duration = 4000) => {
    const toast = document.createElement('div');
    toast.className = `toast toast--${level}`;
    toast.setAttribute('role', level === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    notifications.append(toast);
    setTimeout(() => App.removeToast(toast), duration);
    return toast;
  };

  /** Petit « ding » (pas de fichier son), au volume des paramètres. */
  App.playChime = () => {
    const volume = App.settings.volume / 100;
    if (!volume) return;
    try {
      const ctx = App.audio ?? (App.audio = new AudioContext());
      const now = ctx.currentTime;
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, now + i * 0.09);
        gain.gain.linearRampToValueAtTime(0.18 * volume, now + i * 0.09 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.09);
        osc.stop(now + i * 0.09 + 0.55);
      });
    } catch { /* audio indisponible : tant pis */ }
  };

  socket.on('notify', ({ level, message }) => App.toast(message, level));

  // ---------------------------------------------------------------------------
  // Fenêtres (dialog)
  // ---------------------------------------------------------------------------

  App.openModal = (id) => {
    const dialog = document.getElementById(id);
    if (!dialog.open) dialog.showModal();
    return dialog;
  };
  App.closeModal = (id) => document.getElementById(id).close();

  document.addEventListener('click', (event) => {
    const closer = event.target.closest('[data-close-modal]');
    if (closer) closer.closest('dialog').close();
  });
  // Clic sur le fond sombre = fermer
  $$('dialog.modal').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  function showFormError(form, message) {
    const el = $('.form-error', form);
    el.textContent = message || '';
    el.hidden = !message;
  }
  App.showFormError = showFormError;

  // ---------------------------------------------------------------------------
  // Paramètres
  // ---------------------------------------------------------------------------

  function applySettings() {
    document.body.classList.toggle('reduce-motion', App.settings.reduceMotion);
    document.body.classList.toggle('hide-chat-time', !App.settings.chatTimestamps);
  }

  App.openSettings = () => openSettings();
  function openSettings() {
    const form = $('#settings-form');
    form.elements.volume.value = App.settings.volume;
    form.elements.music.value = App.settings.music;
    form.elements.quality.value = App.settings.quality;
    form.elements.chatTimestamps.checked = App.settings.chatTimestamps;
    form.elements.inviteSound.checked = App.settings.inviteSound;
    form.elements.reduceMotion.checked = App.settings.reduceMotion;
    App.openModal('modal-settings');
  }

  $('#settings-form').addEventListener('submit', (event) => {
    const form = event.currentTarget;
    App.settings = {
      volume: Number(form.elements.volume.value),
      music: Number(form.elements.music.value),
      quality: form.elements.quality.value,
      chatTimestamps: form.elements.chatTimestamps.checked,
      inviteSound: form.elements.inviteSound.checked,
      reduceMotion: form.elements.reduceMotion.checked,
    };
    store.set(STORAGE_SETTINGS, App.settings);
    applySettings();
    document.dispatchEvent(new CustomEvent('lolm:settings', { detail: App.settings }));
    App.toast('Paramètres enregistrés.', 'success');
  });

  $('#logout-btn').addEventListener('click', () => {
    store.remove(STORAGE_SESSION);
    location.reload();
  });

  applySettings();

  // ---------------------------------------------------------------------------
  // Connexion
  // ---------------------------------------------------------------------------

  const loginScreen = $('#login-screen');
  const loginForm = $('#login-form');
  const loginError = $('#login-error');
  let autoLoginRetried = false;

  function showLogin(message) {
    const saved = store.get(STORAGE_SESSION, null);
    if (!$('#login-icons').children.length) {
      fillIconPicker($('#login-icons'), 'icon', saved?.icon ?? 0);
    }
    if (saved && !loginForm.elements.name.value) loginForm.elements.name.value = saved.name;
    loginError.textContent = message || '';
    loginError.hidden = !message;
    loginScreen.hidden = false;
    loginForm.elements.name.focus();
  }

  function login(name, icon, { silent = false } = {}) {
    socket.emit('session:login', { name, icon }, (res) => {
      if (!res?.ok) {
        // Juste après un F5, l'ancienne connexion n'est pas encore fermée côté serveur : on réessaie une fois.
        if (silent && !autoLoginRetried && /déjà connecté/.test(res?.error || '')) {
          autoLoginRetried = true;
          setTimeout(() => login(name, icon, { silent }), 1500);
          return;
        }
        showLogin(res?.error || 'Connexion impossible.');
        return;
      }
      App.me = res.user;
      store.set(STORAGE_SESSION, App.me);
      loginScreen.hidden = true;
      renderProfile();
      document.dispatchEvent(new CustomEvent('app:login', { detail: App.me }));
    });
  }

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = loginForm.elements.name.value.trim();
    const checked = loginForm.querySelector('input[name="icon"]:checked');
    login(name, checked ? Number(checked.value) : 0);
  });

  socket.on('connect', () => {
    const session = App.me || store.get(STORAGE_SESSION, null);
    if (session) login(session.name, session.icon, { silent: true });
    else showLogin();
  });

  socket.on('disconnect', () => {
    App.toast('Connexion au serveur perdue… reconnexion en cours.', 'error', 5000);
  });

  // ---------------------------------------------------------------------------
  // Profil (en haut à droite)
  // ---------------------------------------------------------------------------

  function renderProfile() {
    if (!App.me) return;
    $('#profile-name').textContent = App.me.name;
    $('#profile-icon-img').src = App.iconUrl(App.me.icon);
    $('#profile-icon-img').alt = `Icône de ${App.me.name}`;
    const status = $('#profile-status');
    const players = App.lobby ? App.lobby.slots.filter((s) => s.player).length : 1;
    if (App.lobby?.status === 'in-game') {
      status.dataset.status = 'in-game';
      status.textContent = 'En partie';
    } else if (players > 1) {
      status.dataset.status = 'in-lobby';
      status.textContent = `En salon · ${players}/${App.lobby.maxPlayers}`;
    } else {
      status.dataset.status = 'online';
      status.textContent = 'En ligne';
    }
  }
  App.renderProfile = renderProfile;

  // ---------------------------------------------------------------------------
  // Navigation Accueil ↔ Salon
  // ---------------------------------------------------------------------------

  App.showView = (view) => {
    App.view = view;
    $('#view-home').hidden = view !== 'home';
    $('#view-lobby').hidden = view !== 'lobby';
    $('#play-button').classList.toggle('is-active', view === 'home');
    document.dispatchEvent(new CustomEvent('app:view', { detail: view }));
  };

  /** Vrai si le joueur est dans un salon avec au moins une autre personne. */
  App.inGroup = () => Boolean(App.lobby && App.lobby.slots.filter((s) => s.player).length > 1);

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-nav]');
    if (!nav) return;
    event.preventDefault();
    if (nav.dataset.nav === 'home') App.showView('home');
    else App.toast('Cette page arrive bientôt.', 'info');
  });

  // Boutons d'action présents à plusieurs endroits
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'settings') openSettings();
    if (action === 'add-friend') openAddFriend();
    if (action === 'rules') App.toast('Les règles détaillées arriveront avec le plateau (étape 4).', 'info');
  });

  // ---------------------------------------------------------------------------
  // Écran d'accueil : cartes de mode
  // ---------------------------------------------------------------------------

  const CONFIRM_LABELS = { create: 'Confirmer', join: 'Rejoindre', skin: 'Ouvrir', shop: 'Ouvrir', settings: 'Ouvrir' };
  let currentMode = 'create';

  function selectMode(mode) {
    currentMode = mode;
    $$('.mode-card').forEach((card) => {
      const on = card.dataset.mode === mode;
      card.classList.toggle('is-selected', on);
      card.setAttribute('aria-checked', String(on));
    });
    $$('.mode-details__panel').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== mode;
    });
    $('#home-confirm .confirm-btn__label').textContent = CONFIRM_LABELS[mode];
    if (mode === 'join') setTimeout(() => $('#join-lobby-code').focus(), 0);
  }

  $('#modes').addEventListener('click', (event) => {
    const card = event.target.closest('.mode-card');
    if (card) selectMode(card.dataset.mode);
  });
  // Double-clic sur une carte = choisir et confirmer
  $('#modes').addEventListener('dblclick', (event) => {
    if (event.target.closest('.mode-card')) confirmMode();
  });
  // Flèches gauche/droite dans le groupe de cartes
  $('#modes').addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const cards = $$('.mode-card');
    const index = cards.findIndex((c) => c.dataset.mode === currentMode);
    const next = cards[(index + (event.key === 'ArrowRight' ? 1 : -1) + cards.length) % cards.length];
    selectMode(next.dataset.mode);
    next.focus();
    event.preventDefault();
  });

  $$('[data-mode-shortcut]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      selectMode(link.dataset.modeShortcut);
    });
  });

  function joinByCode() {
    const form = $('#join-lobby-form');
    const code = $('#join-lobby-code').value.trim().toUpperCase();
    if (code.length !== 6) {
      showFormError(form, 'Le code fait 6 caractères.');
      return;
    }
    showFormError(form, '');
    socket.emit('lobby:join', { code }, (res) => {
      if (!res?.ok) return showFormError(form, res?.error);
      $('#join-lobby-code').value = '';
      App.showView('lobby');
    });
  }

  function confirmMode() {
    if (!App.me) return;
    switch (currentMode) {
      case 'create':
        // Déjà dans un salon à plusieurs : on y retourne ; sinon on ouvre son salon (créé à la connexion).
        App.showView('lobby');
        break;
      case 'join':
        joinByCode();
        break;
      case 'skin':
        openSkin();
        break;
      case 'shop':
        openShop();
        break;
      case 'settings':
        openSettings();
        break;
    }
  }

  $('#home-confirm').addEventListener('click', confirmMode);
  $('#home-cancel').addEventListener('click', () => {
    if (App.inGroup()) App.showView('lobby');
    else selectMode('create');
  });
  $('#join-lobby-form').addEventListener('submit', (event) => {
    event.preventDefault();
    joinByCode();
  });
  $('#join-lobby-code').addEventListener('input', (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // ---------------------------------------------------------------------------
  // Skin & Boutique
  // ---------------------------------------------------------------------------

  function openSkin() {
    fillIconPicker($('#skin-icons'), 'skin-icon', App.me.icon);
    const tokens = $('#skin-tokens');
    if (!tokens.children.length) {
      const note = document.createElement('p');
      note.className = 'social__empty';
      note.textContent = 'Les pions arriveront avec le plateau (étape 4).';
      tokens.append(note);
    }
    App.openModal('modal-skin');
  }

  $('#skin-form').addEventListener('submit', (event) => {
    const checked = event.currentTarget.querySelector('input[name="skin-icon"]:checked');
    if (!checked || Number(checked.value) === App.me.icon) return;
    socket.emit('session:setIcon', { icon: Number(checked.value) }, (res) => {
      if (!res?.ok) return App.toast(res?.error || 'Impossible de changer d’icône.', 'error');
      App.me.icon = res.icon;
      store.set(STORAGE_SESSION, App.me);
      renderProfile();
      App.toast('Nouvelle icône enregistrée.', 'success');
    });
  });

  function openShop() {
    $('#shop-balance').textContent = $('#gold-balance').textContent;
    const grid = $('#shop-items');
    if (!grid.children.length) {
      const note = document.createElement('li');
      note.className = 'social__empty';
      note.style.gridColumn = '1 / -1';
      note.textContent = 'La boutique ouvrira avec le plateau (étape 4) : l’or gagné en partie servira à acheter pions, icônes et bannières.';
      grid.append(note);
    }
    App.openModal('modal-shop');
  }

  $$('.shop-tabs__tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.shop-tabs__tab').forEach((t) => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Panneau social
  // ---------------------------------------------------------------------------

  const tplFriend = $('#tpl-friend');
  const tplRequest = $('#tpl-friend-request');

  function renderFriends({ friends, requests }) {
    App.friends = friends;
    const online = friends.filter((f) => f.status !== 'offline').sort((a, b) => a.name.localeCompare(b.name));
    const offline = friends.filter((f) => f.status === 'offline').sort((a, b) => a.name.localeCompare(b.name));

    const build = (friend) => {
      const li = tplFriend.content.firstElementChild.cloneNode(true);
      li.dataset.name = friend.name;
      li.dataset.status = friend.status;
      li.draggable = friend.status !== 'offline';
      $('.friend__name', li).textContent = friend.name;
      $('.friend__status', li).textContent = friend.label;
      const img = $('.summoner-icon__img', li);
      img.src = App.iconUrl(friend.icon);
      img.alt = '';
      return li;
    };
    $('#friends-online').replaceChildren(...online.map(build));
    $('#friends-offline').replaceChildren(...offline.map(build));
    $('#friends-online-count').textContent = online.length;
    $('#friends-total-count').textContent = friends.length;
    $('#friends-empty').hidden = friends.length > 0;

    const requestItems = requests.map((req) => {
      const li = tplRequest.content.firstElementChild.cloneNode(true);
      li.dataset.name = req.name;
      $('.friend__name', li).textContent = req.name;
      $('.summoner-icon__img', li).src = App.iconUrl(req.icon);
      return li;
    });
    $('#friend-requests').replaceChildren(...requestItems);
    $('#friend-requests-count').textContent = requests.length;
    $('#friend-requests-group').hidden = requests.length === 0;

    document.dispatchEvent(new CustomEvent('app:friends', { detail: friends }));
  }

  socket.on('friends:update', renderFriends);

  $('#friend-requests').addEventListener('click', (event) => {
    const button = event.target.closest('[data-respond]');
    if (!button) return;
    const name = button.closest('.friend').dataset.name;
    socket.emit('friends:respond', { name, accept: button.dataset.respond === 'accept' }, (res) => {
      if (!res?.ok) App.toast(res?.error, 'error');
    });
  });

  // Ajouter un ami
  function openAddFriend() {
    const form = $('#add-friend-form');
    form.reset();
    showFormError(form, '');
    App.openModal('modal-add-friend');
  }

  $('#add-friend-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = form.elements.name.value.trim();
    socket.emit('friends:add', { name }, (res) => {
      if (!res?.ok) return showFormError(form, res?.error);
      App.closeModal('modal-add-friend');
      App.toast(res.accepted ? `${name} et toi êtes maintenant amis.` : `Demande envoyée à ${name}.`, 'success');
    });
  });

  // Glisser un ami : on transporte son pseudo (le dépôt est géré par lobby.js)
  const socialScroll = $('.social__scroll');
  socialScroll.addEventListener('dragstart', (event) => {
    const friend = event.target.closest('.friend:not(.friend--request)');
    if (!friend || friend.dataset.status === 'offline') return event.preventDefault();
    event.dataTransfer.setData('text/plain', friend.dataset.name);
    event.dataTransfer.effectAllowed = 'copy';
    friend.classList.add('is-dragging');
    document.dispatchEvent(new CustomEvent('app:friend-drag', { detail: { name: friend.dataset.name, active: true } }));
  });
  socialScroll.addEventListener('dragend', (event) => {
    event.target.closest?.('.friend')?.classList.remove('is-dragging');
    document.dispatchEvent(new CustomEvent('app:friend-drag', { detail: { active: false } }));
  });

  // ---------------------------------------------------------------------------
  // Menu contextuel (clic droit)
  // ---------------------------------------------------------------------------

  const contextMenu = $('#context-menu');
  let contextActions = {};

  /** actions : { invite?: fn, kick?: fn, 'remove-friend'?: fn } — seules celles fournies s'affichent. */
  App.openContextMenu = (x, y, actions) => {
    contextActions = actions;
    let visible = 0;
    $$('.context-menu__item', contextMenu).forEach((item) => {
      const show = typeof actions[item.dataset.ctx] === 'function';
      item.parentElement.hidden = !show;
      if (show) visible++;
    });
    if (!visible) return;
    contextMenu.hidden = false;
    const { width, height } = contextMenu.getBoundingClientRect();
    contextMenu.style.left = `${Math.min(x, innerWidth - width - 8)}px`;
    contextMenu.style.top = `${Math.min(y, innerHeight - height - 8)}px`;
    $('.context-menu__item:not([hidden])', contextMenu)?.focus?.();
  };

  function closeContextMenu() {
    contextMenu.hidden = true;
    contextActions = {};
  }

  contextMenu.addEventListener('click', (event) => {
    const item = event.target.closest('.context-menu__item');
    if (!item) return;
    const action = contextActions[item.dataset.ctx];
    closeContextMenu();
    action?.();
  });
  document.addEventListener('click', (event) => {
    if (!contextMenu.contains(event.target)) closeContextMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeContextMenu();
  });
  window.addEventListener('blur', closeContextMenu);
  window.addEventListener('resize', closeContextMenu);

  // Clic droit sur un ami
  socialScroll.addEventListener('contextmenu', (event) => {
    const friend = event.target.closest('.friend:not(.friend--request)');
    if (!friend) return;
    event.preventDefault();
    const name = friend.dataset.name;
    const inMyLobby = App.lobby?.slots.some((s) => s.player?.name === name);
    App.openContextMenu(event.clientX, event.clientY, {
      invite: friend.dataset.status !== 'offline' && !inMyLobby ? () => App.invite?.(name) : null,
      'remove-friend': () => {
        socket.emit('friends:remove', { name }, (res) => {
          if (res?.ok) App.toast(`${name} a été retiré de tes amis.`, 'info');
          else App.toast(res?.error, 'error');
        });
      },
    });
  });
  // Clavier : touche « menu contextuel » ou Maj+F10 sur un ami sélectionné
  socialScroll.addEventListener('keydown', (event) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    const friend = event.target.closest('.friend');
    if (!friend) return;
    event.preventDefault();
    const rect = friend.getBoundingClientRect();
    friend.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 20, clientY: rect.bottom }));
  });
})();
