import type { PEvent } from "../types/event";
import type { AnalysisReport, FileReport, FunctionReport } from "../types/report";

/**
 * 状態遷移レイヤーの目的
 * --------------------
 * `flow` レポートは AST 由来イベント列を豊富に保持しており、解析根拠としては強い。
 * 一方で「状態遷移図にしたい」「グラフDBに入れたい」「フロントでノード/エッジ描画したい」
 * という用途では、イベント列のままだと扱いにくい。
 *
 * そこで本レイヤーでは、既存の `flow.events` を壊さずに
 * 「関数ごとの状態グラフ (nodes/edges)」へ射影する。
 *
 * 重要な設計方針:
 * - これは CFG (Control Flow Graph) の完全復元ではない
 *   - `if/switch` の分岐先を厳密追跡しない
 *   - `blockEnter/blockExit` は構造イベントとしてそのままノード化する
 * - 既存 `flow` との join を優先する
 *   - `eventIndex` を保持して、元イベントへ戻れるようにする
 * - まずは「時系列イベント列 -> グラフ化」の薄い変換に徹する
 *   - 後で true/false 分岐や例外経路を追加しやすいよう、edge.kind を分けておく
 */
export type StateNode = {
  id: string;
  kind: "start" | "end" | "event";
  label: string;
  eventIndex?: number;
  eventKind?: PEvent["kind"];
  loc?: PEvent["loc"];
};

export type StateEdge = {
  from: string;
  to: string;
  kind: "sequence" | "terminal";
  label?: string;
  eventIndex?: number;
};

export type FunctionStateTransition = {
  file: string;
  functionId: string;
  functionName: string;
  functionKind: FunctionReport["kind"];
  nodes: StateNode[];
  edges: StateEdge[];
  summary: {
    eventCount: number;
    nodeCount: number;
    edgeCount: number;
    terminalTransitionCount: number;
  };
};

// 既存の oauth / framework 派生レポートと同様に、
// まずは file + function の平坦列へ正規化してから関数ごとに変換する。
// こうしておくと後段ロジックは「単一関数のイベント列 -> 状態グラフ」に集中できる。
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
 * イベントを人間が読みやすいノードラベルへ変換する。
 *
 * ここでのラベルは UI / デバッグ用途の「見出し」であり、
 * 厳密な再パースを前提にした表現ではない。
 *
 * 例:
 * - `redirect:navigate -> "/home"`
 * - `if x > 0`
 * - `call commitSession`
 */
/**
 * 入力例: `eventLabel({ kind: "call", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, syntax: "f()", callee: "f", args: [] })`
 * 成果物: 整形・正規化後の文字列を返す。
 */
function eventLabel(e: PEvent): string {
  switch (e.kind) {
    case "if":
      return `if ${e.test}`;
    case "switch":
      return `switch ${e.expr}`;
    case "loop":
      return `${e.loopKind}: ${e.header}`;
    case "try":
      return "try";
    case "catch":
      return e.param ? `catch (${e.param})` : "catch";
    case "finally":
      return "finally";
    case "return":
      return e.expr ? `return ${e.expr}` : "return";
    case "throw":
      return `throw ${e.expr}`;
    case "await":
      return `await ${e.expr}`;
    case "redirect":
      return `redirect:${e.api}${e.target ? ` -> ${e.target}` : ""}`;
    case "urlParamSet":
      return `${e.urlExpr}.searchParams.set(${e.key}${e.value ? `, ${e.value}` : ""})`;
    case "sessionOp":
      if (e.operation === "load" || e.operation === "commit" || e.operation === "destroy") {
        return `session:${e.operation} ${e.api}`;
      }
      return `${e.api}(${e.key ?? ""}${e.value ? `, ${e.value}` : ""})`;
    case "dbOp":
      return `db:${e.operation} ${e.api}${e.model ? ` [${e.model}]` : ""}`;
    case "formOp":
      if (e.operation === "load") return `${e.api}()`;
      return `form:${e.operation} ${e.api}(${e.field ?? ""}${e.value ? `, ${e.value}` : ""})`;
    case "call":
      return `call ${e.callee}`;
    case "new":
      return `new ${e.classExpr}`;
    case "blockEnter":
      return `enter ${e.label}`;
    case "blockExit":
      return `exit ${e.label}`;
    default: {
      const exhaustive: never = e;
      return String(exhaustive);
    }
  }
}

// 「ここで関数実行が終了し得る」イベントを終端イベントとして扱う。
//
// 注意:
// - 現在は簡易ルールとして redirect を終端扱いにしている。
//   実コード上は redirect 呼び出し後に処理継続するパターンも理論上あり得るため、
//   必要になれば API ごとの厳密判定 (throwing redirect / return redirect のみ等) に拡張する。
/**
 * 入力例: `isTerminalEvent({ kind: "return", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, syntax: "return 1" })`
 * 成果物: 条件一致時に `true`、不一致時に `false` を返す。
 */
function isTerminalEvent(e: PEvent): boolean {
  return e.kind === "return" || e.kind === "throw" || e.kind === "redirect";
}

