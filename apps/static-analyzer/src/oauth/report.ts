import type { PEvent } from "../types/event";
import type { AnalysisReport, FileReport, FunctionReport } from "../types/report";
import type { HttpDerivedReport, HttpRedirectRow, HttpUrlParamSetRow } from "../http/report";

export type OauthRedirectRow = {
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
};

export type OauthUrlParamSetRow = {
  file: string;
  functionId: string;
  functionName: string;
  eventIndex: number;
  urlExpr: string;
  key: string;
  value?: string;
  loc: PEvent["loc"];
  syntax?: string;
};

export type OauthLikeFlowRow = {
  file: string;
  functionId: string;
  functionName: string;
  urlExpr: string;
  params: Array<{ key: string; value?: string }>;
  redirectTargets: string[];
  paramKeys: string[];
  score: number;
};

export type OauthReport = {
  summary: {
    redirectCount: number;
    urlParamSetCount: number;
    oauthLikeFlowCount: number;
  };
  redirects: OauthRedirectRow[];
  urlParamSets: OauthUrlParamSetRow[];
  oauthLikeFlows: OauthLikeFlowRow[];
};

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

function buildOauthLikeFlows(redirects: OauthRedirectRow[], urlParamSets: OauthUrlParamSetRow[]): OauthLikeFlowRow[] {
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

  return [...authorizeCandidates.values()]
    .filter((x) => x.params.length > 0)
    .map((x) => ({
      ...x,
      paramKeys: x.params.map((p) => p.key),
      score: ["\"client_id\"", "\"redirect_uri\"", "\"state\"", "\"code_challenge\""].filter((k) => x.params.some((p) => p.key === k)).length,
    }))
    .sort((a, b) => b.score - a.score);
}

function toOauthReport(redirects: OauthRedirectRow[], urlParamSets: OauthUrlParamSetRow[]): OauthReport {
  const oauthLikeFlows = buildOauthLikeFlows(redirects, urlParamSets);
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

function extractFromReport(report: AnalysisReport): { redirects: OauthRedirectRow[]; urlParamSets: OauthUrlParamSetRow[] } {
  const redirects: OauthRedirectRow[] = [];
  const urlParamSets: OauthUrlParamSetRow[] = [];

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

  return { redirects, urlParamSets };
}

function mapHttpRedirectToOauth(row: HttpRedirectRow): OauthRedirectRow {
  return {
    file: row.file,
    functionId: row.functionId,
    functionName: row.functionName,
    eventIndex: row.eventIndex,
    api: row.api,
    via: row.via,
    target: row.target,
    headerKeys: row.headerKeys,
    loc: row.loc,
    syntax: row.syntax,
  };
}

function mapHttpParamSetToOauth(row: HttpUrlParamSetRow): OauthUrlParamSetRow {
  return {
    file: row.file,
    functionId: row.functionId,
    functionName: row.functionName,
    eventIndex: row.eventIndex,
    urlExpr: row.urlExpr,
    key: row.key,
    value: row.value,
    loc: row.loc,
    syntax: row.syntax,
  };
}

export function deriveOauthReport(report: AnalysisReport): OauthReport {
  const { redirects, urlParamSets } = extractFromReport(report);
  return toOauthReport(redirects, urlParamSets);
}

export function deriveOauthReportFromHttp(http: HttpDerivedReport): OauthReport {
  const redirects = new Map<string, OauthRedirectRow>();
  const urlParamSets = new Map<string, OauthUrlParamSetRow>();

  for (const endpoint of http.endpoints) {
    for (const r of endpoint.redirects) {
      const key = `${r.file}::${r.functionId}::${r.eventIndex}::${r.api}::${r.target ?? ""}`;
      if (!redirects.has(key)) redirects.set(key, mapHttpRedirectToOauth(r));
    }
    for (const s of endpoint.urlParamSets) {
      const key = `${s.file}::${s.functionId}::${s.eventIndex}::${s.urlExpr}::${s.key}`;
      if (!urlParamSets.has(key)) urlParamSets.set(key, mapHttpParamSetToOauth(s));
    }
  }

  return toOauthReport([...redirects.values()], [...urlParamSets.values()]);
}
