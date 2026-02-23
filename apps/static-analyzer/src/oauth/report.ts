import type { PEvent } from "../types/event";
import type { AnalysisReport, FileReport, FunctionReport } from "../types/report";

function flattenFunctions(report: AnalysisReport): Array<{ file: FileReport; fn: FunctionReport }> {
  const out: Array<{ file: FileReport; fn: FunctionReport }> = [];
  for (const file of report.files) {
    for (const fn of file.functions) out.push({ file, fn });
  }
  return out;
}

function isRedirectEvent(e: PEvent): e is Extract<PEvent, { kind: "redirect" }> {
  return e.kind === "redirect";
}

function isUrlParamSetEvent(e: PEvent): e is Extract<PEvent, { kind: "urlParamSet" }> {
  return e.kind === "urlParamSet";
}

// OAuth/OIDC 系の観点で、既存 flow(events) から読みやすい派生ビューを作る。
// `flow` を置き換えるのではなく、関数ID / eventIndex で参照できる追加レイヤーとして扱う。
export function deriveOauthReport(report: AnalysisReport) {
  const redirects: Array<{
    file: string;
    functionId: string;
    functionName: string;
    eventIndex: number;
    api: string;
    via: "call" | "assign";
    target?: string;
    headerKeys?: string[];
    loc: PEvent["loc"];
    syntax?: string;
  }> = [];

  const urlParamSets: Array<{
    file: string;
    functionId: string;
    functionName: string;
    eventIndex: number;
    urlExpr: string;
    key: string;
    value?: string;
    loc: PEvent["loc"];
    syntax?: string;
  }> = [];

  for (const { file, fn } of flattenFunctions(report)) {
    fn.events.forEach((e, i) => {
      if (isRedirectEvent(e)) {
        redirects.push({
          file: file.file,
          functionId: fn.id,
          functionName: fn.name,
          eventIndex: i,
          api: e.api,
          via: e.via,
          target: e.target,
          headerKeys: e.headerKeys,
          loc: e.loc,
          syntax: e.syntax,
        });
      }
      if (isUrlParamSetEvent(e)) {
        urlParamSets.push({
          file: file.file,
          functionId: fn.id,
          functionName: fn.name,
          eventIndex: i,
          urlExpr: e.urlExpr,
          key: e.key,
          value: e.value,
          loc: e.loc,
          syntax: e.syntax,
        });
      }
    });
  }

  // authorize URL 組み立てっぽいものを関数単位で軽く集約。
  const authorizeCandidates = new Map<
    string,
    {
      file: string;
      functionId: string;
      functionName: string;
      urlExpr: string;
      params: Array<{ key: string; value?: string }>;
      redirectTargets: string[];
    }
  >();

  for (const s of urlParamSets) {
    const k = `${s.file}::${s.functionId}::${s.urlExpr}`;
    const row = authorizeCandidates.get(k) ?? {
      file: s.file,
      functionId: s.functionId,
      functionName: s.functionName,
      urlExpr: s.urlExpr,
      params: [],
      redirectTargets: [],
    };
    row.params.push({ key: s.key, value: s.value });
    authorizeCandidates.set(k, row);
  }

  for (const r of redirects) {
    for (const row of authorizeCandidates.values()) {
      if (row.file !== r.file || row.functionId !== r.functionId) continue;
      if (r.target?.includes(`${row.urlExpr}.toString()`)) row.redirectTargets.push(r.target);
    }
  }

  const oauthLikeFlows = [...authorizeCandidates.values()]
    .filter((x) => x.params.length > 0)
    .map((x) => ({
      ...x,
      paramKeys: x.params.map((p) => p.key),
      // OAuth/OIDC で頻出のキーがどれだけ揃っているかの簡易スコア
      score: ["\"client_id\"", "\"redirect_uri\"", "\"state\"", "\"code_challenge\""].filter((k) => x.params.some((p) => p.key === k)).length,
    }))
    .sort((a, b) => b.score - a.score);

  return {
    summary: {
      redirectCount: redirects.length,
      urlParamSetCount: urlParamSets.length,
      oauthLikeFlowCount: oauthLikeFlows.length,
    },
    redirects,
    urlParamSets,
    oauthLikeFlows,
  };
}
