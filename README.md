# League of Monopoly

Monopoly multijoueur privé sur le thème de League of Legends : un salon façon client LoL
(amis, invitations, rôles, chat) et un plateau en 3D (Three.js) jouable de 2 à 5.

Projet de fan non commercial, ni approuvé ni soutenu par Riot Games.

## Lancer le jeu

```bash
npm install
npm start          # http://localhost:3000
```

`npm start` télécharge d'abord les illustrations des champions dans
`frontend/assets/champions/` (si le réseau le permet ; sinon le navigateur les charge lui-même).

Pour jouer à plusieurs sur le même réseau, les autres ouvrent `http://<ip-de-l-ordinateur>:3000`.

## Sauvegarde des parties

Le serveur enregistre joueurs, amis, salons et parties en cours dans `data/save.json`
(toutes les 3 secondes et à l'arrêt). Après un redémarrage, chacun se reconnecte tout seul
et retrouve sa partie.

- `SAVE_FILE=/autre/chemin.json npm start` : changer d'emplacement
- `SAVE_FILE=off npm start` : désactiver la sauvegarde

## Tests

```bash
npm test                  # règles du jeu (rapide, sans navigateur)
npx playwright install chromium   # une seule fois, pour les tests suivants
npm run test:browser      # salon, partie, échange, sauvegarde dans un vrai navigateur
TEST_3D=1 npm run test:browser    # + chargement du plateau 3D (plus lent)
```

`CHROMIUM_PATH=/chemin/vers/chromium` permet d'utiliser un Chromium déjà installé.

## Réglages en jeu

Bouton ⚙ (ou Paramètres dans le salon) :

- **Qualité du plateau 3D** : automatique (baisse toute seule si l'image saccade), haute,
  moyenne, basse (sans halo, ombres, poussière ni carte de Runeterra)
- **Volume des effets** et **volume de la musique** (musique générée par le navigateur ; ♪ pour la couper)

Le plateau 3D a besoin de l'accélération graphique du navigateur ; sinon un plateau plat
s'affiche, avec un bandeau qui explique pourquoi. `?3d=1` force la 3D, `?3d=0` la désactive.

## Images officielles (facultatif)

Déposer `chest.png` (Coffre Hextech) et `ping.png` (Ping SS) dans `frontend/assets/board/real/`
pour remplacer les dessins par défaut.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `backend/game.js` | règles : plateau, cartes, loyers, constructions et réserve de la banque, hypothèques, échanges, faillite, statistiques |
| `backend/server.js` | serveur Express + Socket.io : comptes, amis, salons, parties, sauvegarde |
| `frontend/js/main.js`, `lobby.js` | client : connexion, accueil, salon |
| `frontend/js/game.js` | écran de jeu (actions, journal, échanges, fin de partie, sons) |
| `frontend/js/board3d.js` | plateau 3D (Three.js) |
| `frontend/js/pawns3d.js`, `tower3d.js`, `props3d.js` | modèles 3D : pions, tours, rochers, coffre, Baron, carte de Runeterra |
| `frontend/js/music.js` | musique d'ambiance générée |
| `frontend/dev/*.html` | pages d'aperçu des modèles 3D |
| `tests/` | tests des règles et tests navigateur |
