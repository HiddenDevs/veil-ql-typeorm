import type { SqlDialect } from "../dialects/sql-dialect.js";
import { MySqlDialect } from "../dialects/mysql-dialect.js";
import { PostgreSqlDialect } from "../dialects/postgresql-dialect.js";
import { SqliteDialect } from "../dialects/sqlite-dialect.js";
import { AdapterError } from "../errors.js";

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
