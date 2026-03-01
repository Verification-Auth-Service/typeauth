import type { PEvent } from "../types/event";
import type { AnalysisReport, FileReport, FunctionReport } from "../types/report";
import type { deriveFrameworkReports } from "../framework/report";

export type HttpRedirectRow = {
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

export type HttpUrlParamSetRow = {
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

export type HttpEndpointRow = {
  endpoint: string;
  sourceValues: string[];
  files: string[];
  functions: Array<{ file: string; functionId: string; functionName: string }>;
  redirects: HttpRedirectRow[];
  urlParamSets: HttpUrlParamSetRow[];
  frameworks: string[];
};

export type HttpDerivedReport = {
  summary: {
    endpointCount: number;
    redirectCount: number;
    urlParamSetCount: number;
    detectedFrameworks: string[];
  };
  endpoints: HttpEndpointRow[];
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
 * 入力例: `normalizeHttpEndpoint("(spec (vars) (machine) (property))")`
 * 成果物: 整形・正規化後の文字列を返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
export function normalizeHttpEndpoint(raw: string): string | undefined {
  let text = raw.trim();
  text = text.replace(/^['"`]/, "").replace(/['"`]$/, "");
  text = text.replace(/\.toString\(\)/g, "");
  if (!text) return undefined;

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      return u.pathname || "/";
    } catch {
      return text;
    }
  }

  const qPos = text.indexOf("?");
  if (qPos >= 0) text = text.slice(0, qPos);
  return text || undefined;
}

/**
 * 入力例: `deriveHttpReport({ entry: "/workspace/src/index.ts", files: [] }, { summary: { detectedFrameworks: ["react-router"], reasons: [] }, reactRouter: undefined })`
 * 成果物: `summary/endpoints/redirects/urlParamSets` を持つ HTTP派生レポートを返す。
 */
export function deriveHttpReport(
  report: AnalysisReport,
  framework: ReturnType<typeof deriveFrameworkReports>,
): HttpDerivedReport {
  const redirects: HttpRedirectRow[] = [];
  const urlParamSets: HttpUrlParamSetRow[] = [];

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

  const endpointMap = new Map<string, HttpEndpointRow>();
  const functionKeyByEndpoint = new Map<string, Set<string>>();

  /**
   * 入力例: `ensure("/oauth/callback?code=abc")`
   * 成果物: 処理結果オブジェクトを返す。
   */
  function ensure(endpoint: string): HttpEndpointRow {
    const existing = endpointMap.get(endpoint);
    if (existing) return existing;
    const created: HttpEndpointRow = {
      endpoint,
      sourceValues: [],
      files: [],
      functions: [],
      redirects: [],
      urlParamSets: [],
      frameworks: framework.summary.detectedFrameworks,
    };
    endpointMap.set(endpoint, created);
    functionKeyByEndpoint.set(endpoint, new Set<string>());
    return created;
  }

  /**
   * 入力例: `addFunctionRef("/oauth/callback?code=abc", "/workspace/src/index.ts", "example", "state")`
   * 成果物: 副作用のみを実行する（戻り値なし）。
   */
  function addFunctionRef(endpoint: string, file: string, functionId: string, functionName: string) {
    const row = ensure(endpoint);
    const fnSet = functionKeyByEndpoint.get(endpoint);
    const fnKey = `${file}::${functionId}`;
    if (fnSet && !fnSet.has(fnKey)) {
      fnSet.add(fnKey);
      row.functions.push({ file, functionId, functionName });
    }
    if (!row.files.includes(file)) row.files.push(file);
  }

  for (const r of redirects) {
    if (!r.target) continue;
    const endpoint = normalizeHttpEndpoint(r.target);
    if (!endpoint) continue;
    const row = ensure(endpoint);
    row.redirects.push(r);
    if (!row.sourceValues.includes(r.target)) row.sourceValues.push(r.target);
    addFunctionRef(endpoint, r.file, r.functionId, r.functionName);
  }

  for (const s of urlParamSets) {
    const endpoint = normalizeHttpEndpoint(s.urlExpr);
    if (!endpoint) continue;
    const row = ensure(endpoint);
    row.urlParamSets.push(s);
    if (!row.sourceValues.includes(s.urlExpr)) row.sourceValues.push(s.urlExpr);
    addFunctionRef(endpoint, s.file, s.functionId, s.functionName);
  }

  const endpoints = [...endpointMap.values()].sort((a, b) => a.endpoint.localeCompare(b.endpoint));

  return {
    summary: {
      endpointCount: endpoints.length,
      redirectCount: redirects.length,
      urlParamSetCount: urlParamSets.length,
      detectedFrameworks: framework.summary.detectedFrameworks,
    },
    endpoints,
  };
}
