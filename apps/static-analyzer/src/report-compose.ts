import type { AnalysisReport, FileReport, ImportReport } from "./types/report";

/**
 * 入力例: `mergeImports([], [])`
 * 成果物: `source+syntax` 単位で重複排除した import 配列を返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
function mergeImports(base: ImportReport[] | undefined, extra: ImportReport[] | undefined): ImportReport[] | undefined {
  const merged = new Map<string, ImportReport>();
  for (const x of base ?? []) merged.set(`${x.source}\u0000${x.syntax}`, x);
  for (const x of extra ?? []) merged.set(`${x.source}\u0000${x.syntax}`, x);
  return merged.size ? [...merged.values()] : undefined;
}

/**
 * 入力例: `mergeFileReport({ file: "/workspace/src/index.ts", functions: [] }, { file: "/workspace/src/index.ts", functions: [] })`
 * 成果物: `file/imports/functions` を統合した `FileReport` を返す。
 */
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

/**
 * 入力例: `buildCompositeReport("/workspace/src/index.ts", { entry: "/workspace/src/index.ts", files: [] }, [])`
 * 成果物: `entries/tsconfigUsedByEntry/files` をまとめた統合 `AnalysisReport` を返す。
 */
export function buildCompositeReport(entry: string, roleEntries: AnalysisReport["entries"] | undefined, reports: AnalysisReport[]): AnalysisReport {
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
