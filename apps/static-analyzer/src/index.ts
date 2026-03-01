import { analyze } from "./analyze/analyze";
import { parseArgs, resolveRequestedEntries, usage } from "./cli";
import { buildCompositeReport } from "./report-compose";
import { writeDirectoryReport, writeSingleReport } from "./report-output";

/**
 * 目的:
 * - 引数で与えられたTS/TSXファイルを起点に Program + TypeChecker を作る
 * - 関数/メソッド単位で、分岐/ループ/例外/return/await/call を「イベント」として抽出
 * - 重要: 各イベントに型情報(可能ならsymbol/decl)を付与
 *
 * 使い方
 * - 単一ファイル出力: `static-analyzer <entry-file.ts> [output-file.json]`
 * - ディレクトリ出力: `static-analyzer -d <entry-file.ts> [output-dir]`
 * - 役割別エントリ: `static-analyzer --client-entry <file> --resource-entry <file> [--token-entry <file>] [output]`
 * - `-d` なし: 第3引数がなければ `report.json` に保存
 * - `-d` あり: 保存先未指定なら `report/` に保存（元コード構造をミラー）
 */

/**
 * 入力例: `main()`
 * 成果物: 副作用のみを実行する（戻り値なし）。
 */
async function main() {
  // 1st arg は node 実行パス、2nd arg はスクリプトパスなので、
  // ユーザー入力の実引数は `process.argv.slice(2)` から読む。
  const cli = parseArgs(process.argv.slice(2));
  if (cli.error) {
    console.error(cli.error);
    console.error(usage());
    process.exit(2);
  }

  const requested = resolveRequestedEntries(cli);
  if (!requested) {
    if (cli.entries && (!cli.entries.clientEntry || !cli.entries.resourceEntry)) {
      console.error("When using role-based entries, both --client-entry and --resource-entry are required.");
    }
    console.error(usage());
    process.exit(2);
  }

  const reports = requested.analyzeTargets.map((entryPath) => analyze(entryPath));
  const report = buildCompositeReport(requested.entry, requested.roleEntries, reports);

  if (cli.dirMode) {
    await writeDirectoryReport(report, cli.outputPath ?? "report");
    return;
  }

  writeSingleReport(report, cli.outputPath ?? "report.json");
}

void main();
