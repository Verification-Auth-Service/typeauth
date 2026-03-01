import type { AnalysisReport } from "../types/report";
import { deriveReactRouterReport } from "./react-router";

export type FrameworkName = "react-router" | "remix" | "nextjs";

/**
 * 入力例: `detectFrameworkEvidence({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: 検出した framework 名と理由配列を返す。
 */
function detectFrameworkEvidence(report: AnalysisReport) {
  const byFramework: Record<FrameworkName, Array<{ file: string; source: string; syntax: string }>> = {
    "react-router": [],
    remix: [],
    nextjs: [],
  };

  for (const f of report.files) {
    for (const imp of f.imports ?? []) {
      const src = imp.source;
      if (src === "react-router" || src === "react-router-dom" || src.startsWith("react-router/")) {
        byFramework["react-router"].push({ file: f.file, source: src, syntax: imp.syntax });
      }
      if (src.startsWith("@remix-run/")) {
        byFramework["remix"].push({ file: f.file, source: src, syntax: imp.syntax });
      }
      if (src === "next/navigation" || src === "next/server" || src.startsWith("next/")) {
        byFramework["nextjs"].push({ file: f.file, source: src, syntax: imp.syntax });
      }
    }
  }

  return byFramework;
}

// framework 別の「追加整理レイヤー」を構築する。
// flow(AST + 汎用 events) はそのまま残し、ここではフレームワーク特有の関係性・根拠を整理する。
/**
 * 入力例: `deriveFrameworkReports({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: `summary` と framework別詳細をまとめた派生結果を返す。
 */
export function deriveFrameworkReports(report: AnalysisReport) {
  const evidence = detectFrameworkEvidence(report);

  const outputs: Record<string, unknown> = {};
  const detectedFrameworks: FrameworkName[] = [];

  if (evidence["react-router"].length > 0) {
    outputs["react-router"] = deriveReactRouterReport(report);
    detectedFrameworks.push("react-router");
  }

  if (evidence.remix.length > 0) {
    // こんな感じで、対応していないよというメッセージを出せる
    outputs["remix"] = {
      framework: "remix",
      evidence: evidence.remix,
      summary: { evidenceCount: evidence.remix.length },
      note: "Remix-specific relation extraction is not implemented yet.",
    };
    detectedFrameworks.push("remix");
  }

  if (evidence.nextjs.length > 0) {
    outputs["nextjs"] = {
      framework: "nextjs",
      evidence: evidence.nextjs,
      summary: { evidenceCount: evidence.nextjs.length },
      note: "Next.js-specific relation extraction is not implemented yet.",
    };
    detectedFrameworks.push("nextjs");
  }

  const summary = {
    entry: report.entry,
    detectedFrameworks,
    detectedCount: detectedFrameworks.length,
  };

  return { summary, outputs };
}
