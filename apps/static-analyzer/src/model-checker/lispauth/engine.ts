import { isList, isSym } from "./parser"
import type { CompiledSpec, EventDef, ModelCheckResult, RuntimeState, Sexp, Value } from "./types"

// lispauth の最小モデルチェッカ本体。
//
// 実装方針:
// - BFS で探索し、最初に見つかった失敗を「短い反例」として返す
// - 状態同値 (`stableStateKey`) を使って枝刈りする
// - スケジューラ/ネットワークを明示的なキューとして再現する代わりに、
//   「各ステップで任意セッションに任意イベントが届く」近似で worst-case を表現する
//
// この方針は厳密な分散モデルではないが、OAuth の混線/順序崩れ/重複の初期検出には
// コストに対して効果が高い。
export function modelCheck(spec: CompiledSpec): ModelCheckResult {
  const init = createInitialState(spec)
  const queue: RuntimeState[] = [init]
  const seen = new Set<string>()
  let explored = 0

  while (queue.length) {
    const current = queue.shift()!
    const key = stableStateKey(current)
    if (seen.has(key)) continue
    seen.add(key)
    explored += 1

    for (const inv of spec.properties.invariants) {
      const ok = truthy(evalExpr(inv.expr, current, current.last.session ?? 0))
      if (!ok) {
        return {
          ok: false,
          explored,
          invariant: inv.name,
          trace: current.trace,
        }
      }
    }

    if (current.step >= spec.env.maxSteps) continue

    const nexts = generateNextStates(spec, current)
    for (const n of nexts) queue.push(n)
  }

  return { ok: true, explored }
}

function createInitialState(spec: CompiledSpec): RuntimeState {
  // `vars` から session スコープ / global スコープを分離して初期状態を作る。
  // `session.` 接頭辞は DSL 上の名前規約であり、構文としては compile 側では解釈しない。
  const sessions = []
  const globals: RuntimeState["globals"] = {}
  const controlStates: string[] = []

  for (let i = 0; i < spec.env.sessions; i += 1) {
    const store: RuntimeState["sessions"][number] = {}
    for (const v of spec.vars) {
      if (v.name.startsWith("session.")) {
        store[v.name.slice("session.".length)] = initialValue(v.type)
      }
    }
    sessions.push(store)
    controlStates.push(spec.states[0] ?? "")
  }

  for (const v of spec.vars) {
    if (!v.name.startsWith("session.")) globals[v.name] = initialValue(v.type)
  }

  const nowValue = globals.now
  return {
    step: 0,
    now: typeof nowValue === "number" ? nowValue : 0,
    sessions,
    globals,
    controlStates,
    freshSeq: 0,
    last: { event: null, session: null, transitioned: false, args: {} },
    trace: [],
  }
}

function initialValue(type: CompiledSpec["vars"][number]["type"]): Value {
  // enum は先頭値をデフォルトにする。
  // 例: `(enum Start AuthStarted ...)` -> 初期値は `Start`
  if (type.kind === "maybe") return null
  if (type.kind === "enum") return type.values[0] ?? ""
  if (type.kind === "set") return new Set<string>()
  if (type.kind === "int") return 0
  if (type.kind === "bool") return false
  return ""
}

function generateNextStates(spec: CompiledSpec, state: RuntimeState): RuntimeState[] {
  // 「配送されうる次イベント」を全列挙する。
  // 明示キューを持たないため、reorder/duplicate はこの列挙そのものが吸収する。
  const out: RuntimeState[] = []
  for (let sessionIndex = 0; sessionIndex < spec.env.sessions; sessionIndex += 1) {
    for (const event of spec.events) {
      const argOptions = enumerateArgs(spec, state, event, sessionIndex)
      for (const args of argOptions) {
        out.push(applyEvent(spec, state, sessionIndex, event, args))
      }
    }
  }
  return out
}

function enumerateArgs(spec: CompiledSpec, state: RuntimeState, event: EventDef, targetSession: number): Array<Record<string, Value>> {
  if (!event.params.length) return [{}]

  // 文字列引数は有限ドメインに丸める。
  // 無限文字列空間をそのまま扱うと探索不能になるため、seed + 現在状態/既存trace由来の値だけ使う。
  const domainStrings = collectStringDomain(spec, state, targetSession)
  const domains = event.params.map((p) => {
    if (p.type === "string") return domainStrings
    return [null]
  })

  const results: Array<Record<string, Value>> = []
  const recur = (idx: number, acc: Record<string, Value>) => {
    if (idx >= event.params.length) {
      results.push({ ...acc })
      return
    }
    const param = event.params[idx]
    for (const v of domains[idx]) {
      acc[param.name] = v
      recur(idx + 1, acc)
    }
  }
  recur(0, {})
  return results
}

