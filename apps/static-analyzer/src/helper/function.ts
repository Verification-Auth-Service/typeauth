import ts from "typescript";

import { FunctionReport } from "../types/report";

// `export default function () {}` のような匿名関数宣言を区別するため、
// `default` 修飾子を安全に確認する。
//
// 注意:
// - `ts.Node` 型には `modifiers` プロパティが直接定義されていない
// - そのため TypeScript AST の正規 API (`canHaveModifiers/getModifiers`) を使う
const hasDefaultModifier = (node: ts.Node): boolean =>
  (ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined)?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;

// オブジェクトのプロパティ名や computed property を、可能な範囲で文字列化する。
// 例:
// - `foo`            -> "foo"
// - `"loader"`       -> "loader"
// - `[someExpr]`     -> "[someExpr]" (getText の結果)
const nameOfNamedNode = (name: ts.PropertyName | ts.BindingName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  if (ts.isComputedPropertyName(name)) return name.getText();
  return undefined;
};

// arrow function / function expression はノード自身が名前を持たないことが多い。
// そのため「親ノード」から論理名を推論する。
//
// React Router Framework の route module では以下の形が頻出:
// - `export const loader = async () => {}`
// - `export const action = async function () {}`
// - `export const clientLoader = (...) => {}`
//
// これまでは `<arrow>` のような名前になっていたが、ここで export 名を拾えるようにする。
const inferredFunctionName = (node: ts.ArrowFunction | ts.FunctionExpression): string | undefined => {
  const p = node.parent;

  // 例: `const loader = async () => {}`
  // React Router route module の代表的な書き方。
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;

  // 例: `{ loader: async () => {} }`
  // オブジェクトのプロパティに入った関数を解析するとき用。
  if (p && ts.isPropertyAssignment(p)) return nameOfNamedNode(p.name);

  // 例: `exports.loader = async () => {}`
  // 代入式の左辺をそのまま論理名として使う。
  if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    return p.left.getText();
  }

  // 例: `export default (() => {})`
  // 直接 default export される匿名関数は "default" として扱う。
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
    // 例: `export default function () {}`
    // 無名でも default export なら後段のレポートで識別しやすい名前を返す。
    if (hasDefaultModifier(node)) return "default";
    return "<anonymous function>";
  }
  if (ts.isMethodDeclaration(node)) {
    if (ts.isIdentifier(node.name)) return node.name.text;
    return node.name.getText();
  }
  if (ts.isConstructorDeclaration(node)) return "constructor";
  // NOTE:
  // arrow/function expression の「本体解析」は既に別処理で対応済み。
  // ここではレポート表示用の名前を `<arrow>` / `<function expr>` から
  // 実用的な名前（loader/action など）へ改善している。
  if (ts.isArrowFunction(node)) return inferredFunctionName(node) ?? "<arrow>";
  if (ts.isFunctionExpression(node)) return node.name?.text ?? inferredFunctionName(node) ?? "<function expr>";
  return "<unknown>";
}
