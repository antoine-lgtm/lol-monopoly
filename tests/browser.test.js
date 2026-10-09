/**
 * Tests de bout en bout dans un vrai navigateur (Playwright) : `npm run test:browser`.
 *
 * Première fois : `npx playwright install chromium` (télécharge le navigateur de test).
 * Variables utiles :
 *   CHROMIUM_PATH=/chemin/vers/chromium   utiliser un Chromium déjà installé
 *   TEST_3D=1                             tester aussi le plateau 3D (plus lent)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let chromium = null;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.log('Playwright n’est pas installé : `npm install` puis `npx playwright install chromium`.');
}
const skip = chromium ? false : 'Playwright absent';

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lance le serveur de jeu sur un port de test et attend qu'il réponde. */
async function startServer(port, env = {}) {
  const proc = spawn(process.execPath, ['backend/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), SAVE_FILE: 'off', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  proc.stdout.on('data', (d) => { output += d; });
  proc.stderr.on('data', (d) => { output += d; });
  for (let k = 0; k < 50 && !output.includes('écoute'); k++) await sleep(100);
  if (!output.includes('écoute')) throw new Error(`le serveur ne démarre pas :\n${output}`);
  return proc;
}

function stopServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode !== null) return resolve();
    proc.once('exit', resolve);
    proc.kill('SIGTERM');
  });
}

let browser = null;
async function getBrowser() {
  browser ||= await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  return browser;
}

/** Ouvre une page de joueur ; collecte les erreurs JavaScript. */
async function openPlayer(port, label, { query = '?3d=0', viewport = { width: 1400, height: 860 }, timeout = 30000 } = {}) {
  const ctx = await (await getBrowser()).newContext({ viewport });
  const page = await ctx.newPage();
  page.setDefaultTimeout(timeout);
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(`${label} : ${e.message}`));
  await page.goto(`http://localhost:${port}/${query}`);
  return page;
}

async function login(page, name, icon = 0) {
  await page.waitForSelector('#login-screen:not([hidden])');
  await page.fill('#login-name', name);
  await page.click(`#login-icons label:nth-child(${icon + 1})`);
  await page.click('.login-card__submit');
  await page.waitForFunction((n) => document.querySelector('#profile-name').textContent === n, name);
}

/** « Partie trouvée » : le joueur accepte (le chef qui lance a déjà accepté). */
async function acceptMatch(page) {
  await page.waitForSelector('#match-found[data-state="ready"]:not([hidden])');
  await page.click('#match-accept');
}

/** Deux joueurs, un salon, la partie lancée par le chef. */
async function startGame(port, [nameA, nameB], options) {
  const a = await openPlayer(port, nameA, options);
  const b = await openPlayer(port, nameB, options);
  await login(a, nameA, 0);
  await login(b, nameB, 5);
  await a.click('#home-confirm');
  await a.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('#tab-room-code').textContent));
  const code = await a.textContent('#tab-room-code');
  await b.click('.mode-card[data-mode="join"]');
  await b.fill('#join-lobby-code', code);
  await b.click('#home-confirm');
  await a.waitForSelector(`.banner--filled[data-name="${nameB}"]`);
  await a.click('#find-match');
  await acceptMatch(b);
  await a.waitForSelector('#board-view:not([hidden])');
  await b.waitForSelector('#board-view:not([hidden])');
  return { a, b, code };
}

const noErrors = (...pages) => assert.deepEqual(pages.flatMap((p) => p.errors), []);

