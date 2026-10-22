{
  lib,
  buildNpmPackage,
  fetchFromGitHub,
  makeWrapper,
  nodejs_24,
  python3,
  git,
}:

buildNpmPackage {
  pname = "calldiff";
  version = "0.6.0";
  nodejs = nodejs_24;

  # Match the version used by Astahmer's nixfiles skill bundle.
  src = fetchFromGitHub {
    owner = "tanishqkancharla";
    repo = "calldiff";
    rev = "d58c48b33327c1c833b88df521f6838e9a5cc8c5";
    hash = "sha256-6Lefc0rq4bFyptycBK2Uz8bZR648ca5hymWMvgsJVC4=";
  };

  # Pin every supported language grammar instead of installing npm packages
  # dynamically while reviewing a repository. Keep upstream's Lua/C# pins.
  postPatch = ''
    cp ${./package.json} package.json
    cp ${./package-lock.json} package-lock.json
    ${nodejs_24}/bin/node --input-type=module <<'NODE'
    import fs from 'node:fs';
    const file = 'src/languages/grammars.ts';
    const source = fs.readFileSync(file, 'utf8');
    const functionStart = source.indexOf('export function loadGrammarPackage(');
    const start = source.indexOf('\n  const cacheDir = grammarCacheDir();', functionStart);
    const end = source.indexOf('\n}', start);
    if (functionStart < 0 || start < 0 || end < 0) throw new Error('Grammar loader source changed');
    fs.writeFileSync(file, source.slice(0, start)
      + '\n  throw new Error("Bundled grammar unavailable: " + npmPackage + "; runtime downloads are disabled by Nix packaging");\n'
      + source.slice(end));
    NODE
  '';

  npmDepsHash = "sha256-DPRGqOO2/g0QU3YydTkNDfds7a8oVXuC1Tc87qmVsMw=";
  # Native bindings are built explicitly below. In particular, Swift's unused
  # tree-sitter-cli dependency must not download a binary in its install hook.
  npmFlags = [
    "--legacy-peer-deps"
    "--ignore-scripts"
  ];
  nativeBuildInputs = [
    makeWrapper
    python3
  ];

  # npm blocks dependency lifecycle scripts by default. Explicitly compile the
  # reviewed native grammar bindings, including nested grammar dependencies.
  postBuild = ''
    node --input-type=module > "$TMPDIR/native-bindings" <<'NODE'
    import fs from 'node:fs';
    import path from 'node:path';
    const bindings = [];
    function scan(root) {
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const directory = path.join(root, entry.name);
        if (entry.name.startsWith('@')) { scan(directory); continue; }
        const metadata = path.join(directory, 'package.json');
        if (fs.existsSync(metadata)) {
          const { name } = JSON.parse(fs.readFileSync(metadata, 'utf8'));
          if (/^(?:@tree-sitter-grammars\/)?tree-sitter(?:-|$)/.test(name)
              && fs.existsSync(path.join(directory, 'binding.gyp'))) bindings.push(directory);
        }
        const nested = path.join(directory, 'node_modules');
        if (fs.existsSync(nested)) scan(nested);
      }
    }
    scan('node_modules');
    for (const directory of bindings.sort()) console.log(directory);
    NODE
    while IFS= read -r dependency; do
      node ${nodejs_24}/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js \
        rebuild --directory "$dependency"
    done < "$TMPDIR/native-bindings"
  '';

  postInstall = ''
    wrapProgram "$out/bin/calldiff" \
      --prefix PATH : ${
        lib.makeBinPath [
          git
          nodejs_24
        ]
      }
  '';

  meta = {
    description = "Diff call graphs across Git revisions";
    homepage = "https://github.com/tanishqkancharla/calldiff";
    license = lib.licenses.mit;
    mainProgram = "calldiff";
    platforms = lib.platforms.linux;
  };
}
