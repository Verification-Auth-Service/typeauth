import { describe, expect, it } from "vitest"
import { deriveFrameworkReports } from "../../framework/report"
import { buildLispauthDsl } from "../../model-checker/lispauth"
import { buildLispauthDraftFromDerivedReports, buildLispauthDraftUnitsFromDerivedReports } from "../../model-checker/lispauth/generator"
import { q } from "../../model-checker/lispauth/generator/builder"
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

function createReportFromAuthorizeRef(): AnalysisReport {
  return {
    entry: "/repo/src/client-entry.ts",
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
                key: "\"redirect_uri\"",
                value: "\"/oauth/callback?from=oauth\"",
                loc,
              },
              {
                kind: "urlParamSet",
                urlExpr: "authorizeUrl",
                key: "\"state\"",
                value: "state",
                loc,
              },
              {
                kind: "urlParamSet",
                urlExpr: "authorizeUrl",
                key: "\"code_challenge\"",
                value: "challenge",
                loc,
              },
              {
                kind: "redirect",
                via: "call",
                api: "redirect",
                target: "authorizeUrl.toString()",
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
  it("projects state transitions into S-expression machine events and keeps http endpoint metadata", () => {
    const report = createReport(false)
    const framework = deriveFrameworkReports(report)
    const oauth = deriveOauthReport(report)
    const state = deriveStateTransitionReport(report)
    const draft = buildLispauthDraftFromDerivedReports({ report, framework, oauth, state })
    const dsl = buildLispauthDsl(draft)

    expect(draft.machine.states.length).toBeGreaterThanOrEqual(2)
    expect(draft.machine.events.some((e) => e.name.startsWith("Step_"))).toBe(true)
    expect(draft.http?.endpoints).toContain("/oauth/callback")
    expect(dsl).toContain("(http")
    expect(dsl).toContain("(endpoint /oauth/callback)")
  })

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
    expect(endpointLabels).not.toContain("authorizeUrl")
  })

  it("reverse-traces endpoint origins from redirect target references", () => {
    const report = createReportFromAuthorizeRef()
    const draft = buildLispauthDraftFromDerivedReports({
      report,
      framework: deriveFrameworkReports(report),
      oauth: deriveOauthReport(report),
      state: deriveStateTransitionReport(report),
    })

    expect(draft.http?.endpoints).toContain("/oauth/callback")
    expect(draft.http?.endpoints).not.toContain("authorizeUrl")
  })

  it("initializes session.state when leaving Start for state-param flows", () => {
    const report = createReport(false)
    const draft = buildLispauthDraftFromDerivedReports({
      report,
      framework: deriveFrameworkReports(report),
      oauth: deriveOauthReport(report),
      state: deriveStateTransitionReport(report),
    })

    const startExits = draft.machine.events.filter(
      (event) => event.goto !== "Start" && JSON.stringify(event.when).includes(JSON.stringify(q("Start"))),
    )

    expect(startExits.length).toBeGreaterThan(0)
    expect(
      startExits.every((event) =>
        (event.do ?? []).some(
          (step) =>
            Array.isArray(step) &&
            step[0] === "set" &&
            step[1] === "session.state" &&
            JSON.stringify(step[2]) === JSON.stringify(["fresh", "state"]),
        ),
      ),
    ).toBe(true)
  })

  it("initializes session.verifier when pkce parameters are observed", () => {
    const report = createReportFromAuthorizeRef()
    const draft = buildLispauthDraftFromDerivedReports({
      report,
      framework: deriveFrameworkReports(report),
      oauth: deriveOauthReport(report),
      state: deriveStateTransitionReport(report),
    })

    const startExits = draft.machine.events.filter(
      (event) => event.goto !== "Start" && JSON.stringify(event.when).includes(JSON.stringify(q("Start"))),
    )

    expect(startExits.length).toBeGreaterThan(0)
    expect(
      startExits.every((event) =>
        (event.do ?? []).some(
          (step) =>
            Array.isArray(step) &&
            step[0] === "set" &&
            step[1] === "session.verifier" &&
            JSON.stringify(step[2]) === JSON.stringify(["fresh", "verifier"]),
        ),
      ),
    ).toBe(true)
  })
})
