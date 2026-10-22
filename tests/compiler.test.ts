import { parse, parseQuery, Schema, ValidationError } from "@hiddendevs/veil-ql";
import { describe, expect, it } from "vitest";
import { AdapterError, MySqlDialect, PostgreSqlDialect, SqliteDialect, VeilTypeOrmAdapter } from "../src/index.js";
import type { AdapterOptions, FunctionTranslator } from "../src/index.js";

const schema = Schema.fromObject({
    fields: {
        age: { type: "number", sortable: true },
        otherAge: { type: "number" },
        name: { type: "string", sortable: true },
        email: { type: "string", nullable: true },
        tags: { type: { list: "string" } },
        nullableTags: { type: { list: "string" }, nullable: true },
        active: { type: "boolean" },
        createdAt: { type: "number", filterable: false, sortable: true },
    },
    functions: {
        contains: true,
        length: { parameters: ["string"], returns: "number" },
        lower: { parameters: ["string"], returns: "string" },
        tagsFor: { parameters: ["string"], returns: { list: "string" } },
    },
});

const fields = Object.fromEntries(schema.describe().fields.map((field) => [field.name, `user.${field.name}`]));

function adapter(options: Partial<AdapterOptions> = {}) {
    return new VeilTypeOrmAdapter({ schema, fields, ...options });
}

describe("SQL compilation", () => {
    it.each([
        ["==", "="],
        ["!=", "<>"],
        [">", ">"],
        [">=", ">="],
        ["<", "<"],
        ["<=", "<="],
    ])("translates %s with bound literals", (source, sql) => {
        expect(adapter().compile(`age ${source} 18`)).toEqual({
            sql: `(user.age ${sql} :veil_0)`,
            parameters: { veil_0: 18 },
            sorts: [],
        });
    });

    it("preserves boolean precedence and unary negation", () => {
        expect(adapter().compile("NOT active OR age >= 18 AND -age < -10").sql).toBe(
            "((NOT user.active) OR ((user.age >= :veil_0) AND ((-user.age) < (-:veil_1))))",
        );
    });

    it("supports field-to-field comparisons and expression membership lists", () => {
        expect(adapter().compile("age > otherAge").sql).toBe("(user.age > user.otherAge)");
        expect(adapter().compile("age IN [otherAge, -10]").sql).toBe("(user.age IN (user.otherAge, (-:veil_0)))");
    });

    it("supports parsed AST inputs and validates them again", () => {
        expect(adapter().compile(parse("age >= 18"))).toEqual(adapter().compile("age >= 18"));
        expect(adapter().compile(parseQuery("active SORT BY age DESC, name")).sorts).toEqual([
            { field: "user.age", direction: "DESC" },
            { field: "user.name", direction: "ASC" },
        ]);
        expect(() => adapter().compile(parse('age == "18"'))).toThrow(ValidationError);
        expect(() => adapter().compile(parseQuery("active SORT BY email"))).toThrow(ValidationError);
    });

    it.each(["unknown == 1", "createdAt == 10", "active SORT BY tags", "active SORT BY email", "unknown(age)"])(
        "rejects invalid queries: %s",
        (source) => {
            expect(() => adapter().compile(source)).toThrow(ValidationError);
        },
    );

    it("supports sort-only fields", () => {
        expect(adapter().compile("true SORT BY createdAt").sorts).toEqual([
            { field: "user.createdAt", direction: "ASC" },
        ]);
    });

    it.each(["email == null", "null == email", "nullableTags == null"])("translates null checks: %s", (source) => {
        const result = adapter().compile(source);
        expect(result.sql).toContain(" IS NULL)");
        expect(result.parameters).toEqual({});
    });

    it("allocates isolated parameters with a configurable prefix", () => {
        const instance = adapter({ parameterPrefix: "filter" });
        expect(instance.compile("age == 18", { reservedParameters: ["filter_0", "filter_2"] }).parameters).toEqual({
            filter_1: 18,
        });
        expect(instance.compile("age == 19").parameters).toEqual({ filter_0: 19 });
    });

    it("returns immutable compilation results", () => {
        const result = adapter().compile("age == 18 SORT BY age");
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.parameters)).toBe(true);
        expect(Object.isFrozen(result.sorts)).toBe(true);
        expect(Object.isFrozen(result.sorts[0])).toBe(true);
    });

    it("copies mapping and translator configuration", () => {
        const mappings = { ...fields };
        const functions: Record<string, FunctionTranslator> = { length: () => "10" };
        const instance = adapter({ fields: mappings, functions });
        mappings.age = "other.age";
        functions.length = () => "20";
        expect(instance.compile("length(name) == age").sql).toBe("((10) = user.age)");
    });
});

