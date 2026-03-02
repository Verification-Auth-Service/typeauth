import type { PEvent } from "../types/event";
import type { AnalysisReport, FileReport, FunctionReport } from "../types/report";
import type { deriveFrameworkReports } from "../framework/report";
import { resolveFrameworkHttpEndpoints } from "../framework/http-endpoint";

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
  unresolved: {
    redirects: HttpRedirectRow[];
    urlParamSets: HttpUrlParamSetRow[];
  };
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
  text = text.replace(/\.toString\(\)\s*$/, "");
  if (!text) return undefined;

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      return u.pathname || "/";
    } catch {
      return undefined;
    }
  }

  if (!text.startsWith("/")) return undefined;
  const hashPos = text.indexOf("#");
  if (hashPos >= 0) text = text.slice(0, hashPos);
  const qPos = text.indexOf("?");
  if (qPos >= 0) text = text.slice(0, qPos);
  return text || "/";
}

function extractEndpointReference(raw: string): string | undefined {
  let text = raw.trim();
  text = text.replace(/^['"`]/, "").replace(/['"`]$/, "");
  text = text.replace(/\.toString\(\)\s*$/, "");
  if (!text) return undefined;
  if (/^https?:\/\//i.test(text)) return undefined;
  if (text.startsWith("/")) return undefined;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(text)) return undefined;
  return text;
}

function normalizeParamKey(raw: string): string {
  return raw.trim().replace(/^['"`]/, "").replace(/['"`]$/, "");
}

function paramValueEndpoint(row: HttpUrlParamSetRow): string | undefined {
  if (normalizeParamKey(row.key) !== "redirect_uri") return undefined;
  if (!row.value) return undefined;
  return normalizeHttpEndpoint(row.value);
}

function functionKey(row: { file: string; functionId: string }): string {
  return `${row.file}::${row.functionId}`;
}

function eventKey(row: { file: string; functionId: string; eventIndex: number }): string {
  return `${row.file}::${row.functionId}::${row.eventIndex}`;
}

function collectUrlParamSetsByFunction(urlParamSets: HttpUrlParamSetRow[]): Map<string, HttpUrlParamSetRow[]> {
  const out = new Map<string, HttpUrlParamSetRow[]>();
  for (const row of urlParamSets) {
    const key = functionKey(row);
    const current = out.get(key) ?? [];
    current.push(row);
    out.set(key, current);
  }
  for (const rows of out.values()) rows.sort((a, b) => a.eventIndex - b.eventIndex);
  return out;
}

function findContributingUrlParamSets(
  redirect: HttpRedirectRow,
  byFunction: Map<string, HttpUrlParamSetRow[]>,
): HttpUrlParamSetRow[] {
  const target = redirect.target;
  if (!target) return [];
  const ref = extractEndpointReference(target);
  if (!ref) return [];
  const rows = byFunction.get(functionKey(redirect)) ?? [];
  return rows.filter((row) => row.urlExpr === ref && row.eventIndex <= redirect.eventIndex);
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
  const endpointByParamSetEventKey = new Map<string, Set<string>>();
  const unresolvedRedirects: HttpRedirectRow[] = [];
  const unresolvedUrlParamSets: HttpUrlParamSetRow[] = [];
  const urlParamSetsByFunction = collectUrlParamSetsByFunction(urlParamSets);
  const endpointByFunction = resolveFrameworkHttpEndpoints(report, framework);

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
    if (!r.target) {
      unresolvedRedirects.push(r);
      continue;
    }

    const endpoints = new Set<string>(endpointByFunction.get(functionKey(r)) ?? []);
    if (endpoints.size === 0) {
      const direct = normalizeHttpEndpoint(r.target);
      if (direct) endpoints.add(direct);
    }

    const contributors = endpoints.size === 0 ? findContributingUrlParamSets(r, urlParamSetsByFunction) : [];
    if (endpoints.size === 0) {
      for (const c of contributors) {
        const fromParam = paramValueEndpoint(c);
        if (fromParam) endpoints.add(fromParam);
      }
    }

    if (endpoints.size === 0) {
      unresolvedRedirects.push(r);
      continue;
    }

    for (const endpoint of endpoints) {
      const row = ensure(endpoint);
      row.redirects.push(r);
      if (!row.sourceValues.includes(r.target)) row.sourceValues.push(r.target);
      addFunctionRef(endpoint, r.file, r.functionId, r.functionName);
    }

    for (const c of contributors) {
      const key = eventKey(c);
      const current = endpointByParamSetEventKey.get(key) ?? new Set<string>();
      for (const endpoint of endpoints) current.add(endpoint);
      endpointByParamSetEventKey.set(key, current);
    }
  }

  for (const s of urlParamSets) {
    const endpoints = new Set<string>(endpointByFunction.get(functionKey(s)) ?? []);
    let direct: string | undefined;
    let fromValue: string | undefined;

    if (endpoints.size === 0) {
      direct = normalizeHttpEndpoint(s.urlExpr);
      if (direct) endpoints.add(direct);

      fromValue = paramValueEndpoint(s);
      if (fromValue) endpoints.add(fromValue);

      const backPropagated = endpointByParamSetEventKey.get(eventKey(s));
      if (backPropagated) {
        for (const endpoint of backPropagated) endpoints.add(endpoint);
      }
    }

    if (endpoints.size === 0) {
      unresolvedUrlParamSets.push(s);
      continue;
    }

    const sourceValues = new Set<string>();
    if (direct) sourceValues.add(s.urlExpr);
    if (fromValue && s.value) sourceValues.add(s.value);
    if (sourceValues.size === 0) sourceValues.add(s.urlExpr);

    for (const endpoint of endpoints) {
      const row = ensure(endpoint);
      row.urlParamSets.push(s);
      for (const sourceValue of sourceValues) {
        if (!row.sourceValues.includes(sourceValue)) row.sourceValues.push(sourceValue);
      }
      addFunctionRef(endpoint, s.file, s.functionId, s.functionName);
    }
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
    unresolved: {
      redirects: unresolvedRedirects,
      urlParamSets: unresolvedUrlParamSets,
    },
  };
}
