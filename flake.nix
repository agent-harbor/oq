{
  description = "Standalone Org document query and validation tools";
  inputs = {
    nixos-modules.url = "github:metacraft-labs/devops-modules";
    nixpkgs.follows = "nixos-modules/nixpkgs-unstable";
    flake-parts.follows = "nixos-modules/flake-parts";
    fenix.follows = "nixos-modules/fenix";
    workflow-guard-source = {
      url = "github:metacraft-labs/metacraft-github-actions/78e370308303988eaec3cdae42ebf7b48021e550";
      flake = false;
    };
  };
  outputs =
    inputs@{ flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      perSystem =
        { pkgs, system, ... }:
        let
          fenix = inputs.fenix.packages.${system};
          staticTarget =
            if pkgs.stdenv.hostPlatform.isAarch64 then
              "aarch64-unknown-linux-musl"
            else
              "x86_64-unknown-linux-musl";
          toolchain = fenix.combine (
            [
              (fenix.stable.withComponents [
                "cargo"
                "rustc"
                "rustfmt"
                "clippy"
                "rust-std"
              ])
              fenix.targets.wasm32-unknown-unknown.stable.rust-std
            ]
            ++ pkgs.lib.optionals pkgs.stdenv.isLinux [ fenix.targets.${staticTarget}.stable.rust-std ]
          );
          rustPlatform = pkgs.makeRustPlatform {
            cargo = toolchain;
            rustc = toolchain;
          };
        in
        {
          packages.default = rustPlatform.buildRustPackage {
            pname = "oq";
            version = (builtins.fromTOML (builtins.readFile ./Cargo.toml)).workspace.package.version;
            src = pkgs.lib.cleanSource ./.;
            cargoLock.lockFile = ./Cargo.lock;
            cargoBuildFlags = [
              "-p"
              "oq"
            ];
            cargoTestFlags = [ "--workspace" ];
            meta.license = pkgs.lib.licenses.asl20;
          };
          devShells.default = pkgs.mkShell {
            OQ_WORKFLOW_GUARD_SOURCE = inputs.workflow-guard-source;
            packages = [
              toolchain
              pkgs.nodejs_24
              pkgs.typescript
              pkgs.just
              pkgs.prek
              pkgs.nixfmt
              pkgs.gnupg
              pkgs.git
              pkgs.gh
              pkgs.uv
              pkgs.python3
              pkgs.editorconfig-checker
              pkgs.prettier
              pkgs.opentofu
              pkgs.actionlint
            ];
          };
        };
    };
}
