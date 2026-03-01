import ts from "typescript";
import { TypeInfo } from "../types/tree";

/**
 * 入力例: `typeInfo(program.getTypeChecker(), ts.factory.createIdentifier("x"))`
 * 成果物: 型文字列・flags・symbol情報をまとめた `TypeInfo` を返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
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
