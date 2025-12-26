import { Location, TypeInfo, SymbolInfo } from "./tree";

export type PEvent =
  | { kind: "if"; loc: Location; test: string; testType?: TypeInfo }
  | { kind: "switch"; loc: Location; expr: string; exprType?: TypeInfo }
  | { kind: "loop"; loc: Location; loopKind: "for" | "forIn" | "forOf" | "while" | "do"; header: string }
  | { kind: "try"; loc: Location }
  | { kind: "catch"; loc: Location; param?: string; paramType?: TypeInfo }
  | { kind: "finally"; loc: Location }
  | { kind: "return"; loc: Location; expr?: string; exprType?: TypeInfo }
  | { kind: "throw"; loc: Location; expr: string; exprType?: TypeInfo }
  | { kind: "await"; loc: Location; expr: string; exprType?: TypeInfo }
  | {
      // 関数/メソッド/コンストラクタ呼び出し
      kind: "call";
      loc: Location;
      callee: string;
      calleeType?: TypeInfo;
      resolved?: SymbolInfo; // 可能なら呼び出し先シンボル
      args: { text: string; type?: TypeInfo }[];
    }
  | {
      // クラス/コンストラクタ呼び出し
      kind: "new";
      loc: Location;
      classExpr: string;
      classType?: TypeInfo;
      resolved?: SymbolInfo;
      args: { text: string; type?: TypeInfo }[];
    }
  | { kind: "blockEnter"; loc: Location; label: string }
  | { kind: "blockExit"; loc: Location; label: string };
