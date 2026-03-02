import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { deriveFrameworkReports } from "./framework/report";
import { deriveHttpReport } from "./http/report";
import { writeLispauthDslReport } from "./model-checker/lispauth";
import { buildLispauthDraftFromDerivedReports } from "./model-checker/lispauth/generator";
import { deriveOauthReportFromHttp } from "./oauth/report";
import { buildRoleScopedReports, type ReportRole } from "./roles/report";
import { buildReportCoverage } from "./report-coverage";
import { deriveStateTransitionReport } from "./state/report";
import type { AnalysisReport } from "./types/report";

/**
 * 入力例: `confirmDelete("/oauth/callback?code=abc")`
 * 成果物: 対話入力の結果を `Promise<boolean>` で返す。`yes` 系なら `true`、それ以外は `false`。
 */
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

/**
 * 入力例: `commonPathPrefix(["/a.ts", "/b.ts"])`
 * 成果物: 複数パスの共通プレフィックスとなる絶対パス文字列を返す。
 */
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

/**
 * 入力例: `writeJson("/workspace/report/report.json", { entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: 任意オブジェクトを整形JSONで保存する。戻り値はない。
 */
function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/**
 * 入力例: `toSafeFileStem("example")`
 * 成果物: ファイル名に使える安全なスラグ文字列を返す。
 */
function toSafeFileStem(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "unit";
}

function writeFrameworkReport(dir: string, report: ReturnType<typeof deriveFrameworkReports>) {
  writeJson(path.join(dir, "_summary.json"), report.summary);
  for (const [name, payload] of Object.entries(report.outputs)) {
    writeJson(path.join(dir, `${name}.json`), payload);
  }
}

function writeHttpReport(
  dir: string,
  report: ReturnType<typeof deriveHttpReport>,
  options: { writeEndpointFiles?: boolean } = {},
) {
  writeJson(path.join(dir, "_summary.json"), report.summary);
  writeJson(
    path.join(dir, "endpoints.json"),
    report.endpoints.map((x) => ({
      endpoint: x.endpoint,
      fileCount: x.files.length,
      functionCount: x.functions.length,
      redirectCount: x.redirects.length,
      urlParamSetCount: x.urlParamSets.length,
    })),
  );
  writeJson(path.join(dir, "unresolved.json"), report.unresolved);
  if (options.writeEndpointFiles === false) return;

  const usedNames = new Map<string, number>();
  for (const row of report.endpoints) {
    const stemBase = toSafeFileStem(row.endpoint);
    const num = usedNames.get(stemBase) ?? 0;
    usedNames.set(stemBase, num + 1);
    const suffix = num === 0 ? "" : `-${num + 1}`;
    writeJson(path.join(dir, `${stemBase}${suffix}.json`), row);
  }
}

function writeOauthReport(dir: string, report: ReturnType<typeof deriveOauthReportFromHttp>) {
  writeJson(path.join(dir, "_summary.json"), report.summary);
  writeJson(path.join(dir, "redirects.json"), report.redirects);
  writeJson(path.join(dir, "url-param-sets.json"), report.urlParamSets);
  writeJson(path.join(dir, "flows.json"), report.oauthLikeFlows);
}

/**
 * 入力例: `writeSingleReport({ entry: "/workspace/src/index.ts", files: [] }, "/workspace/src/index.ts")`
 * 成果物: レポートJSONを1ファイルへ保存する。戻り値はない。
 */
export function writeSingleReport(report: AnalysisReport, outFile: string) {
  const outAbs = path.resolve(outFile);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.error(`Saved report to ${outAbs}`);
}

/**
 * 入力例: `writeDirectoryReport({ entry: "/workspace/src/index.ts", files: [] }, "/workspace/src/index.ts")`
 * 成果物: 派生レポート一式をディレクトリ構成で保存する。
 */
