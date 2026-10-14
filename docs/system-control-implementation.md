# Première migration des services système

14 octobre 2026 — checkout isolé `task-11/nixfiles-streamdeck`, branche
`feat/streamdeck-usb-hello`. Cette livraison implémente la première étape du
[plan](system-control-streamdeck-plan.md).

## Code livré

Le package `@nixfiles/system-control` contient les services Effect Audio,
MprisPlayer, Spotify / Spotifast, MediaPlayers et Discord. Les transports Linux,
OAuth Discord, erreurs et adaptateurs de sources sont indépendants du deck.
Les imports sont directs, avec extension `.ts`, sans barrel, build ni import
Node natif. Toutes les I/O passent par Effect/platform.

Les Layers démarrent leur surveillance et la ferment avec leur scope. L'état
courant, les changements et l'indisponibilité sont observables sans lancer de
`monitor`. Les opérations sont attachées à la fois au scope du service et à
leur appelant : fermeture et annulation exécutent les finalizers. Discord
conserve la même API pendant les reconnexions et libère chaque session échouée.
Audio offre des commandes absolues de volume/mute, avec sérialisation, plafonds,
respect des canaux et révalidation des identités Pulse/PipeWire.

Le Studio construit les intégrations une fois dans son scope racine et les
plugins Spotify, média et Discord réutilisent ces instances. Leur désactivation
retire leur présentation sans fermer le service partagé. Les activations isolées
peuvent encore construire leur propre service. Les profils et identifiants des
raccourcis restent identiques. Le mixer garde ses lectures fraîches de
compatibilité et sa boucle de composition LCD ; sa migration vers des scènes
et des abonnements partagés sera une étape ultérieure.

La commande `pnpm system inspect` utilise Effect CLI et Node 24 directement.
Elle lit les services sans import USB, sans commande de contrôle de lecture, mute,
volume, microphone ou enregistrement. L'option `--discord-connection` accepte
un fichier OAuth existant sans afficher ses secrets.

Voir [l'API et les exemples](../packages/system-control/README.md).

## Vérifications

Les tests utilisent des transports injectés. Ils vérifient le mute absolu sur
des flux mélangés, les volumes concurrents et hors limites, les identités des
cibles, la diffusion des changements externes, l'indisponibilité/récupération,
la fermeture des pollers, l'annulation des actions, les reconnexions Discord et
la mémoïsation d'un service partagé. Les tests OAuth et IPC existants sont
déplacés dans le package système. Les tests du deck couvrent la compatibilité
des plugins, la présentation Spotify, les gestes et l'éditeur.

Résultats validés :

- `pnpm check` : Oxlint sans avertissement, Oxfmt et typecheck réussis ;
  **192 tests passent** — 18 système (dont 7 tests OAuth/IPC déplacés),
  152 Stream Deck et 22 keep-awake. Le test CLI mock laisse maintenant une
  seconde pour l'initialisation de ses Layers et du renderer à froid, au lieu
  d'arrêter le processus après 100 ms avant le rendu initial.
- `nix flake check` : réussi. Aucun changement de configuration Nix ni
  d'activation système pour cette migration.
- CLI système exécutée avec Node 24, hors du runtime du deck : Audio disponible
  (Discord, Chrome, flux ChatGPT et Master), Spotify et MediaPlayers disponibles
  via `org.mpris.MediaPlayer2.spotifast` ; Discord disponible avec l'autorisation
  OAuth existante, état `mute: false`, `deaf: false`. Cet essai réel ne modifie
  ni le volume ni la lecture ni les réglages vocaux.
- Studio relancé en watch sur `http://127.0.0.1:3900`, avec le même profil ignoré
  par Git : Stream Deck + XL connecté sur `/dev/hidraw8`, 36 touches, six potards,
  LCD 1200 × 100. Mixer, raccourcis, commandes, Spotify, média et Discord sont
  actifs ; le navigateur affiche `RPC connecté`, sans erreur ni avertissement
  console. OBS et Dot restent désactivés.

Les tests vérifient aussi qu'une présentation média désactivée puis réactivée
retrouve la même instance de service système, dont la surveillance continue
pendant cette désactivation. Les opérations qui changent le système sont
testées avec des transports injectés ; l'essai réel ci-dessus est en lecture seule.

## Suite du plan

L’incrément suivant ajoute `Desktop` (applications XDG, fenêtres niri, lancement et
focus) et `Obs` (API stable, sessions WebSocket et reconnexion scoped). Le module
`obs-rpc.ts` contient le protocole indépendant du deck ; `desktop-apps.ts` a quitté
le package Stream Deck. Le Studio partage Desktop une fois, et OBS reste acquis
uniquement lors de l’activation de sa présentation.

Les actions des plugins peuvent exporter une tile de touche avec label, icône et
paramètres par défaut. Discord, Spotify / Spotifast, OBS et ChatGPT / Codex proposent
leurs lancements dans l’inspecteur. Les tests injectent les services pour valider
lancement/focus, états ouvert/fermé, désactivation, catalogue, defaults stricts,
reconnexion OBS et fermeture des ressources. Un essai système en lecture seule
confirme Discord, Spotifast et Codex ouverts, ChatGPT et OBS installés mais fermés,
et le plugin OBS activé avec son WebSocket hors ligne. Aucun enregistrement n’a
été démarré ; les raccourcis personnels restent dans leur profil ignoré par Git.

Ces presets de touches ne constituent pas encore le contrat SurfaceHost/LCD.
La validation complète de cet incrément passe : `pnpm check` (Oxlint, Oxfmt,
typecheck et **202 tests** : 22 système, 158 Stream Deck, 22 keep-awake).

Les étapes 2 à 6 restent à réaliser : catalogue d'actions et schémas communs,
SurfaceHost, scènes/régions/tiles, navigation comme plugin, présentation Spotify
plein écran, HTTP/MCP et extraction des intégrations restantes. Les réglages
d'activation des services système et des présentations ne sont pas encore
deux contrôles distincts dans l'éditeur. La classification fine des erreurs
d'intégration viendra avec les contrats d'actions.
