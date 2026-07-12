# Ship Cairn without requiring a language runtime

Users should install and run Cairn without Bun, Node, Python, SQLite, or a development toolchain.

## Release path

1. CI verifies source on macOS, Linux, and Windows.
2. A version tag builds platform executables.
3. Release assets include checksums and platform signatures where applicable.
4. A source formula and bottles are published through a custom Homebrew tap.
5. `homebrew/core` is considered only after Cairn is stable and established.

## Initial artifact matrix

| Platform | Artifact |
| --- | --- |
| macOS Apple Silicon | `cairn-darwin-arm64` |
| macOS Intel | `cairn-darwin-x64` |
| Linux x64 baseline | `cairn-linux-x64` |
| Linux ARM64 | `cairn-linux-arm64` |
| Windows x64 | `cairn-windows-x64.exe` |

## Homebrew

The tap lives in the public GitHub repository `alex-tgk/homebrew-tap`. Users install with:

```sh
brew install alex-tgk/tap/cairn
```

The formula will build the tagged source with Homebrew's Bun formula as a build-only dependency. Published bottles prevent Bun from becoming an end-user dependency.

Before the first bottle can be published, the project needs:

- a stable GitHub release;
- a release source archive and checksum;
- a passing formula test;
- macOS signing/notarization decisions.

## Release acceptance

- [ ] `cairn --version` works on every artifact target.
- [ ] SQLite, migrations, and FTS5 pass native smoke tests.
- [ ] The executable creates data only in the documented platform directory.
- [ ] Release checksums are published.
- [ ] macOS artifacts are signed and notarized.
- [ ] `brew audit`, source installation, bottle installation, and `brew test` pass.
