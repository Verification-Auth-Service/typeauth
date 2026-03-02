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

function unwrapEndpointExpression(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^.*?redirect\(/, "").replace(/\).*$/, "").trim()
  text = text.replace(/^['"`]/, "").replace(/['"`]$/, "")
  return text.trim()
}

function stripQueryAndHash(pathOrRef: string): string {
  const hashPos = pathOrRef.indexOf("#")
  const withoutHash = hashPos >= 0 ? pathOrRef.slice(0, hashPos) : pathOrRef
  const queryPos = withoutHash.indexOf("?")
  return queryPos >= 0 ? withoutHash.slice(0, queryPos) : withoutHash
}

export function normalizeEndpoint(raw: string): string | undefined {
  let text = unwrapEndpointExpression(raw)
  text = text.replace(/\.toString\(\)\s*$/, "").trim()
  if (!text) return undefined

  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text)
      return u.pathname || "/"
    } catch {
      return undefined
    }
  }

  if (!text.startsWith("/")) return undefined
  const normalized = stripQueryAndHash(text)
  return normalized || "/"
}

export function extractEndpointReference(raw: string): string | undefined {
  let text = unwrapEndpointExpression(raw)
  text = text.replace(/\.toString\(\)\s*$/, "").trim()
  if (!text) return undefined
  if (/^https?:\/\//i.test(text)) return undefined
  if (text.startsWith("/")) return undefined
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(text)) return undefined
  return text
}
