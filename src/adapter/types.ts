import type { Expr, Query, Schema } from "@hiddendevs/veil-ql";
import type { FunctionTranslator } from "../compiler/types.js";
import type { SqlDialect } from "../dialects/sql-dialect.js";

export type QueryInput = string | Expr | Query;

export interface AdapterOptions {
    readonly schema: Schema;
    readonly fields: Readonly<Record<string, string>>;
    readonly functions?: Readonly<Record<string, FunctionTranslator>>;
    readonly dialect?: SqlDialect;
    readonly parameterPrefix?: string;
}

export interface CompileOptions {
    readonly dialect?: SqlDialect;
    readonly reservedParameters?: readonly string[] | ((name: string) => boolean);
}
