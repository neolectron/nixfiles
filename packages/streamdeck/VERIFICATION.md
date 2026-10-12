# Vérification du 12 octobre 2026

Worktree isolé de `/home/neolectron/dev/nixfiles`, base `b1da9453`, branche
`feat/streamdeck-usb-hello`. Le checkout actif et le package `keep-awake-mcp`
de l'autre chantier n'ont pas été modifiés par ce travail.

Validations exécutées :

- `nix-shell packages/streamdeck/shell.nix` : fonctionne avec le nixpkgs verrouillé.
- `pnpm install --frozen-lockfile` : réussit ; scripts node-hid/esbuild seulement,
  accélérateur JPEG optionnel désactivé.
- `pnpm typecheck` et `pnpm build` : réussissent.
- `pnpm test` : 9 tests réussis. Affichage et événements, jauge bornée,
  modèles sans LCD, sélection explicite de plusieurs appareils, erreurs HID,
  sérialisation des écritures, démos CLI finies et durée d'écoute bornée.
- `pnpm streamdeck events --mock --demo` : 7 entrées, 0 trame, jauge finale 51.
- `pnpm streamdeck:demo` : 7 entrées, 5 trames RGB de 120×120 sur touche 0,
  jauge finale 51. Fonctionne aussi sans libudev dans l'environnement : le
  mode mock ne charge pas le pilote HID natif.
- `node packages/streamdeck/dist/cli.js events --mock --demo` : le JS compilé
  exécute également le scénario fini.
- `pnpm streamdeck list` dans le shell Nix : le pilote natif se charge ; résultat
  `[]`, aucun Stream Deck branché. Ce n'est pas un test USB sur le matériel attendu.
- `nix flake check --no-write-lock-file` : sortie 0, configurations NixOS
  évaluées ; 0 checks de build exposés. Avertissements existants pour les sorties
  flake non standard (`modules`, `opencode`, `username`, `androidPhone`,
  `wifiAudioStreaming`). Aucun build/activation de système exécuté.
- Exemple udev Nix parsé et shell formaté avec nixfmt ; `git diff --check` propre.

Les tests CLI lancent des sous-processus. Le sandbox de l'agent bloque leur
spawn/capture (EPERM), donc la suite finale a été exécutée avec autorisation
dans le shell Nix. Aucun test n'est ignoré et aucun résultat matériel n'est simulé.

À confirmer le 13 octobre : référence/VID:PID, droits hidraw, réception des
vrais boutons/potards/toucher et affichage HELLO/OK sur la touche physique.
Les règles de permissions sont des `.example` inactifs. Aucune capture micro,
API Discord, session OBS, modification audio ou changement de focus n'a été fait.

Coordination avant intégration : le checkout actif contient désormais un
package TypeScript `packages/keep-awake-mcp` avec son propre package-lock npm.
Il entre dans le motif `packages/*` du futur monorepo ; le parent doit décider
sa migration/exception et régénérer le lockfile pnpm après assemblage. Ne pas
copier le lockfile ou fusionner ce worktree vers le checkout actif isolément.
Les fichiers Nix existants et le README racine sont restés inchangés ici.
