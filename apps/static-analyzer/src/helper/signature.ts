import ts from "typescript";
import { locOf } from "./locOf.js";
import { SymbolInfo } from "../types/tree.js";

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

export function signatureOf(checker: ts.TypeChecker, decl: ts.SignatureDeclaration): string | undefined {
  try {
    const sig = checker.getSignatureFromDeclaration(decl);
    if (!sig) return undefined;
    return checker.signatureToString(sig, decl, ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Call);
  } catch {
    return undefined;
  }
}
