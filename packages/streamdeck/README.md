# Stream Deck : premiers essais USB-HID sous Linux

Deux hello worlds TypeScript, sans application Elgato : `events` observe les
entrées ; `hello` dessine une touche test. Livraison préparée le 12 octobre 2026
pour le branchement du 13 octobre. Aucun essai matériel n'a encore été effectué.

Le modèle acheté n'est pas confirmé. Les potards font penser à un Stream Deck +,
mais le programme utilise les contrôles du modèle détecté, sans supposer son
nombre de boutons ni de potards. `list` donne le nom, le chemin HID, les indices
et les dimensions des contrôles. Le mock représente un + à huit touches et
quatre potards ; il ne prouve pas la compatibilité du matériel livré.

## Essayer immédiatement

Depuis la racine du worktree dédié :

```sh
cd /home/neolectron/Documents/Codex/2026-10-12/task-7/nixfiles-streamdeck
nix-shell packages/streamdeck/shell.nix
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm streamdeck:demo
pnpm streamdeck events --mock --demo
```

Le shell fournit Node 24, pnpm et les bibliothèques nécessaires au pilote natif,
à partir du nixpkgs déjà verrouillé dans le dépôt. Il ne reconstruit ni n'active
le système. Le premier accès peut télécharger des paquets. `packageManager`
épingle pnpm 12.11.2 ; pnpm peut télécharger cette version au premier lancement.
Le lockfile épingle également la bibliothèque HID et les outils TypeScript.

Sur un Linux classique avec Node 24 et pnpm 12.11.2 disponibles, les commandes
pnpm suffisent. Le pilote `node-hid` peut nécessiter libudev/libusb et, faute de
binaire précompilé compatible, un compilateur C++, Python et pkg-config.

Le mode mock ne charge pas `node-hid`. Il produit des trames RGB en mémoire et
rejoue sept entrées : bouton down/up, potard down/up, rotations +3/-2, toucher.
Résultat `hello` : cinq trames sur la touche 0, valeur simulée finale 51.
Résultat `events` : zéro trame. `--mock` seul attend ; ajouter `--demo` pour le
scénario fini, ou `--duration 5` pour quitter automatiquement après cinq secondes.

## Brancher demain, 13 octobre

Entrer dans le même shell Nix, brancher le Stream Deck en USB puis :

```sh
lsusb -d 0fd9:
pnpm streamdeck list
pnpm streamdeck events --duration 30
pnpm streamdeck hello --duration 30
```

1. Vérifier le nom retourné par `list` et le VID:PID de `lsusb`. Si `list` est
   vide, vérifier le câble de données, le port et la reconnaissance du modèle.
2. Pendant `events`, presser/relâcher un bouton ; cliquer et tourner les potards
   s'ils existent. Le journal distingue `control.type`, `control.index` et le
   `amount` signé des rotations. Les gestes tactiles sont aussi journalisés.
3. Pendant `hello`, la première touche LCD affiche HELLO. La presser affiche
   OK en vert ; la relâcher rétablit HELLO. Tourner un potard déplace une jauge
   fictive bornée à 0–100. Aucun volume système n'est changé.
4. Ctrl+C ou un signal SIGTERM ferme le handle après les écritures en cours. La touche
   test garde son dernier affichage ; aucune réinitialisation globale ni
   modification de luminosité n'est faite.

Avec plusieurs appareils, le programme exige un choix explicite. Copier le
chemin fourni par `list`, par exemple :

```sh
pnpm streamdeck events --path /dev/hidraw7 --duration 30
pnpm streamdeck hello --path /dev/hidraw7 --duration 30
```

Ne pas réutiliser un chemin après reconnexion sans relancer `list`. Une nouvelle
connexion relance aussi la commande : la reconnexion automatique est hors scope.
`events` n'écrit aucune image. `hello` écrit uniquement sa touche test : son
image précédente n'est pas récupérable par cette démo. Un appareil sans touche
LCD reste testable avec `events`, mais `hello` refuse explicitement l'affichage.

## Permissions : exemples inactifs

Une détection réussie peut être suivie d'un échec d'ouverture si l'utilisateur
n'a pas accès au nœud hidraw. Ne pas exécuter les démos avec `sudo`, ne pas
appliquer de `chmod 666`, et ne pas copier l'exemple udev upstream en entier :
il inclut une règle générale pour les périphériques input, inutile ici.

Les fichiers `permissions/*.example` ne sont ni installés ni importés. Avant
toute activation, confirmer le modèle et obtenir l'accord sécurité. Conserver
uniquement le VID:PID exact : la table de la bibliothèque 7.8.0 associe le + à
`0fd9:0084` et le + XL à `0fd9:00c6`. Un autre modèle demande sa propre règle.

L'exemple utilise `TAG+="uaccess"` sur le seul nœud hidraw du modèle retenu :
logind peut accorder l'accès à la session locale active. Pas d'accès universel,
pas de groupe input supplémentaire et pas de service root.

Sur NixOS, l'exemple `nixos-udev-package.nix.example` construit une règle
`50-streamdeck-user.rules` via `services.udev.packages`. Sur cette version de
NixOS, `services.udev.extraRules` produit `99-local.rules`, trop tard pour le
traitement uaccess de `73-seat-late.rules`. Une éventuelle intégration du modèle
confirmé appartient à `hosts/frostbit/` et doit suivre la procédure de
validation/activation de `AGENTS.md`, coordonnée par le parent. Ensuite
débrancher/rebrancher l'appareil. Aucun changement n'a été activé ici.

