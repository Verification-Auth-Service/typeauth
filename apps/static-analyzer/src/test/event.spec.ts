import { extractEvents } from "../analyze/event";
import { PEvent } from "../types/event";
import { describe, it, expect } from "vitest";
import { createSourceFile, createChecker } from "./helper/create";

describe("extractEventsのテスト", () => {
  it("if文のイベント抽出", () => {
    const code = `
      function test(x: number) {
        if (x > 0) {
          console.log("positive");
        } else {
          console.log("non-positive");
        }
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["if", "blockEnter", "call", "blockExit", "blockEnter", "call", "blockExit"]);
  });

  it("for文のイベント抽出", () => {
    const code = `
      function test() {
        for (let i = 0; i < 5; i++) {
          console.log(i);
        }
      }
    `;
    const sourceFile = createSourceFile(code);
    const checker = createChecker(sourceFile);
    const out: PEvent[] = extractEvents(checker, sourceFile, sourceFile, []);

    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["loop", "blockEnter", "call", "blockExit"]);
  });
});
