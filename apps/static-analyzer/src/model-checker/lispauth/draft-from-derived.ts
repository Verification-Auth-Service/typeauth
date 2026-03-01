import path from "node:path"
import type { AnalysisReport } from "../../types/report"
import { deriveFrameworkReports } from "../../framework/report"
import { deriveOauthReport } from "../../oauth/report"
import { deriveStateTransitionReport } from "../../state/report"
import { q, type LispauthSpecDraft } from "./builder"

// `src/index.ts` から切り出した「派生レポート -> lispauth DSL 草案」変換ロジック。
//
// 目的:
// - CLI 本体 (`src/index.ts`) の責務を「入出力 orchestration」に寄せる
// - モデル検査ドラフトのヒューリスティクスを単独ファイルでレビューしやすくする
// - 将来的に unit test を足しやすくする
//
// 注意:
// - これは厳密な OAuth 仕様抽出器ではなく、静的解析結果からの「叩き台」生成器
// - false positive / false negative を避け切るのではなく、レビュー初速を上げることが主目的

export type BuildLispauthDraftFromDerivedReportsArgs = {
  report: AnalysisReport
  framework: ReturnType<typeof deriveFrameworkReports>
  oauth: ReturnType<typeof deriveOauthReport>
  state: ReturnType<typeof deriveStateTransitionReport>
}

export type LispauthDraftUnit = {
  unitType: "project" | "http-endpoint"
  unitId: string
  label: string
  draft: LispauthSpecDraft
}

/**
 * 入力例: `buildLispauthDraftFromDerivedReports({ report: { entry: "/workspace/src/index.ts", files: [] }, oauth: { redirects: [], urlParamSets: [], flows: [] }, http: { endpoints: [], redirects: [], urlParamSets: [] } })`
 * 成果物: 派生レポートから単一 `LispauthSpecDraft` を構築して返す。
 */
export function buildLispauthDraftFromDerivedReports(args: BuildLispauthDraftFromDerivedReportsArgs): LispauthSpecDraft {
  const { report, framework, oauth, state } = args

  // spec 名は「どの解析結果から作ったか」を人間が追いやすいことを優先する。
  // ファイル名だけだと OAuth 実装の入口関数が分からないため、取れれば function 名も混ぜる。
  const specName = buildSpecName(report, framework, oauth)

  // URL パラメータ観測結果から、state / PKCE の存在を推定する。
  // ここは厳密判定ではなく「草案にどの require / invariant を入れるか」のヒューリスティクス。
  const observedSignals = inferObservedOauthSignals(oauth)

  // redirect/callback が複数に見える場合は複数セッション干渉の可能性があるため、
  // セッション数を 2 に上げ、cross-delivery を許可して混線を見つけやすくする。
  const explorationProfile = inferExplorationProfile(oauth, state)

  return {
    name: specName,
    machine: buildDefaultOauthPkceMachine(observedSignals),
    env: {
      scheduler: "worst",
      allow: explorationProfile.allowFlags,
      sessions: explorationProfile.sessionCount,
      time: { maxSteps: explorationProfile.maxSteps, tick: 1 },
    },
    property: {
      invariants: buildDefaultInvariants(observedSignals, explorationProfile),
      counterexample: { format: "trace", minimize: "steps" },
    },
  }
}

/**
 * 入力例: `buildLispauthDraftUnitsFromDerivedReports({ report: { entry: "/workspace/src/index.ts", files: [] }, oauth: { redirects: [], urlParamSets: [], flows: [] }, http: { endpoints: [], redirects: [], urlParamSets: [] } })`
 * 成果物: プロジェクト単位/エンドポイント単位の draft 配列を返す。
 */
export function buildLispauthDraftUnitsFromDerivedReports(
  args: BuildLispauthDraftFromDerivedReportsArgs,
): LispauthDraftUnit[] {
  const base = buildLispauthDraftFromDerivedReports(args)
  const projects = buildProjectUnits(base, args.report)
  const endpoints = buildHttpEndpointUnits(base, args.oauth)
  return [...projects, ...endpoints]
}