test.describe('dans le navigateur', { skip }, () => {
  const PORT = 3191;
  let server = null;
  test.before(async () => { server = await startServer(PORT); });
  test.after(async () => {
    await browser?.close();
    await stopServer(server);
  });

  test('salon : création, code, chat et lancement de la partie', async () => {
    const a = await openPlayer(PORT, 'Ahri');
    const b = await openPlayer(PORT, 'Braum');
    await login(a, 'Ahri', 1);
    await login(b, 'Braum', 2);
    await a.click('#home-confirm');
    await a.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('#tab-room-code').textContent));
    const code = await a.textContent('#tab-room-code');
    await b.click('.mode-card[data-mode="join"]');
    await b.fill('#join-lobby-code', code);
    await b.click('#home-confirm');
    await a.waitForSelector('.banner--filled[data-name="Braum"]');
    await a.fill('#chat-input', 'gl <b>hf</b>');
    await a.press('#chat-input', 'Enter');
    await b.waitForFunction(() => [...document.querySelectorAll('.chat__text')].some((t) => t.textContent === 'gl <b>hf</b>'));
    assert.equal(await b.isDisabled('#find-match'), true, 'seul le chef lance la partie');
    await a.click('#find-match');
    await acceptMatch(b);
    await b.waitForSelector('#board-view:not([hidden])');
    noErrors(a, b);
  });

  test('partie : lancer les dés, jouer, abandonner, écran de victoire et statistiques', async () => {
    const { a, b } = await startGame(PORT, ['Caitlyn', 'Darius']);
    await a.waitForSelector('#gv-buttons .gv-btn--primary');
    await a.click('#gv-buttons .gv-btn--primary'); // lancer les dés
    await a.waitForFunction(() => document.querySelectorAll('#gv-log li').length >= 2);
    b.once('dialog', (d) => d.accept()); // « Abandonner la partie ? »
    await b.click('#gv-forfeit');
    await a.waitForSelector('#gv-over:not([hidden]) .gv-over__table');
    const title = await a.textContent('.gv-over__title');
    assert.equal(title, 'VICTOIRE');
    const rows = await a.$$eval('.gv-over__table tbody tr', (trs) => trs.length);
    assert.equal(rows, 2);
    // revoir la partie : le lecteur de replay s'ouvre, puis on le quitte
    await a.click('.gv-over__buttons .gv-btn:not(.gv-btn--primary)');
    await a.waitForSelector('#gv-replay:not([hidden])');
    await a.waitForFunction(() => /Tour \d+ · \d+\/\d+/.test(document.querySelector('#gv-replay-label').textContent));
    await a.click('[data-replay="quit"]');
    await a.waitForSelector('#board-view[hidden]', { state: 'attached' });
    // et elle apparaît dans l'historique
    await a.click('.square-btn--stats');
    await a.waitForSelector('#history-list .history-item');
    noErrors(a, b);
  });

  test('sorts d’invocateur : Soin depuis le kit (+100 PO, puis recharge)', async () => {
    const { a, b } = await startGame(PORT, ['Karma', 'Lux']);
    await a.waitForSelector('#gv-kit .gv-kit__btn--spell.is-ready');
    await a.click('#gv-kit .gv-kit__btn--spell:nth-child(2)'); // Flash, Soin par défaut
    await a.waitForFunction(() => document.querySelector('.gv-player.is-me .gv-player__gold').textContent.replace(/\D/g, '') === '1600');
    await a.waitForSelector('#gv-kit .gv-kit__btn--spell.is-cooldown');
    noErrors(a, b);
  });

  test('échange : proposer de l’or, l’autre joueur accepte', async () => {
    const { a, b } = await startGame(PORT, ['Ezreal', 'Fiora']);
    await a.waitForSelector('.gv-btn--trade');
    await a.click('.gv-btn--trade');
    await a.locator('.gv-trade__gold input').first().fill('100');
    await a.click('.gv-trade__foot .gv-btn--primary');
    await b.waitForSelector('.gv-trade:not([hidden]) .gv-trade__card--review');
    await b.click('.gv-trade__foot .gv-btn--primary');
    await b.waitForFunction(() => [...document.querySelectorAll('#gv-log li')].some((l) => l.textContent.startsWith('Échange conclu')));
    const gold = await b.$eval('.gv-player.is-me .gv-player__gold', (el) => el.textContent.replace(/\D/g, ''));
    assert.equal(gold, '1600');
    noErrors(a, b);
  });

  test('bots : le chef ajoute un bot, il joue tout seul ; emote et chrono', async () => {
    const a = await openPlayer(PORT, 'Kayle');
    await login(a, 'Kayle', 3);
    await a.click('#home-confirm');
    await a.click('.banner__bots:not([hidden]) .banner__bot-btn[data-bot="easy"]');
    await a.waitForSelector('.banner.is-bot');
    await a.click('#find-match');
    await a.waitForSelector('#board-view:not([hidden])');
    await a.waitForSelector('#gv-timer:not([hidden])');
    await a.click('#gv-emote');
    await a.click('.gv-emotes__btn[data-emote="gg"]');
    await a.waitForSelector('.gv-bubble');
    // on joue notre tour (lancer, acheter, fin du tour) : le bot doit ensuite jouer le sien
    const botPlayed = () => a.evaluate(() => [...document.querySelectorAll('#gv-log li')].some((l) => /\(bot\) lance les dés/.test(l.textContent)));
    for (let k = 0; k < 40 && !(await botPlayed()); k++) {
      const primary = await a.$('#gv-buttons .gv-btn--primary:not([disabled])');
      if (primary) await primary.click().catch(() => {});
      await sleep(600);
    }
    assert.ok(await botPlayed(), 'le bot a lancé les dés');
    noErrors(a);
  });

  test('Abîme Hurlant, raccourcis clavier et pause du chef', async () => {
    const a = await openPlayer(PORT, 'Nami');
    const b = await openPlayer(PORT, 'Olaf');
    await login(a, 'Nami', 0);
    await login(b, 'Olaf', 4);
    await a.click('#home-confirm');
    await a.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('#tab-room-code').textContent));
    await a.evaluate(() => new Promise((r) => App.socket.emit('lobby:setRules', { rules: { board: 'aram' } }, r)));
    const code = await a.textContent('#tab-room-code');
    await b.click('.mode-card[data-mode="join"]');
    await b.fill('#join-lobby-code', code);
    await b.click('#home-confirm');
    await a.waitForSelector('.banner--filled[data-name="Olaf"]');
    await a.click('#find-match');
    await acceptMatch(b);
    await a.waitForSelector('#board-view:not([hidden])');
    assert.equal(await a.$$eval('.gv-sq', (els) => els.length), 28, 'plateau de 28 cases');
    // Espace : lancer les dés
    await a.waitForSelector('#gv-buttons [data-action="game:roll"]');
    await a.keyboard.press('Space');
    await a.waitForFunction(() => [...document.querySelectorAll('#gv-log li')].some((l) => /Nami lance les dés/.test(l.textContent)));
    // pause par le chef : l'autre joueur voit la pause, les actions sont refusées
    await a.click('#gv-pause-btn');
    await b.waitForSelector('#gv-pause:not([hidden])');
    const res = await a.evaluate(() => new Promise((r) => App.socket.emit('game:end', {}, r)));
    assert.equal(res.ok, false);
    await a.click('.gv-pause .gv-btn--primary');
    await b.waitForSelector('#gv-pause', { state: 'hidden' });
    noErrors(a, b);
  });

  test('salon : refuser la partie, couronne, messages privés hors ligne, profil, préréglages, dossiers', async () => {
    const a = await openPlayer(PORT, 'Lulu');
    let b = await openPlayer(PORT, 'Malzahar');
    await login(a, 'Lulu', 0);
    await login(b, 'Malzahar', 2);
    const emit = (page, event, payload) => page.evaluate(([e, p]) => new Promise((r) => App.socket.emit(e, p, r)), [event, payload]);
    await emit(a, 'friends:add', { name: 'Malzahar' });
    assert.equal((await emit(b, 'friends:add', { name: 'Lulu' })).accepted, true);
    await a.waitForSelector('.friend[data-name="Malzahar"]');

    // message privé hors ligne : livré à la connexion, avec le compteur de non-lus
    await b.context().close();
    await a.waitForSelector('.friend[data-name="Malzahar"][data-status="offline"]');
    await a.click('.friend[data-name="Malzahar"]', { button: 'right' });
    await a.click('[data-ctx="message"]');
    await a.fill('#dm-input', 'tu joues ce soir ?');
    await a.press('#dm-input', 'Enter');
    await a.waitForFunction(() => [...document.querySelectorAll('.dm-msg--self .dm-msg__text')].some((t) => t.textContent === 'tu joues ce soir ?'));
    b = await openPlayer(PORT, 'Malzahar');
    await login(b, 'Malzahar', 2);
    await b.waitForSelector('#dm-unread:not([hidden])');
    assert.equal(await b.textContent('#dm-unread'), '1');
    await b.click('#dm-open');
    await b.click('.dm-thread');
    await b.waitForFunction(() => [...document.querySelectorAll('.dm-msg__text')].some((t) => t.textContent === 'tu joues ce soir ?'));
    await b.waitForSelector('#dm-unread', { state: 'hidden' });
    await b.fill('#dm-input', 'oui !');
    await b.press('#dm-input', 'Enter');
    await a.waitForFunction(() => [...document.querySelectorAll('.dm-msg:not(.dm-msg--self) .dm-msg__text')].some((t) => t.textContent === 'oui !'));
    await b.click('#dm-close');
    await a.click('#dm-close');

    // salon à deux : Malzahar refuse la partie, tout le monde revient au salon
    await a.click('#home-confirm');
    await a.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('#tab-room-code').textContent));
    const code = await a.textContent('#tab-room-code');
    await b.click('.mode-card[data-mode="join"]');
    await b.fill('#join-lobby-code', code);
    await b.click('#home-confirm');
    await a.waitForSelector('.banner--filled[data-name="Malzahar"]');
    await a.click('#find-match');
    await a.waitForSelector('#match-found[data-state="accepted"]:not([hidden])');
    await b.waitForSelector('#match-found[data-state="ready"]:not([hidden])');
    await b.click('#match-decline');
    await a.waitForSelector('#match-found', { state: 'hidden' });
    await a.waitForFunction(() => [...document.querySelectorAll('.chat__text')].some((t) => /Malzahar a refusé la partie/.test(t.textContent)));
    assert.equal(await a.isHidden('#board-view'), true, 'pas de partie lancée');
    await a.waitForSelector('#find-match:not([disabled])');

    // couronne : Lulu la donne à Malzahar (clic droit sur sa bannière)
    await a.click('.banner--filled[data-name="Malzahar"]', { button: 'right' });
    await a.click('[data-ctx="promote"]');
    await b.waitForSelector('#find-match:not([disabled])');
    assert.equal(await a.isDisabled('#find-match'), true);

    // préréglages : le nouveau chef applique « ARAM rapide », puis enregistre ses règles
    await b.evaluate(() => App.openRules());
    await b.click('.preset__apply >> text=ARAM rapide');
    await b.waitForFunction(() => App.lobby.rules.board === 'aram' && App.lobby.rules.maxRounds === 20);
    await b.fill('#preset-name', 'Soirée');
    await b.click('#preset-save');
    await b.waitForSelector('.preset--mine .preset__apply >> text=Soirée');
    assert.equal((await b.evaluate(() => App.profile.presets.length)), 1);
    await b.click('#modal-rules .modal__actions .btn--primary');

    // profil d'un ami (clic droit sur la bannière)
    await a.click('.banner--filled[data-name="Malzahar"]', { button: 'right' });
    await a.click('[data-ctx="profile"]');
    await a.waitForSelector('#modal-profile[open]');
    assert.equal(await a.textContent('#profile-card-name'), 'Malzahar');
    assert.ok(await a.$$eval('.achievement', (els) => els.length) >= 5);
    await a.click('#modal-profile .modal__actions .btn--primary');

    // dossier d'amis et recherche
    await a.click('.friend[data-name="Malzahar"]', { button: 'right' });
    await a.click('[data-ctx="folder"]');
    await a.fill('#folder-form input[name="folder"]', 'Duo');
    await a.click('#folder-form button[value="save"]');
    await a.waitForSelector('#friend-folders [data-folder="Duo"] .friend[data-name="Malzahar"]');
    await a.click('#friend-search-btn');
    await a.fill('#friend-search', 'zzz');
    await a.waitForSelector('#friends-empty:not([hidden])');
    await a.fill('#friend-search', 'malz');
    await a.waitForSelector('#friends-empty', { state: 'hidden' });
    noErrors(a, b);
  });

  test('paramètres : changer la touche pour lancer les dés', async () => {
    const a = await openPlayer(PORT, 'Rakan');
    await login(a, 'Rakan', 1);
    await a.click('[data-action="settings"]');
    await a.click('[data-key-action="roll"]');
    await a.keyboard.press('r');
    assert.equal(await a.textContent('[data-key-action="roll"]'), 'R');
    // F est déjà pris (fin du tour) : les deux actions échangent leurs touches
    await a.click('[data-key-action="roll"]');
    await a.keyboard.press('f');
    assert.equal(await a.textContent('[data-key-action="roll"]'), 'F');
    assert.equal(await a.textContent('[data-key-action="end"]'), 'R');
    await a.click('#settings-form button[value="confirm"]');
    await a.reload();
    await a.waitForFunction(() => document.querySelector('#profile-name').textContent === 'Rakan');
    assert.equal(await a.evaluate(() => App.settings.keys.roll), 'f', 'gardé après rechargement');
    await a.evaluate(() => new Promise((r) => App.socket.emit('lobby:quick', { mode: 'practice' }, r)));
    await a.click('#find-match');
    await a.waitForSelector('#gv-buttons [data-action="game:roll"]');
    await a.keyboard.press(' ');
    await sleep(500);
    assert.equal(await a.evaluate(() => [...document.querySelectorAll('#gv-log li')].some((l) => /Rakan lance les dés/.test(l.textContent))), false, 'Espace ne lance plus');
    await a.keyboard.press('f');
    await a.waitForFunction(() => [...document.querySelectorAll('#gv-log li')].some((l) => /Rakan lance les dés/.test(l.textContent)));
    noErrors(a);
  });

  test('sauvegarde : la partie reprend après un redémarrage du serveur', async () => {
    const port = 3192;
    const save = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lolm-')), 'save.json');
    let srv = await startServer(port, { SAVE_FILE: save });
    const { a, b } = await startGame(port, ['Garen', 'Hecarim']);
    await a.click('#gv-buttons .gv-btn--primary');
    await a.waitForFunction(() => document.querySelectorAll('#gv-log li').length >= 2);
    const before = await a.$$eval('#gv-log li', (lis) => lis.map((l) => l.textContent));
    await sleep(3500); // une sauvegarde passe toutes les 3 s
    await stopServer(srv);
    assert.ok(fs.existsSync(save), 'fichier de sauvegarde écrit');
    srv = await startServer(port, { SAVE_FILE: save });
    try {
      // les pages se reconnectent toutes seules et reçoivent la partie
      await a.waitForFunction((n) => document.querySelectorAll('#gv-log li').length >= n, before.length, { timeout: 20000 });
      const after = await a.$$eval('#gv-log li', (lis) => lis.map((l) => l.textContent));
      for (const line of before) assert.ok(after.includes(line), `ligne perdue : ${line}`);
      assert.equal(await a.isHidden('#board-view'), false);
      noErrors(a, b);
    } finally {
      await stopServer(srv);
    }
  });

  test('plateau 3D : se charge et affiche sa scène WebGL', { skip: process.env.TEST_3D ? false : 'TEST_3D=1 pour l’activer' }, async () => {
    const { a, b } = await startGame(PORT, ['Irelia', 'Jinx'], { query: '?3d=1', timeout: 300000 });
    await a.waitForFunction(() => document.querySelector('#board-view').classList.contains('is-webgl'), null, { timeout: 240000 });
    assert.ok(await a.$('canvas.gv-webgl'));
    noErrors(a, b);
  });
});
