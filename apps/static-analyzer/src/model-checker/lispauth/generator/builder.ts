import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sym } from "../shared/syntax-node";
import type { SyntaxNode } from "../shared/syntax-node";
import type { LispauthDslWriteOptions, LispauthDslWriteResult, LispauthSpecDraft } from "./types";

// quoted symbol を builder 利用側でも作りやすくするための再公開ヘルパ。
// 例: q("AuthStarted") -> `'AuthStarted` 相当の AST ノード
export const q = sym;

/**
 * 入力例: `buildLispauthDsl({ name: "oauth-spec", machine: { vars: [], events: [], init: [], assumptions: [] }, property: { invariants: [] } })`
 * 成果物: draft から lispauth DSL テキストを生成して返す。
 */
export function buildLispauthDsl(draft: LispauthSpecDraft): string {
  return renderCommentedLispauthDsl(draft) + "\n";
}

// DSL を生成しつつ、`apps/static-analyzer/report/` (デフォルト) に保存する。
// レビュー時に「今どの仕様を吐いたか」をファイルとして残せるよう、spec 名と timestamp をファイル名に含める。
/**
 * 入力例: `writeLispauthDslReport({ name: "oauth-spec", machine: { vars: [], events: [], init: [], assumptions: [] }, property: { invariants: [] } }, { reportDir: "./report" })`
 * 成果物: DSLファイルを書き出し、`filePath/dsl` を返す。
 */
export function writeLispauthDslReport(draft: LispauthSpecDraft, options: LispauthDslWriteOptions = {}): LispauthDslWriteResult {
  const dsl = buildLispauthDsl(draft);
  const outDir = options.outDir ?? defaultReportDir();
  const fileStem = options.fileStem ?? `lispauth-${slugify(draft.name)}-${formatTimestamp(options.now ?? new Date())}`;
  const fileName = `${fileStem}.lispauth`;
  const filePath = path.join(outDir, fileName);

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, dsl, "utf8");

  return { filePath, fileName, dsl };
}

/**
 * 入力例: `buildSpecSyntax({ name: "oauth-spec", machine: { vars: [], events: [], init: [], assumptions: [] }, property: { invariants: [] } })`
 * 成果物: draft を top-level `(spec ...)` S式へ変換して返す。
 */
export function buildSpecSyntax(draft: LispauthSpecDraft): SyntaxNode {
  const machine: SyntaxNode[] = [
    "machine",
    ["states", ...draft.machine.states],
    ["vars", ...draft.machine.vars.map((v) => [v.name, v.type])],
    ...draft.machine.events.map(buildEventSyntax),
  ];

  const httpDraft = draft.http ?? {};
  const http: SyntaxNode[] = ["http"];
  if (httpDraft.focusEndpoint) http.push(["focus-endpoint", httpDraft.focusEndpoint]);
  for (const endpoint of httpDraft.endpoints ?? []) http.push(["endpoint", endpoint]);
  for (const binding of httpDraft.eventEndpoints ?? []) {
    http.push(["event-endpoints", binding.event, ...binding.endpoints]);
  }

  const envDraft = draft.env ?? {};
  const env: SyntaxNode[] = ["env"];
  if (envDraft.scheduler) env.push(["scheduler", envDraft.scheduler]);
  for (const a of envDraft.allow ?? []) env.push(["allow", a]);
  if (typeof envDraft.sessions === "number") env.push(["sessions", envDraft.sessions]);
  if (envDraft.time && (typeof envDraft.time.maxSteps === "number" || typeof envDraft.time.tick === "number")) {
    const time: SyntaxNode[] = ["time"];
    if (typeof envDraft.time.maxSteps === "number") time.push(["max-steps", envDraft.time.maxSteps]);
    if (typeof envDraft.time.tick === "number") time.push(["tick", envDraft.time.tick]);
    env.push(time);
  }

  const propertyDraft = draft.property ?? {};
  const property: SyntaxNode[] = ["property", ...(propertyDraft.invariants ?? []).map((inv) => ["invariant", inv.name, inv.expr] satisfies SyntaxNode[])];
  if (propertyDraft.counterexample) {
    const cx: SyntaxNode[] = ["counterexample"];
    if (propertyDraft.counterexample.format) cx.push(["format", propertyDraft.counterexample.format]);
    if (propertyDraft.counterexample.minimize) cx.push(["minimize", propertyDraft.counterexample.minimize]);
    property.push(cx);
  }

  return ["spec", draft.name, machine, ...(http.length > 1 ? [http] : []), env, property];
}

/**
 * 入力例: `buildEventSyntax(1)`
 * 成果物: 処理結果オブジェクトを返す。
 */
function buildEventSyntax(event: LispauthSpecDraft["machine"]["events"][number]): SyntaxNode {
  const out: SyntaxNode[] = ["event", event.name, (event.params ?? []).map((p) => [p.name, p.type])];

  if (event.when !== undefined) out.push(["when", event.when]);
  for (const r of event.require ?? []) out.push(["require", r]);
  if (event.do) out.push(["do", ...event.do]);
  if (event.goto) out.push(["goto", q(event.goto)]);
  return out;
}

