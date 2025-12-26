import ts from "typescript";
import path from "node:path";
import { Location } from "../types/tree";

// ノードの位置情報を取得
export function locOf(sf: ts.SourceFile, node: ts.Node): Location {
  const start = sf.getLineAndCharacterOfPosition(node.getStart(sf, false));
  const end = sf.getLineAndCharacterOfPosition(node.getEnd());
  return {
    file: path.resolve(sf.fileName),
    start: { line: start.line + 1, character: start.character + 1 },
    end: { line: end.line + 1, character: end.character + 1 },
  };
}
