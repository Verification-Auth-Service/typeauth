import ts from "typescript";
import { describe, expect, it } from "vitest";
import { functionName } from "../helper/function";

const collectFunctions = (code: string): ts.Node[] => {
  const sf = ts.createSourceFile("route.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: ts.Node[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      out.push(node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
};

describe("functionName", () => {
  it("React Router Framework route module exports の名前を推論できる", () => {
    const code = `
      export const loader = async () => {
        return null;
      };

      export const action = async function () {
        return null;
      };

      export const clientLoader = ({ request }: any) => request.url;
    `;

    const names = collectFunctions(code).map((n) => functionName(n));
    expect(names).toEqual(["loader", "action", "clientLoader"]);
  });

  it("default export function の匿名関数名を default として扱う", () => {
    const code = `
      export default function () {
        return null;
      }
    `;

    const [fn] = collectFunctions(code);
    expect(functionName(fn)).toBe("default");
  });
});
