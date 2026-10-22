import { PortableSqlDialect } from "./portable-sql-dialect.js";

export class MySqlDialect extends PortableSqlDialect {
    override readonly name = "mysql";

    public override contains(text: string, search: string): string {
        return `(LOCATE(CAST(${search} AS BINARY), CAST(${text} AS BINARY)) > 0)`;
    }
}
