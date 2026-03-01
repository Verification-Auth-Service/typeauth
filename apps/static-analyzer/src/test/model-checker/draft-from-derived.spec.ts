import { describe, expect, it } from "vitest"
import { deriveFrameworkReports } from "../../framework/report"
import { buildLispauthDraftUnitsFromDerivedReports } from "../../model-checker/lispauth/generator"
import { deriveOauthReport } from "../../oauth/report"
import { deriveStateTransitionReport } from "../../state/report"
import type { AnalysisReport } from "../../types/report"
import type { Location } from "../../types/tree"

const loc: Location = {
  file: "/repo/src/routes/oauth.ts",
  start: { line: 1, character: 1 },
  end: { line: 1, character: 10 },
}

/**
 * 入力例: `createReport(true)`
 * 成果物: 処理結果オブジェクトを返す。
 */
function createReport(withRoleEntries: boolean): AnalysisReport {
  return {
    entry: "/repo/src/client-entry.ts",
    entries: withRoleEntries
      ? {
          client: "/repo/src/client-entry.ts",
          resourceServer: "/repo/src/resource-entry.ts",
          tokenServer: "/repo/src/token-entry.ts",
        }
      : undefined,
    files: [
      {
        file: "/repo/src/routes/oauth.ts",
        functions: [
          {
            id: "fn:loader",
            name: "loader",
            kind: "function",
            loc,
            events: [
              {
                kind: "urlParamSet",
                urlExpr: "authorizeUrl",
                key: "\"state\"",
                value: "state",
                loc,
              },
              {
                kind: "redirect",
                via: "call",
                api: "redirect",
                target: "\"/oauth/callback?code=abc\"",
                loc,
              },
            ],
          },
        ],
      },
    ],
  }
}

describe("buildLispauthDraftUnitsFromDerivedReports", () => {
  it("builds project units from role-based entries", () => {
    const report = createReport(true)
    const units = buildLispauthDraftUnitsFromDerivedReports({
      report,
      framework: deriveFrameworkReports(report),
      oauth: deriveOauthReport(report),
      state: deriveStateTransitionReport(report),
    })

    const projectUnits = units.filter((x) => x.unitType === "project")
    expect(projectUnits.map((x) => x.label)).toEqual([
      "client: /repo/src/client-entry.ts",
      "resource-server: /repo/src/resource-entry.ts",
      "token-server: /repo/src/token-entry.ts",
    ])
  })

  it("builds endpoint units and normalizes URL path", () => {
    const report = createReport(false)
    const units = buildLispauthDraftUnitsFromDerivedReports({
      report,
      framework: deriveFrameworkReports(report),
      oauth: deriveOauthReport(report),
      state: deriveStateTransitionReport(report),
    })

    const endpointLabels = units.filter((x) => x.unitType === "http-endpoint").map((x) => x.label)
    expect(endpointLabels).toContain("/oauth/callback")
    expect(endpointLabels).toContain("authorizeUrl")
  })
})
