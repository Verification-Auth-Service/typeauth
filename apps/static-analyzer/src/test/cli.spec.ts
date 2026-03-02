import { describe, expect, it } from "vitest";
import { parseArgs, usage } from "../cli";

describe("cli", () => {
  it("parses compact linear transition flags", () => {
    const on = parseArgs(["-d", "--compact-linear-transitions", "entry.ts", "out"]);
    const off = parseArgs(["-d", "--no-compact-linear-transitions", "entry.ts", "out"]);

    expect(on.compactLinearTransitions).toBe(true);
    expect(off.compactLinearTransitions).toBe(false);
  });

  it("includes compact options in usage text", () => {
    const text = usage();
    expect(text).toContain("--compact-linear-transitions");
    expect(text).toContain("--no-compact-linear-transitions");
  });
});
