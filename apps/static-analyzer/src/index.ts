import fs from "node:fs";
import path from "node:path";
import { analyze } from "./analyze/analyze";

/**
 * 目的:
 * - 引数で与えられたTS/TSXファイルを起点に Program + TypeChecker を作る
 * - 関数/メソッド単位で、分岐/ループ/例外/return/await/call を「イベント」として抽出
 * - 重要: 各イベントに型情報(可能ならsymbol/decl)を付与
 *
 * 使い方
 * - `static-analyzer <entry-file.ts> <output-file.json>` で実行
 * - 第3引数があればそのパスへ保存、なければ `report.json` に保存
 */

// ---- CLI

function main() {
  // 1st arg は node 実行パス、2nd arg はスクリプトパスなので、
  // ユーザー入力の実引数は `process.argv[2]` (entry), `process.argv[3]` (output) を使う。
  const entry = process.argv[2];
  const outFile = process.argv[3] ?? "report.json";
  if (!entry) {
    console.error("Usage: static-analyzer <entry-file.ts> [output-file.json]");
    process.exit(2);
  }

  // 解析結果は JSON としてファイル保存する。
  // 出力先ディレクトリが存在しない場合に備え、先に `mkdir -p` 相当を行う。
  const report = analyze(entry);
  const outAbs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + "\n", "utf8");

  // CLI 利用時に出力先が分かるよう、最低限の完了ログだけ stderr に出す。
  // stdout は将来 JSON 出力用途に再利用しやすいように空けておく。
  console.error(`Saved report to ${outAbs}`);
}

main();
