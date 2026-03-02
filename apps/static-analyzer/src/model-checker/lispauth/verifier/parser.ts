import { isList, isSym, sym } from "../shared/syntax-node"
import type { SyntaxNode } from "../shared/syntax-node"

export { isList, isSym, sym }

/**
 * lispauth DSL を `SyntaxNode` に変換する最小 S 式パーサ。
 *
 * 対応範囲はモデルチェッカ向けの DSL に限定しており、
 * 一般 Lisp の reader macro / dotted pair などは扱わない。
 *
 * @param input DSL テキスト。例:
 * `(spec Mini (machine (states Start Done)) (env) (property))`
 * @returns 構文木。例:
 * `["spec", "Mini", ["machine", ["states", "Start", "Done"]], ["env"], ["property"]]`
 */
export function parseSyntax(input: string): SyntaxNode {
  const tokens = tokenize(input)
  let i = 0

  function parseOne(): SyntaxNode {
    const t = tokens[i]
    if (!t) throw new Error("Unexpected EOF")
    if (t === "(") {
      i += 1
      const out: SyntaxNode[] = []
      while (tokens[i] !== ")") {
        if (i >= tokens.length) throw new Error("Unclosed list")
        out.push(parseOne())
      }
      i += 1
      return out
    }
    if (t === ")") throw new Error("Unexpected )")
    i += 1
    if (t === "true") return true
    if (t === "false") return false
    if (t === "null") return null
    if (/^-?\d+$/.test(t)) return Number(t)
    if (t.startsWith("'")) return sym(t.slice(1))
    if (t.startsWith('"')) return JSON.parse(t)
    return t
  }

  const root = parseOne()
  if (i !== tokens.length) throw new Error("Extra tokens after root")
  return root
}

/**
 * S 式トークナイザ。
 *
 * @param input DSL テキスト。
 * @returns `(`, `)`, 文字列リテラル、atom を切り出したトークン列。
 */
function tokenize(input: string): string[] {
  // tokenizer は parser とは独立させ、構文エラー原因の切り分けをしやすくする。
  // 例: 文字列終端漏れは tokenize 段階で報告できる。
  const out: string[] = []
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (/\s/.test(c)) {
      i += 1
      continue
    }
    if (c === ";") {
      // `;` は行末コメント。
      // サンプル spec での注釈記述をそのまま許容するため、Lisp 互換の扱いに寄せる。
      while (i < input.length && input[i] !== "\n") i += 1
      continue
    }
    if (c === "(" || c === ")") {
      out.push(c)
      i += 1
      continue
    }
    if (c === '"') {
      // JSON.parse で戻す前提なので、ここでは「文字列トークンを丸ごと切り出す」責務に限定する。
      let j = i + 1
      let escaped = false
      while (j < input.length) {
        const cj = input[j]
        if (escaped) {
          escaped = false
          j += 1
          continue
        }
        if (cj === "\\") {
          escaped = true
          j += 1
          continue
        }
        if (cj === '"') break
        j += 1
      }
      if (j >= input.length) throw new Error("Unclosed string literal")
      out.push(input.slice(i, j + 1))
      i = j + 1
      continue
    }

    let j = i
    while (j < input.length && !/\s/.test(input[j]) && input[j] !== "(" && input[j] !== ")" && input[j] !== ";") {
      j += 1
    }
    out.push(input.slice(i, j))
    i = j
  }
  return out
}
