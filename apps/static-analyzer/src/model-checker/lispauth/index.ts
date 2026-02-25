// lispauth DSL の公開 API。
// 呼び出し側はこのファイルだけを import すれば、内部の責務分割を意識せず使える。
// parser.ts は実装ファイル名、公開APIは DSL 利用者に合わせて parseSexp を維持する。
export { parseSexp } from "./parser"
export { compileSpec } from "./compile"
export { modelCheck } from "./engine"
export type { CompiledSpec, ModelCheckResult, TraceStep, Sexp } from "./types"
