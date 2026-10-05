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
