import { ViewerPage } from "./pages/ViewerPage";
import { HistoryPage } from "./pages/HistoryPage";
import { RecentsPage } from "./pages/RecentsPage";
import { PlanningPage } from "./pages/PlanningPage";
import { PLANNING_ROUTE } from "./lib/planningRoute";
import { Routes, Route } from "react-router-dom";

function App() {
  return (
    <Routes>
      <Route path="/history/*" element={<HistoryPage />} />
      <Route path="/recent/*" element={<RecentsPage />} />
      {/* Under `.vantage`, which no document URL can use (Plan Q13). */}
      <Route path={`${PLANNING_ROUTE}/*`} element={<PlanningPage />} />
      <Route path="/*" element={<ViewerPage />} />
    </Routes>
  );
}

export default App;