/**
 * 入力例: `buildSpecName({ entry: "/workspace/src/index.ts", files: [] }, { summary: { detectedFrameworks: ["react-router"], reasons: [] }, reactRouter: undefined }, { summary: { redirectCount: 1, urlParamSetCount: 2, oauthLikeFlowCount: 1 }, redirects: [], urlParamSets: [], oauthLikeFlows: [{ file: "/workspace/src/routes/callback.ts", functionName: "loader", paramKeys: ["\"state\"", "\"client_id\""], score: 2 }] })`
 * 成果物: frameworkや関数名を反映した spec 名文字列を返す。
 */
function buildSpecName(
  report: AnalysisReport,
  framework: ReturnType<typeof deriveFrameworkReports>,
  oauth: ReturnType<typeof deriveOauthReport>,
): string {
  const entryBase = path.basename(report.entry, path.extname(report.entry))
  const topOauthFlow = oauth.oauthLikeFlows[0]
  const topFnBase = topOauthFlow?.functionName ? slugForSpecAtom(topOauthFlow.functionName) : undefined
  const frameworkTag = framework.summary.detectedFrameworks[0] ? slugForSpecAtom(framework.summary.detectedFrameworks[0]) : undefined

  // 例:
  // - React_Router_OAuthPKCE_loader
  // - OAuthPKCE_entry
  return [frameworkTag, "OAuthPKCE", (topFnBase ?? entryBase) || "entry"].filter(Boolean).join("_")
}

/**
 * 入力例: `buildProjectUnits({ name: "OAuthPKCE_entry", machine: { vars: [], events: [], init: [], assumptions: [] }, property: { invariants: [] } }, { entry: "/workspace/src/index.ts", files: [] })`
 * 成果物: role別 entry に対応する project unit 配列を返す。
 */
function buildProjectUnits(base: LispauthSpecDraft, report: AnalysisReport): LispauthDraftUnit[] {
  const roles: Array<{ role: string; entry: string }> = []
  if (report.entries?.client) roles.push({ role: "client", entry: report.entries.client })
  if (report.entries?.resourceServer) roles.push({ role: "resource-server", entry: report.entries.resourceServer })
  if (report.entries?.tokenServer) roles.push({ role: "token-server", entry: report.entries.tokenServer })

  // 役割別 entry が無い場合は単一プロジェクトとして扱う。
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

/**
 * 入力例: `buildHttpEndpointUnits({ redirects: [], urlParamSets: [], flows: [] }, { endpoints: [], redirects: [], urlParamSets: [] })`
 * 成果物: HTTP endpoint ごとの draft unit 配列を返す。
 */
function buildHttpEndpointUnits(
  base: LispauthSpecDraft,
  oauth: ReturnType<typeof deriveOauthReport>,
): LispauthDraftUnit[] {
  const candidates = new Set<string>()
  for (const r of oauth.redirects) {
    if (r.target) candidates.add(r.target)
  }
  for (const flow of oauth.oauthLikeFlows) {
    for (const target of flow.redirectTargets) candidates.add(target)
    candidates.add(flow.urlExpr)
  }

  const normalized = [...candidates]
    .map(normalizeEndpoint)
    .filter((x): x is string => !!x)

  const unique = [...new Set(normalized)]
  return unique.map((endpoint) => ({
    unitType: "http-endpoint" as const,
    unitId: `endpoint-${slugForSpecAtom(endpoint).toLowerCase() || "unknown"}`,
    label: endpoint,
    draft: {
      ...base,
      name: `${base.name}__${slugForSpecAtom(endpoint)}`,
    },
  }))
}

/**
 * 入力例: `normalizeEndpoint("(spec (vars) (machine) (property))")`
 * 成果物: クエリや末尾スラッシュを除去した endpoint 文字列を返す。 失敗時: 条件に合わない場合は `undefined` を返す。
 */
function normalizeEndpoint(raw: string): string | undefined {
  let text = raw.trim()
  text = text.replace(/^['"`]/, "").replace(/['"`]$/, "")
  text = text.replace(/^.*?redirect\(/, "").replace(/\).*$/, "").trim()
  text = text.replace(/\.toString\(\)/g, "")
  if (!text) return undefined

  // URL 文字列ならパス主体で揃えて endpoint 単位の重複を減らす。
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text)
      return u.pathname || "/"
    } catch {
      return text
    }
  }

  // クエリは endpoint 識別に不要なので落とす。
  const qPos = text.indexOf("?")
  if (qPos >= 0) text = text.slice(0, qPos)
  return text || undefined
}

/**
 * 入力例: `slugForSpecAtom("example")`
 * 成果物: spec atom として安全なスラグ文字列を返す。
 */