## Dépannage

- `libudev.so.1: cannot open shared object file` : utiliser le shell fourni ;
  `LD_LIBRARY_PATH` y provient de nixpkgs, sans chemins de store codés en dur.
- `could not open` / permission denied : inspecter le VID:PID et les ACL du
  nœud exact (`getfacl /dev/hidraw7` si disponible), puis revoir les règles avec
  le parent. La présence dans `list` ne garantit pas les droits d'ouverture.
- Déconnexion ou erreur d'écriture : le programme signale l'erreur, ferme le
  handle et quitte en échec. Rebrancher, refaire `list` et relancer.
- Si un autre logiciel utilise déjà le Stream Deck, traiter ce conflit
  explicitement ; le programme ne tue aucun processus ni service.
- `pnpm install --ignore-scripts` empêche la préparation de certaines dépendances
  natives. La workspace autorise seulement les builds `node-hid` et `esbuild`.
  L'accélérateur JPEG optionnel est désactivé ; `jpeg-js` fournit le fallback.

## Structure et suite du travail

```text
package.json / pnpm-workspace.yaml / pnpm-lock.yaml / tsconfig.base.json
packages/streamdeck/
  src/transport.ts   contrat minimal, événements et choix de l'appareil
  src/hid.ts         adaptateur HID v7, import natif différé
  src/mock.ts        appareil simulé, trames en mémoire et scénario déterministe
  src/image.ts       HELLO/OK en bitmap local RGB
  src/session.ts     journal, état démo, écritures sérialisées
  src/cli.ts         list / events / hello, durée, arrêt et erreurs
  test/session.test.ts
  shell.nix
  permissions/*.example
```

Les packages Nix existants restent dans `packages/`. La workspace exclut
`packages/node-global-packages`, dont le package-lock npm appartient à sa
dérivation Nix. Les nouvelles actions pourront consommer `DeckEvent` au-dessus
du transport, avec des adaptateurs distincts et des tests mock. Les dimensions
et indices viennent des capacités détectées, ce qui permettra les profils.
Les scripts racine `build`, `typecheck` et `test` ciblent les deux packages
coordonnés : Stream Deck et `keep-awake-mcp`. Les scripts `streamdeck:*` et
`keep-awake:*` permettent de tester chaque outil séparément. Le package veille
conserve son package-lock npm, requis par son build Nix autonome ; la workspace
pnpm possède désormais une résolution commune pour les deux packages.

Roadmap conservée, sans implémentation ni action réelle :

| Besoin | Étape suivante et limite actuelle |
| --- | --- |
| Focus fenêtre, profils selon application active | Adapter l'IPC niri, faire correspondre app_id/fenêtre et profil ; vérifier les commandes sur la version installée. |
| Push-to-talk, dictée vers le dot | Clarifier quel dot et vérifier une API/commande officiellement accessible. Aucune capture micro ni promesse de piloter la dictée UI. |
| Discord mute/unmute/deafen | Étudier RPC local ou raccourcis explicitement configurés ; vérifier OAuth et accès effectif avant de choisir. Aucun token utilisateur ni appel Discord ici. |
| Icône Discord, notifications et navigation au clic | RPC documente NOTIFICATION_CREATE et SELECT_TEXT_CHANNEL ; la disponibilité locale, l'autorisation et le scope rpc.notifications.read restent à vérifier. Pas de promesse de couvrir toutes les notifications. |
| Ouvrir OBS et recording | Séparer lancement et commandes obs-websocket GetRecordStatus/StartRecord/StopRecord ; prévoir authentification et état confirmé. Aucun enregistrement lancé. |
| Potards volume par application PipeWire | Inventorier les flux et leurs identités, puis adapter WirePlumber/PipeWire ; gérer disparition/recréation des IDs. La jauge actuelle est purement simulée. |

## Sources vérifiées

La bibliothèque communautaire maintenue
[@elgato-stream-deck/node](https://github.com/Julusian/node-elgato-stream-deck)
7.8.0 communique avec le matériel indépendamment du logiciel Elgato. Son scope
npm ne signifie pas qu'elle est officielle. Le
[SDK officiel Elgato](https://github.com/elgatosf/streamdeck) sert aux plugins
communiquant avec l'application Stream Deck et ne convient donc pas à ce scope.

- [Modèles et VID:PID v7.8.0](https://github.com/Julusian/node-elgato-stream-deck/blob/v7.8.0/packages/core/src/modelInfo.ts).
- [Signatures événements v7.8.0](https://github.com/Julusian/node-elgato-stream-deck/blob/v7.8.0/packages/core/src/types.ts) : les événements reçoivent des objets de contrôle, pas les anciens indices seuls.
- [Règles udev utilisateur upstream](https://github.com/Julusian/node-elgato-stream-deck/blob/v7.8.0/packages/node/udev/50-elgato-stream-deck-user.rules).
- [RPC Discord](https://docs.discord.com/developers/topics/rpc) : authentification et restrictions à vérifier avant toute intégration.
- [Protocole officiel obs-websocket](https://github.com/obsproject/obs-websocket/blob/master/docs/generated/protocol.md).

La compatibilité USB et l'affichage effectif sur le matériel livré restent à
valider demain. Les tests mock vérifient notre logique, pas le firmware.
