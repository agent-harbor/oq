/** Typed browser/Node adapter for the shared Rust engine. No document parsing lives here. */
export interface SourceLine {
  text: string;
  line: number;
}
export interface ListItem {
  text: string;
  checkbox: " " | "X" | "-" | null;
  line: number;
  indent: number;
  fields: Record<string, string>;
  field_lines: Record<string, number>;
}
export interface TableRow {
  cells: string[];
  line: number;
}
export interface Body {
  content: SourceLine[];
  items: ListItem[];
  tables: TableRow[][];
}
export interface Section extends Body {
  title: string;
  level: number;
  line: number;
  start: number;
  end: number;
  properties: Record<string, string>;
  property_lines: Record<string, number>;
  property_order: string[];
  drawer_stray_lines: SourceLine[];
  drawer_closed: boolean;
  drawer_line: number | null;
  children: Section[];
}
export interface Document extends Body {
  title: string | null;
  title_line: number | null;
  keywords: { key: string; value: string; line: number }[];
  children: Section[];
  sections: Record<string, Section>;
}
export interface Diagnostic {
  rule_id: string;
  severity: "error" | "warning";
  line: number | null;
  message: string;
}
export interface Validation {
  mode: string | null;
  diagnostics: Diagnostic[];
}
export interface Oq {
  parse(source: string): Document;
  query(source: string, expression: string): unknown[];
  set(source: string, expression: string): string;
  validate(source: string, schema: string): Validation;
}
interface Exports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  oq_alloc(length: number): number;
  oq_execute(pointer: number, length: number): bigint;
  oq_free(pointer: number, length: number): void;
}

/** Instantiate from compiled bytes (Node/browser) or an existing module. */
export async function createOq(
  input: BufferSource | WebAssembly.Module,
): Promise<Oq> {
  const result = await WebAssembly.instantiate(input as BufferSource, {});
  const instance =
    result instanceof WebAssembly.Instance ? result : result.instance;
  const exports = instance.exports as Exports;
  for (const name of ["oq_alloc", "oq_execute", "oq_free"] as const) {
    if (typeof exports[name] !== "function")
      throw new Error(`Missing WASM export ${name}`);
  }
  if (!(exports.memory instanceof WebAssembly.Memory))
    throw new Error("Missing WASM memory");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  function call<T>(request: object): T {
    const bytes = encoder.encode(JSON.stringify(request));
    const pointer = exports.oq_alloc(bytes.length) >>> 0;
    let responsePointer: number | undefined;
    let responseLength = 0;
    try {
      new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
      const packed = exports.oq_execute(pointer, bytes.length);
      responsePointer = Number(packed >> 32n) >>> 0;
      responseLength = Number(packed & 0xffffffffn) >>> 0;
      const response: { ok?: T; error?: string } = JSON.parse(
        decoder.decode(
          new Uint8Array(
            exports.memory.buffer,
            responsePointer,
            responseLength,
          ),
        ),
      );
      if ("error" in response) throw new Error(response.error);
      if (!("ok" in response)) throw new Error("Invalid oq WASM response");
      return response.ok as T;
    } finally {
      if (responsePointer !== undefined)
        exports.oq_free(responsePointer, responseLength);
      exports.oq_free(pointer, bytes.length);
    }
  }
  return {
    parse: (source) => call({ op: "parse", source }),
    query: (source, expression) => call({ op: "query", source, expression }),
    set: (source, expression) => call({ op: "set", source, expression }),
    validate: (source, schema) => call({ op: "validate", source, schema }),
  };
}
