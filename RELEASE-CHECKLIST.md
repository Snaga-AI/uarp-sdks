# Release checklist

One stage per package, in order of how hard a mistake is to undo. Each stage is
finished when the artifact has been built, unpacked, installed by a consumer that
did not build it, and used.

The order matters. npm allows `unpublish` for 72 hours; crates.io only yanks;
Maven Central is permanent. A packaging mistake should surface where it is still
cheap.

[PUBLISHING.md](PUBLISHING.md) has the accounts, tokens and the DNS record.
This file records what was actually verified, and what is left.

| Stage | Package | Registry | State |
|---|---|---|---|
| 1 | `packages/typescript` | npm `uarp-sdk` | **0.3.0 published**; 0.2.0 deprecated |
| 2 | `packages/rust` | crates.io `uarp-sdk` | **0.3.0 published**; 0.2.0 yanked |
| 3 | `packages/swift` | SwiftPM `Snaga-AI/uarp-swift` | **0.3.0 tagged** |
| 4 | `packages/kotlin` | Maven `ai.snaga:uarp-sdk` | **0.3.0 published** |
| 5 | `packages/ada` | Alire `uarp_sdk` | **submitted** — alire-index#2059, now 0.3.0 |

---

## Stage 1 — npm, `uarp-sdk`

### Checked

| | |
|---|---|
| Manifest | name, version, description, licence, author, homepage, bugs, repository, engines, keywords, `sideEffects: false` |
| Tarball | 196 kB packed; `dist`, `src`, `README.md`, `LICENSE`; no tests, examples or config |
| Install | packed, installed into an empty project by path, imported |
| Runtime | `import` resolves; `UarpClient`, `VERSION`, `APIError`, `DEFAULT_BASE_URL` all present and constructible |
| Types | `tsc` clean from a consumer under `moduleResolution: nodenext` **and** `bundler`, with `skipLibCheck` off |
| Source maps | `dist/index.d.ts.map` resolves to a file that is actually in the tarball |
| Runtime globals | `fetch`, `Blob`, `FormData`, `AbortSignal`, `crypto`, `TextEncoder`, `ReadableStream` — all Node 18, so `engines` is honest |

Reproduce with:

```sh
cd packages/typescript && npm run build && npm pack
mkdir /tmp/consumer && cd /tmp/consumer && npm init -y
npm install /path/to/uarp-sdk-<version>.tgz
node -e "import('uarp-sdk').then(m => console.log(m.VERSION))"
```

### Fixed

- **Dangling source maps.** The build emits `sourceMap` and `declarationMap`, but
  `files` shipped only `dist` — all 108 maps pointed at a `src` directory that
  was not in the package. `src` now ships, which also makes go-to-definition land
  in the real TypeScript rather than a `.d.ts`.
- **Missing `LICENSE`.** Declared MIT, listed in `files`, and not present. Now in
  every package.
- **`repository.url`** is now the conventional `git+https://….git` form. npm
  provenance matches the publishing repository against this field.
- Added `author`, `homepage` and `bugs`, which npm shows on the package page.

### Known and deliberate

- **ESM only.** `require('uarp-sdk')` works from Node 22.12 onwards, where Node
  learned to require an ES module; below that a CommonJS caller needs
  `await import(…)`. A dual build was not worth the complexity for a package
  whose floor is already Node 18. Documented in the package README.
- `engines.node: ">=18"` is accurate for the globals the code uses, even though
  Node 18 is out of support. It is a floor, not a recommendation.

### Left to do

- `NPM_TOKEN` (automation token — a classic token with 2FA-required fails in CI).
- The publish itself, through the release workflow or `npm publish --provenance`.
  Provenance needs the workflow to run in `Snaga-AI/uarp-sdks`, so the repository
  has to exist first.

---

## Stage 2 — crates.io, `uarp-sdk`

### Checked

| | |
|---|---|
| Manifest | name, version, edition, rust-version, licence, description, repository, homepage, readme, 5 keywords, 2 categories |
| Package | `cargo publish --dry-run` builds the packaged crate from scratch: 63 files, 110 kB compressed |
| Contents | `src`, `examples`, `tests`, `README.md`, `LICENSE`, `Cargo.lock` |
| Docs | `cargo doc --all-features --no-deps` clean, which is how docs.rs will build it |
| Features | `rustls-tls` (default) and `native-tls`; both enabled together still compile, which is what `all-features = true` asks docs.rs to do |

### Fixed

- **Doc comments were mangled by rustdoc.** Descriptions are Markdown once
  rustdoc has them, and the spec's prose is full of things Markdown eats:
  `uarp_<prefix>_<secret>` rendered as `uarp__secret` because `<prefix>` parsed
  as an HTML tag, and every URL in a description was plain text. Both are now
  escaped in the emitter. A first attempt swallowed the full stop after a URL
  into the link itself; trailing punctuation is now left in the sentence.
- **The fixtures had no prose to break.** `prose.json` covers angle-bracket
  placeholders, bracketed text and URLs, so the five emitters are pinned on the
  case that reached production undetected.
- Added `homepage`.

### Left to do

- `CARGO_REGISTRY_TOKEN` — **done**, in repository secrets.
- The publish itself. `uarp-sdk` is unclaimed; the first publish takes the name
  and it cannot be transferred afterwards without asking the crates.io team.

### Known and deliberate

- `docs.rs` builds with `all-features = true`. If it ever fails there, the
  documentation for that version is broken permanently — only a new version can
  replace it — so it is checked locally before every release.
- Angle brackets and URLs are escaped for Rust only. Swift DocC and Kotlin KDoc
  render Markdown too and may have the same problem; nothing has demonstrated it
  yet, so nothing has been changed there.

