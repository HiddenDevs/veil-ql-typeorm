import { parse, parseQuery, Schema } from "@hiddendevs/veil-ql";
import { Brackets, DataSource, EntitySchema } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VeilTypeOrmAdapter } from "../src/index.js";

interface User {
    id: number;
    tenant: number;
    name: string;
    age: number;
    email: string | null;
    active: boolean;
}

const UserEntity = new EntitySchema<User>({
    name: "User",
    columns: {
        id: { type: Number, primary: true },
        tenant: { type: Number },
        name: { type: String, name: "display_name" },
        age: { type: Number },
        email: { type: String, nullable: true },
        active: { type: Boolean },
    },
});

const schema = Schema.fromObject({
    fields: {
        name: { type: "string", sortable: true },
        age: { type: "number", sortable: true },
        email: { type: "string", nullable: true },
        active: { type: "boolean" },
    },
});

const fields = { name: "user.name", age: "user.age", email: "user.email", active: "user.active" };
const adapter = new VeilTypeOrmAdapter({ schema, fields });
const database = new DataSource({ type: "sqljs", entities: [UserEntity], synchronize: true });

beforeAll(async () => {
    await database.initialize();
    await database.getRepository(UserEntity).insert([
        { id: 1, tenant: 1, name: "Alice", age: 30, email: null, active: true },
        { id: 2, tenant: 1, name: "Bob", age: 20, email: "bob@example.com", active: false },
        { id: 3, tenant: 2, name: "Carol", age: 40, email: null, active: true },
        { id: 4, tenant: 1, name: "100%_match", age: 25, email: null, active: true },
    ]);
});

afterAll(async () => {
    if (database.isInitialized) await database.destroy();
});

function builder() {
    return database.getRepository(UserEntity).createQueryBuilder("user");
}

