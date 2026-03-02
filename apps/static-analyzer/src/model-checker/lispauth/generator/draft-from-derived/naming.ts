import path from "node:path"
import type { AnalysisReport } from "../../../../types/report"
import type { OauthReport } from "./context"

export function buildSpecName(
  report: AnalysisReport,
  frameworkTagSource: string | undefined,
  oauth: OauthReport,
): string {
  const entryBase = path.basename(report.entry, path.extname(report.entry))
  const topOauthFlow = oauth.oauthLikeFlows[0]
  const topFnBase = topOauthFlow?.functionName ? slugForSpecAtom(topOauthFlow.functionName) : undefined
  const frameworkTag = frameworkTagSource ? slugForSpecAtom(frameworkTagSource) : undefined

  return [frameworkTag, "OAuthPKCE", (topFnBase ?? entryBase) || "entry"].filter(Boolean).join("_")
}

export function slugForSpecAtom(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_")
}

export function normalizeEndpoint(raw: string): string | undefined {
  let text = raw.trim()
  text = text.replace(/^['"`]/, "").replace(/['"`]$/, "")
  text = text.replace(/^.*?redirect\(/, "").replace(/\).*$/, "").trim()
  text = text.replace(/\.toString\(\)/g, "")
  if (!text) return undefined

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text)
      return u.pathname || "/"
    } catch {
      return text
    }
  }

  const qPos = text.indexOf("?")
  if (qPos >= 0) text = text.slice(0, qPos)
  return text || undefined
}
