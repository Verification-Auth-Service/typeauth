import { describe, expect, it } from "vitest";
import { deriveFrameworkReports } from "../framework/report";
import { deriveHttpReport } from "../http/report";
import { deriveOauthReport, deriveOauthReportFromHttp } from "../oauth/report";
import type { AnalysisReport } from "../types/report";
import type { Location } from "../types/tree";

const loc: Location = {
  file: "/repo/src/routes/oauth.ts",
  start: { line: 1, character: 1 },
  end: { line: 1, character: 10 },
};

describe("http -> oauth derivation pipeline", () => {
  it("keeps oauth counts equivalent after http aggregation", () => {
    const report: AnalysisReport = {
      entry: "/repo/src/routes/oauth.ts",
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
                  kind: "urlParamSet",
                  urlExpr: "authorizeUrl",
                  key: "\"client_id\"",
                  value: "\"abc\"",
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
    const oauthFromReport = deriveOauthReport(report);
    const oauthFromHttp = deriveOauthReportFromHttp(http);

    expect(oauthFromHttp.summary).toEqual(oauthFromReport.summary);
    expect(oauthFromHttp.oauthLikeFlows.length).toBe(1);
  });
});
