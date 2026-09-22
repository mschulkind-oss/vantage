# Colour Themes

Vantage has two independent appearance settings. **Light or dark** is the one
you already know: **Shift+D**, or the Light/Dark buttons in the settings menu.
A **colour theme** is the palette both of those modes are drawn in. The
built-in look is called **Vantage**; Vantage also ships **Catppuccin** (Latte in
light mode, Mocha in dark) and **Lila** (the same flavours with a mauve accent
and the sidebar and top bar recessed below the content in dark mode), and you
can add your own by dropping a stylesheet into a folder.

Switching mode never changes your theme, and switching theme never changes your
mode.

---

## Choosing a theme

Open the settings menu (the gear icon) and pick one from **Colours**, under
the Light/Dark buttons. The list is fetched each time the menu opens, so a
theme you have just added shows up without reloading.

The choice is remembered **per browser**, in that browser's local storage for the
address you opened Vantage at — the same way light/dark is. A second browser, a
private window, or the same server reached under a different host name or port
starts from the default below.

### A default for every browser

To have every browser start in a theme until someone picks another, name it in
your user config:

```toml
# ~/.config/vantage/config.toml
theme = "catppuccin"
```

The value is a theme id: `catppuccin`, the id of one of your own themes (below),
or `default` for the built-in look. The key is read once, when the server
starts, so restart Vantage after changing it. It is always read from
`~/.config/vantage/config.toml` (or `$XDG_CONFIG_HOME/vantage/config.toml`),
because a colour theme is your setting rather than a project's — in single-directory
mode as well as in daemon mode, and even when the daemon was started with
`--config` pointing somewhere else.

### Which one wins

1. **A choice made in this browser.** Picking **Vantage** counts: it is stored
   as an explicit choice, so a configured default does not override it.
2. **`theme` in the user config.**
3. **The built-in look.**

If a browser's stored choice names a theme of yours that no longer loads — you
deleted or renamed the file — the browser forgets that choice and falls back to
the configured default, as if nothing had been picked. If the configured default
names a theme that does not exist, you get the built-in look. A theme of yours
that fails to load leaves a warning in the browser console saying which.

To forget a choice made in a browser and follow the configured default again,
clear the site data for Vantage in that browser.

---

## Writing your own

A theme is one CSS file. Put it in the themes folder beside your config:

```
~/.config/vantage/themes/<id>.css
```

On a Mac set up before 2026-09-04 whose `config.toml` still lives in
`~/Library/Application Support/vantage/`, the themes folder is beside it there.

The file name without `.css` is the theme's **id** — what the menu lists, what
the config's `theme` key names, and what is stored in the browser. An id is 1–64
characters of **lowercase** letters, digits, `-` and `_`, starting with a letter
or digit, and the extension is a lowercase `.css`. Capitals are refused because
a Mac's disk ignores case and Linux's does not, so `Nord.css` would be a
different theme on each. A file whose name does not fit is skipped without a
message, so if a theme does not appear, check its name first. The file may be a
symlink, which is followed — handy if your themes live in a dotfiles
repository.

The folder is re-read every time the menu opens: a new theme appears **without
restarting the server**. Edits to a theme you are using show on the next page
reload.

> [!TIP]
> Start from the built-in Catppuccin theme,
> [`frontend/src/themes/catppuccin.css`](../../frontend/src/themes/catppuccin.css).
> It is written as the worked example for this page: swatches named once, full
> ramps derived from them, and each section commented with why it is shaped that
> way.

### Replacing a built-in

A theme of yours with the **same id as a built-in replaces it**. Copy
`catppuccin.css` into the themes folder as `catppuccin.css`, change what you
like, and everyone who had chosen Catppuccin gets your version, still listed as
**Catppuccin**. The one id you
cannot take is `default`: a file called `default.css` is ignored, so the
built-in look is always available.

### The structure

A theme sets CSS custom properties — nothing else — in two rules:

```css
:root {
  /* light mode, and the starting point for dark mode */
  --color-slate-50: #f8fafc;
  /* … */
}

:root.dark {
  /* dark mode: overrides whatever :root set */
  --color-slate-50: #f1f5f9;
  /* … */
}
```

`:root` applies in **both** modes, and `:root.dark` is layered on top of it in
dark mode. So anything you set only in `:root` is also what dark mode gets. That
is fine for a palette meant to serve both modes, the way Tailwind's own does, but
a palette tuned for a light background has to be restated in `:root.dark`.
Put values that are the same in both modes in `:root, :root.dark { … }`.

Anything a theme does not set keeps its built-in value, so a theme can be as
small as one ramp.

### The variable contract

Vantage's interface is drawn with Tailwind's colour families, and every one of
them is a variable a theme can set: `--color-<family>-<step>`, for the steps
`50`, `100`, `200` … `900`, `950`. Each family has a role:

