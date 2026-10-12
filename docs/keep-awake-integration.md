# Intégration veille et Stream Deck — 12 octobre 2026

L'intégration reste dans le worktree `nixfiles-streamdeck`, branche
`feat/streamdeck-usb-hello`. Aucun merge/push ni activation NixOS/Home Manager,
permission Stream Deck ou enregistrement client MCP n'a été effectué ici.
Le worker installation gère séparément la configuration client approuvée.

## Copie et préservation de la source

Le diff source a été lu avant copie. Il contient exactement 18 fichiers de
`packages/keep-awake-mcp`, le nouveau `flakes/keep-awake.nix`, une ligne
`hm.keepAwake` dans `hosts/frostbit/default.nix` et une section README racine.
Les fichiers partagés ont été appliqués avec `git apply --check` puis `git apply`.
Le checkout source reste sur `main`, commit `b1da9453`, avec son travail
non committé intact.

Une sauvegarde complète des 21 fichiers source et du patch partagé se trouve à :

`/home/neolectron/Documents/Codex/2026-10-12/task-7/keep-awake-source-snapshot`

Le manifeste `SHA256.json` de cette sauvegarde a pour SHA-256 :

`3283d469ce9c23fd1eb70849dcf7654fb4fea6f85f2d2a7d2e254dd5460f071c`

Une copie des hashes est versionnée dans `keep-awake-source-sha256.json`.
Les 21 fichiers ont été comparés avant/après copie et à la fin des validations.
Aucun fichier source n'a été effacé, déplacé ou modifié par l'intégration.

Les seules différences intentionnelles dans la copie sont : un script
`typecheck` ajouté à son package.json, sa documentation pnpm/install mise à
jour et une section monorepo ajoutée au README racine. Son code métier, tests,
dérivation Nix, package-lock, SDK et flake restent identiques à la source.

## Résolution commune

`packages/*` inclut les deux outils ; `node-global-packages` reste exclu.
Les scripts racine build/typecheck/test exécutent les deux packages. Les
scripts `keep-awake:build`, `keep-awake:test`, `keep-awake:smoke` et
`streamdeck:*` restent disponibles pour un lancement ciblé.

SDK serveur/client MCP : **2.3.1**, zod : **4.6.7**, Node : **24**,
TypeScript : **7.0.2**, types Node : **24.19.2**. Les versions exactes et
intégrités SDK/zod ont été vérifiées dans le registre npm et dans les locks.
L'exception de délai de publication pnpm est limitée au pin `zod@4.6.7`
déjà validé par le worker ; aucun script natif supplémentaire n'est autorisé.

Le package-lock npm de veille conserve son SHA-256 source. `buildNpmPackage`
le consomme avec le npmDepsHash existant ; le lockfile pnpm orchestre le
développement commun. Les manifestes/locks concordent pour les dépendances
et engines. Tout futur changement de dépendances doit synchroniser ces deux
locks et le hash Nix. Les inputs Nix et `flake.lock` sont inchangés.

## Résultats exécutés

- Installation pnpm commune, puis `--frozen-lockfile` : réussies.
- Typecheck/build des deux packages : réussis.
- `pnpm test` : **31 tests**, 9 Stream Deck et 22 veille, aucun ignoré.
- Build Nix veille : réussi, **22 tests supplémentaires dans checkPhase**.
- `nix flake check --no-write-lock-file` : sortie 0 ; configs frostbit/lab
  évaluées, sorties flake non standard signalées comme sur la base existante.
  Le CLI indique 0 checks exécutés ; le build ciblé ci-dessus vérifie
  explicitement le checkPhase veille.
- Smoke réel du **binaire Nix final** via le client SDK : handshake/quatre outils,
  isolation, release, renouvellement, expiration, EOF, crash, task exit,
  parent gelé et SIGTERM réussis. **8 inhibiteurs préexistants conservés**,
  aucune lease de test restante. Aucun suspend/reboot réel exécuté.
- Mock Stream Deck hello : 7 entrées, 5 trames, valeur finale 51.
- Mock Stream Deck events : 7 entrées, 0 trame, valeur finale 51.
- Détection HID réelle en lecture seule : `[]`, matériel toujours absent.
- `git diff --check` propre. Les tests avec sous-processus/logind ont été
  exécutés dans le shell Nix avec l'autorisation locale nécessaire.

## Binaire final et installation limitée au package

Exécutable vérifié pour le worker installation :

`/nix/store/c4j6fn6lnb5jnchcwpn3nlg7df1890j0-keep-awake-mcp-0.1.0/bin/keep-awake-mcp`

SHA-256 du wrapper :
`4d1acc4a811184c5e17c76a252991f8fad25be779cfd4c70d917b0aba4fe69a7`

Dérivation : `/nix/store/3sxic9dcq5ysk327qs8shd9ssmi41mdg-keep-awake-mcp-0.1.0.drv`.
Le package référence ses Node 24, bash et systemd du store. Aucun runtime ni
exécutable dans `/tmp` n'est requis. Racine GC persistante vérifiée :

`/home/neolectron/Documents/Codex/2026-10-12/task-7/nixfiles-streamdeck/packages/keep-awake-mcp/result`

Conserver ce lien tant que le client utilise le store path, ou créer une
autre racine durable avant archivage du worktree. Reproduire le build seul :

```sh
cd /home/neolectron/Documents/Codex/2026-10-12/task-7/nixfiles-streamdeck
nix build .#keep-awake-mcp --no-write-lock-file --out-link packages/keep-awake-mcp/result
```

Le client peut lancer directement le store path en stdio. Aucun switch global
n'est nécessaire et cette intégration ne configure pas le client persistant.
L'import Home Manager copié est prêt pour une future activation coordonnée.

Pour Stream Deck, utiliser le worktree et le shell local, sans installation
système ; les règles udev restent des exemples inactifs :

```sh
nix-shell packages/streamdeck/shell.nix
pnpm install --frozen-lockfile
pnpm streamdeck:demo
# Au branchement du 13 octobre :
pnpm streamdeck list
pnpm streamdeck events --duration 30
pnpm streamdeck hello --duration 30
```

Le merge vers le checkout actif reste à coordonner. Aucun autre chantier
du repo n'a été emporté. La référence/VID:PID et les tests USB/écran physiques
du Stream Deck restent à valider après livraison.
