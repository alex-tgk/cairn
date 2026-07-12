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

### Current delivery state

- The public `v0.1.0` source release is published.
- The release archive checksum is pinned in `Formula/cairn.rb` in the tap.
- `brew style` and `brew audit --strict --online` pass locally.
- A source installation, `brew test`, `cairn --version`, and `cairn doctor` pass locally.
- A clean reinstall through the published `alex-tgk/tap/cairn` path passes.
- Main-branch source CI passes on macOS, Linux, and Windows.
- Tap syntax CI passes on Ubuntu, Apple Silicon macOS, and Intel macOS.
- Bottles and prebuilt release executables are not published yet.

Before the first bottle can be published, the project still needs:

- a bottle-building release workflow;
- bottle publication and clean-machine verification;
- macOS signing/notarization decisions.

## Release acceptance

- [x] `cairn --version` works in the locally built executable and source-installed Formula.
- [x] SQLite, migrations, and FTS5 pass local and source-CI smoke tests.
- [ ] The executable creates data only in the documented platform directory.
- [x] The source release checksum is published in the Formula.
- [ ] macOS artifacts are signed and notarized.
- [x] `brew audit`, source installation, and `brew test` pass.
- [ ] Bottle installation passes.
