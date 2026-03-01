import ts from "typescript";

// シグネチャ情報を取得
/**
 * 入力例: `signatureOf(program.getTypeChecker(), ts.factory.createFunctionDeclaration(undefined, undefined, "loader", undefined, [], undefined, ts.factory.createBlock([], true)))`
 * 成果物: 解決できた場合に関数シグネチャ文字列を返し、失敗時は `undefined`。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
export function signatureOf(checker: ts.TypeChecker, decl: ts.SignatureDeclaration): string | undefined {
  try {
    const sig = checker.getSignatureFromDeclaration(decl);
    if (!sig) return undefined;
    // `NoTruncation` を付けて、可変長/複雑な型でも省略されにくくする。
    // レポート用途のため多少長くても情報欠落を避ける。
    return checker.signatureToString(sig, decl, ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Call);
  } catch {
    // 型解決エラーや壊れた AST 状態でも、解析全体は継続させたい。
    return undefined;
  }
}
