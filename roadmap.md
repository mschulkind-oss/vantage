# Roadmap

**Status:** 1 ready · 1 blocked
**Updated:** 2026-09-01

---

## 📦 Up Next

### 📦 Publish a release so the v0.5.5 retraction takes effect

`go.mod` retracts `v0.5.5`, which was tagged without `web/dist` and therefore serves the "Frontend bundle not found." placeholder from `go install`. Every other 0.5.5 artifact is correct.

**A retraction is inert until a later version carrying the directive is published.** `v0.5.6` predates it, so today `go install …@v0.5.5` still resolves and still installs a broken binary. The next release — whenever there is something else worth releasing — makes `go get` and `go install` skip it and warn if it is named directly.

Nothing to build; this is a note that the fix is staged and lands with the next `just release`.

---

## 🔒 Open Threads

### 🔒 TypeScript 7 — blocked on typescript-eslint

TypeScript **7.0.2 is `latest` on npm**, so this is a major version behind current stable rather than a preview we are avoiding.

Attempted and reverted on 2026-09-01: every workspace manifest bumped to `~7.0.2`, resolving to a single hoisted 7.0.2. The gate fails at lint:

```text
Error: typescript-eslint does not support TS 7.0.
```

`typescript-eslint` 8.69.0 — latest, released 2026-08-31 — declares peer `typescript: >=4.8.4 <6.1.0`. No published version names 7.x, canary included, so there is nothing to upgrade to. We lint at `--max-warnings 0` in all three packages, which makes this a hard stop rather than a warning.

**Unblock condition:** `typescript-eslint` ships a release naming 7.x. Nothing else is in the way.

Two blockers used to sit in front of this one, both now cleared:

- `tsup` bundled `rollup-plugin-dts`, which crashed on TS 7 while `tsc --noEmit` passed clean — a failure that surfaced only when generating declarations, which is to say at publish. `c0e70d5d` replaced it with `tsdown`, whose peer range names 7.x and which builds declarations cleanly under 7.0.2.
- The packages disagreed about their TypeScript version, so an upgrade meant moving four pins that were deliberately out of step. `7525caa3` aligned them all on `~6.0.3` and replaced the incidental dual-version check with [`packages/vantage-md/typetest/`](packages/vantage-md/typetest/consumer.ts), which compiles a consumer of the built package under each supported compiler. Widening that range is now adding one alias, not un-aligning the workspace.

Dependabot ignores `typescript` 7.x in [`.github/dependabot.yml`](.github/dependabot.yml) with this reasoning inline, so the weekly PR does not reappear. Lift the ignore, this entry, and the `typescript-5` alias floor together.

**Watch:** [typescript-eslint releases](https://github.com/typescript-eslint/typescript-eslint/releases).
