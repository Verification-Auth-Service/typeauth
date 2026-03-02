import type { OauthRedirectRow, OauthReport, OauthUrlParamSetRow } from "./context"
import { extractEndpointReference, normalizeEndpoint } from "./naming"

export type ResolvedOauthEndpoints = {
  catalog: string[]
  byEventKey: Map<string, string[]>
}

const REDIRECT_URI_KEY = "redirect_uri"

function normalizeParamKey(raw: string): string {
  return raw.trim().replace(/^['"`]/, "").replace(/['"`]$/, "")
}

function functionKey(row: { file: string; functionId: string }): string {
  return `${row.file}::${row.functionId}`
}

function eventKey(row: { file: string; functionId: string; eventIndex: number }): string {
  return `${row.file}::${row.functionId}::${row.eventIndex}`
}

function endpointFromParamValue(paramSet: OauthUrlParamSetRow): string | undefined {
  if (normalizeParamKey(paramSet.key) !== REDIRECT_URI_KEY) return undefined
  if (!paramSet.value) return undefined
  return normalizeEndpoint(paramSet.value)
}

function collectParamSetsByFunction(oauth: OauthReport): Map<string, OauthUrlParamSetRow[]> {
  const byFunction = new Map<string, OauthUrlParamSetRow[]>()
  for (const row of oauth.urlParamSets) {
    const key = functionKey(row)
    const current = byFunction.get(key) ?? []
    current.push(row)
    byFunction.set(key, current)
  }
  for (const rows of byFunction.values()) rows.sort((a, b) => a.eventIndex - b.eventIndex)
  return byFunction
}

function findContributingParamSets(
  redirect: OauthRedirectRow,
  byFunction: Map<string, OauthUrlParamSetRow[]>,
): OauthUrlParamSetRow[] {
  const target = redirect.target
  if (!target) return []
  const ref = extractEndpointReference(target)
  if (!ref) return []

  const rows = byFunction.get(functionKey(redirect)) ?? []
  return rows.filter((row) => row.urlExpr === ref && row.eventIndex <= redirect.eventIndex)
}

function addEndpoint(temp: Map<string, Set<string>>, key: string, endpoint: string) {
  const current = temp.get(key) ?? new Set<string>()
  current.add(endpoint)
  temp.set(key, current)
}

function resolveRedirectEndpoints(
  redirect: OauthRedirectRow,
  byFunction: Map<string, OauthUrlParamSetRow[]>,
): { endpoints: string[]; contributors: OauthUrlParamSetRow[] } {
  const direct = redirect.target ? normalizeEndpoint(redirect.target) : undefined
  if (direct) return { endpoints: [direct], contributors: [] }

  const contributors = findContributingParamSets(redirect, byFunction)
  const fromParams = contributors
    .map(endpointFromParamValue)
    .filter((x): x is string => !!x)

  return { endpoints: [...new Set(fromParams)].sort(), contributors }
}

export function resolveOauthEndpoints(oauth: OauthReport): ResolvedOauthEndpoints {
  const byFunction = collectParamSetsByFunction(oauth)
  const byEvent = new Map<string, Set<string>>()

  for (const paramSet of oauth.urlParamSets) {
    const direct = normalizeEndpoint(paramSet.urlExpr)
    if (direct) addEndpoint(byEvent, eventKey(paramSet), direct)

    const valueEndpoint = endpointFromParamValue(paramSet)
    if (valueEndpoint) addEndpoint(byEvent, eventKey(paramSet), valueEndpoint)
  }

  for (const redirect of oauth.redirects) {
    const resolved = resolveRedirectEndpoints(redirect, byFunction)
    if (resolved.endpoints.length === 0) continue

    const redirectKey = eventKey(redirect)
    for (const endpoint of resolved.endpoints) addEndpoint(byEvent, redirectKey, endpoint)

    for (const paramSet of resolved.contributors) {
      const paramSetKey = eventKey(paramSet)
      for (const endpoint of resolved.endpoints) addEndpoint(byEvent, paramSetKey, endpoint)
    }
  }

  const byEventKey = new Map<string, string[]>()
  const catalogSet = new Set<string>()
  for (const [key, endpoints] of byEvent.entries()) {
    const sorted = [...endpoints].sort()
    byEventKey.set(key, sorted)
    for (const endpoint of sorted) catalogSet.add(endpoint)
  }

  return {
    catalog: [...catalogSet].sort(),
    byEventKey,
  }
}
