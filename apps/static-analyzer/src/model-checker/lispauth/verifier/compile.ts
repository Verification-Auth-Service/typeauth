import { isList, isSym, parseSyntax, sym } from "./parser"
import type { SyntaxNode } from "../shared/syntax-node"
import type { CompiledSpec, CounterexampleOptions, EventDef, InvariantDef, VarType } from "./types"

/**
 * lispauth DSL 文字列を model checker 実行用の `CompiledSpec` へ変換する。
 *
 * `parse` 後の構文木を正規化し、探索ロジックは `engine.ts` 側に分離する。
 *
 * @param source lispauth DSL テキスト。例:
 * `(spec Mini (machine ...) (env ...) (property ...))`
 * @returns 実行可能形式。例:
 * `{ name: "Mini", states: [...], vars: [...], events: [...], env: {...}, properties: {...} }`
 */
export function compileSpec(source: string): CompiledSpec {
  const root = parseSyntax(source)
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
  const chainEvents = machineNode
    .slice(1)
    .filter((x) => isList(x) && x[0] === "chain")
    .flatMap((chain, index) => compileChain(requireList(chain, "chain"), index))

  const env = compileEnv(envNode)
  const properties = compileProperties(propertyNode)

  return {
    name: root[1],
    states,
    vars,
    events: [...events, ...chainEvents],
    env,
    properties,
  }
}

function findBlock(parent: SyntaxNode, name: string): SyntaxNode[] {
  // top-level / machine / env / property は順不同で書けるように、名前検索にしている。
  if (!isList(parent)) throw new Error(`Expected list for block parent: ${name}`)
  const hit = parent.find((x) => isList(x) && x[0] === name)
  if (!hit || !isList(hit)) throw new Error(`Missing block: ${name}`)
  return hit
}

function requireList(x: SyntaxNode, label: string): SyntaxNode[] {
  if (!isList(x)) throw new Error(`Expected list: ${label}`)
  return x
}

function asString(x: SyntaxNode): string {
  if (typeof x !== "string") throw new Error(`Expected string atom, got ${JSON.stringify(x)}`)
  return x
}

/**
 * `(varName varType)` 形式をコンパイルする。
 *
 * @param node 例: `["session.stage", ["enum", "Start", "Done"]]`
 * @returns 例: `{ name: "session.stage", type: { kind: "enum", values: ["Start", "Done"] } }`
 */
function compileVar(node: SyntaxNode[]): { name: string; type: VarType } {
  // vars は `(session.state (maybe string))` のような 2 要素形式。
  // ここで型だけ解釈し、スコープ (`session.` / global) は engine 側で初期化時に見る。
  if (node.length !== 2 || typeof node[0] !== "string") throw new Error(`Invalid var: ${JSON.stringify(node)}`)
  return { name: node[0], type: compileType(node[1]) }
}

/**
 * DSL 型ノードを `VarType` に変換する。
 *
 * @param node 例: `"int"` / `["maybe", "string"]` / `["enum", "Start", "Done"]`
 * @returns 例: `{ kind: "int" }` / `{ kind: "maybe", inner: "string" }`
 */
function compileType(node: SyntaxNode): VarType {
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
 * `(event ...)` ノードを `EventDef` に変換する。
 *
 * @param node 例: `["event", "Callback", [["code", "string"]], ["when", ...], ...]`
 * @returns 例: `{ name, params, whenExpr, requireExprs, doOps, gotoState }`
 */
function compileEvent(node: SyntaxNode[]): EventDef {
  // event の本文は DSL 的には宣言順をある程度自由にしている。
  // compile 後は `when / require* / do / goto` に集約し、評価順序をエンジン側で固定する。
  const name = asString(node[1])
  const paramsNode = requireList(node[2], `${name}.params`)
  const params = paramsNode.map((p) => {
    const l = requireList(p, `${name}.param`)
    return { name: asString(l[0]), type: asString(l[1]) }
  })

  let whenExpr: SyntaxNode = true
  const requireExprs: SyntaxNode[] = []
  let doOps: SyntaxNode[] = []
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

function compileChain(node: SyntaxNode[], chainIndex: number): EventDef[] {
  if (node.slice(1).every(isList)) {
    return node.slice(1).map((segment, index) => compileNamedChainSegment(requireList(segment, "chain.segment"), chainIndex, index))
  }

  const states = node
    .slice(1)
    .filter((part) => part !== "->")
    .map((part) => asQuotedOrString(part))
  if (states.length < 2) throw new Error(`chain requires at least 2 states: ${JSON.stringify(node)}`)

  const out: EventDef[] = []
  for (let i = 0; i < states.length - 1; i += 1) {
    const from = states[i]
    const to = states[i + 1]
    out.push({
      name: `Chain${chainIndex + 1}_${i + 1}_${from}_to_${to}`,
      params: [],
      whenExpr: ["=", "session.stage", sym(from)],
      requireExprs: [],
      doOps: [["set", "session.stage", sym(to)]],
      gotoState: to,
    })
  }

  return out
}

function compileNamedChainSegment(node: SyntaxNode[], chainIndex: number, segmentIndex: number): EventDef {
  if (node.length < 3) throw new Error(`chain segment requires name/from/to: ${JSON.stringify(node)}`)

  const name = asString(node[0])
  const states = node
    .slice(1)
    .filter((part) => part !== "->")
    .map((part) => asQuotedOrString(part))
  if (states.length !== 2) throw new Error(`chain segment requires exactly 2 states: ${JSON.stringify(node)}`)

  return {
    name: name || `Chain${chainIndex + 1}_${segmentIndex + 1}_${states[0]}_to_${states[1]}`,
    params: [],
    whenExpr: ["=", "session.stage", sym(states[0])],
    requireExprs: [],
    doOps: [["set", "session.stage", sym(states[1])]],
    gotoState: states[1],
  }
}

function asQuotedOrString(x: SyntaxNode): string {
  if (typeof x === "string") return x
  if (isSym(x)) return x.name
  throw new Error(`Expected symbol/string: ${JSON.stringify(x)}`)
}

/**
 * `(env ...)` ブロックをコンパイルする。
 *
 * @param node 例: `["env", ["sessions", 2], ["time", ["max-steps", 8], ["tick", 1]]]`
 * @returns 例: `{ sessions: 2, maxSteps: 8, tick: 1, allowDuplicate: false, ... }`
 */
function compileEnv(node: SyntaxNode[]) {
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
 * `(property ...)` ブロックをコンパイルする。
 *
 * @param node 例: `["property", ["invariant", "name", expr], ["counterexample", ...]]`
 * @returns 例: `{ invariants: [{ name, expr }], counterexample: { minimizeSteps: true } }`
 */
function compileProperties(node: SyntaxNode[]) {
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