function collectStringDomain(spec: CompiledSpec, state: RuntimeState, targetSession: number): string[] {
  const set = new Set<string>()
  // seed は「攻撃者が投げがちな値」+ OAuth 例でよく出る値を入れておく。
  // 実案件では spec ごとに注入可能にする余地がある。
  const seed = ["attacker", "code-1", "code-2", "state-1", "state-2", "verifier-1", "verifier-2"]
  for (const s of seed) set.add(s)

  // cross-delivery を許す場合、他セッションに保存された state/verifier も
  // 「誤配送イベントの引数候補」として流入しうるものとしてドメインへ混ぜる。
  const sessionsToRead = spec.env.allowCrossDelivery ? state.sessions : [state.sessions[targetSession]]
  for (const sess of sessionsToRead) {
    for (const v of Object.values(sess)) collectStringsFromValue(v, set)
  }
  for (const v of Object.values(state.globals)) collectStringsFromValue(v, set)
  for (const t of state.trace) {
    for (const v of Object.values(t.args)) collectStringsFromValue(v, set)
  }

  return [...set]
}

function collectStringsFromValue(v: Value, out: Set<string>) {
  if (typeof v === "string") out.add(v)
  if (v instanceof Set) {
    for (const x of v) out.add(x)
  }
}

function applyEvent(spec: CompiledSpec, state: RuntimeState, sessionIndex: number, event: EventDef, args: Record<string, Value>): RuntimeState {
  // 1 イベント適用は純関数的に扱う (clone -> mutate -> return)。
  // BFS で複数分岐を保持するため、元状態の破壊を避ける。
  const next = cloneRuntimeState(state)
  next.step += 1
  next.now += spec.env.tick
  next.globals.now = next.now

  // `when` は「このイベントを現在状態で処理対象として見るか」、
  // `require` は「処理中の検査に通ったか」として分ける。
  // 反例調査では `transitioned=false` の履歴も有用なので trace に残す。
  const whenOk = truthy(evalExpr(event.whenExpr, next, sessionIndex, args))
  let transitioned = false

  if (whenOk) {
    const requiresOk = event.requireExprs.every((expr) => truthy(evalExpr(expr, next, sessionIndex, args)))
    if (requiresOk) {
      for (const op of event.doOps) runOp(op, next, sessionIndex, args)
      if (event.gotoState) next.controlStates[sessionIndex] = event.gotoState
      transitioned = true
    }
  }

  next.last = {
    event: event.name,
    session: sessionIndex,
    transitioned,
    args: { ...args },
  }
  next.trace = [...next.trace, { step: next.step, session: sessionIndex, event: event.name, args: { ...args }, transitioned }]
  return next
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  // `Set` を shallow copy すると枝間で共有されるので、store 単位で複製する。
  return {
    step: state.step,
    now: state.now,
    sessions: state.sessions.map((s) => cloneStore(s)),
    globals: cloneStore(state.globals),
    controlStates: [...state.controlStates],
    freshSeq: state.freshSeq,
    last: {
      event: state.last.event,
      session: state.last.session,
      transitioned: state.last.transitioned,
      args: { ...state.last.args },
    },
    trace: [...state.trace],
  }
}

function cloneStore<T extends Record<string, Value>>(s: T): T {
  const out = {} as T
  for (const [k, v] of Object.entries(s)) {
    out[k as keyof T] = (v instanceof Set ? new Set(v) : v) as T[keyof T]
  }
  return out
}

function runOp(op: Sexp, state: RuntimeState, sessionIndex: number, args: Record<string, Value>) {
  // `do` 節の副作用 DSL。
  // 最小実装では `set` と `noop` のみ対応し、それ以外は明示的に例外で落とす。
  // (暗黙に無視すると、仕様の書き間違いを見逃しやすいため)
  if (!isList(op) || typeof op[0] !== "string") return
  if (op[0] === "noop") return
  if (op[0] === "set") {
    const target = op[1]
    if (typeof target !== "string") throw new Error(`set target must be symbol-like atom: ${JSON.stringify(op)}`)
    const value = evalExpr(op[2], state, sessionIndex, args)
    setRef(target, value, state, sessionIndex)
    return
  }
  throw new Error(`Unsupported op: ${JSON.stringify(op)}`)
}

