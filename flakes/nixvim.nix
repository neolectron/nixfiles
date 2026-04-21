{ inputs, ... }:
{
  # Home Manager side: nixvim configuration
  flake.modules.homeManager.nixvim =
    { pkgs, lib, ... }:
    {
      imports = [
        inputs.nixvim.homeModules.nixvim
      ];

      programs.nixvim = {
        enable = true;

        # Default settings
        opts = {
          number = lib.mkDefault true;
          relativenumber = lib.mkDefault true;
          shiftwidth = lib.mkDefault 2;
          tabstop = lib.mkDefault 2;
          expandtab = lib.mkDefault true;
          smartindent = lib.mkDefault true;
          wrap = lib.mkDefault false;
          cursorline = lib.mkDefault false; # Fixes ghostty/tmux scrolling artifacts
          colorcolumn = lib.mkDefault "80";
        };

        # Enable clipboard integration
        clipboard.register = lib.mkDefault "unnamedplus";

        # Color scheme
        colorschemes.tokyonight = {
          enable = lib.mkDefault true;
          settings = {
            style = lib.mkDefault "night";
          };
        };

        # Useful default plugins
        plugins = {
          # Icons (required by neo-tree and others)
          web-devicons.enable = lib.mkDefault true;

          # File tree
          neo-tree = {
            enable = lib.mkDefault true;
            settings.filesystem.hijack_netrw_behavior = lib.mkDefault "open_current";
          };

          # Fuzzy finder
          telescope = {
            enable = lib.mkDefault true;
            extensions.fzf-native.enable = lib.mkDefault true;
          };

          # LSP
          lsp = {
            enable = lib.mkDefault true;
            servers = {
              nixd.enable = lib.mkDefault true;
              lua_ls.enable = lib.mkDefault true;
            };
          };

          # Completion
          cmp = {
            enable = lib.mkDefault true;
            autoEnableSources = lib.mkDefault true;
            settings.sources = [
              { name = lib.mkDefault "nvim_lsp"; }
              { name = lib.mkDefault "buffer"; }
              { name = lib.mkDefault "path"; }
            ];
          };

          # Syntax highlighting
          treesitter = {
            enable = lib.mkDefault true;
            settings.highlight.enable = lib.mkDefault true;
          };

          # Status line
          lualine.enable = lib.mkDefault true;

          # Git integration
          gitsigns.enable = lib.mkDefault true;

          # Auto pairs
          nvim-autopairs.enable = lib.mkDefault true;

          # Comment helper
          comment.enable = lib.mkDefault true;

          # Buffer line (tabs)
          bufferline.enable = lib.mkDefault true;

          # Indent guides
          indent-blankline.enable = lib.mkDefault true;
        };

        # Keymaps
        globals = {
          mapleader = lib.mkDefault " ";
          maplocalleader = lib.mkDefault "\\";
        };

        keymaps = [
          # File explorer
          {
            key = "<leader>e";
            action = "<cmd>Neotree toggle<cr>";
            options.desc = lib.mkDefault "Toggle file explorer";
          }
          # Find files
          {
            key = "<leader>ff";
            action = "<cmd>Telescope find_files<cr>";
            options.desc = lib.mkDefault "Find files";
          }
          # Live grep
          {
            key = "<leader>fg";
            action = "<cmd>Telescope live_grep<cr>";
            options.desc = lib.mkDefault "Live grep";
          }
          # Buffers
          {
            key = "<leader>fb";
            action = "<cmd>Telescope buffers<cr>";
            options.desc = lib.mkDefault "Find buffers";
          }
        ];
      };
    };
}
