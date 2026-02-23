import ts from "typescript";

export type Location = {
  file: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type TypeInfo = {
  text: string; // 型の文字列表現
};

// `ts.SymbolFlags` の名前 (例: "Function", "Variable", "Class" など)
export type SymbolFlagName = keyof typeof ts.SymbolFlags;

export type SymbolInfo = {
  name: string; // シンボル名
  // `ts.SymbolFlags` の生値 (ビットフラグ)
  flagsRaw?: number;
  // ビット分解したフラグ名の一覧 (例: ["Function", "Transient"])
  flagsLabels?: SymbolFlagName[];
  declarations?: Location[]; // 宣言位置のリスト (複数宣言がある場合に備えて配列)
};
