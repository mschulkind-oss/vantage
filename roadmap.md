# Roadmap

**Status:** 3 ready · 1 blocked
**Updated:** 2026-09-22

---

## 📦 Up Next

### 📦 A semantic-token vocabulary, before any component moves

[`OQ-CT1`](docs/design/color-themes.md#decision-ledger) rules semantic tokens in as the layer above the colour ramps — `--surface`, `--text-muted`, each defined over a ramp step — as a series of its own, one area of the app per PR so each diff stays reviewable.

**The vocabulary is the work; the migration only follows from it.** 1,368 colour utility classes and 193 distinct light/dark pairings have to land on token names, and every PR after the first is a mapping onto whatever those names turned out to be — so a name that moves halfway through costs every area already converted. What is ready here is therefore the design note: it has to settle the names, and how much the built-in look may shift as pairings collapse onto fewer tokens. Nothing in the app is implementable until it exists.

Themes written against today's contract keep working through the migration, because a token is defined in terms of the ramps rather than instead of them ([`color-themes.md` §5](docs/design/color-themes.md#5-why-runtime-variables-now-and-not-a-semantic-token-migration)).

### 📦 The rest of the app's accent glyphs onto per-mode ink

A handful of glyphs are painted in one accent shade for both modes, so each is chosen against one surface and unreadable on the other. Measured by the contrast guard, worst first: the folder icon for a directory containing changes and [`StarButton`](frontend/src/components/StarButton.tsx)'s star are `text-amber-400` at **1.57:1** on the light chrome, collapsed folder icons are `text-blue-400` at 2.41:1, four check marks are `text-green-500` at 2.02:1, [`RecentsPage`](frontend/src/pages/RecentsPage.tsx)'s untracked marker is `text-amber-500` at 1.95:1, and two spinners are `text-blue-600` at 2.79:1 on the dark panel.

**Nothing catches these and nothing can.** [`contrast.ts`](frontend/src/lib/contrast.ts) holds them in the tier it does not floor, because the built-in look misses the floor on them itself — flooring the tier would fail Slate, and no palette can fix a shade the app never steps. The fix is the one [`FileTree`](frontend/src/components/FileTree.tsx)'s git icons already had: a `dark:` half, so each mode's ink is chosen for its own surface, which moves each glyph in one mode only.

It changes the built-in look in a dozen small places at once, which is [`OQ-CT2`](docs/design/color-themes.md#decision-ledger)'s shape rather than a fix to fold into something else: a PR of its own, before/after in both modes. The guard's skip list is the work list, and each site's target ratio is in its output.

### 📦 The review UI's literal colours onto the ramps

About 300 fixed colours in [`frontend/src/index.css`](frontend/src/index.css) — comment highlights, the inline comment cards, their hover and outdated states — ignore every colour theme, so under a dark theme whose surfaces are not Tailwind's slate they are the parts that look wrong. [`OQ-CT2`](docs/design/color-themes.md#decision-ledger) rules the conversion in and accepts what it costs.

**It shifts the built-in look, which is the whole reason it is a PR of its own.** Of the 342 literals counted in that file, 301 are Tailwind v3 palette steps written as `rgb()`, and v4 defines the same steps in `oklch()` — different in the last digits. Snapping each literal to its nearest ramp step therefore moves some of them by a shade with no theme selected at all, which is the one thing the theme system promised not to do ([`color-themes.md` §4](docs/design/color-themes.md#4-the-zero-change-guarantee-and-how-each-piece-keeps-it)). So the PR does only this, and carries before/after screenshots in both modes, so that the shift is what gets reviewed rather than a side effect of something larger. The `¶` heading anchors, the `#L42` line highlight and the two amber flashes go in the same pass.

Self-contained: nothing waits on it and it waits on nothing.

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
