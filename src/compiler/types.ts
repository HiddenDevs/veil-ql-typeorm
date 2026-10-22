import type { Expr, SortDirection } from "@hiddendevs/veil-ql";

export interface FunctionTranslationContext {
    readonly args: readonly Expr[];
    compile(expression: Expr): string;
    bind(value: unknown): string;
}

export type FunctionTranslator = (context: FunctionTranslationContext) => string;

export interface CompiledQuery {
    readonly sql: string;
    readonly parameters: Readonly<Record<string, unknown>>;
    readonly sorts: readonly { readonly field: string; readonly direction: SortDirection }[];
}
