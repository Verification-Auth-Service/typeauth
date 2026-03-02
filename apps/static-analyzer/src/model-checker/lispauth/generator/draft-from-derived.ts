import path from "node:path"
import type { deriveFrameworkReports } from "../../../framework/report"
import type { deriveOauthReport } from "../../../oauth/report"
import type { deriveStateTransitionReport } from "../../../state/report"
import type { AnalysisReport } from "../../../types/report"
import { q } from "./builder"
import type { SyntaxNode } from "../shared/syntax-node"
import type { LispauthSpecDraft } from "./types"

export type BuildLispauthDraftFromDerivedReportsArgs = {
  report: AnalysisReport
  framework: ReturnType<typeof deriveFrameworkReports>
  oauth: ReturnType<typeof deriveOauthReport>
  state: ReturnType<typeof deriveStateTransitionReport>
}

export type LispauthDraftUnit = {
  unitType: "project" | "http-endpoint"
  unitId: string
  label: string
  draft: LispauthSpecDraft
}

export function buildLispauthDraftFromDerivedReports(args: BuildLispauthDraftFromDerivedReportsArgs): LispauthSpecDraft {
  const { report, framework, oauth, state } = args

  const specName = buildSpecName(report, framework, oauth)
  const observedSignals = inferObservedOauthSignals(oauth)
  const explorationProfile = inferExplorationProfile(oauth, state)
  const endpointCatalog = buildEndpointCatalog(oauth)
  const machineResult = buildMachineFromStateTransitions(state, oauth, observedSignals)

  return {
    name: specName,
    machine: machineResult.machine,
    http: {
      endpoints: endpointCatalog.endpoints,
      eventEndpoints: machineResult.eventEndpoints,
    },
    env: {
      scheduler: "worst",
      allow: explorationProfile.allowFlags,
      sessions: explorationProfile.sessionCount,
      time: { maxSteps: explorationProfile.maxSteps, tick: 1 },
    },
    property: {
      invariants: buildDefaultInvariants(machineResult.machine, observedSignals, explorationProfile),
      counterexample: { format: "trace", minimize: "steps" },
    },
  }
}

export function buildLispauthDraftUnitsFromDerivedReports(
  args: BuildLispauthDraftFromDerivedReportsArgs,
): LispauthDraftUnit[] {
  const base = buildLispauthDraftFromDerivedReports(args)
  const projects = buildProjectUnits(base, args.report)
  const endpoints = buildHttpEndpointUnits(base, args.oauth)
  return [...projects, ...endpoints]
}

function buildSpecName(
  report: AnalysisReport,
  framework: ReturnType<typeof deriveFrameworkReports>,
  oauth: ReturnType<typeof deriveOauthReport>,
): string {
  const entryBase = path.basename(report.entry, path.extname(report.entry))
  const topOauthFlow = oauth.oauthLikeFlows[0]
  const topFnBase = topOauthFlow?.functionName ? slugForSpecAtom(topOauthFlow.functionName) : undefined
  const frameworkTag = framework.summary.detectedFrameworks[0] ? slugForSpecAtom(framework.summary.detectedFrameworks[0]) : undefined

  return [frameworkTag, "OAuthPKCE", (topFnBase ?? entryBase) || "entry"].filter(Boolean).join("_")
}

function buildProjectUnits(base: LispauthSpecDraft, report: AnalysisReport): LispauthDraftUnit[] {
  const roles: Array<{ role: string; entry: string }> = []
  if (report.entries?.client) roles.push({ role: "client", entry: report.entries.client })
  if (report.entries?.resourceServer) roles.push({ role: "resource-server", entry: report.entries.resourceServer })
  if (report.entries?.tokenServer) roles.push({ role: "token-server", entry: report.entries.tokenServer })

  if (roles.length === 0) roles.push({ role: "entry", entry: report.entry })

  return roles.map((x) => ({
    unitType: "project" as const,
    unitId: `project-${slugForSpecAtom(path.basename(x.entry, path.extname(x.entry))).toLowerCase() || "entry"}-${x.role}`,
    label: `${x.role}: ${x.entry}`,
    draft: {
      ...base,
      name: `${base.name}__${slugForSpecAtom(x.role)}`,
    },
  }))
}

