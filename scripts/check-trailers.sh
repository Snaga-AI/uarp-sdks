#!/usr/bin/env bash
#
# Commit-message trailer gate.
#
# This repository has no `commit-msg` hook — `core.hooksPath` is unset and
# `.git/hooks` holds only samples — so the trailer rule has never been
# enforced anywhere. `pre-commit`'s `commit-msg` stage would not help: it
# runs only for someone who has run `pre-commit install`, which is exactly
# the assumption that already failed here. A CI check gates every pull
# request regardless of what anyone installed locally.
#
# Scope: pull requests, going forward. It deliberately does NOT clean
# history. Measured on this repository's main: 90 commits, 0 carrying a
# banned trailer, 13 missing the required one. So there is no breach to clean
# up here — only a rule kept by discipline with nothing enforcing it, which
# is what this stops from regressing.
#
# It would not have been academic. `d427c74`, the tip of main, carries
# `Co-authored-by: Snaga <snaga@Snagas-MacBook-Pro.local>` — a developer
# machine's hostname, on a public repository, arrived there because this repo
# squash-merges and squash-merge DISCARDS the branch author while PRESERVING
# the trailer. The branch behind #44 would have gone red here first.
#
# Shared with `chabanov/snaga`, which has the same gap and a real history of
# banned trailers; see that repository's copy for its own numbers.
#
# Usage:  scripts/check-trailers.sh [BASE]
#         BASE defaults to origin/main.

set -euo pipefail

BASE="${1:-${TRAILER_BASE:-origin/main}}"

if ! git rev-parse --verify --quiet "$BASE" >/dev/null; then
    echo "check-trailers: cannot resolve base '$BASE'." >&2
    echo "  In CI this almost always means the checkout was shallow." >&2
    echo "  This job needs 'fetch-depth: 0' or it examines nothing." >&2
    exit 2
fi

RANGE="$BASE..HEAD"
# `git rev-list` into a plain string rather than `mapfile`: mapfile is
# bash 4+, and macOS ships bash 3.2, so the CI-only version would have been
# unrunnable on the machine where it gets falsified.
# `--no-merges`: a contributor who updates a branch by merging main rather
# than rebasing gets a merge commit carrying git's auto-message and no
# trailer. Failing on a commit nobody wrote teaches people to bypass the
# check.
#
# Future-proofing HERE — this repository has no merge commit in its last 80.
# Not so in `chabanov/snaga`, which shares this script: 32 merge commits in
# its last 100 and all 32 lack the required trailer, so there the flag is
# what keeps ordinary pull requests green. Stating which repository the
# number describes, because the first version of this comment said "neither
# repository" and was wrong about the other one.
COMMITS=$(git rev-list --no-merges "$RANGE")
COMMIT_COUNT=$(printf '%s' "$COMMITS" | grep -c . || true)

# An empty range is not a pass. A shallow clone, a wrong base or a branch
# already merged all produce zero commits, and silently reporting success
# over nothing is the failure this gate exists to prevent.
if [ "$COMMIT_COUNT" -eq 0 ]; then
    echo "check-trailers: no commits in $RANGE — nothing was checked."
    echo "  Not treating that as a pass. If this branch really adds no"
    echo "  commits, the job should not have run."
    exit 2
fi

# Banned, on every commit including bots.
#
# Anchored to the start of a line, i.e. to TRAILER form. The first version
# matched these strings anywhere in the body and immediately failed its own
# commit, whose message explains the rule and therefore contains the words.
# A message that discusses `Claude-Session:` is not a message that carries
# one, and a checker that cannot tell the difference makes writing about the
# rule impossible. The defect being caught is always a trailer line:
# `Claude-Session: https://claude.ai/code/...` is caught by the first
# alternative, so a bare URL mentioned in prose needs no separate rule.
BANNED_RE='^claude-session:|^co-authored-by:.*claude|^x-claude'

# The required trailer is matched on the EMAIL, case-insensitively on the
# token. Four legitimate display names are in live use across this repo and
# apps/sdk for one identity — `Snaga Agent`, `agent`, `snaga-code`, `Snaga` —
# against a single constant address. Matching a name rejects most of both
# repositories' legitimate history; the address is the stable part. Git
# treats trailer tokens case-insensitively and both cases are in main.
REQUIRED_RE='^co-authored-by:[[:space:]].*<agent@snaga\.ai>'

# Bots do not carry the agent trailer and never will: every dependabot
# commit in this repository lacks it. Requiring it of them would turn the
# most routine pull request in the repo permanently red, so the REQUIRED
# half exempts them. The BANNED half still applies to everyone.
BOT_RE='dependabot|\[bot\]|github-actions'

fail=0
for sha in $COMMITS; do
    subject=$(git log -1 --format='%s' "$sha")
    body=$(git log -1 --format='%B' "$sha")
    author=$(git log -1 --format='%an <%ae>' "$sha")
    short=$(git log -1 --format='%h' "$sha")

    # Capture, then test for emptiness — do NOT branch on the pipeline's
    # exit status. That status is `head`'s, and `head` all but always
    # succeeds, so this read correctly only because `set -o pipefail`
    # promoted grep's 1 from the middle of the pipe. With `pipefail`
    # removed, every commit failed with an EMPTY evidence line, on a
    # branch that was clean. Correctness must not rest on a `set` line
    # thirty lines away.
    hit=$(printf '%s' "$body" | grep -inE "$BANNED_RE" | head -3 || true)
    if [ -n "$hit" ]; then
        echo "✗ $short $subject"
        echo "    banned trailer / URL in the commit message:"
        printf '      %s\n' "$hit"
        fail=1
    fi

    if printf '%s' "$author" | grep -qiE "$BOT_RE"; then
        continue
    fi

    if ! printf '%s' "$body" | grep -qiE "$REQUIRED_RE"; then
        echo "✗ $short $subject"
        echo "    missing the required trailer:"
        echo "      Co-authored-by: <any name> <agent@snaga.ai>"
        echo "      (the address is what is checked; the display name is free)"
        fail=1
    fi
done

if [ "$fail" -ne 0 ]; then
    echo
    echo "Checked $COMMIT_COUNT commit(s) in $RANGE — see failures above."
    exit 1
fi

echo "check-trailers: $COMMIT_COUNT commit(s) in $RANGE, all clean."
