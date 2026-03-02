import type { AnalysisReport, FileReport, FunctionReport } from "../types/report";
import type { PEvent } from "../types/event";

type ReactRouterRelation =
  | {
      type: "component-reads-loader";
      file: string;
      componentFunctionId: string;
      componentName: string;
      loaderFunctionId?: string;
      loaderName?: string;
      viaHook: string;
      eventIndex: number;
      loc: PEvent["loc"];
      syntax?: string;
    }
  | {
      type: "component-reads-action";
      file: string;
      componentFunctionId: string;
      componentName: string;
      actionFunctionId?: string;
      actionName?: string;
      viaHook: string;
      eventIndex: number;
      loc: PEvent["loc"];
      syntax?: string;
    }
  | {
      type: "component-navigates";
      file: string;
      componentFunctionId: string;
      componentName: string;
      viaApi: string;
      target?: string;
      eventIndex: number;
      loc: PEvent["loc"];
      syntax?: string;
    }
  | {
      type: "server-redirect";
      file: string;
      functionId: string;
      functionName: string;
      role: "loader" | "action" | "clientLoader" | "clientAction" | "unknown";
      viaApi: string;
      target?: string;
      eventIndex: number;
      loc: PEvent["loc"];
      syntax?: string;
    }
  | {
      type: "revalidation-signal";
      file: string;
      functionId: string;
      functionName: string;
      signal: string;
      eventIndex: number;
      loc: PEvent["loc"];
      syntax?: string;
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
 * 入力例: `hasReactRouterImport({ file: "/workspace/src/index.ts", functions: [] })`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function hasReactRouterImport(file: FileReport): boolean {
  return (file.imports ?? []).some((imp) => imp.source === "react-router" || imp.source === "react-router-dom" || imp.source.startsWith("react-router/"));
}

function isLikelyTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.includes("/__tests__/") || /\.spec\.[cm]?[jt]sx?$/i.test(normalized) || /\.test\.[cm]?[jt]sx?$/i.test(normalized);
}

function functionKey(file: string, functionId: string): string {
  return `${file}::${functionId}`;
}

function splitSegmentPartsPreservingEscapedDots(segment: string): string[] {
  const parts: string[] = [];
  let current = "";
  let idx = 0;

  while (idx < segment.length) {
    const ch = segment[idx];
    if (ch === "[") {
      const end = segment.indexOf("]", idx + 1);
      if (end < 0) {
        current += ch;
        idx += 1;
        continue;
      }
      current += segment.slice(idx + 1, end);
      idx = end + 1;
      continue;
    }
    if (ch === ".") {
      parts.push(current);
      current = "";
      idx += 1;
      continue;
    }
    current += ch;
    idx += 1;
  }

  parts.push(current);
  return parts;
}

function normalizeRouteSegmentPart(part: string): string | undefined {
  if (!part || part === "index" || part === "_index") return undefined;
  if (part.startsWith("_")) return undefined;
  if (part === "$") return "*";
  if (!part.startsWith("$")) return part;
  const paramName = part.slice(1);
  return paramName ? `:${paramName}` : "*";
}

/**
 * 入力例: `reactRouterRoutePathFromFile("/workspace/app/routes/oauth.authorize.tsx")`
 * 成果物: React Router route module ファイルパスから endpoint (`/oauth/authorize`) を返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
export function reactRouterRoutePathFromFile(filePath: string): string | undefined {
  const normalized = filePath.replace(/\\/g, "/");
  const marker = "/routes/";
  const markerPos = normalized.lastIndexOf(marker);
  if (markerPos < 0) return undefined;

  const relative = normalized.slice(markerPos + marker.length).replace(/\.[cm]?[jt]sx?$/i, "");
  if (!relative) return undefined;

  const pathParts: string[] = [];
  for (const rawSeg of relative.split("/")) {
    if (!rawSeg) continue;
    const seg = rawSeg.replace(/\++$/g, "");
    if (!seg || seg === "index" || seg === "_index") continue;

    for (const dotPart of splitSegmentPartsPreservingEscapedDots(seg)) {
      const normalizedPart = normalizeRouteSegmentPart(dotPart);
      if (normalizedPart) pathParts.push(normalizedPart);
    }
  }

  return pathParts.length === 0 ? "/" : `/${pathParts.join("/")}`;
}

/**
 * 入力例: `deriveReactRouterFunctionEndpoints({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: `file::functionId` を key とした endpoint 一覧のマップを返す。
 */
export function deriveReactRouterFunctionEndpoints(report: AnalysisReport): Map<string, string[]> {
  const out = new Map<string, Set<string>>();

  for (const file of report.files) {
    if (isLikelyTestFile(file.file)) continue;
    const endpoint = reactRouterRoutePathFromFile(file.file);
    if (!endpoint) continue;

    for (const fn of file.functions) {
      const key = functionKey(file.file, fn.id);
      const current = out.get(key) ?? new Set<string>();
      current.add(endpoint);
      out.set(key, current);
    }
  }

  const resolved = new Map<string, string[]>();
  for (const [key, endpoints] of out.entries()) {
    resolved.set(key, [...endpoints].sort());
  }
  return resolved;
}

/**
 * 入力例: `fnRole("state")`
 * 成果物: 処理結果オブジェクトを返す。
 */
function fnRole(name: string): "loader" | "action" | "clientLoader" | "clientAction" | "component" | "other" {
  if (name === "loader") return "loader";
  if (name === "action") return "action";
  if (name === "clientLoader") return "clientLoader";
  if (name === "clientAction") return "clientAction";
  if (name === "default") return "component";
  return "other";
}