function setRef(ref: string, value: Value, state: RuntimeState, sessionIndex: number) {
  if (ref.startsWith("session.")) {
    state.sessions[sessionIndex][ref.slice("session.".length)] = value instanceof Set ? new Set(value) : value
    return
  }
  state.globals[ref] = value instanceof Set ? new Set(value) : value
}

function evalExpr(expr: Sexp, state: RuntimeState, sessionIndex: number, args: Record<string, Value> = {}): Value {
  // property/guard 共通の式評価器。
  // 「評価可能なものを増やす」よりも、「未対応をすぐ失敗させる」ことを優先している。
  if (typeof expr === "boolean" || typeof expr === "number" || expr === null) return expr
  if (typeof expr === "string") return readRef(expr, state, sessionIndex, args)
  if (isSym(expr)) return expr.name
  if (!isList(expr) || expr.length === 0) return null

  const head = expr[0]
  if (head === "=") return deepEq(evalExpr(expr[1], state, sessionIndex, args), evalExpr(expr[2], state, sessionIndex, args))
  if (head === "and") return expr.slice(1).every((e) => truthy(evalExpr(e, state, sessionIndex, args)))
  if (head === "or") return expr.slice(1).some((e) => truthy(evalExpr(e, state, sessionIndex, args)))
  if (head === "not") return !truthy(evalExpr(expr[1], state, sessionIndex, args))
  if (head === "=>") return !truthy(evalExpr(expr[1], state, sessionIndex, args)) || truthy(evalExpr(expr[2], state, sessionIndex, args))
  if (head === "in") {
    const needle = evalExpr(expr[1], state, sessionIndex, args)
    const hay = evalExpr(expr[2], state, sessionIndex, args)
    return hay instanceof Set ? typeof needle === "string" && hay.has(needle) : false
  }
  if (head === "add") {
    const base = evalExpr(expr[1], state, sessionIndex, args)
    const item = evalExpr(expr[2], state, sessionIndex, args)
    if (!(base instanceof Set) || typeof item !== "string") throw new Error("add expects (set string)")
    const copy = new Set(base)
    copy.add(item)
    return copy
  }
  if (head === "fresh") {
    // fresh は探索枝ごとに独立して増えるカウンタに基づく。
    // 暗号学的ランダム性の再現ではなく、「新値と既存値が区別される」性質だけを近似する。
    const prefix = evalExpr(expr[1], state, sessionIndex, args)
    if (typeof prefix !== "string") throw new Error("fresh prefix must be string")
    state.freshSeq += 1
    return `${prefix}-${state.freshSeq}`
  }

  throw new Error(`Unsupported expr: ${JSON.stringify(expr)}`)
}

function readRef(ref: string, state: RuntimeState, sessionIndex: number, args: Record<string, Value>): Value {
  // DSL の参照解決優先順位:
  // 1. session.*
  // 2. last.args.*
  // 3. last.*
  // 4. event 引数
  // 5. global vars
  // 6. それ以外はリテラル文字列 atom とみなす
  if (ref.startsWith("session.")) return state.sessions[sessionIndex][ref.slice("session.".length)] ?? null
  if (ref.startsWith("last.args.")) return state.last.args[ref.slice("last.args.".length)] ?? null
  if (ref === "last.event") return state.last.event
  if (ref === "last.transitioned") return state.last.transitioned
  if (ref === "last.session") return state.last.session ?? -1
  if (ref in args) return args[ref]
  if (ref in state.globals) return state.globals[ref]
  return ref
}

function truthy(v: Value): boolean {
  if (v instanceof Set) return v.size > 0
  return Boolean(v)
}

function deepEq(a: Value, b: Value): boolean {
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const x of a) {
      if (!b.has(x)) return false
    }
    return true
  }
  return a === b
}

function stableStateKey(state: RuntimeState): string {
  // BFS の枝刈り用キー。
  // `step` を含めないことで、同一状態への到達経路の違いによる探索爆発を抑える。
  // 一方で `last` は invariant が参照し得るためキーに含める。
  return JSON.stringify({
    now: state.now,
    sessions: state.sessions.map((s) => storeToJson(s)),
    globals: storeToJson(state.globals),
    controlStates: state.controlStates,
    freshSeq: state.freshSeq,
    last: {
      ...state.last,
      args: storeToJson(state.last.args as Record<string, Value>),
    },
  })
}

function storeToJson(store: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(store)) {
    out[k] = v instanceof Set ? [...v].sort() : v
  }
  return out
}
