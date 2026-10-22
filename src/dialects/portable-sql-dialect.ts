import { AdapterError } from "../errors.js";
import type { SqlDialect } from "./sql-dialect.js";

export class PortableSqlDialect implements SqlDialect {
    readonly name: string = "portable";

    public contains(text: string, search: string): string {
        throw new AdapterError(
            "UnsupportedDialect",
            `Translating contains(${text}, ${search}) requires an explicit SQL dialect.`,
        );
    }

    public membership(value: string, collection: string): string {
        throw new AdapterError(
            "UnsupportedExpression",
            `Native list membership (${value} IN ${collection}) is not supported by ${this.name}.`,
        );
    }
}
