import path from "node:path";
import type { AnalysisReport } from "./types/report";

export type EntryRoles = {
  clientEntry?: string;
  resourceEntry?: string;
  tokenEntry?: string;
};

export type CliArgs = {
  dirMode: boolean;
  entry?: string;
  entries?: EntryRoles;
  outputPath?: string;
  compactLinearTransitions?: boolean;
  error?: string;
};

export type ResolvedEntries = {
  entry: string;
  roleEntries?: AnalysisReport["entries"];
  analyzeTargets: string[];
};

/**
 * 入力例: `parseArgs(["/a.ts", "/b.ts"])`
 * 成果物: CLI引数を解釈した `CliArgs` を返す。オプション不足時は `error` を設定する。
 */
export function parseArgs(argv: string[]): CliArgs {
  let dirMode = false;
  let compactLinearTransitions: boolean | undefined;
  const entries: EntryRoles = {};

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "-d") {
      dirMode = true;
      continue;
    }
    if (a === "--compact-linear-transitions") {
      compactLinearTransitions = true;
      continue;
    }
    if (a === "--no-compact-linear-transitions") {
      compactLinearTransitions = false;
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
    compactLinearTransitions,
  };
}

/**
 * 入力例: `usage()`
 * 成果物: 実行方法を複数行でまとめたヘルプ文字列を返す。
 */
export function usage(): string {
  return [
    "Usage:",
    "  static-analyzer <entry-file.ts> [output-file.json]",
    "  static-analyzer -d <entry-file.ts> [output-dir]",
    "  static-analyzer [ -d ] --client-entry <file> --resource-entry <file> [--token-entry <file>] [output]",
    "Options:",
    "  --compact-linear-transitions      Emit lispauth chain shorthand for linear transitions (default).",
    "  --no-compact-linear-transitions   Keep expanded event blocks instead of chain shorthand.",
  ].join("\n");
}

/**
 * 入力例: `resolveRequestedEntries({ dirMode: false, entry: "./src/index.ts" })`
 * 成果物: 解析対象の entry 群を解決し、解決不能なら `null` を返す。
 */
export function resolveRequestedEntries(cli: CliArgs): ResolvedEntries | null {
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