/**
 * 入力例: `renderSyntax(["spec"], 1)`
 * 成果物: S式を整形済みDSL文字列へレンダリングして返す。
 */
export function renderSyntax(node: SyntaxNode, indent = 2): string {
  return renderNode(node, 0, indent);
}

/**
 * 入力例: `renderNode(["spec"], 1, 1)`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function renderNode(node: SyntaxNode, level: number, indent: number): string {
  if (Array.isArray(node)) return renderList(node, level, indent);
  if (typeof node === "string") return renderAtom(node);
  if (typeof node === "number") return String(node);
  if (typeof node === "boolean") return node ? "true" : "false";
  if (node === null) return "null";
  return `'${node.name}`;
}

/**
 * 入力例: `renderList([], 1, 1)`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function renderList(list: SyntaxNode[], level: number, indent: number): string {
  if (list.length === 0) return "()";
  if (list.every(isAtomicLike)) {
    return `(${list.map((x) => renderNode(x, level + 1, indent)).join(" ")})`;
  }

  const pad = " ".repeat(level * indent);
  const childPad = " ".repeat((level + 1) * indent);
  const [head, ...rest] = list;

  let out = `(${renderNode(head, level + 1, indent)}`;
  for (const item of rest) {
    if (isAtomicLike(item)) {
      out += ` ${renderNode(item, level + 1, indent)}`;
      continue;
    }
    out += `\n${childPad}${renderNode(item, level + 1, indent)}`;
  }
  if (rest.some((x) => !isAtomicLike(x))) out += `\n${pad}`;
  out += ")";
  return out;
}

/**
 * 入力例: `isAtomicLike(["spec"])`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isAtomicLike(node: SyntaxNode): boolean {
  return !Array.isArray(node);
}

/**
 * 入力例: `renderAtom("example")`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function renderAtom(value: string): string {
  // DSL の識別子として安全に書けるもの以外は文字列リテラル化する。
  // `session.state`, `last.args.code`, `max-steps` などは識別子としてそのまま出す。
  if (/^[A-Za-z0-9_.:+\-?*=<>!/]+$/.test(value)) return value;
  return JSON.stringify(value);
}

/**
 * 入力例: `defaultReportDir()`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function defaultReportDir(): string {
  // `generator/builder.ts` は `src/model-checker/lispauth/` 配下にあるので、4階層上が package root。
  // そこに `report/` を作ることで、ユーザー要望の `apps/static-analyzer/report/` をデフォルトにする。
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..", "..", "report");
}

/**
 * 入力例: `slugify("state")`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "spec";
}

/**
 * 入力例: `formatTimestamp(new Date("2026-01-01T00:00:00Z"))`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function formatTimestamp(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}

/**
 * 入力例: `renderCommentedLispauthDsl({ name: "oauth-spec", machine: { vars: [], events: [], init: [], assumptions: [] }, property: { invariants: [] } })`
 * 成果物: 説明コメント付きDSL全文を文字列で返す。
 */
