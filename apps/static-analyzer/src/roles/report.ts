import path from "node:path";
import type { AnalysisReport, FileReport } from "../types/report";

export type ReportRole = "client" | "resource-server" | "token-server";

type RoleEntry = {
  role: ReportRole;
  entry: string;
};

export type RoleScopedReport = {
  role: ReportRole;
  entry: string;
  report: AnalysisReport;
};

export type RoleScopedReports = {
  scopedReports: RoleScopedReport[];
  ownershipByFile: Record<string, ReportRole[]>;
};

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function buildRoleScopedReports(report: AnalysisReport): RoleScopedReports {
  const roleEntries = collectRoleEntries(report);
  if (roleEntries.length === 0) {
    return { scopedReports: [], ownershipByFile: {} };
  }

  const fileByAbs = new Map<string, FileReport>();
  for (const file of report.files) fileByAbs.set(path.resolve(file.file), file);
  const knownFiles = new Set(fileByAbs.keys());
  const graph = buildLocalImportGraph(report.files, knownFiles);

  const reachableByRole = new Map<ReportRole, Set<string>>();
  for (const roleEntry of roleEntries) {
    reachableByRole.set(roleEntry.role, traverseReachableFiles(roleEntry.entry, graph, knownFiles));
  }

  const ownershipByFile = new Map<string, ReportRole[]>();
  for (const fileAbs of knownFiles) {
    const owners = roleEntries
      .filter((entry) => reachableByRole.get(entry.role)?.has(fileAbs))
      .map((entry) => entry.role);
    if (owners.length > 0) {
      ownershipByFile.set(fileAbs, owners);
      continue;
    }

    const byDir = roleEntries
      .filter((entry) => isInDirectory(fileAbs, path.dirname(entry.entry)))
      .map((entry) => entry.role);
    ownershipByFile.set(fileAbs, byDir.length > 0 ? byDir : roleEntries.map((entry) => entry.role));
  }

  const scopedReports: RoleScopedReport[] = roleEntries.map(({ role, entry }) => {
    const files = report.files.filter((file) => ownershipByFile.get(path.resolve(file.file))?.includes(role));
    return {
      role,
      entry,
      report: {
        entry,
        entries: toRoleOnlyEntries(role, entry),
        tsconfigUsed: report.tsconfigUsedByEntry?.[entry] ?? report.tsconfigUsed,
        tsconfigUsedByEntry: report.tsconfigUsedByEntry ? { [entry]: report.tsconfigUsedByEntry[entry] } : undefined,
        files,
      },
    };
  });

  const ownershipRecord: Record<string, ReportRole[]> = {};
  for (const [fileAbs, owners] of ownershipByFile.entries()) ownershipRecord[fileAbs] = owners;

  return { scopedReports, ownershipByFile: ownershipRecord };
}

function collectRoleEntries(report: AnalysisReport): RoleEntry[] {
  const out: RoleEntry[] = [];
  if (report.entries?.client) out.push({ role: "client", entry: path.resolve(report.entries.client) });
  if (report.entries?.resourceServer) out.push({ role: "resource-server", entry: path.resolve(report.entries.resourceServer) });
  if (report.entries?.tokenServer) out.push({ role: "token-server", entry: path.resolve(report.entries.tokenServer) });
  return out;
}

function toRoleOnlyEntries(role: ReportRole, entry: string): AnalysisReport["entries"] {
  if (role === "client") return { client: entry };
  if (role === "resource-server") return { resourceServer: entry };
  return { tokenServer: entry };
}

function buildLocalImportGraph(files: FileReport[], knownFiles: Set<string>): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const file of files) {
    const fileAbs = path.resolve(file.file);
    const edges = new Set<string>();
    for (const imp of file.imports ?? []) {
      const resolved = resolveImportToKnownFile(fileAbs, imp.source, knownFiles);
      if (resolved) edges.add(resolved);
    }
    graph.set(fileAbs, edges);
  }
  return graph;
}

function resolveImportToKnownFile(fileAbs: string, importSource: string, knownFiles: Set<string>): string | undefined {
  if (!(importSource.startsWith(".") || importSource.startsWith("/"))) return undefined;

  const base = importSource.startsWith("/")
    ? path.resolve(importSource)
    : path.resolve(path.dirname(fileAbs), importSource);

  const candidates = new Set<string>();
  candidates.add(base);
  for (const ext of RESOLVE_EXTENSIONS) {
    candidates.add(`${base}${ext}`);
    candidates.add(path.join(base, `index${ext}`));
  }

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (knownFiles.has(normalized)) return normalized;
  }
  return undefined;
}

function traverseReachableFiles(start: string, graph: Map<string, Set<string>>, knownFiles: Set<string>): Set<string> {
  const startAbs = path.resolve(start);
  const visited = new Set<string>();
  const stack = knownFiles.has(startAbs) ? [startAbs] : [];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const next of graph.get(current) ?? []) {
      if (!visited.has(next)) stack.push(next);
    }
  }
  return visited;
}

function isInDirectory(filePath: string, directory: string): boolean {
  const rel = path.relative(path.resolve(directory), path.resolve(filePath));
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}
