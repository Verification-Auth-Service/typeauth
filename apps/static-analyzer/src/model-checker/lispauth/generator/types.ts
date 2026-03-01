import type { SyntaxNode } from "../shared/syntax-node"

export type LispauthSpecDraft = {
  name: string
  machine: {
    states: string[]
    vars: Array<{ name: string; type: SyntaxNode }>
    events: Array<{
      name: string
      params?: Array<{ name: string; type: string }>
      when?: SyntaxNode
      require?: SyntaxNode[]
      do?: SyntaxNode[]
      goto?: string
    }>
  }
  env?: {
    scheduler?: string
    allow?: string[]
    sessions?: number
    time?: { maxSteps?: number; tick?: number }
  }
  property?: {
    invariants?: Array<{ name: string; expr: SyntaxNode }>
    counterexample?: { format?: string; minimize?: "steps" }
  }
}

export type LispauthDslWriteResult = {
  filePath: string
  fileName: string
  dsl: string
}

export type LispauthDslWriteOptions = {
  outDir?: string
  now?: Date
  fileStem?: string
}

