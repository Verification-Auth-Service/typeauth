import { isList, isSym } from "./parser"
import type { CompiledSpec, EventDef, ModelCheckResult, RuntimeState, Sexp, Value } from "./types"

// CLI などから探索進捗を購読するための通知ペイロード。
// 「内部状態そのもの」を渡すと API が重くなり、将来の内部変更にも弱くなるため、
// まずはログに必要な最小情報 (件数・キュー長・概算step・失敗invariant名) に限定する。
type ModelCheckProgress = {
  phase: "start" | "explore" | "invariant-failed" | "done"
  explored: number
  queueSize: number
  step?: number
  invariant?: string
}

// エンジンの振る舞いを変えずに観測だけ差し込むためのオプション。
// 探索の意味論 (BFS / 近似モデル) を壊さないよう、ここでは副作用フックのみ持つ。
type ModelCheckOptions = {
  onProgress?: (progress: ModelCheckProgress) => void
}

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
export function modelCheck(spec: CompiledSpec, options: ModelCheckOptions = {}): ModelCheckResult {
  // 初期状態は spec から 1 回だけ生成する。
  // 以降の状態遷移では clone ベースで枝を増やすため、ここが探索木の根になる。
  const init = createInitialState(spec)

  // BFS キュー:
  // - queue.shift() で先頭から取り出す
  // - 新しい分岐は末尾へ push
  // この順序により、最初に見つかった失敗は「より短い手順」である可能性が高い。
  const queue: RuntimeState[] = [init]

  // `stableStateKey` で同値とみなした状態の再訪問を防ぐ集合。
  // これがないと duplicate/reorder 近似により同じ状態を大量に再生成して探索が破綻しやすい。
  const seen = new Set<string>()
  let explored = 0
  options.onProgress?.({ phase: "start", explored, queueSize: queue.length, step: init.step })

  while (queue.length) {
    // `!` は while 条件で queue.length > 0 を保証しているため安全。
    const current = queue.shift()!
    const key = stableStateKey(current)

    // 既出状態はここで捨てる。反例最小化の観点でも、BFS で先に来た経路を優先したい。
    if (seen.has(key)) continue
    seen.add(key)
    explored += 1
    options.onProgress?.({ phase: "explore", explored, queueSize: queue.length, step: current.step })

    // invariant は「各到達状態」で評価する。
    // 遷移の前後どちらで評価するかは設計判断だが、本実装は
    // 「その状態に到達した時点で破れていないか」を判定するモデル。
    for (const inv of spec.properties.invariants) {
      const ok = truthy(evalExpr(inv.expr, current, current.last.session ?? 0))
      if (!ok) {
        options.onProgress?.({
          phase: "invariant-failed",
          explored,
          queueSize: queue.length,
          step: current.step,
          invariant: inv.name,
        })
        return {
          ok: false,
          explored,
          invariant: inv.name,
          trace: current.trace,
        }
      }
    }

    // 探索境界。`maxSteps` に達した状態は invariant 検査だけ行い、展開は止める。
    // これにより bounded model checking として動作する。
    if (current.step >= spec.env.maxSteps) continue

    const nexts = generateNextStates(spec, current)
    for (const n of nexts) queue.push(n)
  }

  options.onProgress?.({ phase: "done", explored, queueSize: queue.length, step: spec.env.maxSteps })
  return { ok: true, explored }
}

