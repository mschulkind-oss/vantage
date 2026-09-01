import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// The package ships React components alongside plain modules, so the hooks
// rules matter here as much as in the app. react-refresh is deliberately absent:
// fast refresh is a Vite dev concern of the consumer, not of a published library.
export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      // Browser for the viewer and the DOM-touching helpers; node for the
      // pipeline, which the CLI runs outside a browser.
      globals: { ...globals.browser, ...globals.node },
    },
  },
]);
