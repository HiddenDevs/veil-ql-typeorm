import type { Expr, Query, SchemaDescription } from "@hiddendevs/veil-ql";
import type { SqlDialect } from "../dialects/sql-dialect.js";
import { AdapterError } from "../errors.js";
import type { FieldResolver } from "./field-resolver.js";
import type { ParameterBag } from "./parameter-bag.js";
import type { CompiledQuery, FunctionTranslator } from "./types.js";

export class QueryCompiler {
    private readonly returns: ReadonlyMap<string, string>;

    constructor(
        private readonly fields: FieldResolver,
        private readonly dialect: SqlDialect,
        private readonly functions: ReadonlyMap<string, FunctionTranslator>,
        private readonly parameters: ParameterBag,
        description: SchemaDescription,
    ) {
        this.returns = new Map(description.functions.map((fn) => [fn.name, fn.returns ?? "boolean"]));
    }

    compile(query: Pick<Query, "filter" | "sorts">): CompiledQuery {
        const sql = this.expression(query.filter);
        const sorts = query.sorts.map((sort) =>
            Object.freeze({ field: this.fields.resolve(sort.field), direction: sort.direction }),
        );
        return Object.freeze({ sql, parameters: this.parameters.snapshot(), sorts: Object.freeze(sorts) });
    }

    private expression(expression: Expr): string {
        switch (expression.kind) {
            case "literal":
                return expression.value === null ? "NULL" : this.parameters.bind(expression.value);
            case "path":
                return this.fields.resolve(expression);
            case "unary":
                return `(${expression.op === "NOT" ? "NOT " : "-"}${this.expression(expression.expr)})`;
            case "binary":
                return this.binary(expression);
            case "call":
                return this.call(expression);
            case "list":
                throw new AdapterError(
                    "UnsupportedExpression",
                    "List literals are supported only in IN, NOT IN, or contains(list, value). Use a custom function translator for other list operations.",
                    expression.span,
                );
        }
    }

    private binary(expression: Extract<Expr, { kind: "binary" }>): string {
        const { left, right, op } = expression;
        if (op === "IN" || op === "NOT IN") {
            const membership = this.membership(left, right);
            return op === "NOT IN" ? `(NOT ${membership})` : membership;
        }
        if (op === "==" || op === "!=") {
            const leftNull = left.kind === "literal" && left.value === null;
            const rightNull = right.kind === "literal" && right.value === null;
            if (leftNull || rightNull) {
                return `(${this.expression(leftNull ? right : left)} IS ${op === "!=" ? "NOT " : ""}NULL)`;
            }
            if (this.isList(left) || this.isList(right)) {
                throw new AdapterError(
                    "UnsupportedExpression",
                    "List equality requires a custom function translator.",
                    expression.span,
                );
            }
        }
        const operator = op === "==" ? "=" : op === "!=" ? "<>" : op;
        return `(${this.expression(left)} ${operator} ${this.expression(right)})`;
    }

    private membership(value: Expr, collection: Expr): string {
        if (this.isList(value)) {
            throw new AdapterError("UnsupportedExpression", "Nested list membership is not supported.", value.span);
        }
        if (collection.kind === "list") {
            if (collection.items.length === 0) {
                return "(1 = 0)";
            }
            return `(${this.expression(value)} IN (${collection.items.map((item) => this.expression(item)).join(", ")}))`;
        }
        return this.dialect.membership(this.expression(value), this.expression(collection));
    }

    private call(expression: Extract<Expr, { kind: "call" }>): string {
        const translator = this.functions.get(expression.name);
        if (translator !== undefined) {
            const sql = translator({
                args: expression.args,
                compile: (argument) => this.expression(argument),
                bind: (value) => this.parameters.bind(value),
            });
            if (typeof sql !== "string" || sql.trim() === "") {
                throw new AdapterError(
                    "InvalidConfiguration",
                    `Translator '${expression.name}' must return nonempty SQL.`,
                );
            }
            return `(${sql})`;
        }
        if (expression.name === "contains") {
            const [collection, value] = expression.args;
            if (collection !== undefined && value !== undefined) {
                return this.isList(collection)
                    ? this.membership(value, collection)
                    : this.dialect.contains(this.expression(collection), this.expression(value));
            }
        }
        throw new AdapterError(
            "UnsupportedFunction",
            `No SQL translator was registered for '${expression.name}'.`,
            expression.span,
        );
    }

    private isList(expression: Expr): boolean {
        switch (expression.kind) {
            case "list":
                return true;
            case "path":
                return this.fields.typeOf(expression).startsWith("list<");
            case "call":
                return this.returns.get(expression.name)?.startsWith("list<") ?? false;
            default:
                return false;
        }
    }
}
