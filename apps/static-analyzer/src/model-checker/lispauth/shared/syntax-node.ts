export type SymbolAtom = { kind: "symbol"; name: string }
export type SyntaxNode = string | number | boolean | null | SymbolAtom | SyntaxNode[]

export function sym(name: string): SymbolAtom {
  return { kind: "symbol", name }
}

export function isSym(x: SyntaxNode, name?: string): x is SymbolAtom {
  return typeof x === "object" && x !== null && !Array.isArray(x) && x.kind === "symbol" && (name ? x.name === name : true)
}

export function isList(x: SyntaxNode): x is SyntaxNode[] {
  return Array.isArray(x)
}

