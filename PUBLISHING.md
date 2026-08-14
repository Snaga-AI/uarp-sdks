# Publishing

Five languages, five ecosystems, one version. `scripts/set-version.sh` writes
the number everywhere; a `v<version>` tag triggers
[.github/workflows/release.yml](.github/workflows/release.yml), which refuses to
run if the tag and `VERSION` disagree or the CHANGELOG has no entry.

The workflow does everything a machine can do. This document covers the rest —
the accounts, the domain proof and the signing key, none of which can be
automated, and one structural quirk that is easy to get wrong.

## Where each SDK goes

| Package | Registry | Identity | Reserved by |
|---|---|---|---|
| `packages/typescript` | npm | `uarp-sdk` | publishing |
| `packages/rust` | crates.io | `uarp-sdk` | publishing |
| `packages/kotlin` | Maven Central | `ai.snaga:uarp-sdk` | namespace verification |
| `packages/swift` | SwiftPM | `github.com/snaga-ai/uarp-swift` | the repository itself |
| `packages/ada` | Alire | `uarp_sdk` | a pull request to the index |

## Swift is the odd one out

npm, crates.io and Maven publish an *artifact*: what the registry stores is a
tarball, and where the source lived is only metadata. A package in a monorepo
subdirectory is completely normal there.

SwiftPM publishes nothing. It resolves a git URL at a tag and expects
`Package.swift` at the **root of the repository** — there is no way to point it
at a subdirectory. A Swift developer therefore cannot depend on this monorepo at
all.

So the release copies `packages/swift` into `snaga-ai/uarp-swift`, a repository
that exists only to be depended upon, and tags it there:

```swift
.package(url: "https://github.com/snaga-ai/uarp-swift", from: "0.2.0")
```

The mirror is cloned and updated rather than recreated, because its tags *are*
the published versions: deleting one breaks everybody pinned to it. Create the
repository before the first release — the job cannot create it, and pushing to a
repository that does not exist fails.

## What to arrange once

### npm — minutes

Create the organisation, then an **automation** token (a classic token with
2FA-required will fail in CI). Store it as `NPM_TOKEN`.

The workflow publishes with `--provenance`, which needs no secret but does need
`id-token: write`; that is already in the job.

### crates.io — minutes

Sign in with GitHub, create an API token, store it as
`CARGO_REGISTRY_TOKEN`. The name is claimed by the first publish and cannot be
transferred later without asking the crates.io team, so publish something early
even if it is a preview.

### Maven Central — the slow one, allow half a day

Central no longer uses the old OSSRH flow. Through the
[Central Portal](https://central.sonatype.com):

1. Register the namespace `ai.snaga`. Verification is a **DNS TXT record on
   `snaga.ai`** containing the code the portal gives you. Propagation is usually
   minutes, occasionally hours.
2. Generate a publishing user token — a username/password pair, not your login.
   Store them as `MAVEN_USERNAME` and `MAVEN_PASSWORD`.
3. Create a GPG key, publish the public half to `keyserver.ubuntu.com`, and
   store the **ASCII-armoured private key** as `MAVEN_SIGNING_KEY` and its
   passphrase as `MAVEN_SIGNING_PASSWORD`. Central rejects unsigned artifacts.

A released version can never be deleted or replaced. Treat the first publish as
permanent and dry-run it first.

### SwiftPM — minutes, plus a token

Create `snaga-ai/uarp-swift` (empty, public, no README — the mirror overwrites
everything). Store a token with `contents: write` on that repository as
`SWIFT_MIRROR_TOKEN`; a fine-grained token scoped to the one repository is
enough.

Optionally submit the mirror to the [Swift Package
Index](https://swiftpackageindex.com/add-a-package) so it becomes findable.

### Alire — days to weeks, because a human reviews it

Alire has no upload. `alr publish --tar` builds a tarball and prints the
instructions for opening a pull request against
[`alire-project/alire-index`](https://github.com/alire-project/alire-index).
Maintainers review it and their CI builds the crate **on Linux**, so make sure
the Ada package builds and tests there before submitting — it links libcurl
through FFI and has spent most of its life on macOS.

## Order, by how hard a mistake is to undo

1. **npm** — `npm unpublish` works for 72 hours.
2. **crates.io** — no delete; `cargo yank` only hides a version from new
   dependency resolution.
3. **SwiftPM mirror** — a tag can be deleted, but anyone who resolved it already
   has it cached.
4. **Maven Central** — permanent. Nothing can be removed, ever.
5. **Alire** — a pull request, so mistakes are caught before they land.

Publish in that order the first time. If something is wrong with the packaging,
you find out where it is cheapest.

## Before the first release

```sh
make check                       # generated output matches the spec
make test                        # all five build and pass
make contract                    # the five agree on the wire
UARP_API_KEY=… make smoke        # the spec agrees with the server
```

then a dry run of the release itself, from the Actions tab —
**Release → Run workflow → dry run: true**. It builds every artifact, packs the
npm tarball, packages the crate, publishes the Kotlin jar to the local Maven
repository and assembles the Swift mirror without pushing anything.

Two things that dry runs have caught here already: no package carried a
`LICENSE` file although all five declared MIT, and the Swift package was not
reachable by any consumer at all.

## Cutting a release

```sh
scripts/set-version.sh 0.2.0     # writes VERSION and every manifest, regenerates
$EDITOR CHANGELOG.md             # rename Unreleased to the version
git commit -am "Release 0.2.0"
git tag v0.2.0
git push origin main --tags
```

The tag starts the workflow. Alire is the one step that does not finish on its
own: collect the tarball from the run and open the index pull request.
