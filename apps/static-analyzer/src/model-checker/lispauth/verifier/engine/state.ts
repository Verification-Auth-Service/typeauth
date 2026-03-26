import type { CompiledSpec, RuntimeState, TraceStep, Value } from "../types"

export function createInitialState(spec: CompiledSpec): RuntimeState {
  const sessions = []
  const globals: RuntimeState["globals"] = {}
  const controlStates: string[] = []

  for (let i = 0; i < spec.env.sessions; i += 1) {
    const store: RuntimeState["sessions"][number] = {}
    for (const variable of spec.vars) {
      if (variable.name.startsWith("session.")) {
        store[variable.name.slice("session.".length)] = initialValue(variable.type)
      }
    }
    sessions.push(store)
    controlStates.push(spec.states[0] ?? "")
  }

  for (const variable of spec.vars) {
    if (!variable.name.startsWith("session.")) globals[variable.name] = initialValue(variable.type)
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
    traceTail: null,
  }
}

export function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return {
    step: state.step,
    now: state.now,
    sessions: [...state.sessions],
    globals: { ...state.globals },
    controlStates: [...state.controlStates],
    freshSeq: state.freshSeq,
    last: {
      event: state.last.event,
      session: state.last.session,
      transitioned: state.last.transitioned,
      args: { ...state.last.args },
    },
    traceTail: state.traceTail,
  }
}

export function materializeTrace(state: RuntimeState): TraceStep[] {
  const out: TraceStep[] = []
  for (let node = state.traceTail; node; node = node.prev) out.push(node)
  out.reverse()
  return out
}

export function stableStateKey(state: RuntimeState): string {
  return JSON.stringify({
    now: state.now,
    sessions: state.sessions.map((session) => storeToJson(session)),
    globals: storeToJson(state.globals),
    controlStates: state.controlStates,
    freshSeq: state.freshSeq,
    last: {
      ...state.last,
      args: storeToJson(state.last.args as Record<string, Value>),
    },
  })
}

function initialValue(type: CompiledSpec["vars"][number]["type"]): Value {
  if (type.kind === "maybe") return null
  if (type.kind === "enum") return type.values[0] ?? ""
  if (type.kind === "set") return new Set<string>()
  if (type.kind === "int") return 0
  if (type.kind === "bool") return false
  return ""
}

function cloneStore<T extends Record<string, Value>>(s: T): T {
  const out = {} as T
  for (const [key, value] of Object.entries(s)) {
    out[key as keyof T] = (value instanceof Set ? new Set(value) : value) as T[keyof T]
  }
  return out
}

function storeToJson(store: Record<string, Value>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(store)) {
    out[key] = value instanceof Set ? [...value].sort() : value
  }
  return out
}
