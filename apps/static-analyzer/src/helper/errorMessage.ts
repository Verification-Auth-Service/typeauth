// エラーメッセージを表示してプロセス終了
/**
 * 入力例: `errorMessageO("invalid token")`
 * 成果物: エラーメッセージを出力し例外を投げて処理を中断する。
 */
export function errorMessageO(msg: string) {
  // CLI ツールなので例外を投げるより、stderr + 終了コード固定の方が扱いやすい。
  // (シェルスクリプトや CI から終了コードで判定しやすい)
  console.error(msg);
  process.exit(1);
}
