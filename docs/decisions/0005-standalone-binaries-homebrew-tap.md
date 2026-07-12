# ADR 0005: Publish standalone binaries through a custom Homebrew tap

## Status

Accepted July 12, 2026.

## Context

Ease of installation for other developers is a primary product requirement. Source-only installation would expose users to runtime versions and package-manager setup.

## Decision

- Publish prebuilt Cairn executables for supported macOS, Linux, and Windows targets.
- Publish checksums and platform signatures where required.
- Use a custom `OWNER/homebrew-tap` repository as the first Homebrew channel.
- Build the formula from tagged source and publish bottles so Bun remains a build-only dependency.
- Consider `homebrew/core` only after Cairn is stable and established.

## Consequences

- Release engineering is a product feature, not an afterthought.
- A GitHub owner, license, versioned release, signing policy, formula, and bottle workflow are required before public installation.
- CI artifacts are useful for validation but are not substitutes for signed releases.
