import { isList, isSym, parseSexp } from "./parser"
import type { CompiledSpec, CounterexampleOptions, EventDef, InvariantDef, Sexp, VarType } from "./types"

// 文字列 DSL -> 検証エンジン用の内部表現へ変換する。
// 役割は「構文木の正規化」であり、探索ロジックや意味評価は engine.ts に持ち込まない。
/**
 * 入力例: `compileSpec("(spec (vars) (machine) (property))")`
 * 成果物: DSL ASTを model checker 用 `CompiledSpec` へ変換して返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
export function compileSpec(source: string): CompiledSpec {
  const root = parseSexp(source)
  if (!isList(root) || root.length < 2 || root[0] !== "spec" || typeof root[1] !== "string") {
    throw new Error("Root must be (spec Name ...)")
  }

  const machineNode = findBlock(root, "machine")
  const envNode = findBlock(root, "env")
  const propertyNode = findBlock(root, "property")

  const statesNode = requireList(findBlock(machineNode, "states"), "machine.states")
  const states = statesNode.slice(1).map(asString)

  const varsNode = requireList(findBlock(machineNode, "vars"), "machine.vars")
  const vars = varsNode.slice(1).map((v) => compileVar(requireList(v, "var")))

  const events = machineNode
    .slice(1)
    .filter((x) => isList(x) && x[0] === "event")
    .map((e) => compileEvent(requireList(e, "event")))

  const env = compileEnv(envNode)
  const properties = compileProperties(propertyNode)

  return {
    name: root[1],
    states,
    vars,
    events,
    env,
    properties,
  }
}

/**
 * 入力例: `findBlock(["spec"], "state")`
 * 成果物: 0件以上の要素を含む配列を返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
function findBlock(parent: Sexp, name: string): Sexp[] {
  // top-level / machine / env / property は順不同で書けるように、名前検索にしている。
  if (!isList(parent)) throw new Error(`Expected list for block parent: ${name}`)
  const hit = parent.find((x) => isList(x) && x[0] === name)
  if (!hit || !isList(hit)) throw new Error(`Missing block: ${name}`)
  return hit
}

/**
 * 入力例: `requireList(["spec"], "state")`
 * 成果物: 0件以上の要素を含む配列を返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
function requireList(x: Sexp, label: string): Sexp[] {
  if (!isList(x)) throw new Error(`Expected list: ${label}`)
  return x
}

/**
 * 入力例: `asString(["spec"])`
 * 成果物: 整形・正規化後の文字列を返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
function asString(x: Sexp): string {
  if (typeof x !== "string") throw new Error(`Expected string atom, got ${JSON.stringify(x)}`)
  return x
}

/**
 * 入力例: `compileVar([])`
 * 成果物: 整形・正規化後の文字列を返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
function compileVar(node: Sexp[]): { name: string; type: VarType } {
  // vars は `(session.state (maybe string))` のような 2 要素形式。
  // ここで型だけ解釈し、スコープ (`session.` / global) は engine 側で初期化時に見る。
  if (node.length !== 2 || typeof node[0] !== "string") throw new Error(`Invalid var: ${JSON.stringify(node)}`)
  return { name: node[0], type: compileType(node[1]) }
}

/**
 * 入力例: `compileType(["spec"])`
 * 成果物: 処理結果オブジェクトを返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
function compileType(node: Sexp): VarType {
  if (typeof node === "string") {
    if (node === "int") return { kind: "int" }
    if (node === "string") return { kind: "string" }
    if (node === "bool") return { kind: "bool" }
  }
  if (!isList(node) || typeof node[0] !== "string") throw new Error(`Invalid type: ${JSON.stringify(node)}`)
  if (node[0] === "maybe" && typeof node[1] === "string") return { kind: "maybe", inner: node[1] }
  if (node[0] === "set" && typeof node[1] === "string") return { kind: "set", inner: node[1] }
  if (node[0] === "enum") return { kind: "enum", values: node.slice(1).map(asString) }
  throw new Error(`Unsupported type: ${JSON.stringify(node)}`)
}

/**
 * 入力例: `compileEvent([])`
 * 成果物: 1イベント定義を `EventDef` 形式へコンパイルして返す。
 */