function slugForSpecAtom(value: string): string {
  // DSL 識別子の見やすさを優先し、記号は `_` に寄せる。
  // `builder.renderAtom()` が最終的にはエスケープしてくれるが、
  // spec 名はファイル名やレビュー画面でも目に入るためここで整えておく。
  return value.replace(/[^A-Za-z0-9_]/g, "_")
}

type ObservedOauthSignals = {
  hasStateParam: boolean
  hasPkce: boolean
}

/**
 * 入力例: `inferObservedOauthSignals({ redirects: [], urlParamSets: [], flows: [] })`
 * 成果物: 観測済み OAuth シグナル（state/pkce 等）を返す。
 */
function inferObservedOauthSignals(oauth: ReturnType<typeof deriveOauthReport>): ObservedOauthSignals {
  // `urlParamSets.key` は JSON 文字列として保持されている (`"state"` のような値)。
  // その仕様に合わせて比較する。
  const observedParamKeys = new Set(oauth.urlParamSets.map((x) => x.key))

  const hasStateParam = observedParamKeys.has("\"state\"")
  const hasPkce =
    observedParamKeys.has("\"code_challenge\"") ||
    observedParamKeys.has("\"code_challenge_method\"")

  return { hasStateParam, hasPkce }
}

type ExplorationProfile = {
  sessionCount: number
  maxSteps: number
  allowFlags: string[]
  terminalHeavy: boolean
}

/**
 * 入力例: `inferExplorationProfile({ redirects: [], urlParamSets: [], flows: [] }, { endpoint: "/oauth/callback" })`
 * 成果物: 探索設定プロファイル（要件フラグ）を返す。
 */
function inferExplorationProfile(
  oauth: ReturnType<typeof deriveOauthReport>,
  state: ReturnType<typeof deriveStateTransitionReport>,
): ExplorationProfile {
  // callback 候補が複数ある = セッション間混線の検査価値が高い、とみなす。
  // `file::functionId` 単位でユニーク化して、同一関数の重複観測で過剰反応しないようにする。
  const callbackFunctions = new Set(oauth.redirects.map((r) => `${r.file}::${r.functionId}`))
  const sessionCount = callbackFunctions.size > 1 || oauth.summary.redirectCount > 1 ? 2 : 1

  // 状態遷移レポートの規模から探索上限を決める。
  // 小さすぎると意味のある反例に届きにくく、大きすぎると探索コストが増えるためクランプする。
  const maxSteps = Math.min(30, Math.max(8, state.summary.functionCount > 20 ? 24 : 16))

  // 終端遷移が多いケースでは Logout 系の invariant を足す価値が高い。
  const terminalHeavy = state.summary.terminalTransitionCount > 0

  const allowFlags = ["reorder", "duplicate", ...(sessionCount > 1 ? (["cross-delivery"] as const) : [])]

  return { sessionCount, maxSteps, allowFlags, terminalHeavy }
}

/**
 * 入力例: `buildDefaultOauthPkceMachine({ hasPkce: true, hasState: true, hasNonce: false, requiredParams: ["\"client_id\"", "\"redirect_uri\""] })`
 * 成果物: PKCE想定のデフォルト状態機械定義を返す。
 */
