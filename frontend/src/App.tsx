import { ViewerPage } from "./pages/ViewerPage";
import { HistoryPage } from "./pages/HistoryPage";
import { RecentsPage } from "./pages/RecentsPage";
import { PlanningPage } from "./pages/PlanningPage";
import { WorkPage } from "./pages/WorkPage";
import { ScanAnalysisPage } from "./pages/ScanAnalysisPage";
import { SCAN_ANALYSIS_ROUTE } from "./lib/scanAnalysisRoute";
import { AppShell } from "./components/AppShell";
import { PLANNING_ROUTE } from "./lib/planningRoute";
import { WORK_ROUTE } from "./lib/workRoute";
import { Routes, Route } from "react-router-dom";

function App() {
  return (
    <Routes>
      <Route path="/history/*" element={<HistoryPage />} />
      <Route path="/recent/*" element={<RecentsPage />} />
      {/* One shell for both, so going between them keeps the sidebar as it
          is (components/AppShell.tsx). */}
      <Route element={<AppShell />}>
        <Route
          path={`${SCAN_ANALYSIS_ROUTE}/:repo`}
          element={<ScanAnalysisPage />}
        />
        <Route path={SCAN_ANALYSIS_ROUTE} element={<ScanAnalysisPage />} />
        {/* Under `.vantage`, which no document URL can use (Plan Q13). */}
        <Route path={`${PLANNING_ROUTE}/*`} element={<PlanningPage />} />
        <Route path={`${WORK_ROUTE}/*`} element={<WorkPage />} />
        <Route path="/*" element={<ViewerPage />} />
      </Route>
    </Routes>
  );
}

export default App;
