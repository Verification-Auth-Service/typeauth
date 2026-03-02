import { q } from "../builder"
import type { SyntaxNode } from "../../shared/syntax-node"
import type { LispauthSpecDraft } from "../types"
import type { OauthReport, StateReport } from "./context"
import { resolveOauthEndpoints } from "./endpoint-resolver"

export type ObservedOauthSignals = {
  hasStateParam: boolean
  hasPkce: boolean
}

export type ExplorationProfile = {
  sessionCount: number
  maxSteps: number
  allowFlags: string[]
  terminalHeavy: boolean
}

export function inferObservedOauthSignals(oauth: OauthReport): ObservedOauthSignals {
  const observedParamKeys = new Set(oauth.urlParamSets.map((x) => x.key))

  const hasStateParam = observedParamKeys.has("\"state\"")
  const hasPkce =
    observedParamKeys.has("\"code_challenge\"") ||
    observedParamKeys.has("\"code_challenge_method\"")

  return { hasStateParam, hasPkce }
}

export function buildEndpointCatalog(oauth: OauthReport): { endpoints: string[] } {
  return { endpoints: resolveOauthEndpoints(oauth).catalog }
}

export function inferExplorationProfile(oauth: OauthReport, state: StateReport): ExplorationProfile {
  const callbackFunctions = new Set(oauth.redirects.map((redirect) => `${redirect.file}::${redirect.functionId}`))
  const sessionCount = callbackFunctions.size > 1 || oauth.summary.redirectCount > 1 ? 2 : 1

  const maxSteps = Math.min(30, Math.max(8, state.summary.functionCount > 20 ? 24 : 16))
  const terminalHeavy = state.summary.terminalTransitionCount > 0

  const allowFlags = ["reorder", "duplicate", ...(sessionCount > 1 ? (["cross-delivery"] as const) : [])]

  return { sessionCount, maxSteps, allowFlags, terminalHeavy }
}

export function buildDefaultInvariants(
  machine: LispauthSpecDraft["machine"],
  signals: ObservedOauthSignals,
  profile: ExplorationProfile,
): NonNullable<LispauthSpecDraft["property"]>["invariants"] {
  const stageInKnownStates: SyntaxNode = orExpr(machine.states.map((state) => ["=", "session.stage", q(state)]))
  const terminalEvents = machine.events
    .map((event) => event.name)
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
              ["and", "last.transitioned", orExpr(terminalEvents.map((name) => ["=", "last.event", q(name)]))],
              ["=", "session.stage", q("End")],
            ],
          },
        ]
      : []),
  ]
}

function orExpr(items: SyntaxNode[]): SyntaxNode {
  if (items.length === 0) return false
  if (items.length === 1) return items[0]
  return ["or", ...items]
}
