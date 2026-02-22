import { locOf } from "./locOf";
import { SymbolInfo } from "../types/tree";
import ts from "typescript";

// シンボル情報を取得
export function symbolInfo(checker: ts.TypeChecker, node: ts.Node): SymbolInfo | undefined {
  // AST の形によって `getSymbolAtLocation` の当たり方が変わるため、
  // 代表的なパターンをフォールバックで吸収する。
  // - property access: `obj.method` のとき `method` 側で取れる場合がある
  // - identifier: 単純識別子はそのまま
  const sym =
    checker.getSymbolAtLocation(node) ??
    (ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name) : undefined) ??
    (ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined);

  if (!sym) return undefined;

  const decls = (sym.declarations ?? []).map((d) => locOf(d.getSourceFile(), d));
  return {
    name: checker.symbolToString(sym),
    // SymbolFlags はビットフラグ。文字列表現が取れない場合に備えて数値も残せるようにする。
    flags: ts.SymbolFlags[sym.flags] ?? String(sym.flags),
    declarations: decls.length ? decls : undefined,
  };
}
