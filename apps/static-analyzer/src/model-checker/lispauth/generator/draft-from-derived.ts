import type { LispauthSpecDraft } from "./types"
import {
  type BuildLispauthDraftFromDerivedReportsArgs,
  type LispauthDraftUnit,
} from "./draft-from-derived/context"
import {
  buildDefaultInvariants,
  buildEndpointCatalog,
  inferExplorationProfile,
  inferObservedOauthSignals,
} from "./draft-from-derived/analysis"
import { buildMachineFromStateTransitions } from "./draft-from-derived/machine"
import { buildSpecName } from "./draft-from-derived/naming"
import { buildHttpEndpointUnits, buildProjectUnits } from "./draft-from-derived/units"

export type {
  BuildLispauthDraftFromDerivedReportsArgs,
  LispauthDraftUnit,
} from "./draft-from-derived/context"

/**
 * 解析済みレポート群から、1つの lispauth 仕様下書きを生成する。
 *
 * @param args 静的解析結果の束。
 * 例: `{ report, framework: deriveFrameworkReports(report), oauth: deriveOauthReport(report), state: deriveStateTransitionReport(report) }`
 * @returns `LispauthSpecDraft`。例:
 * `{ name, machine: { states, vars, events }, http, env, property }`
 */
export function buildLispauthDraftFromDerivedReports(args: BuildLispauthDraftFromDerivedReportsArgs): LispauthSpecDraft {
  const { report, framework, oauth, state } = args

  const specName = buildSpecName(report, framework.summary.detectedFrameworks[0], oauth)
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

/**
 * プロジェクト単位と endpoint 単位の複数ドラフトユニットを生成する。
 *
 * @param args `buildLispauthDraftFromDerivedReports` と同じ入力。
 * @returns `LispauthDraftUnit[]`。例:
 * `[{ unitType: "project", unitId: "project-...-client", ... }, { unitType: "http-endpoint", unitId: "endpoint-...", ... }]`
 */
export function buildLispauthDraftUnitsFromDerivedReports(
  args: BuildLispauthDraftFromDerivedReportsArgs,
): LispauthDraftUnit[] {
  const base = buildLispauthDraftFromDerivedReports(args)
  const projects = buildProjectUnits(base, args.report)
  const endpoints = buildHttpEndpointUnits(base, args.oauth)
  return [...projects, ...endpoints]
}
