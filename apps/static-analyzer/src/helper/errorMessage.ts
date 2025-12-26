// エラーメッセージを表示してプロセス終了
export function errorMessageO(msg: string) {
  console.error(msg);
  process.exit(1);
}
