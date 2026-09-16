{
  description = "GitHub Action that installs Tilia and caches what it reads";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        nodejs = pkgs.nodejs_24;
      in
      {
        packages.default = pkgs.buildNpmPackage {
          pname = "setup-tilia";
          version = "1.0.0";
          src = ./.;

          npmDepsHash = "sha256-S92OtTTH3A2TsbrwdcBxtgzdP6KWQHcJ9bGYHBpPQh8=";

          inherit nodejs;

          npmBuildScript = "prepare";

          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r dist $out/dist
            cp action.yml $out/
            runHook postInstall
          '';
        };

        devShells.default = pkgs.mkShell {
          packages = [ nodejs ];
        };
      });
}