describe("VeilTypeOrmAdapter", () => {
    it("preserves tenant restrictions and groups OR filters", async () => {
        const query = builder().where("user.tenant = :tenant", { tenant: 1 });
        expect(adapter.apply(query, "age >= 30 OR age == 20 SORT BY age DESC")).toBe(query);
        expect((await query.getMany()).map((user) => user.id)).toEqual([1, 2]);
    });

    it("binds untrusted literals without interpolating SQL", async () => {
        const query = adapter.apply(builder(), 'name == "Alice\' OR 1=1 --"');
        expect(query.getQuery()).not.toContain("OR 1=1");
        expect(query.getParameters()).toEqual({ veil_0: "Alice' OR 1=1 --" });
        expect(await query.getMany()).toEqual([]);
    });

    it("intersects existing top-level OR conditions with the entire filter", async () => {
        const query = builder().where("user.tenant = :tenant", { tenant: 1 }).orWhere("user.id = :id", { id: 3 });
        adapter.apply(query, "age == 20");
        expect((await query.getMany()).map((user) => user.id)).toEqual([2]);
    });

    it("preserves nested Brackets and raw OR predicates", async () => {
        const query = builder().where(
            new Brackets((where) => {
                where.where("user.id = :first OR user.id = :second", { first: 1, second: 2 });
            }),
        );
        adapter.apply(query, "active");
        expect((await query.getMany()).map((user) => user.id)).toEqual([1]);
    });

    it("appends sorting without replacing an existing primary order or pagination", async () => {
        const query = builder().orderBy("user.tenant", "DESC").take(2).skip(1);
        adapter.apply(query, "true SORT BY age DESC, name");
        expect(query.expressionMap.orderBys).toEqual({ "user.tenant": "DESC", "user.age": "DESC", "user.name": "ASC" });
        expect((await query.getMany()).map((user) => user.id)).toEqual([1, 4]);
    });

    it("accepts and revalidates both filter and query ASTs", async () => {
        expect((await adapter.apply(builder(), parse("age == 20")).getMany()).map((user) => user.id)).toEqual([2]);
        const query = adapter.apply(builder(), parseQuery("active SORT BY age DESC"));
        expect((await query.getMany()).map((user) => user.id)).toEqual([3, 1, 4]);
        expect(() => adapter.apply(builder(), parse('age == "wrong"'))).toThrow();
    });

    it("does not overwrite existing parameters or parameters from earlier applications", async () => {
        const query = builder().where("user.tenant = :veil_0", { veil_0: 1 });
        adapter.apply(query, "age >= 20");
        adapter.apply(query, "age < 30");
        expect(query.getParameters()).toEqual({ veil_0: 1, veil_1: 20, veil_2: 30 });
        expect((await query.getMany()).map((user) => user.id)).toEqual([2, 4]);
    });

    it("does not overwrite parameters owned by a subquery's parent", () => {
        const parent = builder().where("user.tenant = :veil_0", { veil_0: 1 });
        const subquery = parent.subQuery().select("user.id").from(UserEntity, "user");
        adapter.apply(subquery, "age == 20");
        expect(parent.getParameters()).toEqual({ veil_0: 1, veil_1: 20 });
        expect(subquery.getParameters()).toEqual({ veil_1: 20 });
    });

    it("uses caller-owned joins without creating or replacing them", async () => {
        const joined = new VeilTypeOrmAdapter({ schema, fields: { ...fields, name: "peer.name" } });
        const query = builder().leftJoin("User", "peer", "peer.id = user.id");
        joined.apply(query, 'name == "Alice"');
        expect((await query.getMany()).map((user) => user.id)).toEqual([1]);
        expect(query.expressionMap.joinAttributes).toHaveLength(1);
    });

    it("executes nested custom functions using compiled arguments", async () => {
        const functionsSchema = Schema.fromObject({
            fields: { name: { type: "string" } },
            functions: {
                lower: { parameters: ["string"], returns: "string" },
                length: { parameters: ["string"], returns: "number" },
            },
        });
        const custom = new VeilTypeOrmAdapter({
            schema: functionsSchema,
            fields: { name: "user.name" },
            functions: {
                lower: ({ args, compile }) => `LOWER(${compile(args[0]!)})`,
                length: ({ args, compile }) => `LENGTH(${compile(args[0]!)})`,
            },
        });
        const query = custom.apply(builder(), 'lower(name) == "alice" AND length(name) == 5');
        expect((await query.getMany()).map((user) => user.id)).toEqual([1]);
    });

    it("uses mapped entity properties, including renamed database columns", async () => {
        const query = adapter.apply(builder(), 'name == "Alice"');
        expect(query.getSql()).toContain('"user"."display_name"');
        expect((await query.getMany()).map((user) => user.id)).toEqual([1]);
    });

    it.each([
        ["email == null", [1, 3, 4]],
        ["null != email", [2]],
        ["age IN []", []],
        ["age NOT IN []", [1, 2, 3, 4]],
        ["age IN [20, 30]", [1, 2]],
        ["NOT active AND -age < -10", [2]],
        ['contains(name, "%_")', [4]],
        ['contains(name, "alice")', []],
    ])("executes %s", async (source, ids) => {
        const query = adapter.apply(builder().orderBy("user.id"), source as string);
        expect((await query.getMany()).map((user) => user.id)).toEqual(ids);
    });

    it("does not mutate a builder on validation or translation failure", () => {
        const query = builder().where("user.tenant = :tenant", { tenant: 1 }).orderBy("user.id");
        const before = query.getQueryAndParameters();
        expect(() => adapter.apply(query, 'age == "wrong"')).toThrow();
        expect(query.getQueryAndParameters()).toEqual(before);
    });

    it("leaves all state untouched when a valid query cannot be translated", () => {
        const customSchema = Schema.fromObject({
            fields: { age: { type: "number", sortable: true } },
            functions: { positive: { parameters: ["number"], returns: "boolean" } },
        });
        const custom = new VeilTypeOrmAdapter({ schema: customSchema, fields: { age: "user.age" } });
        const query = builder().where("user.tenant = :tenant", { tenant: 1 }).orWhere("user.id = 3").orderBy("user.id");
        const before = query.getQueryAndParameters();
        const wheres = query.expressionMap.wheres;
        expect(() => custom.apply(query, "age > 10 AND positive(age) SORT BY age")).toThrow("No SQL translator");
        expect(query.getQueryAndParameters()).toEqual(before);
        expect(query.expressionMap.wheres).toBe(wheres);
        expect(query.expressionMap.orderBys).toEqual({ "user.id": "ASC" });
    });
});
