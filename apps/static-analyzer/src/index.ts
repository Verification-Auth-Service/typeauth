import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { analyze } from "./analyze/analyze";
import type { AnalysisReport } from "./types/report";

/**
 * 目的:
 * - 引数で与えられたTS/TSXファイルを起点に Program + TypeChecker を作る
 * - 関数/メソッド単位で、分岐/ループ/例外/return/await/call を「イベント」として抽出
 * - 重要: 各イベントに型情報(可能ならsymbol/decl)を付与
 *
 * 使い方
 * - 単一ファイル出力: `static-analyzer <entry-file.ts> [output-file.json]`
 * - ディレクトリ出力: `static-analyzer -d <entry-file.ts> [output-dir]`
 * - `-d` なし: 第3引数がなければ `report.json` に保存
 * - `-d` あり: 保存先未指定なら `report/` に保存（元コード構造をミラー）
 */

// ---- CLI

type CliArgs = {
  dirMode: boolean;
  entry?: string;
  outputPath?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const rest = [...argv];
  let dirMode = false;

  // 今回サポートするオプションは `-d` のみ。
  // 位置は前後どちらでも受けられるようにして、CLI 利用時のストレスを減らす。
  const positional: string[] = [];
  for (const a of rest) {
    if (a === "-d") {
      dirMode = true;
      continue;
    }
    positional.push(a);
  }

  return {
    dirMode,
    entry: positional[0],
    outputPath: positional[1],
  };
}

function usage(): string {
  return [
    "Usage:",
    "  static-analyzer <entry-file.ts> [output-file.json]",
    "  static-analyzer -d <entry-file.ts> [output-dir]",
  ].join("\n");
}

async function confirmDelete(targetAbs: string): Promise<boolean> {
  // 非対話環境では確認できないため、安全側に倒して中断する。
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false;

  const rl = readline.createInterface({ input, output });
  try {
    const ans = await rl.question(`Output directory already exists: ${targetAbs}\nDelete it and recreate? [y/N] `);
    return /^(y|yes)$/i.test(ans.trim());
  } finally {
    rl.close();
  }
}

function commonPathPrefix(paths: string[]): string {
  if (!paths.length) return process.cwd();
  let current = path.resolve(paths[0]);
  for (const p of paths.slice(1)) {
    const next = path.resolve(p);
    while (!next.startsWith(current + path.sep) && next !== current) {
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (next === current) continue;
    if (!next.startsWith(current + path.sep)) current = path.dirname(current);
  }
  return current;
}

function writeSingleReport(report: AnalysisReport, outFile: string) {
  const outAbs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.error(`Saved report to ${outAbs}`);
}

async function writeDirectoryReport(report: AnalysisReport, outDir: string) {
  const outDirAbs = path.resolve(outDir);

  if (fs.existsSync(outDirAbs)) {
    const st = fs.statSync(outDirAbs);
    if (!st.isDirectory()) {
      console.error(`Output path exists and is not a directory: ${outDirAbs}`);
      process.exit(2);
    }

    const ok = await confirmDelete(outDirAbs);
    if (!ok) {
      console.error("Canceled.");
      process.exit(1);
    }
    fs.rmSync(outDirAbs, { recursive: true, force: true });
  }

  fs.mkdirSync(outDirAbs, { recursive: true });

  // ファイルごとのレポートを、解析対象ファイル群の共通親ディレクトリを基準にミラー配置する。
  // 例:
  // - source: `/app/src/routes/a.tsx`
  // - outDir : `report`
  // - output : `report/src/routes/a.tsx.json`
  const filePaths = report.files.map((f) => f.file);
  const baseDir = commonPathPrefix([report.entry, ...filePaths]);

  for (const f of report.files) {
    const rel = path.relative(baseDir, f.file);
    const outFile = path.join(outDirAbs, `${rel}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(f, null, 2) + "\n", "utf8");
  }

  // 全体メタ情報 (entry / tsconfig / 出力基準ディレクトリなど) を別ファイルに残す。
  // 各ファイル JSON だけでは復元しにくい情報をここに集約する。
  const meta = {
    entry: report.entry,
    tsconfigUsed: report.tsconfigUsed,
    baseDir,
    files: report.files.map((f) => ({ file: f.file })),
  };
  fs.writeFileSync(path.join(outDirAbs, "_meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

  console.error(`Saved directory report to ${outDirAbs}`);
}

async function main() {
  // 1st arg は node 実行パス、2nd arg はスクリプトパスなので、
  // ユーザー入力の実引数は `process.argv.slice(2)` から読む。
  const cli = parseArgs(process.argv.slice(2));
  const entry = cli.entry;
  if (!entry) {
    console.error(usage());
    process.exit(2);
  }

  // 解析は先に一度だけ実行し、出力形式 (単一JSON / ディレクトリ分割) を後段で分岐する。
  const report = analyze(entry);

  if (cli.dirMode) {
    await writeDirectoryReport(report, cli.outputPath ?? "report");
    return;
  }

  writeSingleReport(report, cli.outputPath ?? "report.json");
}

void main();
