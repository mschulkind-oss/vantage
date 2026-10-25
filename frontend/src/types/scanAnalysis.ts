export interface ScanAnalysisEvidence {
  command: string;
  elapsedMs: number;
  timeoutMs: number;
  gitignored: boolean;
  timedOut: boolean;
  directory?: string;
  error?: string;
  unknown_failures?: number;
  settings?: {
    show_hidden: boolean;
    use_ignore_files: boolean;
    exclude_dir_count: number;
    walk_max_depth: number | null;
  };
}

export interface ScanAnalysisDirectory {
  path: string;
  elapsedMs: number;
  entries: number;
  examples: string[];
}

export interface ScanAnalysisComparison {
  status: string;
  elapsedMs: number;
  entries: number;
  reason: string;
}

export interface ScanAnalysisRecommendation {
  path: string;
  reason: string;
  examples: string[];
}

export interface ScanAnalysisDiagnostic {
  method: string;
  partial: boolean;
  reason: string;
  elapsedMs: number;
  entries: number;
  directories: ScanAnalysisDirectory[];
  comparison: ScanAnalysisComparison;
  recommendations: ScanAnalysisRecommendation[];
}

export interface ScanAnalysisResponse {
  evidence: ScanAnalysisEvidence | null;
  diagnostic: ScanAnalysisDiagnostic | null;
}
