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
raccourcis restent identiques. Le mixer consomme `Audio.observe` et son snapshot
partagé ; sa boucle de composition LCD ne relit plus PipeWire en fonctionnement
normal. Les changements externes de volume/mute remontent aux contributions via
`MixerCards.onChange(app, previous)`. Spotify actualise sa valeur et son overlay
sur la jaquette, quelle que soit l'origine du changement. Le service audio conserve
une surveillance toutes les 500 ms et sérialise les rafraîchissements concurrents.

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

## Overlays contextuels de touches

Le host fournit maintenant `DeckOverlays`, un service Effect lié à l’identité et au
scope d’activation du plugin. Une présentation temporaire expose `update` et `close` ;
la priorité et l’ordre d’activation arbitrent chaque touche. Les touches absentes
laissent passer le layout inférieur, `null` le masque. Désactivation, échec et fermeture
révoquent aussi les anciennes API : une instance arrêtée ne peut pas reprendre la main.

`Plugin.presentFrom` relie n’importe quel Stream à un sélecteur Effect.
`plugins/context-layout.ts` propose le binding à `Desktop.focusChanges` : fenêtre
au premier plan, retour au profil lorsque l’application change, restauration en cas
d’erreur du moniteur puis récupération. L’état de focus est lu via le même service
Desktop partagé, sans ouvrir ni activer de fenêtre. Les règles sont explicites,
installées dans la composition des plugins puis activées depuis Plugins ; aucun
preset personnel n’est inventé ni activé automatiquement.

