# Roadmap

**Status:** 4 ready · 1 blocked
**Updated:** 2026-09-22

---

## 📦 Up Next

### 📦 Publish a release so the v0.5.5 retraction takes effect

[`go.mod`](go.mod) retracts `v0.5.5`, which was tagged without `web/dist` and therefore serves the "Frontend bundle not found." placeholder from `go install`. Every other 0.5.5 artifact is correct.

**A retraction is inert until a later version carrying the directive is published.** `v0.5.6` predates it, so today `go install …@v0.5.5` still resolves and still installs a broken binary. The next release — whenever there is something else worth releasing — makes `go get` and `go install` skip it and warn if it is named directly.

Nothing to build; this is a note that the fix is staged and lands with the next `just release`.

### 📦 A semantic-token vocabulary, before any component moves

[`OQ-CT1`](docs/design/color-themes.md#decision-ledger) rules semantic tokens in as the layer above the colour ramps — `--surface`, `--text-muted`, each defined over a ramp step — as a series of its own, one area of the app per PR so each diff stays reviewable.

**The vocabulary is the work; the migration only follows from it.** 1,368 colour utility classes and 193 distinct light/dark pairings have to land on token names, and every PR after the first is a mapping onto whatever those names turned out to be — so a name that moves halfway through costs every area already converted. What is ready here is therefore the design note: it has to settle the names, and how much the built-in look may shift as pairings collapse onto fewer tokens. Nothing in the app is implementable until it exists.

Themes written against today's contract keep working through the migration, because a token is defined in terms of the ramps rather than instead of them ([`color-themes.md` §5](docs/design/color-themes.md#5-why-runtime-variables-now-and-not-a-semantic-token-migration)).

### 📦 The review UI's literal colours onto the ramps

About 300 fixed colours in [`frontend/src/index.css`](frontend/src/index.css) — comment highlights, the inline comment cards, their hover and outdated states — ignore every colour theme, so under a dark theme whose surfaces are not Tailwind's slate they are the parts that look wrong. [`OQ-CT2`](docs/design/color-themes.md#decision-ledger) rules the conversion in and accepts what it costs.

**It shifts the built-in look, which is the whole reason it is a PR of its own.** Of the 342 literals counted in that file, 301 are Tailwind v3 palette steps written as `rgb()`, and v4 defines the same steps in `oklch()` — different in the last digits. Snapping each literal to its nearest ramp step therefore moves some of them by a shade with no theme selected at all, which is the one thing the theme system promised not to do ([`color-themes.md` §4](docs/design/color-themes.md#4-the-zero-change-guarantee-and-how-each-piece-keeps-it)). So the PR does only this, and carries before/after screenshots in both modes, so that the shift is what gets reviewed rather than a side effect of something larger. The `¶` heading anchors, the `#L42` line highlight and the two amber flashes go in the same pass.

Self-contained: nothing waits on it and it waits on nothing.

### 📦 More community palettes as built-ins

[`OQ-CT5`](docs/design/color-themes.md#decision-ledger) keeps Catppuccin and Lila in the tree and leaves the door open for more. A theme may be as small as one ramp, so a further palette costs about what the file costs, and each one exercises [the contract](docs/design/color-themes.md#2-the-contract) somewhere the two existing built-ins do not — which is the reason to have built-ins at all.

One stylesheet beside [`frontend/src/themes/catppuccin.css`](frontend/src/themes/catppuccin.css) and its id in the built-in list in [`frontend/src/lib/colorTheme.ts`](frontend/src/lib/colorTheme.ts). The check is the specimen pages in [`docs/gallery/`](docs/gallery/README.md), in both modes, plus a page with prose, code, callouts, a table and a mermaid diagram.

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
