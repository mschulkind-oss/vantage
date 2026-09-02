# Roadmap

**Status:** 1 attention required · 1 ready · 1 blocked
**Updated:** 2026-09-01

---

## 💬 Attention Required

### 💬 Keep the dual-TypeScript check, or collapse it?

[PR #84](https://github.com/mschulkind-oss/vantage/pull/84) bumps `frontend` and `packages/vantage-check` from `~5.9.3` to `~6.0.3`. It is CI-green, and merging it would delete both nested installs from the lockfile so everything resolves the single hoisted 6.0.3.

That silently removes a check `AGENTS.md` calls deliberate: `packages/vantage-md` is type-checked twice, standalone at `~6.0.3` and again through `frontend`'s project reference at `~5.9.3`. The gate cannot notice the loss — one consistent compiler passes fine. The second opinion simply stops being asked.

**Leaning: close it and add a `typescript` 6.x ignore for those two packages**, with the reason recorded the way the 7.x one now is. The check is cheap, `vantage-md` is published to npm for consumers on varied TypeScript versions, and today produced a related lesson — the dts build silently picking up the wrong compiler is exactly what it guards against.

Merging is defensible too. If you take it, `AGENTS.md` needs the paragraph deleted, including the note on why `typescript` is pinned at the workspace root — that pin exists only to keep the two versions apart.

Either way this needs a ruling, because dependabot will re-open it weekly until one is written down.

---

## 📦 Up Next

Ordered by what unblocks users first.

### 📦 Cut v0.5.6 to repair `go install`

`v0.5.5` was tagged by hand rather than through `just release`, so its tree carries no `web/dist`. Every other artifact is correct — archives, both PyPI wheels, npm, and the Homebrew formula are all built by CI — but `go install github.com/mschulkind-oss/vantage/cmd/vantage@latest` serves `Frontend bundle not found.`

The tag cannot be repaired. `proxy.golang.org` fetched it at 21:08:26Z on 2026-09-01, so `sum.golang.org` has recorded that tree hash; re-pointing the tag would turn a placeholder into a checksum failure for everyone. A new version is the only fix.

```bash
just release 0.5.6
```

Then confirm `go install …@latest` serves a real frontend — that is the property the whole untracked-`web/dist` design protects, and it has not yet been exercised by a correctly cut tag.

Both guards against a repeat are already in place: `publish.yml` fails a tag whose `web/dist` holds only `.gitkeep`, and `oss-release` refuses to run without a `just release` recipe.

---

## 🔒 Open Threads

### 🔒 TypeScript 7 — blocked on typescript-eslint

TypeScript **7.0.2 is `latest` on npm**, so this is a major version behind current stable rather than a preview we are avoiding.

Attempted and reverted on 2026-09-01: all four workspace manifests bumped to `~7.0.2`, resolving to a single hoisted 7.0.2. The gate fails at lint:

```text
Error: typescript-eslint does not support TS 7.0.
```

`typescript-eslint` 8.69.0 — latest, released 2026-08-31 — declares peer `typescript: >=4.8.4 <6.1.0`. No published version names 7.x, canary included, so there is nothing to upgrade to. We lint at `--max-warnings 0` in all three packages, which makes this a hard stop rather than a warning.

**Unblock condition:** `typescript-eslint` ships a release naming 7.x. Nothing else is in the way.

A second blocker used to sit in front of this one and is now gone: `tsup` bundled `rollup-plugin-dts`, which crashed on TS 7 with `Cannot read properties of undefined (reading 'useCaseSensitiveFileName…')` while `tsc --noEmit` passed clean — a failure that only surfaced when generating declarations, which is to say at publish. `c0e70d5d` replaced `tsup` with `tsdown`, whose peer range names 7.x and which builds declarations cleanly under 7.0.2.

Dependabot ignores `typescript` 7.x in [`.github/dependabot.yml`](.github/dependabot.yml) with this reasoning inline, so the weekly PR does not reappear. Lift the ignore and the roadmap entry together.

**Watch:** [typescript-eslint releases](https://github.com/typescript-eslint/typescript-eslint/releases).
