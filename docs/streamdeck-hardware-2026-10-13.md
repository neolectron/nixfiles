# Premier essai USB — 13 octobre 2026

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

Ces données identifient le matériel et les capacités reconnues. Elles ne valident
pas encore l'affichage ni la réception des entrées physiques. Le numéro de série
n'est pas conservé dans ces preuves.

## Blocage observé

Commande réellement tentée, durée maximale cinq secondes :

```sh
nix-shell packages/streamdeck/shell.nix --run 'pnpm streamdeck hello --path /dev/hidraw8 --duration 5'
```

Sortie 1 :

```text
Stream Deck : cannot open device with path /dev/hidraw8: Failed to open a device with path '/dev/hidraw8': Permission denied
```

`getfacl /dev/hidraw8` confirme `root:root`, `user::rw-`, `group::---`,
`other::---`, sans ACL pour `neolectron`. `udevadm info` donne `TAGS=:seat:` et
`CURRENT_TAGS=:seat:` ; aucun tag `uaccess`. Le sandbox cache les nœuds hidraw et
empêche l'accès au daemon Nix ; la vérification effectuée hors sandbox montre
que l'ouverture reste refusée par les permissions de la machine elle-même.
Aucune écriture LCD n'a donc eu lieu et aucun événement réel n'a été reçu.

## Prochaine action après validation

La demande de validation d'une ACL temporaire pour `neolectron` sur le seul nœud
`/dev/hidraw8` est en attente. Aucun droit n'a été changé. Le parent peut faire
accorder cet accès temporaire, perdu au débranchement, ou coordonner l'intégration
Nix persistante. Avant toute ACL, revalider le chemin et le VID:PID ; ne pas
réutiliser `/dev/hidraw8` après reconnexion sans nouvelle détection.

L'[exemple Nix inactif](../packages/streamdeck/permissions/nixos-udev-package.nix.example)
est désormais limité au modèle confirmé `0fd9:00c6`. Il ajoute `uaccess` avant
`73-seat-late.rules`, sans permission universelle ni groupe input. Il n'est pas
importé et aucune activation système n'a été faite. Une intégration persistante
appartient au host et suit le workflow du dépôt, coordonné par le parent.

Une fois l'accès disponible :

```sh
nix-shell packages/streamdeck/shell.nix
pnpm streamdeck list
pnpm streamdeck hello --path /dev/hidraw8 --duration 120
```

Manuel confirme HELLO sur la touche supérieure gauche, la presse/relâche
(OK vert puis HELLO), puis tourne/clique un potard et touche la bande tactile.
Conserver les événements JSON réels. La jauge est simulée ; aucun volume système
n'est changé. Le test actuel observe le tactile mais ne dessine pas la bande LCD.
Ce test d'affichage supplémentaire vient après validation des deux premiers essais.

## Vérifications et suivi

Dans ce clone : `pnpm test` réussit avec **31 tests** (9 Stream Deck et 22 veille),
`pnpm typecheck` et `pnpm build` réussissent. `nix flake check --no-write-lock-file`
sort avec le code 0 : configurations évaluées, zéro check de build exécuté,
avertissements de sorties non standard existants. L'exemple Nix est parsé avec
`nix-instantiate --parse` et `git diff --check` est propre.
Aucune dépendance, aucun package veille,
aucune configuration MCP, aucune racine GC ni installation existante n'a été modifiée.
Aucun micro, enregistrement OBS, commande Discord ou changement audio/focus activé.
Aucun changement à Formula production.

Jalon à reporter par le parent dans le [ticket Notion](https://app.notion.com/p/3f70d92ce4cc8112a450fe5058bf4cee) :
**matériel reçu et identifié, pilote reconnaît le + XL ; premier essai bloqué par
les permissions hidraw, validation d'accès en attente ; 31 tests verts.** Le ticket
n'a pas été modifié depuis cette conversation.