function buildHttpEndpointUnits(
  base: LispauthSpecDraft,
  oauth: ReturnType<typeof deriveOauthReport>,
): LispauthDraftUnit[] {
  const candidates = new Set<string>()
  for (const r of oauth.redirects) {
    if (r.target) candidates.add(r.target)
  }
  for (const flow of oauth.oauthLikeFlows) {
    for (const target of flow.redirectTargets) candidates.add(target)
    candidates.add(flow.urlExpr)
  }

  const normalized = [...candidates]
    .map(normalizeEndpoint)
    .filter((x): x is string => !!x)

  const unique = [...new Set(normalized)]
  return unique.map((endpoint) => ({
    unitType: "http-endpoint" as const,
    unitId: `endpoint-${slugForSpecAtom(endpoint).toLowerCase() || "unknown"}`,
    label: endpoint,
    draft: {
      ...base,
      name: `${base.name}__${slugForSpecAtom(endpoint)}`,
      http: {
        focusEndpoint: endpoint,
        endpoints: [endpoint],
        eventEndpoints: (base.http?.eventEndpoints ?? []).filter((x) => x.endpoints.includes(endpoint)),
      },
    },
  }))
}

function normalizeEndpoint(raw: string): string | undefined {
  let text = raw.trim()
  text = text.replace(/^['"`]/, "").replace(/['"`]$/, "")
  text = text.replace(/^.*?redirect\(/, "").replace(/\).*$/, "").trim()
  text = text.replace(/\.toString\(\)/g, "")
  if (!text) return undefined

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text)
      return u.pathname || "/"
    } catch {
      return text
    }
  }

  const qPos = text.indexOf("?")
  if (qPos >= 0) text = text.slice(0, qPos)
  return text || undefined
}

function slugForSpecAtom(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_")
}

type ObservedOauthSignals = {
  hasStateParam: boolean
  hasPkce: boolean
}

type EndpointCatalog = {
  endpoints: string[]
}

function inferObservedOauthSignals(oauth: ReturnType<typeof deriveOauthReport>): ObservedOauthSignals {
  const observedParamKeys = new Set(oauth.urlParamSets.map((x) => x.key))

  const hasStateParam = observedParamKeys.has("\"state\"")
  const hasPkce =
    observedParamKeys.has("\"code_challenge\"") ||
    observedParamKeys.has("\"code_challenge_method\"")

  return { hasStateParam, hasPkce }
}

function buildEndpointCatalog(oauth: ReturnType<typeof deriveOauthReport>): EndpointCatalog {
  const endpoints = new Set<string>()

  for (const r of oauth.redirects) {
    if (!r.target) continue
    const endpoint = normalizeEndpoint(r.target)
    if (endpoint) endpoints.add(endpoint)
  }
  for (const s of oauth.urlParamSets) {
    const endpoint = normalizeEndpoint(s.urlExpr)
    if (endpoint) endpoints.add(endpoint)
  }
  for (const flow of oauth.oauthLikeFlows) {
    const direct = normalizeEndpoint(flow.urlExpr)
    if (direct) endpoints.add(direct)
    for (const target of flow.redirectTargets) {
      const endpoint = normalizeEndpoint(target)
      if (endpoint) endpoints.add(endpoint)
    }
  }

  return { endpoints: [...endpoints].sort() }
}

type ExplorationProfile = {
  sessionCount: number
  maxSteps: number
  allowFlags: string[]
  terminalHeavy: boolean
}

function inferExplorationProfile(
  oauth: ReturnType<typeof deriveOauthReport>,
  state: ReturnType<typeof deriveStateTransitionReport>,
): ExplorationProfile {
  const callbackFunctions = new Set(oauth.redirects.map((r) => `${r.file}::${r.functionId}`))
  const sessionCount = callbackFunctions.size > 1 || oauth.summary.redirectCount > 1 ? 2 : 1

  const maxSteps = Math.min(30, Math.max(8, state.summary.functionCount > 20 ? 24 : 16))
  const terminalHeavy = state.summary.terminalTransitionCount > 0

  const allowFlags = ["reorder", "duplicate", ...(sessionCount > 1 ? (["cross-delivery"] as const) : [])]

  return { sessionCount, maxSteps, allowFlags, terminalHeavy }
}

type MachineFromStateResult = {
  machine: LispauthSpecDraft["machine"]
  eventEndpoints: Array<{ event: string; endpoints: string[] }>
}

