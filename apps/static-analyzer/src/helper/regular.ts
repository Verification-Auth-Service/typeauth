// .ts/.tsx/.mts/.cts
/**
 * 入力例: `isTsLike("example")`
 * 成果物: .ts/.tsx/.mts/.cts かどうかを真偽値で返す。
 */
export function isTsLike(p: string) {
  // CLI の入口チェック用。TypeScript Program 側でも読める/読めないは判定されるが、
  // ここで早めに弾いてエラーメッセージを分かりやすくする。
  return /\.(tsx?|mts|cts)$/.test(p);
}
