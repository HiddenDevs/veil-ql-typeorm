import { PortableSqlDialect } from "./portable-sql-dialect.js";

export class SqliteDialect extends PortableSqlDialect {
    override readonly name = "sqlite";

    public override contains(text: string, search: string): string {
        return `(INSTR(${text}, ${search}) > 0)`;
    }
}
