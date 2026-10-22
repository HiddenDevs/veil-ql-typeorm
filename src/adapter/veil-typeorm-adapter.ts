import type { Query, Schema } from "@hiddendevs/veil-ql";
import type { ObjectLiteral, SelectQueryBuilder } from "typeorm";
import { FieldResolver } from "../compiler/field-resolver.js";
import { ParameterBag } from "../compiler/parameter-bag.js";
import { QueryCompiler } from "../compiler/query-compiler.js";
import type { CompiledQuery, FunctionTranslator } from "../compiler/types.js";
import type { SqlDialect } from "../dialects/sql-dialect.js";
import { PortableSqlDialect } from "../dialects/strategies.js";
import { dialectForDriver } from "./resolve-dialect.js";
import type { AdapterOptions, CompileOptions, QueryInput } from "./types.js";

export class VeilTypeOrmAdapter {
    private readonly schema: Schema;
    private readonly fields: FieldResolver;
    private readonly functions: ReadonlyMap<string, FunctionTranslator>;
    private readonly dialect: SqlDialect | undefined;
    private readonly parameterPrefix: string;
    private readonly description: ReturnType<Schema["describe"]>;

    constructor(options: AdapterOptions) {
        this.schema = options.schema;
        this.description = options.schema.describe();
        this.fields = new FieldResolver(options.fields, this.description);
        this.functions = new Map(Object.entries(options.functions ?? {}));
        this.dialect = options.dialect;
        this.parameterPrefix = options.parameterPrefix ?? "veil";
        new ParameterBag(this.parameterPrefix);
    }

    compile(input: QueryInput, options: CompileOptions = {}): CompiledQuery {
        const query = this.validate(input);
        const compiler = new QueryCompiler(
            this.fields,
            options.dialect ?? this.dialect ?? new PortableSqlDialect(),
            this.functions,
            new ParameterBag(this.parameterPrefix, options.reservedParameters),
            this.description,
        );
        return compiler.compile(query);
    }

    apply<Entity extends ObjectLiteral>(
        builder: SelectQueryBuilder<Entity>,
        input: QueryInput,
    ): SelectQueryBuilder<Entity> {
        const result = this.compile(input, {
            dialect: this.dialect ?? dialectForDriver(builder.connection.options.type),
            reservedParameters: (name) => builder.hasParameter(name),
        });
        const existing = builder.expressionMap.wheres;
        if (existing.length > 0) {
            builder.expressionMap.wheres = [
                { type: "simple", condition: { operator: "brackets", condition: existing } },
            ];
        }
        builder.andWhere(`(${result.sql})`, { ...result.parameters });
        for (const sort of result.sorts) {
            builder.addOrderBy(sort.field, sort.direction);
        }
        return builder;
    }

    private validate(input: QueryInput): Pick<Query, "filter" | "sorts"> {
        if (typeof input === "string") {
            return this.schema.parseQuery(input);
        }
        if ("kind" in input) {
            this.schema.validate(input);
            return { filter: input, sorts: [] };
        }
        this.schema.validateQuery(input);
        return input;
    }
}
