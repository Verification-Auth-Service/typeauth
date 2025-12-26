import { locOf } from "./locOf";
import { SymbolInfo } from "../types/tree";
import ts from "typescript";

// シンボル情報を取得
export function symbolInfo(checker: ts.TypeChecker, node: ts.Node): SymbolInfo | undefined {
  const sym =
    checker.getSymbolAtLocation(node) ??
    (ts.isPropertyAccessExpression(node) ? checker.getSymbolAtLocation(node.name) : undefined) ??
    (ts.isIdentifier(node) ? checker.getSymbolAtLocation(node) : undefined);

  if (!sym) return undefined;

  const decls = (sym.declarations ?? []).map((d) => locOf(d.getSourceFile(), d));
  return {
    name: checker.symbolToString(sym),
    flags: ts.SymbolFlags[sym.flags] ?? String(sym.flags),
    declarations: decls.length ? decls : undefined,
  };
}
