import { describe, expect, it } from "vitest";
import { buildRoleScopedReports } from "../roles/report";
import type { AnalysisReport } from "../types/report";

describe("buildRoleScopedReports", () => {
  it("separates client/resource files and keeps shared files in both roles", () => {
    const report: AnalysisReport = {
      entry: "/repo/client/main.ts",
      entries: {
        client: "/repo/client/main.ts",
        resourceServer: "/repo/resource/main.ts",
      },
      files: [
        {
          file: "/repo/client/main.ts",
          imports: [
            { source: "./only-client", syntax: "import './only-client'" },
            { source: "../shared/util", syntax: "import '../shared/util'" },
          ],
          functions: [],
        },
        {
          file: "/repo/client/only-client.ts",
          functions: [],
        },
        {
          file: "/repo/resource/main.ts",
          imports: [
            { source: "./only-resource", syntax: "import './only-resource'" },
            { source: "../shared/util", syntax: "import '../shared/util'" },
          ],
          functions: [],
        },
        {
          file: "/repo/resource/only-resource.ts",
          functions: [],
        },
        {
          file: "/repo/shared/util.ts",
          functions: [],
        },
      ],
    };

    const scoped = buildRoleScopedReports(report);
    const client = scoped.scopedReports.find((x) => x.role === "client");
    const resource = scoped.scopedReports.find((x) => x.role === "resource-server");

    expect(client).toBeDefined();
    expect(resource).toBeDefined();

    expect(client?.report.files.map((x) => x.file).sort()).toEqual([
      "/repo/client/main.ts",
      "/repo/client/only-client.ts",
      "/repo/shared/util.ts",
    ]);
    expect(resource?.report.files.map((x) => x.file).sort()).toEqual([
      "/repo/resource/main.ts",
      "/repo/resource/only-resource.ts",
      "/repo/shared/util.ts",
    ]);
    expect(scoped.ownershipByFile["/repo/shared/util.ts"]).toEqual(["client", "resource-server"]);
  });
});
