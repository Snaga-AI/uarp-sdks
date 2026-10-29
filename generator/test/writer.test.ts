/**
 * Doc comments are Markdown in every target, and a list item that wraps has to
 * keep its hanging indent or the continuation reads as a new paragraph. Build
 * 9eadfc19 brought the first descriptions with long list items (the agents
 * overview's rings, the App Store notification types) and `cargo clippy -D
 * warnings` refused all 21 continuations (`doc_lazy_continuation`).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Writer } from '../src/writer.ts';

const long = 'word '.repeat(30).trim();

test('a wrapped list item keeps its hanging indent', () => {
  const out = new Writer().doc(`Rings:\n\n- \`needs_you\` — ${long}\n- \`done\` — short`, '/// ').toString();
  const lines = out.trimEnd().split('\n');
  assert.match(lines[2] ?? '', /^\/\/\/ - `needs_you`/);
  assert.match(lines[3] ?? '', /^\/\/\/ {3}word/);
  assert.equal(lines.at(-1), '/// - `done` — short');
});

test('a numbered item indents its continuation by the width of its marker', () => {
  const out = new Writer().doc(`10. ${long}`, ' * ').toString();
  const lines = out.trimEnd().split('\n');
  assert.match(lines[0] ?? '', /^ \* 10\. word/);
  assert.match(lines[1] ?? '', /^ \* {5}word/);
});

test('a plain paragraph wraps flush, as before', () => {
  const out = new Writer().doc(long + ' ' + long, '/// ').toString();
  for (const line of out.trimEnd().split('\n')) {
    assert.match(line, /^\/\/\/ word/);
    assert.ok(line.length <= 96, `${line.length} columns`);
  }
});
