import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { initStaticMode, isStaticMode } from "./lib/staticMode";
import { followColorTheme, initColorTheme } from "./lib/colorTheme";

// Initialize static mode interceptor before any API calls
initStaticMode();

// After static mode, which decides whether there is a server to ask for user
// themes. A stored built-in theme is applied before this returns, so the first
// render is already in its colours; the rest settles once /api/themes answers.
void initColorTheme();

// And then follow the reader's later picks, including the ones made in another
// tab: a colour theme is a preference of the whole browser, and a second tab of
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
