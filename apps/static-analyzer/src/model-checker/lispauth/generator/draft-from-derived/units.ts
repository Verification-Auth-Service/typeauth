import path from "node:path"
import type { AnalysisReport } from "../../../../types/report"
import type { LispauthSpecDraft } from "../types"
import type { LispauthDraftUnit, OauthReport } from "./context"
import { buildEndpointCatalog } from "./analysis"
import { slugForSpecAtom } from "./naming"

export function buildProjectUnits(base: LispauthSpecDraft, report: AnalysisReport): LispauthDraftUnit[] {
  const roles: Array<{ role: string; entry: string }> = []
  if (report.entries?.client) roles.push({ role: "client", entry: report.entries.client })
  if (report.entries?.resourceServer) roles.push({ role: "resource-server", entry: report.entries.resourceServer })
  if (report.entries?.tokenServer) roles.push({ role: "token-server", entry: report.entries.tokenServer })

  if (roles.length === 0) roles.push({ role: "entry", entry: report.entry })

  return roles.map((x) => ({
    unitType: "project" as const,
    unitId: `project-${slugForSpecAtom(path.basename(x.entry, path.extname(x.entry))).toLowerCase() || "entry"}-${x.role}`,
    label: `${x.role}: ${x.entry}`,
    draft: {
      ...base,
      name: `${base.name}__${slugForSpecAtom(x.role)}`,
    },
  }))
}

export function buildHttpEndpointUnits(base: LispauthSpecDraft, oauth: OauthReport): LispauthDraftUnit[] {
  const unique = buildEndpointCatalog(oauth).endpoints
  return unique.map((endpoint) => ({
    unitType: "http-endpoint" as const,
    unitId: `endpoint-${slugForSpecAtom(endpoint).toLowerCase() || "unknown"}`,
    label: endpoint,
    draft: {
      ...base,
      name: `${base.name}__${slugForSpecAtom(endpoint)}`,
      http: {
        focusEndpoint: endpoint,
        endpoints: [endpoint],
        eventEndpoints: (base.http?.eventEndpoints ?? []).filter((x) => x.endpoints.includes(endpoint)),
      },
    },
  }))
}
