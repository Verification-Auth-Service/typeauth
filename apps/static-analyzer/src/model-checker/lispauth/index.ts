// lispauth DSL の公開 API。
// 呼び出し側はこのファイルだけを import すれば、内部の責務分割を意識せず使える。
// parser.ts は実装ファイル名、公開APIは DSL 利用者に合わせて parseSyntax を維持する。
export { buildLispauthDsl, buildSpecSyntax, q, renderSyntax, writeLispauthDslReport } from "./generator"
export { buildLispauthDraftFromDerivedReports, buildLispauthDraftUnitsFromDerivedReports } from "./generator"
export { compileSpec, modelCheck, parseSyntax } from "./verifier"
export type { SyntaxNode } from "./shared/syntax-node"
export type { CompiledSpec, ModelCheckResult, TraceStep } from "./verifier/types"
export type {
  BuildLispauthDraftFromDerivedReportsArgs,
  LispauthDraftUnit,
  LispauthDslWriteOptions,
  LispauthDslWriteResult,
  LispauthSpecDraft,
} from "./generator"
