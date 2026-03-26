import type { SyntaxNode } from "../shared/syntax-node"

export type { SyntaxNode }

// DSL の vars セクションで使う簡易型。
// 実行時表現 (Value) と 1:1 ではない。例: `enum` は初期値決定にも使う。
export type VarType =
  | { kind: "maybe"; inner: string }
  | { kind: "enum"; values: string[] }
  | { kind: "set"; inner: string }
  | { kind: "int" }
  | { kind: "string" }
  | { kind: "bool" }

export type Param = { name: string; type: string }

// `machine.event` をコンパイルした後の表現。
// parser 段階では単なる S 式だが、compile 段階で「イベント名/引数/ガード/副作用」に分解する。
export type EventDef = {
  name: string
  params: Param[]
  whenExpr: SyntaxNode
  requireExprs: SyntaxNode[]
  doOps: SyntaxNode[]
  gotoState?: string
}

export type InvariantDef = {
  name: string
  expr: SyntaxNode
}

// `counterexample` ブロックの出力方針。
// 現状は `format trace` / `minimize steps` を受理する最小サブセットのみ保持する。
export type CounterexampleOptions = {
  minimizeSteps: boolean
  format?: string
}

// `compileSpec()` が返す内部表現。
// engine はこの型だけを見て動作し、元の DSL 文字列には依存しない。
export type CompiledSpec = {
  name: string
  states: string[]
  vars: Array<{ name: string; type: VarType }>
  events: EventDef[]
  env: {
    sessions: number
    maxSteps: number
    tick: number
    allowDuplicate: boolean
    allowReorder: boolean
    allowCrossDelivery: boolean
  }
  properties: {
    invariants: InvariantDef[]
    counterexample: CounterexampleOptions
  }
}

export type Value = string | number | boolean | null | Set<string>
export type SessionStore = Record<string, Value>
export type GlobalStore = Record<string, Value>

// 直前の遷移の観測値。
// `property.invariant` から `last.*` を読めるようにするために保持する。
export type LastTransition = {
  event: string | null
  session: number | null
  transitioned: boolean
  args: Record<string, Value>
}

// 反例出力用のトレース 1 ステップ。
// 「遷移できなかったイベント」も含めることで、原因調査時にガード失敗を追跡しやすくする。
export type TraceStep = {
  step: number
  session: number
  event: string
  args: Record<string, Value>
  transitioned: boolean
}

export type TraceLink = TraceStep & {
  prev: TraceLink | null
}

// 探索時の完全状態。
// 将来的に明示キュー/配送キューを導入する場合も、この型に拡張フィールドを足していく想定。
export type RuntimeState = {
  step: number
  now: number
  sessions: SessionStore[]
  globals: GlobalStore
  controlStates: string[]
  freshSeq: number
  last: LastTransition
  traceTail: TraceLink | null
}

// 最小モデルチェッカの結果。
// `ok: false` のときは「どの invariant が破れたか」と、その時点までの trace を返す。
export type ModelCheckResult =
  | { ok: true; explored: number }
  | { ok: false; explored: number; invariant: string; trace: TraceStep[] }