---

## Stage 3 — SwiftPM, `Snaga-AI/uarp-swift` — published

SwiftPM resolves a git URL and expects `Package.swift` at the repository root,
so nothing in a monorepo subdirectory can be depended upon. `packages/swift` is
copied into its own repository and tagged there.

```swift
.package(url: "https://github.com/Snaga-AI/uarp-swift", from: "0.2.0")
```

### Checked

| | |
|---|---|
| Assembly | `scripts/swift-mirror.sh` builds the mirror and refuses to finish if a harness target survives the strip |
| Standalone | the assembled package builds from its own root and passes all 30 tests |
| Products | the library and the example only; the contract and live runners are stripped |
| **Resolution** | a fresh package depending on the tag fetched it from GitHub, built, and ran |

### Left to do

- `SWIFT_MIRROR_TOKEN` — a fine-grained token with `contents: write` on
  `Snaga-AI/uarp-swift`. 0.2.0 was pushed by hand; without the secret the
  release job warns and skips the mirror.
- Optionally list it on the Swift Package Index so it is findable.

---

## Stage 4 — Maven Central, `ai.snaga:uarp-sdk` — blocked on DNS

Central does not accept a Maven deploy. The upload endpoint takes one zip
holding the whole repository layout; a per-file `PUT` answers 404, which is what
the build was doing. Gradle now stages into a directory and
`scripts/publish-maven.sh` zips, posts and polls.

### Checked

| | |
|---|---|
| Artifacts | jar, sources, javadoc, pom, module — everything Central requires |
| Signatures | a 4096-bit RSA key signs every file; `.asc`, `.md5`, `.sha1`, `.sha256`, `.sha512` all present |
| Bundle | Central accepted the upload (201) and returned a deployment id |
| Validation | ran, and answered — see below |

The upload was tried by hand with `publishingType=USER_MANAGED`, so a mistake
could not become permanent. It failed with exactly one error:

```
Namespace 'ai.snaga' is not allowed
```

### Left to do

- **Register and verify `ai.snaga`** on the Central Portal. Verification is a
  DNS TXT record on `snaga.ai`. Nothing can work around it, and everything else
  is already proven working.
- The signing key is `625840EC DBE162D6 0C5C8C2D C3A2DE60 5591E83E`, RSA 4096,
  no expiry, public half on `keyserver.ubuntu.com`. Replace it with your own if
  you would rather hold the private key yourself; the secrets to change are
  `MAVEN_SIGNING_KEY` and `MAVEN_SIGNING_PASSWORD`.

---

## Stage 5 — Alire, `uarp_sdk` — ready to submit

Alire has no upload: a release is a pull request against the community index
pointing at a hosted tarball.

| | |
|---|---|
| Tarball | attached to the GitHub release, 200 kB |
| Hash | `sha256:fcc059c5a856feda8d77bae784473549b3d0d0e512b8a237c054035e579ec0a6`, verified against a fresh download |
| Manifest | `packages/ada/alire-index/uarp_sdk-0.2.0.toml` |
| Linux | the crate builds and its 93 tests pass on Ubuntu in CI, which is where the index reviewers build it |

### Submitted

[alire-project/alire-index#2059](https://github.com/alire-project/alire-index/pull/2059),
against `stable-1.4.0`, which is the branch `alr` 2.1.1 actually reads.

Two things were corrected before submitting, both of which would have failed
review:

- `maintainers-logins` named only the organisation. Alire checks that whoever
  opens the submission is listed there, and an organisation cannot open a pull
  request. The crate carries its own manifest inside the tarball, so the archive
  was rebuilt and re-uploaded for the two to agree — and the hash recomputed
  from the published file, not the local one.
- The `tests` and `examples` crates ship inside the tarball and had drifted from
  the root manifest.

Verified by fetching it the way a user would: with the manifest in a local copy
of the community index, `alr get uarp_sdk` retrieved and deployed the crate from
the published archive and checked the hash.

The rest is review by the Alire maintainers, and their CI builds the crate on
Linux — which this repository's CI already does on every push.

---

## 0.3.0

Cut because 0.2.0 reports an empty collection when it is not one: every `*All`
walker stopped at the first page with no items, and this API returns exactly
that while `has_more` is true. Silently — the caller sees an empty list, not an
error. 0.2.0 is deprecated on npm, yanked on crates.io, and the Alire submission
was moved to 0.3.0 rather than putting a known-broken release in the index.

A minor bump rather than a patch: the generated surface changed with the API
document. `AgentModelConfig` no longer carries a provider or model identifier
and its enumeration is gone; health status became an enumeration; required
properties moved across five schemas. Code that set a model on create will not
compile — and the platform had been ignoring that field anyway.

The Swift mirror still has to be pushed by hand at each release, because
`SWIFT_MIRROR_TOKEN` is not set. Without it the job warns and skips, so a
release quietly leaves Swift consumers on the previous version — which is what
happened here until it was noticed.

---

## Stage 4 — Maven Central, `ai.snaga:uarp-sdk` — published

The namespace verified once the TXT record was picked up, and 0.3.0 went out
through the release workflow: bundle uploaded, validated, `PUBLISHED`, and
`repo1.maven.org` serves both the pom and the jar.

Verified the way the others were — from a project that did not build it:

```kotlin
repositories { mavenCentral() }
dependencies { implementation("ai.snaga:uarp-sdk:0.3.0") }
```

resolves, compiles and runs.

That test also turned up something worth documenting rather than fixing: the
library is built with Kotlin 2.2, and a consumer on Kotlin 2.0 fails with
*"Module was compiled with an incompatible version of Kotlin"* before reaching
any of the API. Both READMEs now state the requirement.

All five registries are now published.