/**
 * 入力例: `findRouteRoleFns({ file: "/workspace/src/index.ts", functions: [] })`
 * 成果物: 処理結果オブジェクトを返す。
 */
function findRouteRoleFns(file: FileReport) {
  const byName = new Map(file.functions.map((f) => [f.name, f]));
  return {
    loader: byName.get("loader"),
    action: byName.get("action"),
    clientLoader: byName.get("clientLoader"),
    clientAction: byName.get("clientAction"),
    component: byName.get("default"),
  };
}

/**
 * 入力例: `isCallEvent({ kind: "call", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, syntax: "redirect()", callee: "redirect", args: [] })`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isCallEvent(e: PEvent): e is Extract<PEvent, { kind: "call" }> {
  return e.kind === "call";
}
/**
 * 入力例: `isRedirectEvent({ kind: "redirect", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 20 }, syntax: "redirect('/login')", via: "call", api: "redirect" })`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isRedirectEvent(e: PEvent): e is Extract<PEvent, { kind: "redirect" }> {
  return e.kind === "redirect";
}

// React Router route module に特有な依存関係を「追加レイヤー」として整理する。
// flow(events) の AST 系情報はそのまま残し、本レポートは functionId/eventIndex 参照で結びつける。
/**
 * 入力例: `deriveReactRouterReport({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: React Router向けの routeModules/importRows/eventRows を返す。
 */
export function deriveReactRouterReport(report: AnalysisReport) {
  const evidence = report.files
    .flatMap((f) =>
      (f.imports ?? [])
        .filter((imp) => imp.source === "react-router" || imp.source === "react-router-dom" || imp.source.startsWith("react-router/"))
        .map((imp) => ({ file: f.file, source: imp.source, syntax: imp.syntax }))
    );

  const routeModules = report.files.filter(hasReactRouterImport).map((file) => {
    const roles = findRouteRoleFns(file);
    return {
      file: file.file,
      exports: {
        loader: roles.loader ? { id: roles.loader.id, name: roles.loader.name } : undefined,
        action: roles.action ? { id: roles.action.id, name: roles.action.name } : undefined,
        clientLoader: roles.clientLoader ? { id: roles.clientLoader.id, name: roles.clientLoader.name } : undefined,
        clientAction: roles.clientAction ? { id: roles.clientAction.id, name: roles.clientAction.name } : undefined,
        component: roles.component ? { id: roles.component.id, name: roles.component.name } : undefined,
      },
      imports: file.imports,
    };
  });

  const relations: ReactRouterRelation[] = [];

  for (const { file, fn } of flattenFunctions(report)) {
    if (!hasReactRouterImport(file)) continue;
    const role = fnRole(fn.name);
    const roleFns = findRouteRoleFns(file);

    fn.events.forEach((e, eventIndex) => {
      if (isCallEvent(e)) {
        // 画面コンポーネントが loader/action に依存する典型パターンを relation 化する。
        if (role === "component") {
          if (e.callee === "useLoaderData" || e.callee === "useRouteLoaderData") {
            relations.push({
              type: "component-reads-loader",
              file: file.file,
              componentFunctionId: fn.id,
              componentName: fn.name,
              loaderFunctionId: roleFns.loader?.id ?? roleFns.clientLoader?.id,
              loaderName: roleFns.loader?.name ?? roleFns.clientLoader?.name,
              viaHook: e.callee,
              eventIndex,
              loc: e.loc,
              syntax: e.syntax,
            });
          }
          if (e.callee === "useActionData" || e.callee === "useFetcher" || e.callee === "useFetchers") {
            relations.push({
              type: "component-reads-action",
              file: file.file,
              componentFunctionId: fn.id,
              componentName: fn.name,
              actionFunctionId: roleFns.action?.id ?? roleFns.clientAction?.id,
              actionName: roleFns.action?.name ?? roleFns.clientAction?.name,
              viaHook: e.callee,
              eventIndex,
              loc: e.loc,
              syntax: e.syntax,
            });
          }
        }

        // 再検証・画面更新に関係する signal 群
        if (
          e.callee === "revalidate" ||
          e.callee.endsWith(".revalidate") ||
          e.callee === "submit" ||
          e.callee.endsWith(".submit") ||
          e.callee === "fetcher.load" ||
          e.callee === "fetcher.submit"
        ) {
          relations.push({
            type: "revalidation-signal",
            file: file.file,
            functionId: fn.id,
            functionName: fn.name,
            signal: e.callee,
            eventIndex,
            loc: e.loc,
            syntax: e.syntax,
          });
        }
      }

      if (isRedirectEvent(e)) {
        if (role === "component" && (e.api === "navigate" || e.api.endsWith(".navigate") || e.api.endsWith(".push") || e.api.endsWith(".replace"))) {
          relations.push({
            type: "component-navigates",
            file: file.file,
            componentFunctionId: fn.id,
            componentName: fn.name,
            viaApi: e.api,
            target: e.target,
            eventIndex,
            loc: e.loc,
            syntax: e.syntax,
          });
        }

        if (role === "loader" || role === "action" || role === "clientLoader" || role === "clientAction") {
          relations.push({
            type: "server-redirect",
            file: file.file,
            functionId: fn.id,
            functionName: fn.name,
            role,
            viaApi: e.api,
            target: e.target,
            eventIndex,
            loc: e.loc,
            syntax: e.syntax,
          });
        }
      }
    });
  }

  return {
    framework: "react-router" as const,
    evidence,
    routeModules,
    // `flow` 側と join しやすいように functionId / eventIndex を必ず持つ relation 設計にする。
    relations,
    summary: {
      evidenceCount: evidence.length,
      routeModuleCount: routeModules.length,
      relationCount: relations.length,
    },
  };
}
