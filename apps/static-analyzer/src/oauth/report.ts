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

/**
 * 入力例: `flattenFunctions({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: `{ file, fn }` のフラット配列を返す。
 */
function flattenFunctions(report: AnalysisReport): Array<{ file: FileReport; fn: FunctionReport }> {
  const out: Array<{ file: FileReport; fn: FunctionReport }> = [];
  for (const file of report.files) {
    for (const fn of file.functions) out.push({ file, fn });
  }
  return out;
}

/**
 * 入力例: `isRedirectEvent({ kind: "redirect", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 20 }, syntax: "redirect('/login')", via: "call", api: "redirect" })`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isRedirectEvent(e: PEvent): e is Extract<PEvent, { kind: "redirect" }> {
  return e.kind === "redirect";
}

/**
 * 入力例: `isUrlParamSetEvent({ kind: "urlParamSet", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 30 }, syntax: "url.searchParams.set('state', token)", url: "url", key: "\"state\"", value: "token" })`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isUrlParamSetEvent(e: PEvent): e is Extract<PEvent, { kind: "urlParamSet" }> {
  return e.kind === "urlParamSet";
}

/**
 * 入力例: `buildOauthLikeFlows([], [])`
 * 成果物: 0件以上の要素を含む配列を返す。
 */
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

/**
 * 入力例: `toOauthReport([], [])`
 * 成果物: 処理結果オブジェクトを返す。
 */
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

/**
 * 入力例: `extractFromReport({ entry: "/workspace/src/index.ts", files: [{ file: "/workspace/src/routes/callback.ts", functions: [{ id: "fn1", name: "loader", kind: "function", loc: { startLine: 1, startCol: 1, endLine: 20, endCol: 2 }, events: [{ kind: "redirect", loc: { startLine: 8, startCol: 3, endLine: 8, endCol: 25 }, syntax: "redirect('/login')", via: "call", api: "redirect", target: "\"/login\"" }] }] }] })`
 * 成果物: `redirects` と `urlParamSets` の2配列を抽出して返す。
 */
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

/**
 * 入力例: `mapHttpRedirectToOauth({ endpoint: "/oauth/callback", file: "/workspace/src/callback.ts", functionId: "fn1", functionName: "loader", api: "redirect", target: "\"/login\"", index: 0, loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 20 }, syntax: "redirect('/login')" })`
 * 成果物: 処理結果オブジェクトを返す。
 */
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

/**
 * 入力例: `mapHttpParamSetToOauth({ endpoint: "/oauth/start", file: "/workspace/src/start.ts", functionId: "fn2", functionName: "loader", key: "\"state\"", value: "state", index: 0, loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 30 }, syntax: "url.searchParams.set('state', state)", urlExpr: "url" })`
 * 成果物: 処理結果オブジェクトを返す。
 */
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

/**
 * 入力例: `deriveOauthReport({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: `summary/redirects/urlParamSets/oauthLikeFlows` を持つ OAuthレポートを返す。
 */
export function deriveOauthReport(report: AnalysisReport): OauthReport {
  const { redirects, urlParamSets } = extractFromReport(report);
  return toOauthReport(redirects, urlParamSets);
}

/**
 * 入力例: `deriveOauthReportFromHttp({ endpoints: [], redirects: [], urlParamSets: [] })`
 * 成果物: HTTP派生レポートをOAuth形式へ変換して返す。
 */
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
