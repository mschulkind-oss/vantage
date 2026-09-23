import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // coverage/ is vitest's v8 report output — never source, but present in a
  // working tree after `npm run test:coverage`, and its vendored reporter
  // scripts carry eslint-disable directives that trip --max-warnings 0.
  globalIgnores(["dist", "coverage"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // The Vite entry wires up routing at the root; it is never a fast-refresh
    // boundary, so react-refresh's component-export rule does not apply here.
    files: ["src/main.tsx"],
    rules: {
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // Web storage is `src/lib/preferences.ts`'s alone. Eleven preferences once
    // reached `localStorage` at the point of use and nine of them therefore
    // never followed the reader to a second tab, which no type and no test can
    // prevent the twelfth from repeating — only a rule that fails at the line
    // that wrote it. The selectors cover both spellings of the access,
    // `localStorage.x`, `window.localStorage.x` and `window["localStorage"].x`,
    // because each is the obvious way around the one before it. The third
    // matches only a *string literal* property, so `obj[someName]` and
    // `obj["anythingElse"]` are untouched — the goal is closing the obvious
    // bypass, not proving impossibility. A genuinely dynamic `window[name]`
    // where `name` is computed at runtime can still reach storage; nothing short
    // of a type-aware rule would see that, and nothing in this app does it.
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name=/^(localStorage|sessionStorage)$/]",
          message:
            "Use readPreference/writePreference/clearPreference/subscribePreference from src/lib/preferences.ts — a preference read here would not follow the reader to another tab.",
        },
        {
          selector:
            "MemberExpression[property.name=/^(localStorage|sessionStorage)$/]",
          message:
            "Use readPreference/writePreference/clearPreference/subscribePreference from src/lib/preferences.ts — a preference read here would not follow the reader to another tab.",
        },
        {
          selector:
            'MemberExpression[computed=true][property.type="Literal"][property.value=/^(localStorage|sessionStorage)$/]',
          message:
            "Use readPreference/writePreference/clearPreference/subscribePreference from src/lib/preferences.ts — a preference read here would not follow the reader to another tab.",
        },
      ],
    },
  },
  {
    // The three exemptions, each for a different reason:
    //
    // - `preferences.ts` is the module the rule exists to funnel everything
    //   into; it is the one place the access is the point.
    // - A unit test's whole job here is the storage contract: it seeds the
    //   stored bytes, asserts the format an older tab has to keep reading, and
    //   models another tab by dispatching the `StorageEvent` a real one would
    //   have caused — none of which is expressible through the module under
    //   test. The rule protects readers from going around the module, and a test
    //   has no reader to keep in step.
    // - A Playwright spec's `localStorage` is inside `page.evaluate`, so it runs
    //   in the browser under test rather than in this app's source. It is how
    //   those specs set up and assert a preference from outside, which is the
    //   only vantage point that can prove two tabs agree.
    files: [
      "src/lib/preferences.ts",
      "**/*.test.ts",
      "**/*.test.tsx",
      "e2e/**/*.ts",
    ],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);