function createInitialState(spec: CompiledSpec): RuntimeState {
  // `vars` から session スコープ / global スコープを分離して初期状態を作る。
  // `session.` 接頭辞は DSL 上の名前規約であり、構文としては compile 側では解釈しない。
  // そのため engine 側が「命名規約に従って」ストアを振り分ける責務を持つ。
  const sessions = []
  const globals: RuntimeState["globals"] = {}
  const controlStates: string[] = []

  // 各セッションに対して同じ session.* 変数集合を初期化する。
  // `controlStates[i]` は「そのセッションが machine のどの状態にいるか」を表す。
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

  // `now` は global 変数として定義されていなくても動くようにフォールバック 0 を持たせる。
  // DSL 例では `now int` を置くことが多いが、必須にしていないため。
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
  // これは「未初期化」を別表現で持たず、状態機械の起点を enum の先頭値に寄せる簡易設計。
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
  //
  // 具体的には:
  // - すべての session
  // - すべての event
  // - その event に与えうる引数候補
  // の直積を生成し、各候補を 1 手進めた状態として返す。
  //
  // `when` / `require` に失敗する候補も `applyEvent()` 内で trace に残るため、
  // 反例調査時に「何が試され、どこで落ちたか」を追いやすい。
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
  // 引数なしイベントは空オブジェクト 1 通りだけ。
  // 「0 通り」ではなく「1 通り」にすることで直積の実装を単純に保つ。
  if (!event.params.length) return [{}]

  // 文字列引数は有限ドメインに丸める。
  // 無限文字列空間をそのまま扱うと探索不能になるため、seed + 現在状態/既存trace由来の値だけ使う。
  const domainStrings = collectStringDomain(spec, state, targetSession)
  const domains = event.params.map((p) => {
    // 現状 DSL では event 引数の実用型は string が中心。
    // string 以外は最小実装として `null` のみを候補にしている。
    // 型の表現力を増やす場合はここで有限ドメイン化戦略を追加する。
    if (p.type === "string") return domainStrings
    return [null]
  })

  const results: Array<Record<string, Value>> = []
  const recur = (idx: number, acc: Record<string, Value>) => {
    // パラメータ列の直積を深さ優先で展開する。
    // ここは「生成順」が反例の見え方に影響するため、domains の順序をそのまま保つ。
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
  // 許さない場合は targetSession のみ参照し、セッション間混線の探索空間を絞る。
  const sessionsToRead = spec.env.allowCrossDelivery ? state.sessions : [state.sessions[targetSession]]
  for (const sess of sessionsToRead) {
    for (const v of Object.values(sess)) collectStringsFromValue(v, set)
  }
  for (const v of Object.values(state.globals)) collectStringsFromValue(v, set)
  for (const t of state.trace) {
    for (const v of Object.values(t.args)) collectStringsFromValue(v, set)
  }

  // Set を使っているので重複は自然に消える。
  // 順序は厳密固定ではないが、同一実行中は概ね追加順に近い挙動になる。
  return [...set]
}

function collectStringsFromValue(v: Value, out: Set<string>) {
  // `Value` は string 以外も取り得るため、ここで string 成分だけを抽出する。
  // `set string` をサポートしているので Set の中身も再帰ではなく走査で回収する。
  if (typeof v === "string") out.add(v)
  if (v instanceof Set) {
    for (const x of v) out.add(x)
  }
}

function applyEvent(spec: CompiledSpec, state: RuntimeState, sessionIndex: number, event: EventDef, args: Record<string, Value>): RuntimeState {
  // 1 イベント適用は純関数的に扱う (clone -> mutate -> return)。
  // BFS で複数分岐を保持するため、元状態の破壊を避ける。
  const next = cloneRuntimeState(state)

  // 時間は「イベント試行」単位で進める。
  // transitioned=false (ガード失敗) の場合も step/now を進めるため、
  // 本モデルでは「無効な入力が届いた試行」も時間経過として扱う。
  next.step += 1
  next.now += spec.env.tick
  next.globals.now = next.now

  // `when` は「このイベントを現在状態で処理対象として見るか」、
  // `require` は「処理中の検査に通ったか」として分ける。
  // 反例調査では `transitioned=false` の履歴も有用なので trace に残す。
  const whenOk = truthy(evalExpr(event.whenExpr, next, sessionIndex, args))
  let transitioned = false

  if (whenOk) {
    // `require` は複数書けるので all-pass 条件。
    // 1つでも失敗したら副作用 (`do`) と制御状態遷移 (`goto`) は実行しない。
    const requiresOk = event.requireExprs.every((expr) => truthy(evalExpr(expr, next, sessionIndex, args)))
    if (requiresOk) {
      for (const op of event.doOps) runOp(op, next, sessionIndex, args)
      if (event.gotoState) next.controlStates[sessionIndex] = event.gotoState
      transitioned = true
    }
  }

  // `last` は property から参照される「直前の観測値」。
  // invariant はこれを使って「Callback 直後なら state 一致しているか」等を書ける。
  next.last = {
    event: event.name,
    session: sessionIndex,
    transitioned,
    args: { ...args },
  }

  // trace は反例の可読性優先で append-only。
  // 各状態が trace 全体を持つためメモリは増えるが、bounded 探索前提の実装としては許容している。
  next.trace = [...next.trace, { step: next.step, session: sessionIndex, event: event.name, args: { ...args }, transitioned }]
  return next
}

function cloneRuntimeState(state: RuntimeState): RuntimeState {
  // `Set` を shallow copy すると枝間で共有されるので、store 単位で複製する。
  // `trace` の各要素は append 後に再変更しない前提のため、配列は shallow copy で十分。
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
  // store の値に mutable な `Set` が含まれ得るため、値単位で clone する。
  // string/number/bool/null は immutable なのでそのまま参照でよい。
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
  //
  // ここを strict にしている理由:
  // - compile 側は構文を受理しても意味を知らない式を通し得る
  // - engine 側で未対応命令を黙殺すると「検査できていないのに通った」ように見える
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
  // 書き込み時も `session.` 規約でスコープを振り分ける。
  // `Set` は参照共有を避けるため再度 clone して保存する。
  if (ref.startsWith("session.")) {
    state.sessions[sessionIndex][ref.slice("session.".length)] = value instanceof Set ? new Set(value) : value
    return
  }
  state.globals[ref] = value instanceof Set ? new Set(value) : value
}

function evalExpr(expr: Sexp, state: RuntimeState, sessionIndex: number, args: Record<string, Value> = {}): Value {
  // property/guard 共通の式評価器。
  // 「評価可能なものを増やす」よりも、「未対応をすぐ失敗させる」ことを優先している。
  // これは静かに誤解釈して偽陰性を出すより、安全側に倒すため。
  if (typeof expr === "boolean" || typeof expr === "number" || expr === null) return expr
  if (typeof expr === "string") return readRef(expr, state, sessionIndex, args)
  if (isSym(expr)) return expr.name
  if (!isList(expr) || expr.length === 0) return null

  // parser は quote 付き symbol を `isSym` にしているので、
  // ここに来る list は「関数適用風」の DSL 式だけを想定する。
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
    // `add` 自体は破壊的更新を行わず、新しい Set を返す純関数として扱う。
    // 実際の store 更新は `(set x (add x ...))` の `set` 側で行う。
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
    // `state` を直接 mutate するのは意図的で、同一枝の後続評価から同じ fresh を再利用させないため。
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
  //
  // この優先順位の狙い:
  // - `session.foo` / `last.*` は明示接頭辞で衝突回避
  // - event 引数と global の名前衝突時は「そのイベント呼び出しの文脈」を優先
  // - 未知の atom を文字列として返すことで、簡易 DSL の記述量を減らす
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
  // DSL の truthiness は JS に寄せつつ、Set だけは size ベースで明示化する。
  // (`Boolean(new Set()) === true` だが、空集合を false 扱いしたい)
  if (v instanceof Set) return v.size > 0
  return Boolean(v)
}

function deepEq(a: Value, b: Value): boolean {
  // `set string` のみ特別扱いし、それ以外は strict equality を使う。
  // Value に深い構造を増やす場合はここを拡張する。
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
  //
  // 重要なトレードオフ:
  // - `trace` はキーに含めない (経路差分で爆発するため)
  // - `freshSeq` は含める (fresh 生成結果に影響し、将来の到達状態を変え得るため)
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
  // JSON stringify 用の正規化:
  // - Set は順序非保証なので sort して配列化
  // - それ以外はそのまま
  // これにより `stableStateKey` の文字列が実行順に左右されにくくなる。
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(store)) {
    out[k] = v instanceof Set ? [...v].sort() : v
  }
  return out
}