function compileEvent(node: Sexp[]): EventDef {
  // event の本文は DSL 的には宣言順をある程度自由にしている。
  // compile 後は `when / require* / do / goto` に集約し、評価順序をエンジン側で固定する。
  const name = asString(node[1])
  const paramsNode = requireList(node[2], `${name}.params`)
  const params = paramsNode.map((p) => {
    const l = requireList(p, `${name}.param`)
    return { name: asString(l[0]), type: asString(l[1]) }
  })

  let whenExpr: Sexp = true
  const requireExprs: Sexp[] = []
  let doOps: Sexp[] = []
  let gotoState: string | undefined

  for (const part of node.slice(3)) {
    if (!isList(part) || typeof part[0] !== "string") continue
    if (part[0] === "when") whenExpr = part[1] ?? true
    if (part[0] === "require") requireExprs.push(part[1] ?? true)
    if (part[0] === "do") doOps = part.slice(1)
    if (part[0] === "goto") gotoState = asQuotedOrString(part[1])
  }

  return { name, params, whenExpr, requireExprs, doOps, gotoState }
}

/**
 * 入力例: `asQuotedOrString(["spec"])`
 * 成果物: 整形・正規化後の文字列を返す。 失敗時: 不正入力や不整合を検出した場合は例外を送出する。
 */
function asQuotedOrString(x: Sexp): string {
  if (typeof x === "string") return x
  if (isSym(x)) return x.name
  throw new Error(`Expected symbol/string: ${JSON.stringify(x)}`)
}

/**
 * 入力例: `compileEnv([])`
 * 成果物: `op/require` ブロックを実行可能形式へ変換して返す。
 */
function compileEnv(node: Sexp[]) {
  // env は「最悪スケジューラの探索境界」を与える。
  // 現時点では `allow duplicate/reorder` はフラグ保持のみで、engine の探索は常に worst-case 寄り。
  let sessions = 1
  let maxSteps = 10
  let tick = 1
  let allowDuplicate = false
  let allowReorder = false
  let allowCrossDelivery = false

  for (const part of node.slice(1)) {
    if (!isList(part) || typeof part[0] !== "string") continue
    if (part[0] === "allow" && typeof part[1] === "string") {
      if (part[1] === "duplicate") allowDuplicate = true
      if (part[1] === "reorder") allowReorder = true
      if (part[1] === "cross-delivery") allowCrossDelivery = true
    }
    if (part[0] === "sessions" && typeof part[1] === "number") sessions = part[1]
    if (part[0] === "time") {
      for (const t of part.slice(1)) {
        if (!isList(t) || typeof t[0] !== "string") continue
        if (t[0] === "max-steps" && typeof t[1] === "number") maxSteps = t[1]
        if (t[0] === "tick" && typeof t[1] === "number") tick = t[1]
      }
    }
  }

  return { sessions, maxSteps, tick, allowDuplicate, allowReorder, allowCrossDelivery }
}

/**
 * 入力例: `compileProperties([])`
 * 成果物: invariant 群を `properties.invariants` へ変換して返す。
 */
function compileProperties(node: Sexp[]) {
  // property は将来的に safety/liveness を分けられるように独立関数化している。
  // 現状は invariant + counterexample の最小セットのみ対応。
  const invariants: InvariantDef[] = []
  let counterexample: CounterexampleOptions = { minimizeSteps: false }

  for (const part of node.slice(1)) {
    if (!isList(part) || typeof part[0] !== "string") continue
    if (part[0] === "invariant") {
      invariants.push({
        name: asString(part[1]),
        expr: part[2] ?? true,
      })
    }
    if (part[0] === "counterexample") {
      const out: CounterexampleOptions = { minimizeSteps: false }
      for (const p of part.slice(1)) {
        if (!isList(p) || typeof p[0] !== "string") continue
        if (p[0] === "format" && typeof p[1] === "string") out.format = p[1]
        if (p[0] === "minimize" && typeof p[1] === "string" && p[1] === "steps") out.minimizeSteps = true
      }
      counterexample = out
    }
  }

  return { invariants, counterexample }
}