function buildDefaultOauthPkceMachine(signals: ObservedOauthSignals): LispauthSpecDraft["machine"] {
  // ここで作る machine は「典型 OAuth+PKCE セッション」の抽象化テンプレート。
  // 派生レポートから event 名や状態数を厳密再構成するのではなく、
  // レビュー観点（state 照合 / PKCE verifier / code replay）を検査しやすい構造を優先している。
  return {
    states: ["Start", "AuthStarted", "CodeReceived", "TokenIssued", "LoggedOut"],
    vars: [
      // `session.*` は engine 側でセッションローカルに割り当てられる規約名。
      { name: "session.state", type: ["maybe", "string"] },
      { name: "session.verifier", type: ["maybe", "string"] },
      { name: "session.stage", type: ["enum", "Start", "AuthStarted", "TokenIssued", "LoggedOut"] },

      // 認可コード再利用検査に使うグローバル集合。
      { name: "used-codes", type: ["set", "string"] },

      // engine が進める時刻。今回の invariant では直接使わないが、将来の時間制約追加に備える。
      { name: "now", type: "int" },
    ],
    events: [
      {
        name: "BeginAuth",
        params: [],
        // ログイン開始は初期状態またはログアウト後のみ許可する簡易モデル。
        when: ["or", ["=", "session.stage", q("Start")], ["=", "session.stage", q("LoggedOut")]],
        do: [
          // 実装の具体値は不要なので `fresh` で「新値であること」だけを表現する。
          ["set", "session.state", ["fresh", "state"]],
          ["set", "session.verifier", ["fresh", "verifier"]],
          ["set", "session.stage", q("AuthStarted")],
        ],
        goto: "AuthStarted",
      },
      {
        name: "Callback",
        params: [
          { name: "code", type: "string" },
          { name: "state", type: "string" },
        ],
        when: ["=", "session.stage", q("AuthStarted")],
        // `state` パラメータ観測がある場合のみ、照合 require を草案に含める。
        // 観測が無い実装に無理に入れると、「未実装なのか未観測なのか」の区別が崩れるため。
        require: signals.hasStateParam ? [["=", "state", "session.state"]] : [],
        do: [["noop"]],
        goto: "CodeReceived",
      },
      {
        name: "ExchangeToken",
        params: [
          { name: "code", type: "string" },
          { name: "verifier", type: "string" },
        ],
        when: ["or", ["=", "session.stage", q("AuthStarted")], ["=", "session.stage", q("CodeReceived")]],
        require: [
          // PKCE の兆候が観測できた場合のみ verifier 一致を要求する。
          ...(signals.hasPkce ? [["=", "verifier", "session.verifier"]] : []),
          // コード再利用は常に検査観点として残す。
          ["not", ["in", "code", "used-codes"]],
        ],
        do: [
          ["set", "used-codes", ["add", "used-codes", "code"]],
          ["set", "session.stage", q("TokenIssued")],
        ],
        goto: "TokenIssued",
      },
      {
        name: "Logout",
        params: [],
        // ここは簡易モデルとして常時許可。
        // 厳密な前提条件は対象アプリに依存するため、草案段階では絞り込みすぎない。
        when: true,
        do: [["set", "session.stage", q("LoggedOut")]],
        goto: "LoggedOut",
      },
    ],
  }
}

/**
 * 入力例: `buildDefaultInvariants({ hasPkce: true, hasState: true, hasNonce: false, requiredParams: ["\"client_id\""] }, { requireStateMatch: true, requirePkceOnToken: true, requireNoCodeReuse: true, includeLogoutInvariant: true })`
 * 成果物: 検査用デフォルト不変条件配列を返す。
 */
function buildDefaultInvariants(
  signals: ObservedOauthSignals,
  profile: ExplorationProfile,
): NonNullable<LispauthSpecDraft["property"]>["invariants"] {
  return [
    ...(signals.hasStateParam
      ? [
          {
            name: "callback-must-match-state",
            // Callback が成功遷移した直後なら、受け取った state は session.state と一致しているべき。
            expr: ["=>", ["and", ["=", "last.event", q("Callback")], "last.transitioned"], ["=", "last.args.state", "session.state"]],
          },
        ]
      : []),
    {
      name: "token-issued-requires-verifier",
      // PKCE 観測あり: TokenIssued 到達時に verifier が存在することを要求
      // PKCE 観測なし: 現時点ではこの invariant を tautology にして、将来の手動調整ポイントとして残す
      expr: signals.hasPkce
        ? ["=>", ["=", "session.stage", q("TokenIssued")], ["not", ["=", "session.verifier", null]]]
        : ["=>", ["=", "session.stage", q("TokenIssued")], true],
    },
    {
      name: "no-code-replay",
      // ExchangeToken が成功したなら、その code は `used-codes` に入っているべき。
      // 直前遷移の事後条件として書くことで、再利用検知のレビュー起点にする。
      expr: ["=>", ["and", ["=", "last.event", q("ExchangeToken")], "last.transitioned"], ["in", "last.args.code", "used-codes"]],
    },
    ...(profile.terminalHeavy
      ? [
          {
            name: "logout-reaches-loggedout",
            // 終端遷移が観測されるコードベースでは、logout の到達状態も明示的に確認する価値が高い。
            expr: ["=>", ["and", ["=", "last.event", q("Logout")], "last.transitioned"], ["=", "session.stage", q("LoggedOut")]],
          },
        ]
      : []),
  ]
}
