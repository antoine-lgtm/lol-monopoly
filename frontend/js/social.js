/**
 * LoL Monopoly — client : vie sociale
 *
 * Discussions (messages privés entre amis, gardés et livrés hors ligne), recherche, tri et
 * dossiers de la liste d'amis, notifications d'amis (connexion, fin de partie) et page
 * de profil détaillée (la sienne ou celle d'un ami). S'appuie sur `App` (main.js).
 */
(() => {
  'use strict';

  const { socket, $, $$ } = App;
  const timeFormat = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
  const fmtNum = (n) => new Intl.NumberFormat('fr-FR').format(n);
  const BOARD_NAMES = { rift: 'Faille de l’Invocateur', aram: 'Abîme Hurlant' };

  // ---------------------------------------------------------------------------
  // Recherche et tri de la liste d'amis
  // ---------------------------------------------------------------------------

  const searchBtn = $('#friend-search-btn');
  const searchBar = $('#friend-search-bar');
  const searchInput = $('#friend-search');
  searchBtn.addEventListener('click', () => {
    const open = searchBar.hidden;
    searchBar.hidden = !open;
    searchBtn.setAttribute('aria-expanded', String(open));
    searchBtn.classList.toggle('is-active', open);
    if (open) {
      searchInput.focus();
    } else {
      searchInput.value = '';
      App.friendView.query = '';
      App.renderFriends();
    }
  });
  searchInput.addEventListener('input', () => {
    App.friendView.query = searchInput.value;
    App.renderFriends();
  });
  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') searchBtn.click();
  });

  const sortBtn = $('#friend-sort-btn');
  const syncSort = () => { sortBtn.title = `Trier : ${App.FRIEND_SORTS[App.friendView.sort]}`; };
  syncSort();
  sortBtn.addEventListener('click', () => {
    const order = Object.keys(App.FRIEND_SORTS);
    const next = order[(order.indexOf(App.friendView.sort) + 1) % order.length];
    App.setFriendSort(next);
    syncSort();
    App.toast(`Amis triés ${App.FRIEND_SORTS[next]}.`, 'info', 1800);
  });

  // ---------------------------------------------------------------------------
  // Dossiers d'amis
  // ---------------------------------------------------------------------------

  const folderForm = $('#folder-form');
  let editedFolder = null; // dossier ouvert à la modification (null = nouveau)

  /** Ouvre la fenêtre d'un dossier : celui de `friendName` s'il est rangé, sinon un nouveau. */
  App.openFolder = (friendName = null) => {
    const friend = friendName && App.friends.find((f) => f.name === friendName);
    editedFolder = friend?.folder || null;
    folderForm.reset();
    App.showFormError(folderForm, '');
    folderForm.elements.folder.value = editedFolder || '';
    $('#folder-names').replaceChildren(...(App.friendFolders || []).map((name) => Object.assign(document.createElement('option'), { value: name })));
    renderFolderFriends(editedFolder, friendName);
    App.openModal('modal-folder');
    folderForm.elements.folder.focus();
  };

  function renderFolderFriends(folder, extra) {
    const list = $('#folder-friends');
    const friends = [...App.friends].sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(...friends.map((f) => {
      const li = document.createElement('li');
      const label = document.createElement('label');
      label.className = 'folder-friends__item';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.value = f.name;
      box.checked = (folder && f.folder === folder) || f.name === extra;
      const img = document.createElement('img');
      img.src = App.iconUrl(f.icon);
      img.alt = '';
      const name = document.createElement('span');
      name.textContent = f.name;
      const where = document.createElement('small');
      where.textContent = f.folder && f.folder !== folder ? `(${f.folder})` : '';
      label.append(box, img, name, where);
      li.append(label);
      return li;
    }));
    if (!friends.length) list.replaceChildren(Object.assign(document.createElement('li'), { className: 'social__empty', textContent: 'Ajoute d’abord des amis.' }));
  }

  // En tapant le nom d'un dossier existant, on coche ses membres
  folderForm.elements.folder.addEventListener('change', () => {
    const name = folderForm.elements.folder.value.trim();
    if (App.friendFolders?.includes(name)) {
      editedFolder = name;
      renderFolderFriends(name, null);
    }
  });

  $('#friend-folder-btn').addEventListener('click', () => App.openFolder(null));

  folderForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const folder = folderForm.elements.folder.value.replace(/\s+/g, ' ').trim();
    if (!folder) return App.showFormError(folderForm, 'Donne un nom au dossier.');
    const boxes = $$('#folder-friends input[type="checkbox"]');
    const emit = (name, value) => new Promise((resolve) => socket.emit('friends:setFolder', { name, folder: value }, resolve));
    const changes = [];
    for (const box of boxes) {
      const friend = App.friends.find((f) => f.name === box.value);
      if (!friend) continue;
      if (box.checked && friend.folder !== folder) changes.push(emit(friend.name, folder));
      // décoché : il sort du dossier (s'il y était, ou s'il était dans le dossier renommé)
      if (!box.checked && (friend.folder === folder || (editedFolder && friend.folder === editedFolder))) changes.push(emit(friend.name, ''));
      // dossier renommé : ses membres cochés suivent
    }
    const results = await Promise.all(changes);
    const error = results.find((r) => !r?.ok);
    if (error) return App.showFormError(folderForm, error.error || 'Impossible de ranger cet ami.');
    App.closeModal('modal-folder');
    if (!boxes.some((b) => b.checked)) App.toast('Dossier vide : il disparaît de la liste.', 'info', 2500);
  });

  // ---------------------------------------------------------------------------
  // Notifications d'amis
  // ---------------------------------------------------------------------------

  socket.on('friends:event', (event) => {
    if (event.type === 'online') {
      App.sound?.('friend');
      App.toast(`${event.name} vient de se connecter.`, 'info', 3500);
    } else if (event.type === 'gameOver') {
      const how = event.won ? 'a gagné sa partie' : event.place ? `a terminé sa partie (${event.place}ᵉ)` : 'a terminé sa partie';
      App.toast(`${event.name} ${how} : de nouveau disponible !`, event.won ? 'success' : 'info', 4500);
    }
  });

  // ---------------------------------------------------------------------------
  // Discussions (messages privés)
  // ---------------------------------------------------------------------------

  const panel = $('#dm-panel');
  const openBtn = $('#dm-open');
  const threads = $('#dm-threads');
  const messages = $('#dm-messages');
  const form = $('#dm-form');
  const input = $('#dm-input');
  let current = null; // pseudo de l'ami dont la conversation est ouverte

  const friendOf = (name) => App.friends.find((f) => f.name === name);

  function setPanel(open) {
    panel.hidden = !open;
    openBtn.setAttribute('aria-expanded', String(open));
    openBtn.classList.toggle('is-active', open);
    if (!open) current = null;
  }

  function showThreads() {
    current = null;
    $('#dm-title').textContent = 'Discussions';
    $('#dm-back').hidden = true;
    $('#dm-icon').hidden = true;
    messages.hidden = true;
    form.hidden = true;
    const friends = [...App.friends].sort((a, b) => (b.unread || 0) - (a.unread || 0)
      || (a.status === 'offline') - (b.status === 'offline') || a.name.localeCompare(b.name));
    threads.hidden = false;
    threads.replaceChildren(...friends.map((f) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dm-thread';
      btn.dataset.status = f.status;
      const img = document.createElement('img');
      img.src = App.iconUrl(f.icon);
      img.alt = '';
      const info = document.createElement('span');
      info.className = 'dm-thread__info';
      const name = document.createElement('b');
      name.textContent = f.name;
      const status = document.createElement('small');
      status.textContent = f.label;
      info.append(name, status);
      btn.append(img, info);
      if (f.unread) {
        const badge = document.createElement('span');
        badge.className = 'count-badge';
        badge.textContent = f.unread;
        btn.append(badge);
      }
      btn.addEventListener('click', () => App.openDm(f.name));
      li.append(btn);
      return li;
    }));
    $('#dm-threads-empty').hidden = friends.length > 0;
  }

  function buildMessage(msg) {
    const li = document.createElement('li');
    const self = msg.from === App.me?.name;
    li.className = `dm-msg${self ? ' dm-msg--self' : ''}`;
    const text = document.createElement('span');
    text.className = 'dm-msg__text';
    text.textContent = msg.text; // jamais interprété comme du HTML
    const time = document.createElement('time');
    time.className = 'dm-msg__time';
    time.dateTime = new Date(msg.ts).toISOString();
    const sameDay = new Date(msg.ts).toDateString() === new Date().toDateString();
    time.textContent = sameDay ? timeFormat.format(msg.ts) : `${dayFormat.format(msg.ts)} ${timeFormat.format(msg.ts)}`;
    li.append(text, time);
    return li;
  }

  /** Ouvre la conversation avec un ami (historique des 50 derniers messages). */
  App.openDm = (name) => {
    const friend = friendOf(name);
    if (!friend) return App.toast('Tu ne peux écrire qu’à tes amis.', 'error');
    setPanel(true);
    current = friend.name;
    threads.hidden = true;
    $('#dm-threads-empty').hidden = true;
    $('#dm-back').hidden = false;
    $('#dm-title').textContent = friend.name;
    const icon = $('#dm-icon');
    icon.src = App.iconUrl(friend.icon);
    icon.hidden = false;
    messages.hidden = false;
    form.hidden = false;
    messages.replaceChildren();
    socket.emit('dm:history', { with: friend.name }, (res) => {
      if (!res?.ok || current !== friend.name) return;
      messages.replaceChildren(...res.messages.map(buildMessage));
      if (!res.messages.length) {
        const li = document.createElement('li');
        li.className = 'dm-msg dm-msg--empty';
        li.textContent = `Début de ta conversation avec ${friend.name}.`;
        messages.append(li);
      }
      messages.scrollTop = messages.scrollHeight;
    });
    input.focus();
  };

  socket.on('dm:message', ({ with: other, message }) => {
    const mine = message.from === App.me?.name;
    if (!panel.hidden && current === other) {
      $('.dm-msg--empty', messages)?.remove();
      messages.append(buildMessage(message));
      messages.scrollTop = messages.scrollHeight;
      if (!mine) socket.emit('dm:read', { with: other });
      return;
    }
    if (mine) return;
    App.sound?.('message');
    const toast = App.toast(`${message.from} : ${message.text}`, 'info', 5000);
    toast.classList.add('toast--clickable');
    toast.title = 'Ouvrir la discussion';
    toast.addEventListener('click', () => {
      App.removeToast(toast);
      App.openDm(other);
    });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || !current) return;
    input.value = '';
    socket.emit('dm:send', { to: current, text }, (res) => {
      if (!res?.ok) {
        input.value = text;
        App.toast(res?.error || 'Message non envoyé.', 'error');
      }
    });
  });

  openBtn.addEventListener('click', () => {
    if (!panel.hidden) return setPanel(false);
    setPanel(true);
    showThreads();
  });
  $('#dm-close').addEventListener('click', () => setPanel(false));
  $('#dm-back').addEventListener('click', showThreads);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setPanel(false);
  });

  // Double-clic sur un ami : discuter
  $('.social__scroll').addEventListener('dblclick', (event) => {
    const friend = event.target.closest('.friend:not(.friend--request)');
    if (friend) App.openDm(friend.dataset.name);
  });

  // Compteur de messages non lus (bouton Discussions) ; liste rafraîchie si ouverte
  document.addEventListener('app:friends', ({ detail: friends }) => {
    const unread = friends.reduce((n, f) => n + (f.unread || 0), 0);
    const badge = $('#dm-unread');
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    openBtn.title = unread ? `Discussions (${unread} non lu${unread > 1 ? 's' : ''})` : 'Discussions';
    if (!panel.hidden && current === null) showThreads();
    if (current && !friendOf(current)) setPanel(false); // ami retiré
  });

  // ---------------------------------------------------------------------------
  // Profil détaillé
  // ---------------------------------------------------------------------------

  const ago = (ts) => {
    const days = Math.floor((Date.now() - ts) / 86_400_000);
    if (days <= 0) return `aujourd’hui à ${timeFormat.format(ts)}`;
    if (days === 1) return 'hier';
    return `il y a ${days} jours`;
  };

  function renderProfileCard(p) {
    $('#profile-card-icon').src = App.iconUrl(p.icon);
    $('#profile-card-level').textContent = p.level;
    $('#profile-card-name').textContent = p.name;
    $('#profile-card').dataset.banner = p.banner || 'default';
    $('#profile-card-presence').textContent = p.self ? 'Ton profil' : p.presence?.label || '';
    $('#profile-card-presence').dataset.status = p.presence?.status || 'online';

    const stat = (value, label) => {
      const div = document.createElement('div');
      div.className = 'profile-card__stat';
      const b = document.createElement('b');
      b.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      div.append(b, span);
      return div;
    };
    $('#profile-card-stats').replaceChildren(
      stat(fmtNum(p.games), 'Parties'),
      stat(fmtNum(p.wins), 'Victoires'),
      stat(`${p.winRate} %`, 'Taux de victoire'),
      stat(`${fmtNum(p.bestRent)} PO`, 'Plus gros loyer'),
      stat(`${fmtNum(p.rentEarned)} PO`, 'Loyers touchés'),
    );

    $('#profile-card-boards').replaceChildren(...Object.entries(BOARD_NAMES).map(([id, label]) => {
      const b = p.boards?.[id] || { games: 0, wins: 0 };
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = label;
      const value = document.createElement('b');
      value.textContent = `${b.wins} victoire${b.wins > 1 ? 's' : ''} / ${b.games} partie${b.games > 1 ? 's' : ''}`;
      const bar = document.createElement('i');
      bar.style.setProperty('--ratio', b.games ? b.wins / b.games : 0);
      li.append(name, value, bar);
      return li;
    }));

    const pawnBox = $('#profile-card-pawn');
    if (p.favouritePawn) {
      const img = document.createElement('img');
      img.src = `assets/pawns/${p.favouritePawn.pawn}.svg`;
      img.alt = '';
      const txt = document.createElement('span');
      const b = document.createElement('b');
      b.textContent = App.PAWN_NAMES?.[p.favouritePawn.pawn] || p.favouritePawn.pawn;
      txt.append(b, ` — joué ${p.favouritePawn.games} fois`);
      pawnBox.replaceChildren(img, txt);
    } else {
      pawnBox.textContent = 'Aucune partie jouée pour l’instant.';
    }

    const history = $('#profile-card-history');
    history.replaceChildren(...(p.history || []).map((h) => {
      const li = document.createElement('li');
      li.className = `profile-card__game${h.won ? ' is-win' : ''}`;
      const result = document.createElement('b');
      result.textContent = h.won ? 'Victoire' : h.place ? `${h.place}ᵉ` : 'Défaite';
      const img = document.createElement('img');
      img.src = `assets/pawns/${h.pawn || 'classic'}.svg`;
      img.alt = '';
      const info = document.createElement('span');
      const mode = [BOARD_NAMES[h.board] || 'Faille', h.team ? '2 contre 2' : null, h.vsAi ? 'contre l’IA' : null].filter(Boolean).join(' · ');
      info.textContent = `${mode} — ${h.rounds} tour${h.rounds > 1 ? 's' : ''}${h.players?.length ? ` · avec ${h.players.join(', ')}` : ''}`;
      const when = document.createElement('small');
      when.textContent = ago(h.date);
      li.append(result, img, info, when);
      return li;
    }));
    if (!p.history?.length) history.replaceChildren(Object.assign(document.createElement('li'), { className: 'social__empty', textContent: 'Aucune partie pour l’instant.' }));

    const done = p.achievements.filter((a) => a.done).length;
    $('#profile-card-ach-count').textContent = `(${done}/${p.achievements.length})`;
    $('#profile-card-achievements').replaceChildren(...p.achievements.map((a) => {
      const li = document.createElement('li');
      li.className = `achievement${a.done ? ' is-done' : ''}`;
      li.title = a.done ? 'Débloqué' : 'Pas encore débloqué';
      const name = document.createElement('b');
      name.textContent = a.name;
      const text = document.createElement('span');
      text.textContent = a.text;
      li.append(name, text);
      return li;
    }));
  }

  /** Page de profil : la sienne (sans argument) ou celle d'un ami. */
  App.openProfile = (name = null) => {
    socket.emit('profile:get', { name: name || App.me?.name }, (res) => {
      if (!res?.ok) return App.toast(res?.error || 'Profil indisponible.', 'error');
      renderProfileCard(res.profile);
      App.openModal('modal-profile');
    });
  };

  const myProfile = $('.topbar__profile .profile');
  myProfile.classList.add('is-clickable');
  myProfile.title = 'Voir mon profil';
  myProfile.addEventListener('click', () => App.openProfile());
})();