Studio réutilise sa projection pour les images, les snapshots web et les actions.
Les adresses de génération empêchent un ancien appui long de déclencher une action
masquée, tout en conservant le release d’une action déjà démarrée. Le profil, ses
pages et dossiers restent inchangés sur disque. Les changements de configuration
restent soumis à Enregistrer ; un overlay d’exécution ne devient pas une mutation
de configuration. Les exemples sont dans [la documentation des plugins](streamdeck-plugins.md#contextual-key-overlays).

Cet incrément couvre les touches. L’arbitrage des scènes LCD, des régions tactiles
et des potards, ainsi que l’éditeur visuel de presets contextuels, restent à réaliser.
Il ne constitue pas la livraison complète du futur SurfaceHost décrit dans le plan.

## Surfaces LCD configurables et plugin Système

Le contrat de tile est maintenant portable entre touches et LCD. Une action
exporte ses surfaces possibles, sa largeur initiale et, pour un widget spécialisé,
un callback Effect de présentation LCD. Les actions ordinaires conservent leur
schéma, leur exécution et leur feedback ; aucun second binding système n’est créé.

`LcdSurface` et sa Layer composent des zones au-dessus du producteur existant,
sérialisent les écritures et routent les gestes sur la dernière scène effectivement
peinte. Le layout pur gère pages, dossiers, Retour, clipping et bande horizontale
débordante. Les filtres d’application utilisent le Desktop partagé. Le plugin
Système adapte le titre de fenêtre et l’icône XDG, puis exporte les actions de
navigation communes aux touches et au tactile.

L’éditeur accepte le dépôt sur le LCD, les largeurs de zones et de tiles, les
conditions de visibilité, la navigation de brouillon, le rangement en dossiers
et l’ajout de contenu hors écran. Ces modifications rejoignent le profil et sa
sauvegarde atomique avec contrôle de conflit. Les présentations web utilisent du
React client et des données SSE ; seul le matériel reçoit les images.

Cet incrément ne livre pas encore un SurfaceHost unique pour tous les types de
contrôles : les potards restent au mixer et les overlays de touches conservent
leur service. Le mixer n’a plus l’exclusivité physique du LCD ; les régions
configurées recouvrent son image et interceptent leurs propres gestes.

## Consolidation du 15 octobre 2026

Cette livraison remplace les limites des incréments historiques ci-dessus. Le
runtime partage les intégrations et un catalogue d'actions entre plugins, HTTP et
MCP ; il n'instancie pas un second ensemble de services pour chaque transport.

| Frontière      | Implémentation actuelle                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Système        | `actions.ts` valide entrées/sorties, expose capacités, choix dynamiques et diagnostics bornés sans paramètres ni résultats. `system-actions.ts` adapte les services.                    |
| Transports     | `/api/system/actions`, `/choices`, `/invoke`, `/diagnostics`, `/integrations` et `/mcp`. MCP utilise l'implémentation fournie par Effect.                                               |
| Lifecycle      | `IntegrationControl` persiste l'activation indépendamment des plugins ; désactiver interrompt commandes/sessions et suspend les lectures périodiques. Réactiver permet la récupération. |
| Média          | `MprisRegistry` partage le contrôleur par nom D-Bus entre Spotify et les touches média. OBS lit son état initial et suit les événements de scènes, mute et sorties.                     |
| Présentations  | `SurfaceHost` arbitre des scènes scoped : touches, régions LCD/tactile et potards. Fermer une scène restaure les propriétaires inférieurs ; les anciens handles sont révoqués.          |
| Tiles          | `TileInstance` sépare identité/action et placement ; des adaptateurs conservent les profils existants. Une définition peut exporter plusieurs templates pour une action.                |
| Client         | Le registre de plugins client rassemble icônes et présentations React. Le renderer générique et le schéma d'icônes ne connaissent plus chaque nouveau plugin.                           |
| Gestes         | Une touche peut associer plusieurs actions à l'appui simple, long et double ; l'arbitrage exclusif appartient à la bibliothèque d'entrée.                                               |
| État web       | Une projection matérialisée, révision monotone commune à HTTP/SSE ; snapshot complet à la connexion puis domaines modifiés. Un trou dans les révisions déclenche une resynchronisation. |
| Rendu matériel | Les frames LCD sont paresseuses, mises en cache par taille, stamp et vue. Une frame inchangée ne relance pas sa rasterisation.                                                          |
| Contextes      | Règles persistées avec priorité et app_id exact, capture d'une zone, LCD facultatif et aperçu local sur le deck. Le plugin « Layouts contextuels » contrôle leur activation.            |
| Compteur       | Le compteur natif et le plugin de référence utilisent `Counters`, partagé à la racine avec le même adaptateur `PersistentState`.                                                        |

La modification du départ d'un compteur écrit seulement le document de profil,
avec un nouvel epoch `stateVersion`. L'ancien état ne correspond alors plus à cette
configuration. Il n'y a plus deux écritures profil/compteurs à réussir pour
valider une configuration. Chaque incrément est sauvegardé avant son affichage.

Compatibilité : les profils v1/v2, les actions historiques, `DeckOverlays` et
`MixerCards` sont conservés comme adaptateurs. Le mixer est une présentation de
base ; les régions configurées et scènes temporaires le recouvrent via le même
compositeur. Une contribution Spotify garde sa vue, son tactile et son expansion.
Les changements de layout, de gestes et de contextes restent dans le brouillon
jusqu'à **Enregistrer**. Les activations d'intégrations sont des commandes de
runtime explicites, comme celles des plugins.

Les tests couvrent notamment l'échec de sauvegarde, le redémarrage des compteurs,
les révisions SSE, les trous de transport, les templates, les gestes exclusifs,
l'arbitrage et la fermeture des scènes, la suspension/reprise des intégrations,
les événements OBS et l'exécution HTTP/MCP sur un backend injecté. Aucun test ne
démarre de microphone, appel, enregistrement ou diffusion réels.

Les adaptateurs Redis/PostgreSQL, un système de chargement de code tiers à chaud
et l'exécution des plugins binaires Elgato ne sont pas ajoutés : cette consolidation
fournit les contrats pour les extensions du projet. Le verrou de persistance reste
local au processus ; un adaptateur distribué doit porter sa propre atomicité.

Validation de consolidation : `pnpm check` (Oxlint, Oxfmt, typecheck, Vitest et
suite keep-awake). La suite couvre 324 tests : 69 services système, 233 Stream
Deck et 22 veille. Inspection navigateur à 1280 px et 390 px : onglets lisibles,
aucun débordement du document ni erreur console ; création/aperçu/annulation d'un
contexte vérifiés. Le hash du profil réel est identique avant/après cet essai.
Un seul serveur watch utilise le deck connecté sur `http://127.0.0.1:3900`.
