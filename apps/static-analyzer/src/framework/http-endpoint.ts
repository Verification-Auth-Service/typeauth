import type { AnalysisReport } from "../types/report";
import type { deriveFrameworkReports } from "./report";
import { deriveReactRouterFunctionEndpoints } from "./react-router";

function mergeEndpointMaps(base: Map<string, Set<string>>, incoming: Map<string, string[]>) {
  for (const [key, endpoints] of incoming.entries()) {
    const current = base.get(key) ?? new Set<string>();
    for (const endpoint of endpoints) current.add(endpoint);
    base.set(key, current);
  }
}

/**
 * 入力例: `resolveFrameworkHttpEndpoints({ entry: "/workspace/src/index.ts", files: [] }, framework)`
 * 成果物: framework 依存の endpoint 解決結果 (`file::functionId` -> endpoint一覧) を返す。
 */
export function resolveFrameworkHttpEndpoints(
  report: AnalysisReport,
  framework: ReturnType<typeof deriveFrameworkReports>,
): Map<string, string[]> {
  const merged = new Map<string, Set<string>>();

  if (framework.summary.detectedFrameworks.includes("react-router")) {
    mergeEndpointMaps(merged, deriveReactRouterFunctionEndpoints(report));
  }

  const resolved = new Map<string, string[]>();
  for (const [key, endpoints] of merged.entries()) {
    resolved.set(key, [...endpoints].sort());
  }
  return resolved;
}
