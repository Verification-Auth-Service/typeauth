import ts from "typescript";

import { extractEvents } from "../analyze/event";
import { PEvent } from "../types/event";
import { describe, it, expect } from "vitest";

describe("extractEventsのテスト", () => {
  const createSourceFile = (code: string) => ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const createChecker = (sourceFile: ts.SourceFile) => {
    const program = ts.createProgram({
      rootNames: [sourceFile.fileName],
      options: {},
      host: {
        fileExists: (fileName) => fileName === sourceFile.fileName,
        readFile: (fileName) => (fileName === sourceFile.fileName ? sourceFile.getFullText() : undefined),
        getSourceFile: (fileName, _) => (fileName === sourceFile.fileName ? sourceFile : undefined),
        getDefaultLibFileName: () => "lib.d.ts",
        writeFile: () => {},
        getCurrentDirectory: () => "",
        getDirectories: () => [],
        getCanonicalFileName: (fileName) => fileName,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
      },
    });
    return program.getTypeChecker();
  };

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
    const out: PEvent[] = [];
    extractEvents(checker, sourceFile, sourceFile, out);

    const kinds = out.map((e) => e.kind);
    expect(kinds).toEqual(["if", "blockEnter", "call", "blockExit", "blockEnter", "call", "blockExit"]);
  });
});