describe("SQL dialect strategies", () => {
    it.each([
        [new PostgreSqlDialect(), "(STRPOS(user.name, :veil_0) > 0)"],
        [new SqliteDialect(), "(INSTR(user.name, :veil_0) > 0)"],
        [new MySqlDialect(), "(LOCATE(CAST(:veil_0 AS BINARY), CAST(user.name AS BINARY)) > 0)"],
    ])("compiles literal substring matching for $name", (dialect, sql) => {
        const result = adapter({ dialect }).compile('contains(name, "%_\\\\")');
        expect(result.sql).toBe(sql);
        expect(result.parameters).toEqual({ veil_0: "%_\\" });
    });

    it("allows a per-compilation dialect override", () => {
        expect(
            adapter({ dialect: new SqliteDialect() }).compile('contains(name, "A")', {
                dialect: new PostgreSqlDialect(),
            }).sql,
        ).toBe("(STRPOS(user.name, :veil_0) > 0)");
    });

    it("requires a dialect for standalone string contains compilation", () => {
        expect(() => adapter().compile('contains(name, "A")')).toThrow(AdapterError);
    });

    it.each([
        ['"trusted" IN tags', "(:veil_0 = ANY(user.tags))"],
        ['"trusted" NOT IN tags', "(NOT (:veil_0 = ANY(user.tags)))"],
        ['contains(tags, "trusted")', "(:veil_0 = ANY(user.tags))"],
    ])("supports PostgreSQL native array membership: %s", (source, sql) => {
        expect(adapter({ dialect: new PostgreSqlDialect() }).compile(source).sql).toBe(sql);
    });

    it("supports list-returning custom functions in PostgreSQL membership", () => {
        const instance = adapter({
            dialect: new PostgreSqlDialect(),
            functions: { tagsFor: ({ args, compile }) => `tags_for(${compile(args[0]!)})` },
        });
        expect(instance.compile('contains(tagsFor(name), "trusted")').sql).toBe(
            "(:veil_0 = ANY((tags_for(user.name))))",
        );
    });

    it("supports contains on literal lists without a dialect", () => {
        expect(adapter().compile('contains(["Alice", "Bob"], name)').sql).toBe("(user.name IN (:veil_0, :veil_1))");
        expect(adapter().compile("contains([], age)").sql).toBe("(1 = 0)");
    });

    it.each([new SqliteDialect(), new MySqlDialect()])("rejects unsupported native arrays for $name", (dialect) => {
        expect(() => adapter({ dialect }).compile('contains(tags, "trusted")')).toThrow("Native list membership");
    });

    it.each(['tags == ["trusted"]', "tags != tags", 'tags IN [["trusted"]]'])(
        "rejects unsupported list semantics rather than generating incorrect SQL: %s",
        (source) => {
            expect(() => adapter({ dialect: new PostgreSqlDialect() }).compile(source)).toThrow(AdapterError);
        },
    );
});

describe("function translators", () => {
    it("supports nested calls and safely bound translator-owned values", () => {
        const instance = adapter({
            functions: {
                lower: ({ args, compile }) => `LOWER(${compile(args[0]!)})`,
                length: ({ args, compile, bind }) => `LENGTH(${compile(args[0]!)}) + ${bind(2)}`,
            },
        });
        expect(instance.compile("length(lower(name)) > 5")).toEqual({
            sql: "((LENGTH((LOWER(user.name))) + :veil_0) > :veil_1)",
            parameters: { veil_0: 2, veil_1: 5 },
            sorts: [],
        });
    });

    it("reports missing implementations with a structured error and source span", () => {
        try {
            adapter().compile("length(name) > 5");
            expect.fail("Expected translation to fail");
        } catch (error) {
            expect(error).toBeInstanceOf(AdapterError);
            expect(error).toMatchObject({ code: "UnsupportedFunction", name: "AdapterError" });
            expect((error as AdapterError).span).toBeDefined();
        }
    });

    it("rejects empty translator output", () => {
        expect(() => adapter({ functions: { length: () => " " } }).compile("length(name) > 5")).toThrow(
            "must return nonempty SQL",
        );
    });

    it("permits application-owned translators for built-in functions", () => {
        expect(adapter({ functions: { contains: () => "1 = 1" } }).compile('contains(tags, "trusted")').sql).toBe(
            "(1 = 1)",
        );
    });
});

describe("configuration validation", () => {
    it("requires explicit mappings for every schema field", () => {
        expect(() => adapter({ fields: {} })).toThrow("No TypeORM property mapping");
    });

    it("rejects mappings not declared in the schema", () => {
        expect(() => adapter({ fields: { ...fields, unknown: "user.secret" } })).toThrow("not declared");
    });

    it.each(["user.age; DROP TABLE users", "user.age DESC", "age", "LOWER(user.name)", "user.age --"])(
        "rejects non-property mappings: %s",
        (target) => {
            expect(() => adapter({ fields: { ...fields, age: target } })).toThrow("alias.property");
        },
    );

    it.each(["", "bad-prefix", "param.name", "1param"])("rejects invalid parameter prefixes: %s", (parameterPrefix) => {
        expect(() => adapter({ parameterPrefix })).toThrow("parameterPrefix");
    });
});
