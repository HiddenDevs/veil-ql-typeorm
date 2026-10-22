import type { Span } from "@hiddendevs/veil-ql";

export type AdapterErrorCode =
    "InvalidConfiguration" | "UnmappedField" | "UnsupportedExpression" | "UnsupportedFunction" | "UnsupportedDialect";

export class AdapterError extends Error {
    override readonly name = "AdapterError";

    constructor(
        readonly code: AdapterErrorCode,
        message: string,
        readonly span?: Span,
    ) {
        super(message);
    }
}
