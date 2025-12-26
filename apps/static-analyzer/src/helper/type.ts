import ts from "typescript";
import { TypeInfo } from "../types/tree.js";

export function typeInfo(checker: ts.TypeChecker, node: ts.Node): TypeInfo | undefined {
  try {
    const t = checker.getTypeAtLocation(node);
    return { text: checker.typeToString(t, node, ts.TypeFormatFlags.NoTruncation) };
  } catch {
    return undefined;
  }
}