export async function writeDirectoryReport(report: AnalysisReport, outDir: string) {
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
  // - source-derived/http      : flow + framework を HTTP endpoint 単位に再編したビュー
  // - source-derived/oauth     : HTTP 派生ビューから OAuth/OIDC 観点を抽出したビュー
  const sourceDerivedDir = path.join(outDirAbs, "source-derived");
  const flowDir = path.join(sourceDerivedDir, "flow");
  const frameworkDir = path.join(sourceDerivedDir, "framework");
  const oauthDir = path.join(sourceDerivedDir, "oauth");
  const httpDir = path.join(sourceDerivedDir, "http");
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
  const scoped = buildRoleScopedReports(report);

  const framework = deriveFrameworkReports(report);
  writeFrameworkReport(frameworkDir, framework);

  const http = deriveHttpReport(report, framework);
  writeHttpReport(httpDir, http, { writeEndpointFiles: scoped.scopedReports.length === 0 });

  const oauth = deriveOauthReportFromHttp(http);
  writeOauthReport(oauthDir, oauth);

  const frameworkByRole: Partial<Record<ReportRole, ReturnType<typeof deriveFrameworkReports>>> = {};
  const oauthByRole: Partial<Record<ReportRole, ReturnType<typeof deriveOauthReportFromHttp>>> = {};
  const stateByRole: Partial<Record<ReportRole, ReturnType<typeof deriveStateTransitionReport>>> = {};
  for (const roleScope of scoped.scopedReports) {
    const frameworkRole = deriveFrameworkReports(roleScope.report);
    const httpRole = deriveHttpReport(roleScope.report, frameworkRole);
    const oauthRole = deriveOauthReportFromHttp(httpRole);
    const stateRole = deriveStateTransitionReport(roleScope.report);

    const roleFrameworkDir = path.join(frameworkDir, "by-role", roleScope.role);
    const roleHttpDir = path.join(httpDir, "by-role", roleScope.role);
    const roleOauthDir = path.join(oauthDir, "by-role", roleScope.role);
    writeFrameworkReport(roleFrameworkDir, frameworkRole);
    writeHttpReport(roleHttpDir, httpRole);
    writeOauthReport(roleOauthDir, oauthRole);

    frameworkByRole[roleScope.role] = frameworkRole;
    oauthByRole[roleScope.role] = oauthRole;
    stateByRole[roleScope.role] = stateRole;
  }
  if (scoped.scopedReports.length > 0) {
    const byRoleMeta = scoped.scopedReports.map((x) => ({
      role: x.role,
      entry: x.entry,
      fileCount: x.report.files.length,
    }));
    writeJson(path.join(sourceDerivedDir, "by-role", "_meta.json"), {
      roles: byRoleMeta,
      ownershipByFile: scoped.ownershipByFile,
    });
  }

  // `const report = analyze(entry)` の返り値をそのまま入力にして state を派生する。
  // 既にメモリ上にある `report` を使うため、flow JSON の再読込や再解析は不要。
  const state = deriveStateTransitionReport(report);
  writeJson(path.join(stateDir, "_summary.json"), state.summary);
  writeJson(path.join(stateDir, "files.json"), state.files);
  writeJson(path.join(stateDir, "functions.json"), state.functions);

  const coverage = buildReportCoverage(report, framework, http, oauth, state);
  writeJson(path.join(outDirAbs, "_coverage.json"), coverage);
  writeJson(path.join(sourceDerivedDir, "_coverage.json"), coverage);

  // OAuth 解析結果から、lispauth モデル検査の叩き台 DSL を同梱する。
  // 固定テンプレではなく、framework/oauth/state 派生レポートを材料にドラフト化する。
  const lispauthOutDir = path.join(outDirAbs, "model-checker", "lispauth");
  const lispauthDraft = buildLispauthDraftFromDerivedReports({ report, framework, oauth, state });
  const lispauthFile = writeLispauthDslReport(lispauthDraft, { outDir: lispauthOutDir });
  const roleDslFiles: Array<{ role: ReportRole; file: string }> = [];
  for (const roleScope of scoped.scopedReports) {
    const frameworkRole = frameworkByRole[roleScope.role];
    const oauthRole = oauthByRole[roleScope.role];
    const stateRole = stateByRole[roleScope.role];
    if (!frameworkRole || !oauthRole || !stateRole) continue;

    const draft = buildLispauthDraftFromDerivedReports({
      report: roleScope.report,
      framework: frameworkRole,
      oauth: oauthRole,
      state: stateRole,
    });
    const file = writeLispauthDslReport(draft, {
      outDir: path.join(lispauthOutDir, "by-role"),
      fileStem: roleScope.role,
    });
    roleDslFiles.push({ role: roleScope.role, file: path.join("by-role", file.fileName) });
  }
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
    unifiedDsl: true,
    byRoleDslCount: roleDslFiles.length,
    byProjectDslCount: 0,
    byHttpEndpointDslCount: 0,
    dslFiles: {
      main: lispauthFile.fileName,
      byRole: roleDslFiles,
      byProject: [],
      byHttpEndpoint: [],
    },
  });

  console.error(`Saved directory report to ${outDirAbs}`);
}
