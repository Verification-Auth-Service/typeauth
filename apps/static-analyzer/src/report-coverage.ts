import type { deriveFrameworkReports } from "./framework/report";
import type { deriveHttpReport } from "./http/report";
import type { deriveOauthReportFromHttp } from "./oauth/report";
import type { deriveStateTransitionReport } from "./state/report";
import type { PEvent } from "./types/event";
import type { AnalysisReport } from "./types/report";

type EventKind = PEvent["kind"];

export type ReportCoverage = {
  summary: {
    fileCount: number;
    functionCount: number;
    eventCount: number;
  };
  sourceDerived: {
    eventKindCounts: Partial<Record<EventKind, number>>;
    filesWithImports: number;
    functionsWithSignature: number;
  };
  http: {
    endpointCount: number;
    redirectCount: number;
    urlParamSetCount: number;
    detectedFrameworks: string[];
    endpointFields: string[];
  };
  oauth: {
    redirectCount: number;
    urlParamSetCount: number;
    oauthLikeFlowCount: number;
    flowHeuristicKeys: string[];
  };
  state: {
    fileCount: number;
    functionCount: number;
    nodeCount: number;
    edgeCount: number;
    terminalTransitionCount: number;
  };
  scopeRules: {
    sourceFileScope: string;
    filesWithoutFunctions: string;
    endpointNormalization: string;
  };
  endpointFieldCoverage: {
    collected: string[];
    notCollectedYet: string[];
  };
};

function collectEventKindCounts(report: AnalysisReport): Partial<Record<EventKind, number>> {
  const counts: Partial<Record<EventKind, number>> = {};
  for (const file of report.files) {
    for (const fn of file.functions) {
      for (const event of fn.events) {
        counts[event.kind] = (counts[event.kind] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/**
 * 入力例: `buildReportCoverage({ entry: "/workspace/src/index.ts", files: [] }, framework, http, oauth, state)`
 * 成果物: 「このレポートで何を取得できているか」を集約したオブジェクトを返す。
 */
export function buildReportCoverage(
  report: AnalysisReport,
  framework: ReturnType<typeof deriveFrameworkReports>,
  http: ReturnType<typeof deriveHttpReport>,
  oauth: ReturnType<typeof deriveOauthReportFromHttp>,
  state: ReturnType<typeof deriveStateTransitionReport>,
): ReportCoverage {
  const functionCount = report.files.reduce((n, file) => n + file.functions.length, 0);
  const eventCount = report.files.reduce((n, file) => n + file.functions.reduce((m, fn) => m + fn.events.length, 0), 0);
  const filesWithImports = report.files.filter((file) => (file.imports?.length ?? 0) > 0).length;
  const functionsWithSignature = report.files.reduce(
    (n, file) => n + file.functions.filter((fn) => !!fn.signature).length,
    0,
  );

  return {
    summary: {
      fileCount: report.files.length,
      functionCount,
      eventCount,
    },
    sourceDerived: {
      eventKindCounts: collectEventKindCounts(report),
      filesWithImports,
      functionsWithSignature,
    },
    http: {
      endpointCount: http.summary.endpointCount,
      redirectCount: http.summary.redirectCount,
      urlParamSetCount: http.summary.urlParamSetCount,
      detectedFrameworks: framework.summary.detectedFrameworks,
      endpointFields: ["endpoint", "sourceValues", "files", "functions", "redirects", "urlParamSets", "frameworks"],
    },
    oauth: {
      redirectCount: oauth.summary.redirectCount,
      urlParamSetCount: oauth.summary.urlParamSetCount,
      oauthLikeFlowCount: oauth.summary.oauthLikeFlowCount,
      flowHeuristicKeys: ["\"client_id\"", "\"redirect_uri\"", "\"state\"", "\"code_challenge\""],
    },
    state: {
      fileCount: state.summary.fileCount,
      functionCount: state.summary.functionCount,
      nodeCount: state.summary.nodeCount,
      edgeCount: state.summary.edgeCount,
      terminalTransitionCount: state.summary.terminalTransitionCount,
    },
    scopeRules: {
      sourceFileScope: "entry ファイルと同一ディレクトリ配下の TS/TSX 系ファイルを解析対象にする",
      filesWithoutFunctions: "関数が 1 つもないファイルは report.files から除外される",
      endpointNormalization: "URL は path 部分へ正規化し、query は除去して endpoint 集約する",
    },
    endpointFieldCoverage: {
      collected: [
        "endpoint(path)",
        "sourceValues(raw expression)",
        "file/function references",
        "redirect api/via/target/headerKeys",
        "urlParamSet(urlExpr/key/value)",
      ],
      notCollectedYet: [
        "HTTP method",
        "request/response schema",
        "authn/authz requirement",
        "status code expectation",
        "rate limit/CORS/CSRF policy",
      ],
    },
  };
}
