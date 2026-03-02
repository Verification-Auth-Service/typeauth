import { q } from "../builder"
import type { LispauthSpecDraft } from "../types"
import type { OauthReport, StateReport } from "./context"
import type { ObservedOauthSignals } from "./analysis"
import { resolveOauthEndpoints } from "./endpoint-resolver"
import { slugForSpecAtom } from "./naming"

export type MachineFromStateResult = {
  machine: LispauthSpecDraft["machine"]
  eventEndpoints: Array<{ event: string; endpoints: string[] }>
}

export function buildMachineFromStateTransitions(
  state: StateReport,
  oauth: OauthReport,
  signals: ObservedOauthSignals,
  frameworkEndpointsByFunction?: Map<string, string[]>,
): MachineFromStateResult {
  const primary = selectPrimaryTransitionFunction(state, oauth)
  if (!primary) return buildFallbackOauthMachine(signals)

  const endpointByEvent = resolveOauthEndpoints(oauth).byEventKey
  const stateNameByNodeId = new Map<string, string>()
  const usedStateNames = new Set<string>()
  const usedEventNames = new Set<string>()

  for (const node of primary.nodes) {
    const suggested =
      node.kind === "start"
        ? "Start"
        : node.kind === "end"
          ? "End"
          : `S${(node.eventIndex ?? 0) + 1}_${slugForSpecAtom(node.eventKind ?? "event")}`
    stateNameByNodeId.set(node.id, uniqueName(suggested, usedStateNames))
  }

  const states = primary.nodes
    .map((node) => stateNameByNodeId.get(node.id))
    .filter((name): name is string => !!name)

  const events: LispauthSpecDraft["machine"]["events"] = []
  const eventEndpoints: Array<{ event: string; endpoints: string[] }> = []
  const seenEdge = new Set<string>()

  for (const edge of primary.edges) {
    const fromState = stateNameByNodeId.get(edge.from)
    const toState = stateNameByNodeId.get(edge.to)
    if (!fromState || !toState) continue

    const edgeKey = `${edge.kind}::${fromState}::${toState}::${edge.eventIndex ?? "none"}`
    if (seenEdge.has(edgeKey)) continue
    seenEdge.add(edgeKey)

    const eventName = uniqueName(
      `${edge.kind === "terminal" ? "Terminal" : "Step"}_${fromState}_to_${toState}`,
      usedEventNames,
    )

    events.push({
      name: eventName,
      params: [],
      when: ["=", "session.stage", q(fromState)],
      do: [
        ...(signals.hasStateParam && fromState === "Start" && toState !== "Start"
          ? [["set", "session.state", ["fresh", "state"]]]
          : []),
        ...(signals.hasPkce && fromState === "Start" && toState !== "Start"
          ? [["set", "session.verifier", ["fresh", "verifier"]]]
          : []),
        ["set", "session.stage", q(toState)],
      ],
      goto: toState,
    })

    const eventKey = edge.eventIndex === undefined ? undefined : `${primary.file}::${primary.functionId}::${edge.eventIndex}`
    const fromOauth = eventKey ? endpointByEvent.get(eventKey) ?? [] : []
    const fromFramework = frameworkEndpointsByFunction?.get(`${primary.file}::${primary.functionId}`) ?? []
    const endpoints = [...new Set([...fromOauth, ...fromFramework])].sort()
    if (endpoints.length > 0) eventEndpoints.push({ event: eventName, endpoints })
  }

  if (events.length === 0 && states.length >= 2) {
    const [startState, endState] = states
    if (startState && endState) {
      events.push({
        name: "Step_Start_to_End",
        params: [],
        when: ["=", "session.stage", q(startState)],
        do: [
          ...(signals.hasStateParam && startState === "Start" && endState !== "Start"
            ? [["set", "session.state", ["fresh", "state"]]]
            : []),
          ...(signals.hasPkce && startState === "Start" && endState !== "Start"
            ? [["set", "session.verifier", ["fresh", "verifier"]]]
            : []),
          ["set", "session.stage", q(endState)],
        ],
        goto: endState,
      })
    }
  }

  return {
    machine: {
      states,
      vars: [
        { name: "session.state", type: ["maybe", "string"] },
        { name: "session.verifier", type: ["maybe", "string"] },
        { name: "session.stage", type: ["enum", ...states] },
        { name: "used-codes", type: ["set", "string"] },
        { name: "now", type: "int" },
      ],
      events,
    },
    eventEndpoints: compactEventEndpoints(eventEndpoints),
  }
}

