import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { analyze } from "./analyze/analyze";
import type { AnalysisReport, FileReport, ImportReport } from "./types/report";
import { deriveFrameworkReports } from "./framework/report";
import { deriveOauthReport } from "./oauth/report";
import { writeLispauthDslReport } from "./model-checker/lispauth";
import { buildLispauthDraftFromDerivedReports } from "./model-checker/lispauth/draft-from-derived";
import { deriveStateTransitionReport } from "./state/report";

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

// ---- CLI

type EntryRoles = {
  clientEntry?: string;
  resourceEntry?: string;
  tokenEntry?: string;
};

type CliArgs = {
  dirMode: boolean;
  entry?: string;
  entries?: EntryRoles;
  outputPath?: string;
  error?: string;
};

function parseArgs(argv: string[]): CliArgs {
  let dirMode = false;
  const entries: EntryRoles = {};

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-d") {
      dirMode = true;
      continue;
    }

    if (a === "--client-entry" || a === "--resource-entry" || a === "--token-entry") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        return { dirMode, error: `Missing value for ${a}` };
      }
      if (a === "--client-entry") entries.clientEntry = value;
      if (a === "--resource-entry") entries.resourceEntry = value;
      if (a === "--token-entry") entries.tokenEntry = value;
      i += 1;
      continue;
    }

    positional.push(a);
  }

  const hasRoleEntry = !!(entries.clientEntry || entries.resourceEntry || entries.tokenEntry);
  return {
    dirMode,
    entry: hasRoleEntry ? undefined : positional[0],
    entries: hasRoleEntry ? entries : undefined,
    outputPath: hasRoleEntry ? positional[0] : positional[1],
  };
}

function usage(): string {
  return [
    "Usage:",
    "  static-analyzer <entry-file.ts> [output-file.json]",
    "  static-analyzer -d <entry-file.ts> [output-dir]",
    "  static-analyzer [ -d ] --client-entry <file> --resource-entry <file> [--token-entry <file>] [output]",
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

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const abs = path.resolve(v);
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push(abs);
  }
  return out;
}

function mergeImports(base: ImportReport[] | undefined, extra: ImportReport[] | undefined): ImportReport[] | undefined {
  const merged = new Map<string, ImportReport>();
  for (const x of base ?? []) merged.set(`${x.source}\u0000${x.syntax}`, x);
  for (const x of extra ?? []) merged.set(`${x.source}\u0000${x.syntax}`, x);
  return merged.size ? [...merged.values()] : undefined;
}

function mergeFileReport(base: FileReport, extra: FileReport): FileReport {
  const fnMap = new Map(base.functions.map((f) => [f.id, f]));
  for (const fn of extra.functions) {
    if (!fnMap.has(fn.id)) fnMap.set(fn.id, fn);
  }
  return {
    file: base.file,
    imports: mergeImports(base.imports, extra.imports),
    functions: [...fnMap.values()],
  };
}

function buildCompositeReport(entry: string, roleEntries: AnalysisReport["entries"] | undefined, reports: AnalysisReport[]): AnalysisReport {
  const fileMap = new Map<string, FileReport>();
  for (const r of reports) {
    for (const f of r.files) {
      const prev = fileMap.get(f.file);
      fileMap.set(f.file, prev ? mergeFileReport(prev, f) : f);
    }
  }

  const tsconfigByEntry: Record<string, string | undefined> = {};
  for (const r of reports) tsconfigByEntry[r.entry] = r.tsconfigUsed;

  return {
    entry,
    entries: roleEntries,
    tsconfigUsed: tsconfigByEntry[entry],
    tsconfigUsedByEntry: tsconfigByEntry,
    files: [...fileMap.values()],
  };
}

function resolveRequestedEntries(cli: CliArgs): {
  entry: string;
  roleEntries?: AnalysisReport["entries"];
  analyzeTargets: string[];
} | null {
  if (!cli.entries) {
    if (!cli.entry) return null;
    const abs = path.resolve(cli.entry);
    return { entry: abs, analyzeTargets: [abs] };
  }

  const clientEntry = cli.entries.clientEntry ? path.resolve(cli.entries.clientEntry) : undefined;
  const resourceEntry = cli.entries.resourceEntry ? path.resolve(cli.entries.resourceEntry) : undefined;
  const tokenEntry = cli.entries.tokenEntry ? path.resolve(cli.entries.tokenEntry) : resourceEntry;
  if (!clientEntry || !resourceEntry) return null;

  return {
    entry: clientEntry,
    roleEntries: {
      client: clientEntry,
      resourceServer: resourceEntry,
      tokenServer: tokenEntry,
    },
    analyzeTargets: uniqueNonEmpty([clientEntry, resourceEntry, tokenEntry]),
  };
}

