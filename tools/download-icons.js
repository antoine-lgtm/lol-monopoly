'use strict';

/**
 * Télécharge les icônes d'invocateur officielles (Data Dragon de Riot) dans
 * frontend/assets/icons/0.png … 29.png. Les 10 premières sont offertes à la création
 * du compte, les autres s'achètent à la boutique.
 *
 * Lancé avant `npm start` ; `npm run icons` le relance et affiche les erreurs.
 * Les icônes déjà présentes sont gardées ; sans réseau, le jeu garde ses icônes dessinées.
 * Pour changer une icône : remplacer son numéro Data Dragon dans ICON_IDS
 * (ou déposer soi-même un PNG carré à la place), puis `npm run icons -- --force`.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT = path.join(__dirname, '..', 'frontend', 'assets', 'icons');
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const FALLBACK_VERSION = '14.24.1';

/** Place dans le jeu (0 à 29) -> numéro de l'icône chez Riot : les icônes d'origine de League. */
const ICON_IDS = Array.from({ length: 30 }, (_, i) => i);

function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 15000, headers: { 'User-Agent': 'lol-monopoly' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, redirects - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ type: String(res.headers['content-type'] || ''), body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('délai dépassé')));
    req.on('error', reject);
  });
}

(async () => {
  const verbose = process.argv.includes('--verbose') || process.env.npm_lifecycle_event === 'icons';
  const force = process.argv.includes('--force');
  fs.mkdirSync(OUT, { recursive: true });
  const jobs = ICON_IDS.map((id, index) => ({ id, file: path.join(OUT, `${index}.png`) }))
    .filter((j) => force || !fs.existsSync(j.file));
  if (!jobs.length) {
    if (verbose) console.log('Toutes les icônes sont déjà présentes.');
    return;
  }
  let version = FALLBACK_VERSION;
  try {
    version = JSON.parse((await get(`${DDRAGON}/api/versions.json`)).body.toString())[0] || version;
  } catch (err) {
    if (verbose) console.log(`Versions Data Dragon indisponibles (${err.message}).`);
    if (err.code || /HTTP 4/.test(err.message)) {
      console.log('Icônes officielles non téléchargées (pas d’accès à Data Dragon) : le jeu garde ses icônes dessinées.');
      return;
    }
  }
  let ok = 0;
  let firstError = null;
  for (const { id, file } of jobs) {
    try {
      const res = await get(`${DDRAGON}/cdn/${version}/img/profileicon/${id}.png`);
      if (!res.type.startsWith('image/')) throw new Error(`pas une image (${res.type})`);
      fs.writeFileSync(file, res.body);
      ok += 1;
    } catch (err) {
      firstError ||= `${id} : ${err.message}`;
    }
  }
  console.log(`Icônes d'invocateur : ${ok}/${jobs.length} téléchargées (Data Dragon ${version}).`);
  if (firstError && verbose) console.log(`  première erreur — ${firstError}`);
})().catch((err) => console.log('Téléchargement des icônes impossible :', err.message));