function buildMachineFromStateTransitions(
  state: ReturnType<typeof deriveStateTransitionReport>,
  oauth: ReturnType<typeof deriveOauthReport>,
  signals: ObservedOauthSignals,
): MachineFromStateResult {
  const primary = selectPrimaryTransitionFunction(state, oauth)
  if (!primary) return buildFallbackOauthMachine(signals)

  const endpointByEvent = buildEndpointByEventKey(oauth)
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
    .map((n) => stateNameByNodeId.get(n.id))
    .filter((x): x is string => !!x)

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
      do: [["set", "session.stage", q(toState)]],
      goto: toState,
    })

    const eventKey = edge.eventIndex === undefined ? undefined : `${primary.file}::${primary.functionId}::${edge.eventIndex}`
    if (!eventKey) continue
    const endpoints = endpointByEvent.get(eventKey)
    if (!endpoints || endpoints.length === 0) continue
    eventEndpoints.push({ event: eventName, endpoints })
  }

  if (events.length === 0 && states.length >= 2) {
    const [startState, endState] = states
    if (startState && endState) {
      events.push({
        name: "Step_Start_to_End",
        params: [],
        when: ["=", "session.stage", q(startState)],
        do: [["set", "session.stage", q(endState)]],
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

function buildDefaultInvariants(
  machine: LispauthSpecDraft["machine"],
  signals: ObservedOauthSignals,
  profile: ExplorationProfile,
): NonNullable<LispauthSpecDraft["property"]>["invariants"] {
  const stageInKnownStates: SyntaxNode = orExpr(machine.states.map((s) => ["=", "session.stage", q(s)]))
  const terminalEvents = machine.events
    .map((e) => e.name)
    .filter((name) => /^Terminal_/i.test(name))

  return [
    {
      name: "session-stage-is-known",
      expr: stageInKnownStates,
    },
    {
      name: "transition-preserves-stage-domain",
      expr: ["=>", "last.transitioned", stageInKnownStates],
    },
    ...(signals.hasPkce
      ? [
          {
            name: "pkce-verifier-present-when-token-issued",
            expr: ["=>", ["=", "session.stage", q("TokenIssued")], ["not", ["=", "session.verifier", null]]],
          },
        ]
      : []),
    ...(signals.hasStateParam
      ? [
          {
            name: "state-slot-present-after-auth",
            expr: ["=>", ["not", ["=", "session.stage", q("Start")]], ["not", ["=", "session.state", null]]],
          },
        ]
      : []),
    ...(terminalEvents.length > 0
      ? [
          {
            name: "terminal-event-reaches-end",
            expr: [
              "=>",
              ["and", "last.transitioned", orExpr(terminalEvents.map((e) => ["=", "last.event", q(e)]))],
              ["=", "session.stage", q("End")],
            ],
          },
        ]
      : []),
    ...(profile.terminalHeavy
      ? [
          {
            name: "eventually-can-finish",
            expr: ["=>", ["=", "session.stage", q("End")], true],
          },
        ]
      : []),
  ]
}

function selectPrimaryTransitionFunction(
  state: ReturnType<typeof deriveStateTransitionReport>,
  oauth: ReturnType<typeof deriveOauthReport>,
) {
  if (state.functions.length === 0) return undefined

  const oauthFunctionKeys = new Set<string>([
    ...oauth.oauthLikeFlows.map((x) => `${x.file}::${x.functionId}`),
    ...oauth.redirects.map((x) => `${x.file}::${x.functionId}`),
    ...oauth.urlParamSets.map((x) => `${x.file}::${x.functionId}`),
  ])

  const oauthCandidates = state.functions.filter((f) => oauthFunctionKeys.has(`${f.file}::${f.functionId}`))
  const candidates = oauthCandidates.length > 0 ? oauthCandidates : state.functions

  return [...candidates].sort((a, b) => {
    if (b.summary.eventCount !== a.summary.eventCount) return b.summary.eventCount - a.summary.eventCount
    if (b.summary.terminalTransitionCount !== a.summary.terminalTransitionCount) {
      return b.summary.terminalTransitionCount - a.summary.terminalTransitionCount
    }
    return a.functionId.localeCompare(b.functionId)
  })[0]
}

function buildEndpointByEventKey(oauth: ReturnType<typeof deriveOauthReport>): Map<string, string[]> {
  const temp = new Map<string, Set<string>>()
  const add = (key: string, raw: string | undefined) => {
    if (!raw) return
    const endpoint = normalizeEndpoint(raw)
    if (!endpoint) return
    const current = temp.get(key) ?? new Set<string>()
    current.add(endpoint)
    temp.set(key, current)
  }

  for (const r of oauth.redirects) add(`${r.file}::${r.functionId}::${r.eventIndex}`, r.target)
  for (const s of oauth.urlParamSets) add(`${s.file}::${s.functionId}::${s.eventIndex}`, s.urlExpr)

  const out = new Map<string, string[]>()
  for (const [k, v] of temp.entries()) out.set(k, [...v].sort())
  return out
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

function orExpr(items: SyntaxNode[]): SyntaxNode {
  if (items.length === 0) return false
  if (items.length === 1) return items[0]
  return ["or", ...items]
}
