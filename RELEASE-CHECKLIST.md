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
| 1 | `packages/typescript` | npm `uarp-sdk` | verified, waiting on a token |
| 2 | `packages/rust` | crates.io `uarp-sdk` | verified, waiting on the repository |
| 3 | `packages/swift` | SwiftPM `snaga-ai/uarp-swift` | not started |
| 4 | `packages/kotlin` | Maven `ai.snaga:uarp-sdk` | not started |
| 5 | `packages/ada` | Alire `uarp_sdk` | not started |

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
  Provenance needs the workflow to run in `snaga-ai/uarp-sdks`, so the repository
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
