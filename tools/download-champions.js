'use strict';

/**
 * Télécharge les illustrations des champions du plateau depuis Data Dragon (Riot)
 * dans frontend/assets/champions/, pour qu'elles s'affichent même hors ligne.
 *
 * Lancé automatiquement avant `npm start` : les images déjà présentes sont gardées,
 * et une erreur réseau n'empêche jamais le serveur de démarrer.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { BOARD } = require('../backend/game');

const CDN = 'https://ddragon.leagueoflegends.com/cdn/img/champion';
const OUT = path.join(__dirname, '..', 'frontend', 'assets', 'champions');
const KINDS = ['loading', 'splash'];

const champions = BOARD.filter((sq) => sq.type === 'property').map((sq) => sq.name.replace(/[^A-Za-z]/g, ''));

function download(url, file) {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return resolve(false);
      }
      const tmp = `${file}.part`;
      const stream = fs.createWriteStream(tmp);
      res.pipe(stream);
      stream.on('finish', () => stream.close(() => {
        fs.renameSync(tmp, file);
        resolve(true);
      }));
      stream.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

(async () => {
  const jobs = [];
  for (const kind of KINDS) {
    fs.mkdirSync(path.join(OUT, kind), { recursive: true });
    for (const id of champions) {
      const file = path.join(OUT, kind, `${id}_0.jpg`);
      if (fs.existsSync(file)) continue;
      jobs.push({ url: `${CDN}/${kind}/${id}_0.jpg`, file });
    }
  }
  if (!jobs.length) return;

  console.log(`Téléchargement de ${jobs.length} illustrations de champions…`);
  let ok = 0;
  for (let i = 0; i < jobs.length; i += 6) {
    const results = await Promise.all(jobs.slice(i, i + 6).map((j) => download(j.url, j.file)));
    ok += results.filter(Boolean).length;
  }
  if (ok === jobs.length) console.log('Illustrations prêtes.');
  else console.log(`${ok}/${jobs.length} illustrations téléchargées (les autres seront chargées en ligne).`);
})().catch(() => {});
