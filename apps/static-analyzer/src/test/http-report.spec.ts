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

    expect(http.summary.endpointCount).toBe(0);
    expect(http.unresolved.redirects).toHaveLength(1);
    expect(http.unresolved.urlParamSets).toHaveLength(2);
    expect(oauthFromHttp.summary).toEqual(oauthFromReport.summary);
    expect(oauthFromHttp.oauthLikeFlows.length).toBe(1);
  });

  it("uses React Router route path as endpoint instead of redirect target", () => {
    const report: AnalysisReport = {
      entry: "/repo/app/routes/login.tsx",
      files: [
        {
          file: "/repo/app/routes/login.tsx",
          imports: [{ source: "react-router", syntax: "import { redirect } from 'react-router'" }],
          functions: [
            {
              id: "fn:loader",
              name: "loader",
              kind: "function",
              loc,
              events: [
                {
                  kind: "redirect",
                  via: "call",
                  api: "redirect",
                  target: "\"/dashboard\"",
                  loc,
                },
              ],
            },
            {
              id: "fn:redirectToError",
              name: "redirectToError",
              kind: "function",
              loc,
              events: [
                {
                  kind: "redirect",
                  via: "call",
                  api: "redirect",
                  target: "\"/error\"",
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

    expect(http.summary.endpointCount).toBe(1);
    expect(http.unresolved.redirects).toHaveLength(0);
    expect(http.endpoints[0].endpoint).toBe("/login");
    expect(http.endpoints[0].redirects).toHaveLength(2);
    expect(http.endpoints[0].sourceValues).toEqual(expect.arrayContaining(["\"/dashboard\"", "\"/error\""]));
  });
});