function buildFallbackOauthMachine(signals: ObservedOauthSignals): MachineFromStateResult {
  const machine: LispauthSpecDraft["machine"] = {
    states: ["Start", "AuthStarted", "CodeReceived", "TokenIssued", "LoggedOut"],
    vars: [
      { name: "session.state", type: ["maybe", "string"] },
      { name: "session.verifier", type: ["maybe", "string"] },
      { name: "session.stage", type: ["enum", "Start", "AuthStarted", "CodeReceived", "TokenIssued", "LoggedOut"] },
      { name: "used-codes", type: ["set", "string"] },
      { name: "now", type: "int" },
    ],
    events: [
      {
        name: "BeginAuth",
        params: [],
        when: ["or", ["=", "session.stage", q("Start")], ["=", "session.stage", q("LoggedOut")]],
        do: [
          ["set", "session.state", ["fresh", "state"]],
          ["set", "session.verifier", ["fresh", "verifier"]],
          ["set", "session.stage", q("AuthStarted")],
        ],
        goto: "AuthStarted",
      },
      {
        name: "Callback",
        params: [
          { name: "code", type: "string" },
          { name: "state", type: "string" },
        ],
        when: ["=", "session.stage", q("AuthStarted")],
        require: signals.hasStateParam ? [["=", "state", "session.state"]] : [],
        do: [["set", "session.stage", q("CodeReceived")]],
        goto: "CodeReceived",
      },
      {
        name: "ExchangeToken",
        params: [
          { name: "code", type: "string" },
          { name: "verifier", type: "string" },
        ],
        when: ["=", "session.stage", q("CodeReceived")],
        require: [
          ...(signals.hasPkce ? [["=", "verifier", "session.verifier"]] : []),
          ["not", ["in", "code", "used-codes"]],
        ],
        do: [
          ["set", "used-codes", ["add", "used-codes", "code"]],
          ["set", "session.stage", q("TokenIssued")],
        ],
        goto: "TokenIssued",
      },
      {
        name: "Logout",
        params: [],
        when: true,
        do: [["set", "session.stage", q("LoggedOut")]],
        goto: "LoggedOut",
      },
    ],
  }
  return { machine, eventEndpoints: [] }
}

function selectPrimaryTransitionFunction(state: StateReport, oauth: OauthReport) {
  if (state.functions.length === 0) return undefined

  const oauthFunctionKeys = new Set<string>([
    ...oauth.oauthLikeFlows.map((x) => `${x.file}::${x.functionId}`),
    ...oauth.redirects.map((x) => `${x.file}::${x.functionId}`),
    ...oauth.urlParamSets.map((x) => `${x.file}::${x.functionId}`),
  ])

  const oauthCandidates = state.functions.filter((fn) => oauthFunctionKeys.has(`${fn.file}::${fn.functionId}`))
  const candidates = oauthCandidates.length > 0 ? oauthCandidates : state.functions

  return [...candidates].sort((a, b) => {
    if (b.summary.eventCount !== a.summary.eventCount) return b.summary.eventCount - a.summary.eventCount
    if (b.summary.terminalTransitionCount !== a.summary.terminalTransitionCount) {
      return b.summary.terminalTransitionCount - a.summary.terminalTransitionCount
    }
    return a.functionId.localeCompare(b.functionId)
  })[0]
}

function compactEventEndpoints(rows: Array<{ event: string; endpoints: string[] }>): Array<{ event: string; endpoints: string[] }> {
  const merged = new Map<string, Set<string>>()
  for (const row of rows) {
    const current = merged.get(row.event) ?? new Set<string>()
    for (const endpoint of row.endpoints) current.add(endpoint)
    merged.set(row.event, current)
  }

  return [...merged.entries()]
    .map(([event, endpoints]) => ({ event, endpoints: [...endpoints].sort() }))
    .sort((a, b) => a.event.localeCompare(b.event))
}

function uniqueName(base: string, used: Set<string>): string {
  const normalized = slugForSpecAtom(base) || "Item"
  if (!used.has(normalized)) {
    used.add(normalized)
    return normalized
  }

  let seq = 2
  while (used.has(`${normalized}_${seq}`)) seq += 1
  const unique = `${normalized}_${seq}`
  used.add(unique)
  return unique
}