function renderCommentedLispauthDsl(draft: LispauthSpecDraft): string {
  const lines: string[] = [];

  pushComment(lines, 0, "仕様定義の開始（spec 名はレビュー対象の識別子）");
  pushLine(lines, 0, `(spec ${renderAtom(draft.name)}`);

  pushComment(lines, 1, "状態機械本体");
  pushLine(lines, 1, "(machine");

  pushComment(lines, 2, "状態一覧（遷移先の表記ゆれ確認ポイント）");
  pushRendered(lines, 2, ["states", ...draft.machine.states]);

  pushComment(lines, 2, "状態変数・補助変数");
  pushLine(lines, 2, "(vars");
  for (const v of draft.machine.vars) {
    pushComment(lines, 3, `変数 ${v.name} の型定義`);
    pushRendered(lines, 3, [v.name, v.type]);
  }
  pushLine(lines, 2, ")");

  for (const event of draft.machine.events) {
    pushComment(lines, 2, `イベント ${event.name} の定義`);
    pushLine(lines, 2, `(event ${renderAtom(event.name)}`);

    pushComment(lines, 3, "イベント引数一覧");
    pushRendered(
      lines,
      3,
      (event.params ?? []).map((p) => [p.name, p.type]),
    );

    if (event.when !== undefined) {
      pushComment(lines, 3, "遷移試行の前提条件（when）");
      pushRendered(lines, 3, ["when", event.when]);
    }

    for (const [index, req] of (event.require ?? []).entries()) {
      pushComment(lines, 3, `実行時必須条件（require ${index + 1}）`);
      pushRendered(lines, 3, ["require", req]);
    }

    if (event.do) {
      pushComment(lines, 3, "条件成立時の更新操作（do）");
      pushLine(lines, 3, "(do");
      for (const [index, op] of event.do.entries()) {
        pushComment(lines, 4, `操作 ${index + 1}`);
        pushRendered(lines, 4, op);
      }
      pushLine(lines, 3, ")");
    }

    if (event.goto) {
      pushComment(lines, 3, "イベント後の遷移先状態（goto）");
      pushRendered(lines, 3, ["goto", q(event.goto)]);
    }

    pushLine(lines, 2, ")");
  }
  pushLine(lines, 1, ")");

  const httpDraft = draft.http ?? {};
  if (httpDraft.focusEndpoint || (httpDraft.endpoints?.length ?? 0) > 0 || (httpDraft.eventEndpoints?.length ?? 0) > 0) {
    pushComment(lines, 1, "HTTP endpoint 情報（モデル化対象の通信面）");
    pushLine(lines, 1, "(http");
    if (httpDraft.focusEndpoint) {
      pushComment(lines, 2, "この spec unit が主に注目する endpoint");
      pushRendered(lines, 2, ["focus-endpoint", httpDraft.focusEndpoint]);
    }
    for (const endpoint of httpDraft.endpoints ?? []) {
      pushComment(lines, 2, "観測された endpoint");
      pushRendered(lines, 2, ["endpoint", endpoint]);
    }
    for (const binding of httpDraft.eventEndpoints ?? []) {
      pushComment(lines, 2, `イベント ${binding.event} に関連する endpoint 候補`);
      pushRendered(lines, 2, ["event-endpoints", binding.event, ...binding.endpoints]);
    }
    pushLine(lines, 1, ")");
  }

  const envDraft = draft.env ?? {};
  pushComment(lines, 1, "探索環境（スケジューラ・セッション数・時間境界）");
  pushLine(lines, 1, "(env");
  if (envDraft.scheduler) {
    pushComment(lines, 2, "探索時のスケジューラ方針");
    pushRendered(lines, 2, ["scheduler", envDraft.scheduler]);
  }
  for (const allow of envDraft.allow ?? []) {
    pushComment(lines, 2, `探索で許容する挙動（${allow}）`);
    pushRendered(lines, 2, ["allow", allow]);
  }
  if (typeof envDraft.sessions === "number") {
    pushComment(lines, 2, "同時セッション数の上限");
    pushRendered(lines, 2, ["sessions", envDraft.sessions]);
  }
  if (envDraft.time && (typeof envDraft.time.maxSteps === "number" || typeof envDraft.time.tick === "number")) {
    pushComment(lines, 2, "探索の時間・手数境界（time）");
    pushLine(lines, 2, "(time");
    if (typeof envDraft.time.maxSteps === "number") {
      pushComment(lines, 3, "探索ステップ数の上限");
      pushRendered(lines, 3, ["max-steps", envDraft.time.maxSteps]);
    }
    if (typeof envDraft.time.tick === "number") {
      pushComment(lines, 3, "1 ステップごとの時間進行量");
      pushRendered(lines, 3, ["tick", envDraft.time.tick]);
    }
    pushLine(lines, 2, ")");
  }
  pushLine(lines, 1, ")");

  const propertyDraft = draft.property ?? {};
  pushComment(lines, 1, "検証したい性質（invariant / counterexample 出力設定）");
  pushLine(lines, 1, "(property");
  for (const inv of propertyDraft.invariants ?? []) {
    pushComment(lines, 2, `不変条件 ${inv.name}`);
    pushRendered(lines, 2, ["invariant", inv.name, inv.expr]);
  }
  if (propertyDraft.counterexample) {
    pushComment(lines, 2, "反例出力の形式・最小化方針（counterexample）");
    pushLine(lines, 2, "(counterexample");
    if (propertyDraft.counterexample.format) {
      pushComment(lines, 3, "反例の出力形式");
      pushRendered(lines, 3, ["format", propertyDraft.counterexample.format]);
    }
    if (propertyDraft.counterexample.minimize) {
      pushComment(lines, 3, "反例の最小化尺度");
      pushRendered(lines, 3, ["minimize", propertyDraft.counterexample.minimize]);
    }
    pushLine(lines, 2, ")");
  }
  pushLine(lines, 1, ")");

  pushLine(lines, 0, ")");
  return lines.join("\n");
}

/**
 * 入力例: `pushComment(["/a.ts", "/b.ts"], 1, "example")`
 * 成果物: 副作用のみを実行する（戻り値なし）。
 */
function pushComment(lines: string[], level: number, text: string) {
  lines.push(`${" ".repeat(level * 2)}; - ${text}`);
}

/**
 * 入力例: `pushLine(["/a.ts", "/b.ts"], 1, "example")`
 * 成果物: 副作用のみを実行する（戻り値なし）。
 */
function pushLine(lines: string[], level: number, text: string) {
  lines.push(`${" ".repeat(level * 2)}${text}`);
}

/**
 * 入力例: `pushRendered(["/a.ts", "/b.ts"], 1, ["spec"])`
 * 成果物: 副作用のみを実行する（戻り値なし）。
 */
function pushRendered(lines: string[], level: number, node: SyntaxNode) {
  const pad = " ".repeat(level * 2);
  for (const line of renderSyntax(node).split("\n")) {
    lines.push(`${pad}${line}`);
  }
}
