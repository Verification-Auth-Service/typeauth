export type Location = {
  file: string;
  start: { line: number; character: number };
  end: { line: number; character: number };
};

export type TypeInfo = {
  text: string; // 型の文字列表現
};

export type SymbolInfo = {
  name: string;
  flags?: string;
  declarations?: Location[];
};
