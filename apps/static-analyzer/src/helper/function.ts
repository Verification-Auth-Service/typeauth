import ts from "typescript";

import { FunctionReport } from "../types/report.js";

export function functionKind(node: ts.Node): FunctionReport["kind"] | undefined {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isArrowFunction(node)) return "arrow";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isFunctionExpression(node)) return "function";
  return undefined;
}

export function functionName(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? "<anonymous function>";
  if (ts.isMethodDeclaration(node)) {
    if (ts.isIdentifier(node.name)) return node.name.text;
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isArrowFunction(node)) return "<arrow>";
  if (ts.isFunctionExpression(node)) return node.name?.text ?? "<function expr>";
  return "<unknown>";
}
