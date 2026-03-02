import { isList, isSym } from "../parser"
import type { SyntaxNode } from "../../shared/syntax-node"
import type { RuntimeState, Value } from "../types"

export function evalExpr(expr: SyntaxNode, state: RuntimeState, sessionIndex: number, args: Record<string, Value> = {}): Value {
  if (typeof expr === "boolean" || typeof expr === "number" || expr === null) return expr
  if (typeof expr === "string") return readRef(expr, state, sessionIndex, args)
  if (isSym(expr)) return expr.name
  if (!isList(expr) || expr.length === 0) return null

  const head = expr[0]
  if (head === "=") return deepEq(evalExpr(expr[1], state, sessionIndex, args), evalExpr(expr[2], state, sessionIndex, args))
  if (head === "and") return expr.slice(1).every((node) => truthy(evalExpr(node, state, sessionIndex, args)))
  if (head === "or") return expr.slice(1).some((node) => truthy(evalExpr(node, state, sessionIndex, args)))
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
    const prefix = evalExpr(expr[1], state, sessionIndex, args)
    if (typeof prefix !== "string") throw new Error("fresh prefix must be string")
    state.freshSeq += 1
    return `${prefix}-${state.freshSeq}`
  }

  throw new Error(`Unsupported expr: ${JSON.stringify(expr)}`)
}

export function truthy(v: Value): boolean {
  if (v instanceof Set) return v.size > 0
  return Boolean(v)
}

export function deepEq(a: Value, b: Value): boolean {
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false
    for (const x of a) {
      if (!b.has(x)) return false
    }
    return true
  }
  return a === b
}

function readRef(ref: string, state: RuntimeState, sessionIndex: number, args: Record<string, Value>): Value {
  if (ref.startsWith("session.")) return state.sessions[sessionIndex][ref.slice("session.".length)] ?? null
  if (ref.startsWith("last.args.")) return state.last.args[ref.slice("last.args.".length)] ?? null
  if (ref === "last.event") return state.last.event
  if (ref === "last.transitioned") return state.last.transitioned
  if (ref === "last.session") return state.last.session ?? -1
  if (ref in args) return args[ref]
  if (ref in state.globals) return state.globals[ref]
  return ref
}
