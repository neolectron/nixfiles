# Premier essai USB — 13 octobre 2026

**Résultat final : premiers essais USB réussis.** Manuel a confirmé HELLO → OK
vert → HELLO sur la première touche et HELLO/jauge mobile sur la bande LCD.
Le journal confirme boutons, rotations signées, clics de potards, appuis courts
et glissements tactiles. Les appuis longs ne sont pas validés dans les preuves.

## Reprise préservée

- Préparation source propre : `/home/neolectron/Documents/Codex/2026-10-12/task-7/nixfiles-streamdeck`, branche `feat/streamdeck-usb-hello`, HEAD `3ba42d0110902d10dfc375719c354d3a183b322b`.
- Clone indépendant avec `git clone --no-hardlinks --single-branch` dans `/home/neolectron/Documents/Codex/2026-10-13/task-11/nixfiles-streamdeck`, même branche et même base.
- Le clone a pour origin la préparation locale ; aucune publication, fusion ou modification du dépôt principal `/home/neolectron/dev/nixfiles`.
- Aucun attachement au projet desktop confirmé. Rangement manuel de la conversation possible ; aucun registre privé modifié.

## Détection réelle

`lsusb -d 0fd9:` dans le shell Nix existant :

```text
Bus 001 Device 012: ID 0fd9:00c6 Elgato Systems GmbH Stream Deck + XL
```

Sysfs confirme `idVendor=0fd9`, `idProduct=00c6`, `product=Stream Deck + XL` et `authorized=1`.
`pnpm streamdeck list` reconnaît `/dev/hidraw8` comme `Stream Deck + XL`.
Les [capacités détaillées](streamdeck-hardware-2026-10-13/device.json) sont le résultat
réel de l'énumération par `@elgato-stream-deck/node` 7.8.0, sans ouverture HID :

| Contrôle | Capacités données par le pilote |
| --- | --- |
| Touches LCD | 36, indices 0–35, quatre rangées de neuf, images de 112×112 |
| Potards | Six, indices 0–5, rotation et clic disponibles dans le contrat du pilote |
| Bande LCD tactile | Un segment, indice 0, 1200×100, régions dessinables |

Ces données identifient le matériel et les capacités reconnues. Les essais
ci-dessous valident ensuite l'affichage et plusieurs entrées physiques, sans
prétendre couvrir individuellement les 36 touches et six potards. Le numéro de
série n'est pas conservé dans ces preuves.

## Blocage initial, levé

Commande réellement tentée, durée maximale cinq secondes :

```sh
nix-shell packages/streamdeck/shell.nix --run 'pnpm streamdeck hello --path /dev/hidraw8 --duration 5'
```

Sortie 1 :

```text
Stream Deck : cannot open device with path /dev/hidraw8: Failed to open a device with path '/dev/hidraw8': Permission denied
```

`getfacl /dev/hidraw8` confirmait `root:root`, `user::rw-`, `group::---`,
`other::---`, sans ACL pour `neolectron`. `udevadm info` donne `TAGS=:seat:` et
`CURRENT_TAGS=:seat:` ; aucun tag `uaccess`. Le sandbox cache les nœuds hidraw et
empêche l'accès au daemon Nix ; la vérification effectuée hors sandbox montre
que l'ouverture reste refusée par les permissions de la machine elle-même.
Aucune écriture LCD ni événement réel pendant cette première tentative refusée.

## ACL temporaire et essais réels

Après nouvelle vérification du VID:PID, Manuel a exécuté lui-même :

```sh
sudo setfacl -m u:neolectron:rw /dev/hidraw8
```

Il a confirmé « c'est bon ». La vérification suivante montre
`user:neolectron:rw-`, et le pilote ouvre réellement l'appareil. Cet accès est
perdu au débranchement ; aucune configuration globale n'a été activée. Après
reconnexion, refaire la détection avant toute ACL.

L'[exemple Nix inactif](../packages/streamdeck/permissions/nixos-udev-package.nix.example)
est désormais limité au modèle confirmé `0fd9:00c6`. Il ajoute `uaccess` avant
`73-seat-late.rules`, sans permission universelle ni groupe input. Il n'est pas
importé et aucune activation système n'a été faite. Une intégration persistante
appartient au host et suit le workflow du dépôt, coordonné par le parent.

Commandes réellement exécutées ensuite :

```sh
nix-shell packages/streamdeck/shell.nix
pnpm streamdeck hello --path /dev/hidraw8 --duration 300
pnpm streamdeck hello --lcd --path /dev/hidraw8 --duration 300
```

Les deux processus ont été fermés proprement par SIGTERM, avec code de sortie 0,
avant de libérer leur handle HID. Les dernières images restent affichées.

- Première démo : Manuel confirme HELLO/OK. Les [extraits d'événements](streamdeck-hardware-2026-10-13/hello-observed.jsonl) prouvent les boutons 0/1, rotations positives/négatives sur potards 0/3/4/5 et clics de potards 3/4. Le flux de sortie du premier essai a été tronqué ; ces extraits ne sont pas un journal exhaustif.
- Deuxième démo : [journal complet](streamdeck-hardware-2026-10-13/lcd-live.log) et [résumé](streamdeck-hardware-2026-10-13/lcd-summary.json). 324 écritures terminées (162 touche, 162 bande), 121 rotations, 20 événements down et 20 up, sept gestes tactiles (appuis courts et glissements). Manuel confirme HELLO lisible sur la bande et jauge mobile en tournant le potard. Aucun événement d'erreur.

Le nouveau mode explicite `hello --lcd` dessine seulement la première touche et
la première bande LCD aux dimensions détectées. La bande reste intacte par défaut.
Les écritures touche/bande sont sérialisées et journalisées après achèvement.
La jauge est simulée ; aucun volume système n'est changé. Aucun diagnostic HID
brut n'a finalement été nécessaire : les événements tactiles sont arrivés pendant
la fin du second essai.

## Vérifications et suivi

Reprise initiale : `pnpm test` réussit avec **31 tests** (9 Stream Deck et 22 veille),
`pnpm typecheck` et `pnpm build` réussissent. `nix flake check --no-write-lock-file`
sort avec le code 0 : configurations évaluées, zéro check de build exécuté,
avertissements de sorties non standard existants. L'exemple Nix est parsé avec
`nix-instantiate --parse` et `git diff --check` est propre.
Aucune dépendance, aucun package veille,
aucune configuration MCP, aucune racine GC ni installation existante n'a été modifiée.
Après ajout de `--lcd`, les **13 tests Stream Deck** passent, ainsi que son
typecheck et son build. Les quatre nouveaux tests couvrent les dimensions du + XL,
l'ordre des écritures et leur état capturé, la bande inactive par défaut, les
modèles sans bande, l'échec d'écriture et le refus de `events --lcd`. Les 22 tests
veille de la reprise restent applicables à ses sources inchangées : **35 tests
validés au total**. Les tests du mode LCD ont été relancés après la dernière
correction de capture des trames en file d'attente.
Aucun micro, enregistrement OBS, commande Discord ou changement audio/focus activé.
Aucun changement à Formula production.

Jalon à reporter par le parent dans le [ticket Notion](https://app.notion.com/p/3f70d92ce4cc8112a450fe5058bf4cee) :
**matériel + XL identifié ; ACL temporaire accordée par Manuel ; HELLO/OK,
boutons, rotations/clics de potards, bande LCD et gestes tactiles validés.
35 tests validés ; permissions persistantes Nix encore inactives.** Le ticket
n'a pas été modifié depuis cette conversation.
