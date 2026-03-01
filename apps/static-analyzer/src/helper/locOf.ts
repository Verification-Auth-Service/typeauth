import ts from "typescript";
import path from "node:path";
import { Location } from "../types/tree";

// ノードの位置情報を取得
/**
 * 入力例: `locOf(ts.createSourceFile("tmp.ts", "const x = 1", ts.ScriptTarget.Latest, true), ts.factory.createIdentifier("x"))`
 * 成果物: `startLine/startCol/endLine/endCol` を含む位置情報を返す。
 */
export function locOf(sf: ts.SourceFile, node: ts.Node): Location {
  // TypeScript API は 0-based なので、一般的なエディタ/人間向けに 1-based へ変換する。
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf, false));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: path.resolve(sf.fileName),
    start: { line: start.line + 1, character: start.character + 1 },
    end: { line: end.line + 1, character: end.character + 1 },
  };
}
