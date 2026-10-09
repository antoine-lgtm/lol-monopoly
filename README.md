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

## Profil, Essence bleue et boutique

- **Essence bleue (EB)** gagnée en fin de partie selon la place : 1 000 pour le vainqueur, 500 pour
  le 2ᵉ, 300 pour le 3ᵉ, 150 ensuite (moitié contre l'IA). Expérience et niveau (toutes les 600 XP).
- **Boutique** (porte-monnaie en haut, ou carte « Boutique ») : pions à débloquer (« champions »,
  3 150 à 6 300 EB, ~4 800 en moyenne), icônes d'invocateur (450 EB), bannières de salon (1 350 EB).
  Cinq pions sont offerts (classique, Poro, Sbire, Balise, Œuf d'Anivia).
- **Collection** (onglet du haut ou carte « Collection ») : pions, skins débloqués en jouant,
  icônes et bannières ; on y choisit son icône et sa bannière.
- **Contre l'IA** (deux bots Normal) et **Entraînement** (un bot Facile, sans chrono) : un clic
  dans la barre de l'accueil prépare le salon.
- Valeurs dans `backend/profile.js`.

## Salon et amis

- **Partie trouvée** : quand le chef lance, chaque joueur a 10 s pour cliquer « Accepter ! » (les bots
  acceptent toujours). Un refus ou un temps écoulé annule : tout le monde revient au salon, et le chat
  dit qui n'a pas accepté.
- **Musique et sons du client** : un thème calme dans le client (volume de la musique dans les
  Paramètres), petits sons pour les clics, les arrivées dans le salon, les messages.
- **Discussions** (bouton en bas du panneau social, double-clic ou clic droit sur un ami) : messages
  privés entre amis, 50 derniers par conversation, gardés après un redémarrage ; les messages reçus
  hors ligne sont livrés à la connexion avec un compteur de non-lus.
- **Liste d'amis** : recherche (loupe), tri par statut, nom ou niveau, et dossiers (bouton dossier,
  ou clic droit › Ranger dans un dossier).
- **Notifications** : quand un ami se connecte ou termine une partie.
- **Donner la couronne** : clic droit du chef sur un joueur du salon.
- **Profil** (clic sur son icône en haut à droite, ou clic droit › Voir le profil sur un ami) :
  parties, victoires par plateau, pion préféré, plus gros loyer, 10 dernières parties et succès.
  Visible par soi et ses amis.
- **Préréglages de règles** (fenêtre Règles) : Classique, ARAM rapide, Équipes 2v2, et jusqu'à 5
  préréglages à soi, enregistrés dans le profil ; le chef les applique d'un clic.

## Bots, chrono, pouvoirs et événements

- **Bots** : dans le salon, le chef remplit une place libre avec un bot **Facile**, **Normal** ou
  **Difficile** (ils achètent, construisent, échangent, utilisent sorts et objets). Clic droit ou
  « Retirer le bot » pour l'enlever.
- **Chrono** : 60 s par tour par défaut (30, 60, 90 ou sans chrono dans les règles). Une fois le
  temps écoulé, le jeu lance les dés, n'achète rien et termine le tour à la place du joueur.
- **Pouvoir des pions** : chaque pion a un petit passif (Poro : des PO en plus à la Fontaine, Zhonya
  annule un loyer, Œuf d'Anivia survit une fois à la faillite…). Détail dans « Règles ».
- **Équilibrage** : les valeurs des quêtes et des pouvoirs sont réunies en haut de
  `backend/features.js` ; `npm run balance` simule des milliers de parties entre bots et donne
  le taux de victoire de chaque rôle et de chaque pion.
- **Événements de la Faille** : tous les 4 tours, un événement d'un tour (Ruée des sbires,
  Nouveau patch, Brouillard de guerre, Soldes, Snowdown, Prime de guerre).
- **Skins de pions** : Hextech (1 partie), Obscur (3 parties), Prestige (1 victoire), Cristal
  (3 victoires), Infernal (10 parties). À choisir sous le pion, dans le salon.
- **Emotes et pings** : bouton ☺ en haut du plateau ; ping sur une case avec le bouton ! ou
  **Alt + clic**.
- **Équipes 2 contre 2** (règle maison, 4 joueurs, bots compris) : chacun choisit Bleue ou Rouge
  dans le salon ; pas de loyer entre partenaires, groupe complété avec les cases du partenaire,
  dons de PO ; l'équipe gagne quand les deux adversaires sont éliminés.
- **Victoire à l'objectif** (règle maison) : 3 groupes complets sans hypothèque détruisent le Nexus.
- **Replays** : les 10 dernières parties de chacun sont gardées. « Revoir la partie » en fin de
  partie, ou le bouton Historique du salon : lecture, pause, ×1/×2/×4, tour suivant.
- **Statistiques** : onglet « Stats » (courbe de la valeur de chaque joueur, tour par tour),
  reprise dans le récapitulatif de fin.
- **Musique dynamique** : plus intense quand le Baron ou l'Ancien sont en jeu, puis en fin de
  partie (joueur en danger, objectif presque atteint, derniers tours).
- **Abîme Hurlant (ARAM)** : second plateau, 28 cases et 15 champions de Freljord, décor enneigé
  (rivière gelée, pont unique, neige qui tombe) ; parties environ deux fois plus courtes. À choisir
  dans « Règles » (Plateau).
- **Pause** : le chef du salon met la partie en pause (⏸) et la reprend ; chrono et bots s'arrêtent.
- **Raccourcis clavier** : Espace lancer les dés, A acheter, P passer, F fin du tour, D/S sorts,
  E échange, Échap fermer, ? aide.
- **Répliques des champions** : une bulle quand on achète une case ou qu'on paye un loyer.
  Pour les entendre, déposer des sons dans `frontend/assets/voices/` (voir `LISEZMOI.txt`).

## Réglages en jeu

Bouton ⚙ (ou Paramètres dans le salon) :

- **Qualité du plateau 3D** : automatique (baisse toute seule si l'image saccade), haute,
  moyenne, basse (sans halo, ombres, poussière ni carte de Runeterra)
- **Volume des effets** et **volume de la musique** (musique générée par le navigateur ; ♪ pour la couper)

Le plateau 3D a besoin de l'accélération graphique du navigateur ; sinon un plateau plat
s'affiche, avec un bandeau qui explique pourquoi. `?3d=1` force la 3D, `?3d=0` la désactive.

## Images officielles (facultatif)

Déposer ses images dans `frontend/assets/board/real/` (dragons, potions, coffre, ping, coins…) :
la liste des noms est dans `LISEZMOI.txt`. Elles remplacent les dessins par défaut.

## Crédits

- Modèle 3D du Poro : « League of Legends Poro » par hotwire12 (Printables), licence CC BY 4.0 —
  voir `frontend/assets/pawns/models/CREDITS.txt`.
- League of Legends et ses éléments appartiennent à Riot Games.

## Organisation

| Dossier | Contenu |
| --- | --- |
| `backend/game.js` | règles : plateau, cartes, loyers, constructions et réserve de la banque, hypothèques, échanges, faillite, statistiques |
| `backend/features.js` | sorts, objets, quêtes, pouvoirs des pions, événements, skins, règles maison |
| `backend/bot.js` | bots (Facile, Normal, Difficile) |
| `backend/profile.js` | profil : Essence bleue, niveau, boutique, collection |
| `backend/server.js` | serveur Express + Socket.io : comptes, amis, salons, bots, chrono, parties, sauvegarde |
| `frontend/js/main.js`, `lobby.js` | client : connexion, accueil, salon |
| `frontend/js/game.js` | écran de jeu (actions, journal, échanges, fin de partie, sons) |
| `frontend/js/board3d.js` | plateau 3D (Three.js) |
| `frontend/js/pawns3d.js`, `tower3d.js`, `props3d.js` | modèles 3D : pions, tours, rochers, coffre, Baron, carte de Runeterra |
| `frontend/js/music.js` | musique d'ambiance générée |
| `frontend/dev/*.html` | pages d'aperçu des modèles 3D |
| `tests/` | tests des règles et tests navigateur |
