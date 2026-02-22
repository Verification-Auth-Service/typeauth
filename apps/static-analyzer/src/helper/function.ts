import ts from "typescript";

import { FunctionReport } from "../types/report";

const hasDefaultModifier = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;

const nameOfNamedNode = (name: ts.PropertyName | ts.BindingName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return name.getText();
  return undefined;
};

const inferredFunctionName = (node: ts.ArrowFunction | ts.FunctionExpression): string | undefined => {
  const p = node.parent;

  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;

  if (p && ts.isPropertyAssignment(p)) return nameOfNamedNode(p.name);

  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return p.left.getText();
  }

  if (p && ts.isExportAssignment(p)) return "default";

  return undefined;
};

// 関数の種類を取得
export function functionKind(node: ts.Node): FunctionReport["kind"] | undefined {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isArrowFunction(node)) return "arrow";
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isFunctionExpression(node)) return "function";
  return undefined;
}

// 関数の名前を取得
export function functionName(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) {
    if (node.name) return node.name.text;
    if (hasDefaultModifier(node)) return "default";
    return "<anonymous function>";
  }
  if (ts.isMethodDeclaration(node)) {
    if (ts.isIdentifier(node.name)) return node.name.text;
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  if (ts.isArrowFunction(node)) return inferredFunctionName(node) ?? "<arrow>";
  if (ts.isFunctionExpression(node)) return node.name?.text ?? inferredFunctionName(node) ?? "<function expr>";
  return "<unknown>";
}
