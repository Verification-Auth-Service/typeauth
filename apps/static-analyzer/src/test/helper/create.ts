import ts from "typescript";
import path from "node:path";

/**
 * 入力例: `createSourceFile("const x = 1")`
 * 成果物: 副作用のみを実行する（戻り値なし）。
 */
export const createSourceFile = (code: string) => ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/**
 * 入力例: `createChecker(ts.createSourceFile("tmp.ts", "const x = 1", ts.ScriptTarget.Latest, true))`
 * 成果物: 処理結果オブジェクトを返す。
 */
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
