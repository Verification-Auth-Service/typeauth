import { describe, expect, it } from "vitest";
import { deriveFrameworkReports } from "../framework/report";
import { deriveHttpReport } from "../http/report";
import { deriveOauthReportFromHttp } from "../oauth/report";
import { buildReportCoverage } from "../report-coverage";
import { deriveStateTransitionReport } from "../state/report";
import type { AnalysisReport } from "../types/report";
import type { Location } from "../types/tree";

const loc: Location = {
  file: "/repo/src/routes/oauth.ts",
  start: { line: 1, character: 1 },
  end: { line: 1, character: 10 },
};

describe("buildReportCoverage", () => {
  it("summarizes collected report fields and limits", () => {
    const report: AnalysisReport = {
      entry: "/repo/src/routes/oauth.ts",
      files: [
        {
          file: "/repo/src/routes/oauth.ts",
          imports: [{ source: "react-router", syntax: "import { redirect } from 'react-router'" }],
          functions: [
            {
              id: "fn:loader",
              name: "loader",
              kind: "function",
              loc,
              signature: "function loader(): Promise<Response>",
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
                  target: "authorizeUrl.toString()",
                  loc,
                },
              ],
            },
          ],
        },
      ],
    };

    const framework = deriveFrameworkReports(report);
    const http = deriveHttpReport(report, framework);
    const oauth = deriveOauthReportFromHttp(http);
    const state = deriveStateTransitionReport(report);
    const coverage = buildReportCoverage(report, framework, http, oauth, state);

    expect(coverage.summary).toEqual({
      fileCount: 1,
      functionCount: 1,
      eventCount: 2,
    });
    expect(coverage.sourceDerived.eventKindCounts.redirect).toBe(1);
    expect(coverage.sourceDerived.eventKindCounts.urlParamSet).toBe(1);
    expect(coverage.http.endpointCount).toBe(0);
    expect(coverage.endpointFieldCoverage.notCollectedYet).toContain("HTTP method");
  });
});
