# setup-tilia

A GitHub Action that installs [Tilia][tilia], puts it on `PATH`, and caches
the two directories it reads.

## Usage

```yaml
- uses: haskell-actions/setup@v2
  with:
    ghc-version: '9.10.3'
- uses: actions/checkout@v7
- uses: mrkkrp/setup-tilia@v1
- run: tilia check
```

## What is cached

Two directories, restored before the job and saved after it:

- **Tilia's own cache**, holding what it has already worked out about each
  package's operators. `~/.cache/tilia`, or `%LOCALAPPDATA%\tilia` on
  Windows.
- **Cabal's package cache**, holding the source tarballs Tilia reads those
  operators out of. Its location differs by platform and has moved once on
  Unix, so this action asks `cabal path --remote-repo-cache` rather than
  guessing. Skipped when there is no `cabal` to ask.

Both are keyed on the version of Tilia, the runner, and a hash of
`cabal.project`, `cabal.project.freeze` and every `*.cabal` file.

## Inputs

| Input | Default | Meaning |
| --- | --- | --- |
| `version` | `latest` | The version to install, without a leading `v`. `latest` means the newest version this action knows about, not whatever is newest on GitHub, so that a workflow pinning nothing stays reproducible. |
| `cache` | `true` | Whether to restore and save the directories above. |
| `cache-prefix` | `setup-tilia` | Put in front of the cache keys. Change it to keep two workflows from sharing caches, or to abandon the ones already written. |

## Outputs

| Output | Meaning |
| --- | --- |
| `tilia-path` | The full path of the installed executable. |
| `version` | The version that was installed. |
| `cache-hit` | `true` if every cached directory came back from an exact match. |

## Platforms

`x86_64-linux`, `aarch64-darwin`, `x86_64-darwin`, and `x86_64-windows`—the
four that Tilia releases.

## Building

`dist/index.js` is committed, as a GitHub Action's must be. It is built from
`src/index.ts`:

```console
$ npm install
$ npm run all
```

`nix build` does the same hermetically and is what CI checks the committed
`dist/` against, so a change to `src/` that forgets to rebuild fails rather
than passing quietly. `nix develop` gives you the pinned Node.js without
installing one.

## License

BSD 3 clause, see [`LICENSE.md`](LICENSE.md).

[tilia]: https://github.com/mrkkrp/tilia
[setup]: https://github.com/haskell-actions/setup
