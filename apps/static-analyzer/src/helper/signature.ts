import ts from "typescript";

// シグネチャ情報を取得
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
