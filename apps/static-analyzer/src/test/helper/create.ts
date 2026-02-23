import ts from "typescript";
import path from "node:path";

export const createSourceFile = (code: string) => ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

export const createChecker = (sourceFile: ts.SourceFile) => {
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
