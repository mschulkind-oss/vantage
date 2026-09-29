# Mermaid stylesheet fixture

Fixture for the "keeps a diagram's source from writing the page's stylesheet"
test in `mermaid.spec.ts`. Mermaid scopes every selector a diagram's CSS writes
to that diagram, but not the name of a `@keyframes` rule, so a diagram that
defines one of the app's animations redefines it for the whole page. Each
diagram below reaches Mermaid's stylesheet by a different route, and each one
also asks for an image from a host that does not exist.

The `themeCSS` of an `init` directive:

```mermaid
%%{init: {"themeCSS": "@keyframes flash-update { 0%, 100% { position: fixed; top: 0px; left: 0px; width: 100vw; height: 100vh; z-index: 99999; background-color: red; } } .node rect { fill: url(https://init-theme.example.invalid/beacon.svg#a) }"}}%%
flowchart LR
  A1[init theme] --> B1[end]
```

The `themeCSS` of a diagram's frontmatter:

```mermaid
---
config:
  themeCSS: "@keyframes flash-update-dark { 0%, 100% { position: fixed; top: 0px; left: 0px; width: 100vw; height: 100vh; z-index: 99999; } } .node rect { fill: url(https://frontmatter-theme.example.invalid/beacon.svg#a) }"
---
flowchart LR
  A2[frontmatter theme] --> B2[end]
```

The `fontFamily` of an `init` directive, which Mermaid writes into its
stylesheet as a declaration's value:

```mermaid
%%{init: {"fontFamily": "serif; @keyframes spin { 0%, 100% { position: fixed; top: 0px; left: 0px; width: 100vw; height: 100vh; z-index: 99999; } } background-image: url(https://init-font.example.invalid/beacon.png)"}}%%
flowchart LR
  A3[init font] --> B3[end]
```

The `fontFamily` of a diagram's frontmatter:

```mermaid
---
config:
  fontFamily: "serif; @keyframes pulse { 0%, 100% { position: fixed; top: 0px; left: 0px; width: 100vw; height: 100vh; z-index: 99999; } } background-image: url(https://frontmatter-font.example.invalid/beacon.png)"
---
flowchart LR
  A4[frontmatter font] --> B4[end]
```

The block the test flashes.