// 終端遷移のラベルはグラフ描画時に視認性が高い短い語を優先する。
// (イベントノード側に詳細ラベルがあるため、edge には最小限を載せる)
/**
 * 入力例: `terminalLabel({ kind: "throw", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 15 }, syntax: "throw e" })`
 * 成果物: 整形・正規化後の文字列を返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
function terminalLabel(e: PEvent): string | undefined {
  if (e.kind === "return") return "return";
  if (e.kind === "throw") return "throw";
  if (e.kind === "redirect") return "redirect";
  return undefined;
}

/**
 * 単一関数の `events[]` を状態遷移データへ変換する。
 *
 * 変換ルール (現行):
 * 1. 必ず `START` / `END` ノードを作る
 * 2. 各イベントを 1 ノード化する (`eventIndex` 付き)
 * 3. イベント列の隣接関係を `sequence` edge として接続する
 * 4. return/throw/redirect は `END` への `terminal` edge を追加する
 *
 * これにより「線形イベント列」をグラフとして扱えるようになり、
 * UI 側で色分けやフィルタ (terminal のみ強調 等) がしやすくなる。
 *
 * 制約:
 * - `terminal` edge を追加しても、sequence edge は残す。
 *   理由は「元イベント列の連続性」を失わないため。
 *   もし描画上ノイズになる場合は、描画側で `terminal` を優先表示すればよい。
 */
/**
 * 入力例: `toFunctionTransition({ file: "/workspace/src/index.ts", functions: [] }, { id: "fn1", name: "loader", kind: "function", loc: { startLine: 1, startCol: 1, endLine: 1, endCol: 10 }, events: [] })`
 * 成果物: 1関数分の遷移グラフ（nodes/edges/summary）を返す。
 */
function toFunctionTransition(file: FileReport, fn: FunctionReport): FunctionStateTransition {
  const startId = `${fn.id}:start`;
  const endId = `${fn.id}:end`;
  const nodes: StateNode[] = [
    { id: startId, kind: "start", label: "START" },
    { id: endId, kind: "end", label: "END" },
  ];
  const edges: StateEdge[] = [];

  // 空関数も「状態グラフとしては存在する」ので START->END を 1 本だけ張る。
  // これにより関数一覧UIでの扱いが均一になる (node/edge 0 件にならない)。
  if (fn.events.length === 0) {
    // 実際の終端イベント (return/throw/redirect) ではないため terminal にはしない。
    edges.push({ from: startId, to: endId, kind: "sequence", label: "empty" });
  } else {
    // START は flow.events の要素ではないため eventIndex は付与しない。
    edges.push({ from: startId, to: `${fn.id}:e0`, kind: "sequence" });
  }

  fn.events.forEach((e, i) => {
    const nodeId = `${fn.id}:e${i}`;
    nodes.push({
      id: nodeId,
      kind: "event",
      label: eventLabel(e),
      eventIndex: i,
      eventKind: e.kind,
      loc: e.loc,
    });

    if (i < fn.events.length - 1) {
      edges.push({
        from: nodeId,
        to: `${fn.id}:e${i + 1}`,
        kind: "sequence",
        eventIndex: i,
      });
    } else {
      edges.push({
        from: nodeId,
        to: endId,
        kind: "sequence",
        label: "end-of-events",
        eventIndex: i,
      });
    }

    if (isTerminalEvent(e)) {
      // 「このイベントで終了し得る」ことを明示する補助 edge。
      // sequence edge と併存させることで、時系列情報と終端候補情報を両立させる。
      edges.push({
        from: nodeId,
        to: endId,
        kind: "terminal",
        label: terminalLabel(e),
        eventIndex: i,
      });
    }
  });

  const terminalTransitionCount = edges.filter((e) => e.kind === "terminal").length;
  return {
    file: file.file,
    functionId: fn.id,
    functionName: fn.name,
    functionKind: fn.kind,
    nodes,
    edges,
    summary: {
      eventCount: fn.events.length,
      nodeCount: nodes.length,
      edgeCount: edges.length,
      terminalTransitionCount,
    },
  };
}

/**
 * `AnalysisReport` 全体を状態遷移レイヤーへ変換するエントリポイント。
 *
 * 出力構造:
 * - `summary`: 集約統計 (件数監視・差分確認向け)
 * - `files`: ファイル単位の軽量インデックス
 * - `functions`: 実データ本体 (nodes/edges)
 *
 * `files` を別に持つ理由:
 * - UI/CLI が関数本体を全ロードせず、まずファイル一覧だけ表示できる
 * - 後で分割保存 (fileごと / functionごと) に切り替える際の布石になる
 */
/**
 * 入力例: `deriveStateTransitionReport({ entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: 関数ごとの状態遷移ノード/エッジ集約結果を返す。
 */
export function deriveStateTransitionReport(report: AnalysisReport) {
  const functions = flattenFunctions(report).map(({ file, fn }) => toFunctionTransition(file, fn));
  const files = report.files.map((f) => ({
    file: f.file,
    functionIds: f.functions.map((fn) => fn.id),
    functionCount: f.functions.length,
  }));

  return {
    summary: {
      fileCount: report.files.length,
      functionCount: functions.length,
      nodeCount: functions.reduce((n, f) => n + f.summary.nodeCount, 0),
      edgeCount: functions.reduce((n, f) => n + f.summary.edgeCount, 0),
      terminalTransitionCount: functions.reduce((n, f) => n + f.summary.terminalTransitionCount, 0),
    },
    files,
    functions,
  };
}