| Family | Role |
| --- | --- |
| `slate` | Neutral surfaces, borders and text — nearly the whole interface, and the document body |
| `blue` | The accent: links, selection, primary buttons, focus |
| `purple` | Review mode and the secondary accent |
| `red` | Danger and errors |
| `amber` | Warnings |
| `green` | Success |
| `gray`, `indigo`, `emerald`, `yellow`, `orange` | Used in a handful of places; point them at a main family, as Catppuccin does |

Two single values sit beside the ramps: `--color-white`, which is the page
background in light mode **and** the text on accent buttons in both modes, and
`--color-black`.

> [!IMPORTANT]
> **Keep every ramp in order, `50` lightest to `950` darkest, in both modes.**
> Components choose a step for its lightness — `slate-500` is muted text on a
> light page, `slate-800` is the chrome in dark mode — so a ramp that is in
> order keeps each of them legible, and a ramp that is out of order puts light
> text on a light surface somewhere you did not look.
>
> Break the order only on purpose, one step you know the use of. Lila does it
> once: in dark mode its `slate-800` (the sidebar, top bar and menus) is darker
> than its `slate-900` (the content), so the chrome sits below the page, the way
> terminal panes do.

The rest of the contract is things that are not Tailwind colours:

- **Tones** — the colours of callouts (`> [!NOTE]`) and of the `tone=` directive,
  for the six tones `note`, `tip`, `important`, `warning`, `caution` and `muted`:
  `--vantage-tone-<tone>-accent` (the rule and border),
  `--vantage-tone-<tone>-ink` (the text),
  `--vantage-tone-<tone>-wash` (the background) and
  `--vantage-tone-<tone>-chip` (a badge's background). These have their own
  built-in values rather than following the ramps, so a theme that recolours
  `blue` still gets the built-in blue for `note` until it sets these too.
- **Code** — syntax-highlighting colours by role. Under the built-in look code
  keeps GitHub's palette; under any theme each role reads its variable and, if
  the theme leaves it unset, falls back to a step of the theme's own ramps. A
  theme that only recolours the ramps therefore still gets coherent code.

  | Variable | Colours | Falls back to (light / dark) |
  | --- | --- | --- |
  | `--vantage-code-fg` | Plain code, variables, punctuation | `slate-800` / `slate-200` |
  | `--vantage-code-comment` | Comments | `slate-500` / `slate-400` |
  | `--vantage-code-keyword` | Keywords | `purple-600` / `purple-400` |
  | `--vantage-code-string` | Strings, regexes | `green-700` / `green-400` |
  | `--vantage-code-number` | Numbers, literals | `orange-600` / `orange-400` |
  | `--vantage-code-title` | Function, class and section names | `blue-600` / `blue-400` |
  | `--vantage-code-tag` | Tags and selectors | `red-600` / `red-400` |
  | `--vantage-code-attr` | Attributes and properties | `amber-700` / `amber-400` |
  | `--vantage-code-builtin` | Built-ins and types | `amber-600` / `amber-300` |
  | `--vantage-code-meta` | Preprocessor and meta lines | `slate-600` / `slate-400` |
  | `--vantage-code-addition` | Added lines in a diff | `green-700` / `green-400` |
  | `--vantage-code-deletion` | Removed lines in a diff | `red-700` / `red-400` |

- **Scrollbars** — `--vantage-scrollbar-thumb` and
  `--vantage-scrollbar-thumb-hover`.
- **Mermaid diagrams** have no variables of their own: they follow the `slate`
  ramp. Diagram backgrounds, nodes, borders, lines and labels are read from the
  same `slate` steps the built-in diagram colours were chosen from, and a
  diagram redraws when the theme changes.

### Checking a theme

The pages that exercise the most colour at once are a review in progress (review
mode uses `purple`, `amber` and `green` together), a document with callouts of
every kind, and a code block in a few languages. In a clone of the Vantage
repository, the specimen pages in
[`docs/gallery/`](../../docs/gallery/README.md) render every tone, badge and
callout on one screen each. Check both modes: Shift+D flips between them without
leaving the page.

---

## What is not themed yet

- **Parts of review mode.** Roughly 300 colours in the review interface —
  comment highlights, the inline comment cards, their hover and outdated states —
  are written as fixed values in Vantage's own stylesheet rather than as
  variables, so they keep the built-in colours under every theme. Converting
  them is planned.
- **A few accents.** The `¶` anchor beside a heading and the highlight on a
  linked line (`#L42`) stay the built-in blue, and the flash on a document that
  just changed and the copy-error message stay the built-in amber, whatever your
  theme sets `blue` and `amber` to.
- **Printing.** Print ignores the theme, on purpose: a page prints the way the
  built-in look prints it in the same mode, with prose text forced dark on a light
  page.
- **Static sites.** A [static export](static-sites.md) has no server, so it
  offers the built-in themes only. Your own themes, and the configured default,
  are not part of it.
