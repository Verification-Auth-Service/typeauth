import { analyze } from "./analyze/analyze";

/**
 * 目的:
 * - 引数で与えられたTS/TSXファイルを起点に Program + TypeChecker を作る
 * - 関数/メソッド単位で、分岐/ループ/例外/return/await/call を「イベント」として抽出
 * - 重要: 各イベントに型情報(可能ならsymbol/decl)を付与
 *
 * 使い方
 * - `static-analyzer <entry-file.ts>` で実行
 * - JSON 形式で AnalysisReport を標準出力に出す
 */

// ---- CLI

function main() {
  // 1st arg は node 実行パス、2nd arg はスクリプトパスなので、
  // ユーザー入力の実引数は `process.argv[2]` から読む。
  const entry = process.argv[2];
  if (!entry) {
    console.error("Usage: static-analyzer <entry-file.ts>");
    process.exit(2);
  }

  // 解析結果は JSON として stdout にのみ出す。
  // 他ツールからパイプで受け取りやすくするため、余計なログは出さない。
  const report = analyze(entry);
  process.stdout.write(JSON.stringify(report, null, 2));
}

main();
