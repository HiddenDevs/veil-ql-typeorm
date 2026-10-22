import { AdapterError } from "./errors.js";

export interface SqlDialect {
    readonly name: string;
    contains(text: string, search: string): string;
    membership(value: string, collection: string): string;
}

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

export function dialectForDriver(driver: string): SqlDialect {
    switch (driver) {
        case "postgres":
        case "aurora-postgres":
        case "cockroachdb":
            return new PostgreSqlDialect();
        case "sqlite":
        case "better-sqlite3":
        case "sqljs":
            return new SqliteDialect();
        case "mysql":
        case "mariadb":
        case "aurora-mysql":
            return new MySqlDialect();
        default:
            throw new AdapterError(
                "UnsupportedDialect",
                `Unsupported TypeORM driver '${driver}'; supply a SqlDialect.`,
            );
    }
}
