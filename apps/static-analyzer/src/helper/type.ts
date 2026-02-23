import ts from "typescript";
import { TypeInfo } from "../types/tree";

export function typeInfo(checker: ts.TypeChecker, node: ts.Node): TypeInfo | undefined {
  try {
    const t = checker.getTypeAtLocation(node);
    // レポート用に文字列化した型だけを保持する。
    // 必要になれば将来ここで flags / aliasSymbol などを追加できる。
    return { text: checker.typeToString(t, node, ts.TypeFormatFlags.NoTruncation) };
  } catch {
    // 解析対象コードに型エラーがあっても全体停止しない方針。
    return undefined;
  }
}
