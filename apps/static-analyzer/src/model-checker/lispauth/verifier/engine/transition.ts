import { isList } from "../parser"
import type { SyntaxNode } from "../../shared/syntax-node"
import type { CompiledSpec, EventDef, RuntimeState, Value } from "../types"
import { evalExpr, truthy } from "./expr"
import { cloneRuntimeState } from "./state"

export function generateNextStates(spec: CompiledSpec, state: RuntimeState): RuntimeState[] {
  const out: RuntimeState[] = []
  const stringDomains = buildStringDomains(spec, state)
  const argOptionsCache = new Map<string, Array<Record<string, Value>>>()

  for (let sessionIndex = 0; sessionIndex < spec.env.sessions; sessionIndex += 1) {
    for (const event of spec.events) {
      const cacheKey = `${sessionIndex}:${event.name}`
      const argOptions = argOptionsCache.get(cacheKey) ?? enumerateArgs(event, stringDomains[sessionIndex])
      argOptionsCache.set(cacheKey, argOptions)
      for (const args of argOptions) {
        out.push(applyEvent(spec, state, sessionIndex, event, args))
      }
    }
  }
  return out
}

function enumerateArgs(event: EventDef, domainStrings: string[]): Array<Record<string, Value>> {
  if (!event.params.length) return [{}]

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

function buildStringDomains(spec: CompiledSpec, state: RuntimeState): string[][] {
  const shared = new Set<string>()
  const seed = ["attacker", "code-1", "code-2", "state-1", "state-2", "verifier-1", "verifier-2"]
  for (const value of seed) shared.add(value)

  for (const value of Object.values(state.globals)) collectStringsFromValue(value, shared)
  for (let trace = state.traceTail; trace; trace = trace.prev) {
    for (const value of Object.values(trace.args)) collectStringsFromValue(value, shared)
  }

  if (spec.env.allowCrossDelivery) {
    for (const session of state.sessions) {
      for (const value of Object.values(session)) collectStringsFromValue(value, shared)
    }
    const domain = [...shared]
    return state.sessions.map(() => domain)
  }

  return state.sessions.map((session) => {
    const domain = new Set(shared)
    for (const value of Object.values(session)) collectStringsFromValue(value, domain)
    return [...domain]
  })
}

function collectStringsFromValue(value: Value, out: Set<string>): void {
  if (typeof value === "string") out.add(value)
  if (value instanceof Set) {
    for (const x of value) out.add(x)
  }
}

function applyEvent(spec: CompiledSpec, state: RuntimeState, sessionIndex: number, event: EventDef, args: Record<string, Value>): RuntimeState {
  const next = cloneRuntimeState(state)
  let sessionCloned = false

  const ensureSessionCloned = () => {
    if (sessionCloned) return
    next.sessions[sessionIndex] = cloneStore(next.sessions[sessionIndex] ?? {})
    sessionCloned = true
  }

  next.step += 1
  next.now += spec.env.tick
  next.globals.now = next.now

  const whenOk = truthy(evalExpr(event.whenExpr, next, sessionIndex, args))
  let transitioned = false

  if (whenOk) {
    const requiresOk = event.requireExprs.every((expr) => truthy(evalExpr(expr, next, sessionIndex, args)))
    if (requiresOk) {
      for (const op of event.doOps) runOp(op, next, sessionIndex, args, ensureSessionCloned)
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
  next.traceTail = {
    step: next.step,
    session: sessionIndex,
    event: event.name,
    args: { ...args },
    transitioned,
    prev: state.traceTail,
  }

  return next
}

function runOp(
  op: SyntaxNode,
  state: RuntimeState,
  sessionIndex: number,
  args: Record<string, Value>,
  ensureSessionCloned: () => void,
) {
  if (!isList(op) || typeof op[0] !== "string") return
  if (op[0] === "noop") return
  if (op[0] === "set") {
    const target = op[1]
    if (typeof target !== "string") throw new Error(`set target must be symbol-like atom: ${JSON.stringify(op)}`)
    const value = evalExpr(op[2], state, sessionIndex, args)
    setRef(target, value, state, sessionIndex, ensureSessionCloned)
    return
  }
  throw new Error(`Unsupported op: ${JSON.stringify(op)}`)
}

function setRef(ref: string, value: Value, state: RuntimeState, sessionIndex: number, ensureSessionCloned: () => void) {
  if (ref.startsWith("session.")) {
    ensureSessionCloned()
    state.sessions[sessionIndex][ref.slice("session.".length)] = value instanceof Set ? new Set(value) : value
    return
  }
  state.globals[ref] = value instanceof Set ? new Set(value) : value
}

function cloneStore<T extends Record<string, Value>>(s: T): T {
  const out = {} as T
  for (const [key, value] of Object.entries(s)) {
    out[key as keyof T] = (value instanceof Set ? new Set(value) : value) as T[keyof T]
  }
  return out
}