function writeSingleReport(report: AnalysisReport, outFile: string) {
  const outAbs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.error(`Saved report to ${outAbs}`);
}

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
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

  // レイヤー分離:
  // - source-derived/flow      : 既存の汎用フローレポート (ファイル/関数/events)
  // - source-derived/framework : import/package 傾向からのフレームワーク判定
  // - source-derived/oauth     : redirect / URL param set など認可まわりの派生ビュー
  const sourceDerivedDir = path.join(outDirAbs, "source-derived");
  const flowDir = path.join(sourceDerivedDir, "flow");
  const frameworkDir = path.join(sourceDerivedDir, "framework");
  const oauthDir = path.join(sourceDerivedDir, "oauth");
  const stateDir = path.join(outDirAbs, "state");

  // ファイルごとのフローレポートを、解析対象ファイル群の共通親ディレクトリを基準にミラー配置する。
  // 例:
  // - source: `/app/src/routes/a.tsx`
  // - outDir : `report/source-derived/flow`
  // - output : `report/source-derived/flow/src/routes/a.tsx.json`
  const filePaths = report.files.map((f) => f.file);
  const baseDir = commonPathPrefix([
    report.entry,
    report.entries?.client,
    report.entries?.resourceServer,
    report.entries?.tokenServer,
    ...filePaths,
  ].filter((x): x is string => !!x));

  for (const f of report.files) {
    const rel = path.relative(baseDir, f.file);
    writeJson(path.join(flowDir, `${rel}.json`), f);
  }

  // 互換性のためトップレベル `_meta.json` は残しつつ、source-derived/flow 配下にもメタを置く。
  const meta = {
    entry: report.entry,
    entries: report.entries,
    tsconfigUsed: report.tsconfigUsed,
    tsconfigUsedByEntry: report.tsconfigUsedByEntry,
    baseDir,
    files: report.files.map((f) => ({ file: f.file })),
  };
  writeJson(path.join(outDirAbs, "_meta.json"), meta);
  writeJson(path.join(sourceDerivedDir, "_meta.json"), meta);
  writeJson(path.join(flowDir, "_meta.json"), meta);

  const framework = deriveFrameworkReports(report);
  writeJson(path.join(frameworkDir, "_summary.json"), framework.summary);
  for (const [name, payload] of Object.entries(framework.outputs)) {
    writeJson(path.join(frameworkDir, `${name}.json`), payload);
  }

  const oauth = deriveOauthReport(report);
  writeJson(path.join(oauthDir, "_summary.json"), oauth.summary);
  writeJson(path.join(oauthDir, "redirects.json"), oauth.redirects);
  writeJson(path.join(oauthDir, "url-param-sets.json"), oauth.urlParamSets);
  writeJson(path.join(oauthDir, "flows.json"), oauth.oauthLikeFlows);

  // `const report = analyze(entry)` の返り値をそのまま入力にして state を派生する。
  // 既にメモリ上にある `report` を使うため、flow JSON の再読込や再解析は不要。
  const state = deriveStateTransitionReport(report);
  writeJson(path.join(stateDir, "_summary.json"), state.summary);
  writeJson(path.join(stateDir, "files.json"), state.files);
  writeJson(path.join(stateDir, "functions.json"), state.functions);

  // OAuth 解析結果から、lispauth モデル検査の叩き台 DSL を同梱する。
  // 固定テンプレではなく、framework/oauth/state 派生レポートを材料にドラフト化する。
  const lispauthOutDir = path.join(outDirAbs, "model-checker", "lispauth");
  const lispauthDraft = buildLispauthDraftFromDerivedReports({ report, framework, oauth, state });
  const lispauthFile = writeLispauthDslReport(lispauthDraft, { outDir: lispauthOutDir });
  writeJson(path.join(lispauthOutDir, "_meta.json"), {
    generatedAt: new Date().toISOString(),
    sourceEntry: report.entry,
    sourceEntries: report.entries,
    detectedFrameworks: framework.summary.detectedFrameworks,
    oauthLikeFlowCount: oauth.summary.oauthLikeFlowCount,
    redirectCount: oauth.summary.redirectCount,
    urlParamSetCount: oauth.summary.urlParamSetCount,
    stateSummary: state.summary,
    dslFile: lispauthFile.fileName,
  });

  console.error(`Saved directory report to ${outDirAbs}`);
}

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
    console.error(usage());
    process.exit(2);
  }

  if (cli.entries && (!cli.entries.clientEntry || !cli.entries.resourceEntry)) {
    console.error("When using role-based entries, both --client-entry and --resource-entry are required.");
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
