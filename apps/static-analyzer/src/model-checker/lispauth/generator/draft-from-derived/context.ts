import type { deriveFrameworkReports } from "../../../../framework/report"
import type { deriveOauthReport } from "../../../../oauth/report"
import type { deriveStateTransitionReport } from "../../../../state/report"
import type { AnalysisReport } from "../../../../types/report"
import type { LispauthSpecDraft } from "../types"

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

export type OauthReport = ReturnType<typeof deriveOauthReport>
export type StateReport = ReturnType<typeof deriveStateTransitionReport>
