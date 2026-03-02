import { isList } from "../parser"
import type { SyntaxNode } from "../../shared/syntax-node"
import type { CompiledSpec, EventDef, RuntimeState, Value } from "../types"
import { evalExpr, truthy } from "./expr"
import { cloneRuntimeState } from "./state"

export function generateNextStates(spec: CompiledSpec, state: RuntimeState): RuntimeState[] {
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

  const domainStrings = collectStringDomain(spec, state, targetSession)
  const domains = event.params.map((param) => {
    if (param.type === "string") return domainStrings
    return [null]
  })

  const results: Array<Record<string, Value>> = []
  const recur = (idx: number, acc: Record<string, Value>) => {
    if (idx >= event.params.length) {
      results.push({ ...acc })
      return
    }
    const param = event.params[idx]
    for (const value of domains[idx]) {
      acc[param.name] = value
      recur(idx + 1, acc)
    }
  }

  recur(0, {})
  return results
}

function collectStringDomain(spec: CompiledSpec, state: RuntimeState, targetSession: number): string[] {
  const set = new Set<string>()
  const seed = ["attacker", "code-1", "code-2", "state-1", "state-2", "verifier-1", "verifier-2"]
  for (const value of seed) set.add(value)

  const sessionsToRead = spec.env.allowCrossDelivery ? state.sessions : [state.sessions[targetSession]]
  for (const session of sessionsToRead) {
    for (const value of Object.values(session)) collectStringsFromValue(value, set)
  }
  for (const value of Object.values(state.globals)) collectStringsFromValue(value, set)
  for (const trace of state.trace) {
    for (const value of Object.values(trace.args)) collectStringsFromValue(value, set)
  }

  return [...set]
}

function collectStringsFromValue(value: Value, out: Set<string>): void {
  if (typeof value === "string") out.add(value)
  if (value instanceof Set) {
    for (const x of value) out.add(x)
  }
}

function applyEvent(spec: CompiledSpec, state: RuntimeState, sessionIndex: number, event: EventDef, args: Record<string, Value>): RuntimeState {
  const next = cloneRuntimeState(state)

  next.step += 1
  next.now += spec.env.tick
  next.globals.now = next.now

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

function runOp(op: SyntaxNode, state: RuntimeState, sessionIndex: number, args: Record<string, Value>) {
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
