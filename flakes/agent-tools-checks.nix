{ inputs, ... }:
{
  flake.checks.x86_64-linux.agent-tools =
    let
      pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
      tools = inputs.self.packages.x86_64-linux;
    in
    pkgs.runCommand "agent-tools-check"
      {
        CALLDIFF_PACKAGE = "${tools.calldiff}/lib/node_modules/calldiff";
        nativeBuildInputs = [
          tools.ast-outline
          tools.calldiff
          pkgs.ast-grep
          pkgs.oxlint
          pkgs.oxfmt
          pkgs.python3
          pkgs.fnm
          pkgs.nodejs_24
          pkgs.git
          pkgs.playwright-test
        ];
      }
      ''
        export HOME="$TMPDIR/home"
        mkdir -p "$HOME" fixture
        cd fixture
        git init -q

        printf 'export function greet() { return message(); }\nfunction message() { return "hello"; }\n' > example.ts
        printf '<?php function welcome() { return "hello"; }\n' > example.php
        printf 'fun welcome(): String { return "hello" }\n' > example.kt
        printf 'export function welcomeJs() { return helperJs(); }\nfunction helperJs() { return "hello"; }\n' > example.js
        printf 'def welcome_py():\n    return helper_py()\ndef helper_py():\n    return "hello"\n' > example.py
        git add -- example.ts example.php example.kt example.js example.py

        ast-outline digest example.ts --json > digest.json
        ast-outline show example.ts greet --json > symbol.json
        ast-outline grep greet example.ts --json > usages.json
        ast-outline example.php --json > php.json
        ast-outline example.kt --json > kotlin.json
        calldiff tree --file example.ts --format json > calls.json
        calldiff tree --file example.js --format json > javascript-calls.json
        calldiff tree --file example.py --format json > python-calls.json

        node --input-type=module <<'NODE'
        import assert from 'node:assert/strict';
        import fs from 'node:fs';
        import path from 'node:path';
        import { createRequire } from 'node:module';
        import { pathToFileURL } from 'node:url';
        const packageRoot = process.env.CALLDIFF_PACKAGE;
        const require = createRequire(path.join(packageRoot, 'package.json'));
        const Parser = require('tree-sitter');
        const { extractors } = await import(pathToFileURL(path.join(packageRoot, 'dist/languages/registry.js')));
        const { loadGrammarPackage, resolveLanguage } = await import(pathToFileURL(path.join(packageRoot, 'dist/languages/grammars.js')));
        for (const extractor of extractors) {
          const parser = new Parser();
          parser.setLanguage(resolveLanguage(loadGrammarPackage(extractor.grammarPackage), extractor.grammarExport));
          assert(parser.parse(""), extractor.id + ' parser failed');
        }
        assert(!fs.existsSync(path.join(process.env.HOME, '.cache/calldiff')), 'Unexpected runtime grammar cache');
        for (const [file, expected] of [
          ['digest.json', ['greet']],
          ['symbol.json', ['greet', 'message']],
          ['usages.json', ['greet']],
          ['php.json', ['welcome']],
          ['kotlin.json', ['welcome']],
          ['calls.json', ['greet', 'message']],
          ['javascript-calls.json', ['welcomeJs', 'helperJs']],
          ['python-calls.json', ['welcome_py', 'helper_py']],
        ]) {
          const result = JSON.parse(fs.readFileSync(file, 'utf8'));
          assert(!result.error, file + ' returned an error');
          const text = JSON.stringify(result);
          for (const symbol of expected) {
            assert(text.includes(symbol), file + ' did not find ' + symbol);
          }
        }
        NODE

        ast-grep --version
        oxlint --version
        oxfmt --version
        python3 --version
        fnm --version
        playwright --version
        touch "$out"
      '';
}
