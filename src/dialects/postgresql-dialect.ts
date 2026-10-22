import { PortableSqlDialect } from "./portable-sql-dialect.js";

export class PostgreSqlDialect extends PortableSqlDialect {
    override readonly name = "postgres";

    public override contains(text: string, search: string): string {
        return `(STRPOS(${text}, ${search}) > 0)`;
    }

    public override membership(value: string, collection: string): string {
        return `(${value} = ANY(${collection}))`;
    }
}
