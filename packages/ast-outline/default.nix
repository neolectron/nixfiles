{
  lib,
  fetchPypi,
  fetchurl,
  python313Packages,
  autoPatchelfHook,
  stdenv,
}:
let
  python = python313Packages;
  grammars = python.tree-sitter-grammars;

  # PHP's Python distribution has no source release. Use its official ABI3
  # wheel and patch its native library for NixOS rather than a runtime pip install.
  php = python.buildPythonPackage {
    pname = "tree-sitter-php";
    version = "0.24.1";
    format = "wheel";
    src = fetchurl {
      url = "https://files.pythonhosted.org/packages/9a/c6/fd863a7a779d0ab67688939eba0e08bff7b1ffe731288d3d3610df21217b/tree_sitter_php-0.24.1-cp310-abi3-manylinux2014_x86_64.manylinux_2_17_x86_64.manylinux_2_28_x86_64.whl";
      hash = "sha256-ehQEow8pckmKzgQLAClzi42sRdChKTLMuLYF65S6++Q=";
    };
    nativeBuildInputs = [ autoPatchelfHook ];
    buildInputs = [ stdenv.cc.cc.lib ];
    pythonImportsCheck = [ "tree_sitter_php" ];
    meta.platforms = [ "x86_64-linux" ];
  };

  # The generic nixpkgs Kotlin grammar is a different project/version; this
  # application requires the upstream Python binding's language() API.
  kotlin = python.buildPythonPackage {
    pname = "tree-sitter-kotlin";
    version = "1.1.0";
    format = "wheel";
    # The source distribution omits tree_sitter/parser.h. The official ABI3
    # wheel contains the complete binding; patch it for NixOS as with PHP.
    src = fetchurl {
      url = "https://files.pythonhosted.org/packages/65/bd/0f3aac45eb88b6b3173ac9c23bc41d8865943cbbe1caaafc001cd1b73c90/tree_sitter_kotlin-1.1.0-cp39-abi3-manylinux_2_5_x86_64.manylinux1_x86_64.manylinux_2_17_x86_64.manylinux2014_x86_64.whl";
      hash = "sha256-mpKv4ktjTPkUxYEq8PXFMYSxwYvfbuVQXIOvrIH2v2w=";
    };
    nativeBuildInputs = [ autoPatchelfHook ];
    buildInputs = [ stdenv.cc.cc.lib ];
    pythonImportsCheck = [ "tree_sitter_kotlin" ];
    meta.platforms = [ "x86_64-linux" ];
  };

  # nixpkgs' serenadeai grammar has the same version but different SCSS nodes.
  # Use the binding tested by ast-outline so variables/mixins remain visible.
  scss = python.buildPythonPackage {
    pname = "tree-sitter-scss";
    version = "1.0.0";
    format = "wheel";
    src = fetchurl {
      url = "https://files.pythonhosted.org/packages/7d/a9/75e8e7a80083c68bf9e6d471374e74fb9e3ac3df92cca12ceb7a90d63abe/tree_sitter_scss-1.0.0-cp38-abi3-manylinux_2_5_x86_64.manylinux1_x86_64.manylinux_2_17_x86_64.manylinux2014_x86_64.whl";
      hash = "sha256-z8veTCLCMbzk+XlyLfmxEOmUdgtq7hKk0eoJk4fqrV8=";
    };
    nativeBuildInputs = [ autoPatchelfHook ];
    buildInputs = [ stdenv.cc.cc.lib ];
    pythonImportsCheck = [ "tree_sitter_scss" ];
    meta.platforms = [ "x86_64-linux" ];
  };
in
python.buildPythonApplication (finalAttrs: {
  pname = "ast-outline";
  version = "1.8.2";
  pyproject = true;

  src = fetchPypi {
    pname = "ast_outline";
    inherit (finalAttrs) version;
    hash = "sha256-6CxWqmqEYPExE1MPdFPq5FOa1TKn+x+EV6NhzbG5WWE=";
  };

  build-system = [ python.hatchling ];
  dependencies = [
    python.pathspec
    python.tree-sitter
    python.tree-sitter-c-sharp
    python.tree-sitter-html
    python.tree-sitter-markdown
    python.tree-sitter-python
    python.tree-sitter-rust
    python.tree-sitter-sql
    python.tree-sitter-typescript
    python.tree-sitter-yaml
    grammars.tree-sitter-cpp
    grammars.tree-sitter-css
    grammars.tree-sitter-elixir
    grammars.tree-sitter-go
    grammars.tree-sitter-java
    grammars.tree-sitter-lua
    grammars.tree-sitter-ruby
    grammars.tree-sitter-scala
    grammars.tree-sitter-swift
    php
    kotlin
    scss
  ];

  nativeCheckInputs = [ python.pytestCheckHook ];
  pythonImportsCheck = [ "ast_outline.cli" ];

  meta = {
    description = "Stateless AST outlines, symbol extraction and structural search";
    homepage = "https://github.com/ast-outline/ast-outline";
    license = [
      lib.licenses.asl20
      lib.licenses.cc-by-40
    ];
    mainProgram = "ast-outline";
    platforms = [ "x86_64-linux" ];
  };
})
