import { describe, expect, it } from "vitest";
import { deriveStateTransitionReport } from "../state/report";
import type { AnalysisReport } from "../types/report";

describe("deriveStateTransitionReport", () => {
  it("関数イベント列を状態遷移データに変換する", () => {
    const report: AnalysisReport = {
      entry: "/app/src/entry.ts",
      files: [
        {
          file: "/app/src/entry.ts",
          functions: [
            {
              id: "fn:guard",
              name: "guard",
              kind: "function",
              loc: {
                file: "/app/src/entry.ts",
                start: { line: 1, character: 1 },
                end: { line: 10, character: 1 },
              },
              events: [
                {
                  kind: "if",
                  test: "!ok",
                  loc: {
                    file: "/app/src/entry.ts",
                    start: { line: 2, character: 3 },
                    end: { line: 2, character: 10 },
                  },
                },
                {
                  kind: "redirect",
                  via: "call",
                  api: "redirect",
                  target: "\"/login\"",
                  loc: {
                    file: "/app/src/entry.ts",
                    start: { line: 3, character: 5 },
                    end: { line: 3, character: 30 },
                  },
                },
                {
                  kind: "return",
                  expr: "\"ok\"",
                  loc: {
                    file: "/app/src/entry.ts",
                    start: { line: 5, character: 3 },
                    end: { line: 5, character: 14 },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const out = deriveStateTransitionReport(report);
    expect(out.summary.functionCount).toBe(1);
    expect(out.summary.terminalTransitionCount).toBe(2);

    const fn = out.functions[0];
    expect(fn.nodes.map((n) => n.id)).toEqual(["fn:guard:start", "fn:guard:end", "fn:guard:e0", "fn:guard:e1", "fn:guard:e2"]);
    expect(fn.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "fn:guard:start", to: "fn:guard:e0", kind: "sequence" }),
        expect.objectContaining({ from: "fn:guard:e1", to: "fn:guard:end", kind: "terminal", label: "redirect" }),
        expect.objectContaining({ from: "fn:guard:e2", to: "fn:guard:end", kind: "terminal", label: "return" }),
      ]),
    );
  });
});
