import { AdapterError } from "../errors.js";
import type { SqlDialect } from "./sql-dialect.js";

export class PortableSqlDialect implements SqlDialect {
    readonly name: string = "portable";

    contains(text: string, search: string): string {
        throw new AdapterError(
            "UnsupportedDialect",
            `Translating contains(${text}, ${search}) requires an explicit SQL dialect.`,
        );
    }

    membership(value: string, collection: string): string {
        throw new AdapterError(
            "UnsupportedExpression",
            `Native list membership (${value} IN ${collection}) is not supported by ${this.name}.`,
        );
    }
}

export class PostgreSqlDialect extends PortableSqlDialect {
    override readonly name = "postgres";

    override contains(text: string, search: string): string {
        return `(STRPOS(${text}, ${search}) > 0)`;
    }

    override membership(value: string, collection: string): string {
        return `(${value} = ANY(${collection}))`;
    }
}

export class SqliteDialect extends PortableSqlDialect {
    override readonly name = "sqlite";

    override contains(text: string, search: string): string {
        return `(INSTR(${text}, ${search}) > 0)`;
    }
}

export class MySqlDialect extends PortableSqlDialect {
    override readonly name = "mysql";

    override contains(text: string, search: string): string {
        return `(LOCATE(CAST(${search} AS BINARY), CAST(${text} AS BINARY)) > 0)`;
    }
}
