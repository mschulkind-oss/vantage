import { describe, expect, it } from "vitest";
import {
  scanAnalysisPath,
  scanAnalysisRepoFromPath,
  SCAN_ANALYSIS_ROUTE,
  isScanAnalysisRoutePath,
} from "./scanAnalysisRoute";

describe("scan-analysis route", () => {
  it("keeps the single-repository endpoint at the reserved route", () => {
    expect(scanAnalysisPath(false, null)).toBe(SCAN_ANALYSIS_ROUTE);
    expect(scanAnalysisRepoFromPath(SCAN_ANALYSIS_ROUTE)).toBeNull();
  });

  it("encodes and decodes the project segment", () => {
    const path = scanAnalysisPath(true, "project #2");
    expect(path).toBe(`${SCAN_ANALYSIS_ROUTE}/project%20%232`);
    expect(scanAnalysisRepoFromPath(path)).toBe("project #2");
  });

  it("recognizes the reserved single and project-scoped routes only", () => {
    expect(isScanAnalysisRoutePath(SCAN_ANALYSIS_ROUTE)).toBe(true);
    expect(isScanAnalysisRoutePath(`${SCAN_ANALYSIS_ROUTE}/repo%20name`)).toBe(
      true,
    );
    expect(isScanAnalysisRoutePath("/project/scan-analysis")).toBe(false);
    expect(isScanAnalysisRoutePath("/scan-analysis")).toBe(false);
  });

  it("does not capture document paths or project names that contain scan-analysis", () => {
    expect(scanAnalysisRepoFromPath("/scan-analysis")).toBeNull();
    expect(scanAnalysisRepoFromPath("/project/scan-analysis")).toBeNull();
  });
});
