import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { sourceHash } from "virtual:planning-scanner-id";
import { initStaticMode, isStaticMode } from "./lib/staticMode";
import { followColorTheme, initColorTheme } from "./lib/colorTheme";
import { startPlanningScanner } from "./planningScan/client";

// Initialize static mode interceptor before any API calls
initStaticMode();

// The planning scan worker starts now, beside the app's first requests, so it
// is up by the time a surface asks for the planning index
// (docs/design/planning-index-at-scale.md §7.1). A static export has no server
// to scan, so it never makes one.
if (!isStaticMode()) startPlanningScanner(sourceHash);

// After static mode, which decides whether there is a server to ask for user
// themes. A stored built-in theme is applied before this returns, so the first
// render is already in its colors; the rest settles once /api/themes answers.
void initColorTheme();

// And then follow the reader's later picks, including the ones made in another
// tab: a color theme is a preference of the whole browser, and a second tab of
// the same repository is the same reader wanting the same palette.
followColorTheme();

const Router = isStaticMode() ? HashRouter : BrowserRouter;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
