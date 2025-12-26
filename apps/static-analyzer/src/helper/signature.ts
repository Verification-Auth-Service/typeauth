import ts from "typescript";

// シグネチャ情報を取得
export function signatureOf(checker: ts.TypeChecker, decl: ts.SignatureDeclaration): string | undefined {
  try {
    const sig = checker.getSignatureFromDeclaration(decl);
    if (!sig) return undefined;
    return checker.signatureToString(sig, decl, ts.TypeFormatFlags.NoTruncation, ts.SignatureKind.Call);
  } catch {
    return undefined;
  }
}
