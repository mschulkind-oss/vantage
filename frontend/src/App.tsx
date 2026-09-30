import { ViewerPage } from "./pages/ViewerPage";
import { HistoryPage } from "./pages/HistoryPage";
import { RecentsPage } from "./pages/RecentsPage";
import { PlanningPage } from "./pages/PlanningPage";
import { AppShell } from "./components/AppShell";
import { PLANNING_ROUTE } from "./lib/planningRoute";
import { Routes, Route } from "react-router-dom";

function App() {
  return (
    <Routes>
      <Route path="/history/*" element={<HistoryPage />} />
      <Route path="/recent/*" element={<RecentsPage />} />
      {/* One shell for both, so going between them keeps the sidebar as it
          is (components/AppShell.tsx). */}
      <Route element={<AppShell />}>
        {/* Under `.vantage`, which no document URL can use (Plan Q13). */}
        <Route path={`${PLANNING_ROUTE}/*`} element={<PlanningPage />} />
        <Route path="/*" element={<ViewerPage />} />
      </Route>
    </Routes>
  );
}

export default App;
