'use strict';

/**
 * Télécharge les illustrations des champions du plateau dans
 * frontend/assets/champions/, pour qu'elles s'affichent même hors ligne.
 *
 * Plusieurs sources sont essayées dans l'ordre (CommunityDragon, puis
 * Data Dragon de Riot). Lancé automatiquement avant `npm start` : les images déjà
 * présentes sont gardées, et une erreur réseau n'empêche jamais le serveur de démarrer.
 * `npm run images` relance le téléchargement et affiche le détail des erreurs.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { BOARD } = require('../backend/game');

const OUT = path.join(__dirname, '..', 'frontend', 'assets', 'champions');
const DDRAGON = 'https://ddragon.leagueoflegends.com/cdn';
const CDRAGON = 'https://cdn.communitydragon.org/latest/champion';

const champions = BOARD.filter((sq) => sq.type === 'property').map((sq) => sq.name.replace(/[^A-Za-z]/g, ''));

// Même ordre que le plateau (frontend/js/game.js) : les adresses « sans version »
// de Data Dragon (img/champion/loading, splash) ne répondent plus.
function sourcesFor(kind, id) {
  const square = `${DDRAGON}/14.24.1/img/champion/${id}.png`;
  if (kind === 'splash') {
    return [`${CDRAGON}/${id}/splash-art/centered`, `${CDRAGON}/${id}/splash-art`, `${CDRAGON}/${id}/tile`, `${CDRAGON}/${id}/square`, square];
  }
  return [`${CDRAGON}/${id}/tile`, `${CDRAGON}/${id}/portrait`, `${CDRAGON}/${id}/square`, square];
}

/** Résout avec un Buffer d'image, ou rejette avec la raison de l'échec. */
function fetchImage(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000, headers: { 'User-Agent': 'lol-monopoly' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(fetchImage(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      if (!String(res.headers['content-type'] || '').startsWith('image/')) {
        res.resume();
        return reject(new Error(`pas une image (${res.headers['content-type']})`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

const failures = new Map(); // hôte -> première erreur rencontrée
let networkDown = false; // connexion coupée (pas une simple image manquante) : on arrête tout

async function downloadOne(kind, id, file) {
  for (const url of sourcesFor(kind, id)) {
    if (networkDown) return false;
    try {
      const data = await fetchImage(url);
      fs.writeFileSync(file, data);
      return true;
    } catch (err) {
      const host = new URL(url).host;
      if (!failures.has(host)) failures.set(host, `${err.code || err.message} (${url})`);
      if (err.code) networkDown = [...failures.values()].length >= 2 || networkDown;
    }
  }
  return false;
}

(async () => {
  const verbose = process.argv.includes('--verbose') || process.env.npm_lifecycle_event === 'images';
  const jobs = [];
  for (const kind of ['loading', 'splash']) {
    fs.mkdirSync(path.join(OUT, kind), { recursive: true });
    for (const id of champions) {
      const file = path.join(OUT, kind, `${id}_0.jpg`);
      if (!fs.existsSync(file)) jobs.push({ kind, id, file });
    }
  }
  if (!jobs.length) {
    if (verbose) console.log('Toutes les illustrations sont déjà présentes.');
    return;
  }

  console.log(`Téléchargement de ${jobs.length} illustrations de champions…`);
  let ok = 0;
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = jobs.slice(i, i + 6);
    const results = await Promise.all(batch.map((j) => downloadOne(j.kind, j.id, j.file)));
    ok += results.filter(Boolean).length;
  }
  if (ok === jobs.length) {
    console.log('Illustrations prêtes.');
    return;
  }
  console.log(`${ok}/${jobs.length} illustrations téléchargées.`);
  if (verbose) for (const [host, reason] of failures) console.log(`  ${host} : ${reason}`);
  console.log('Pas grave : le navigateur chargera les illustrations directement pendant la partie.');
})().catch((err) => console.log('Téléchargement des illustrations impossible :', err.message));
