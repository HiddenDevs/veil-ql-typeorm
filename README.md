# Veil-QL TypeORM

Apply [Veil-QL](https://www.npmjs.com/package/@hiddendevs/veil-ql) filters and
sorting to TypeORM `SelectQueryBuilder` instances. Query text is validated
against your schema, fields resolve through explicit mappings, and values are
bound as parameters rather than interpolated into SQL.

## Install

Requires Node.js 22.12+, TypeORM `^0.3.28`, and Veil-QL `^1.0.2`, matching this
package's peer dependency ranges. Install your database driver separately.

```sh
npm install @hiddendevs/veil-ql-typeorm @hiddendevs/veil-ql typeorm
```

Both ESM `import` and CommonJS `require()` are supported. CommonJS uses Node.js
22.12+'s synchronous ESM loading; both entry points load the same module.
CommonJS applications that also `require("@hiddendevs/veil-ql")` need a Veil-QL
release with a `require` export as well; Veil-QL 1.0.5 and earlier only expose
an `import` export.

## Usage

Create one schema and adapter per exposed query surface, then reuse them across
requests. Schema field names are public API names; mapping values are your
application's trusted TypeORM `alias.property` paths, not raw SQL.

```ts
import { Schema } from "@hiddendevs/veil-ql";
import { VeilTypeOrmAdapter } from "@hiddendevs/veil-ql-typeorm";
import type { Repository } from "typeorm";

interface User {
    id: number;
    tenantId: number;
    name: string;
    age: number;
    active: boolean;
}

const schema = Schema.fromObject({
    fields: {
        name: { type: "string", sortable: true },
        age: { type: "number", sortable: true },
        active: { type: "boolean" },
    },
});

const adapter = new VeilTypeOrmAdapter({
    schema,
    fields: {
        name: "user.name",
        age: "user.age",
        active: "user.active",
    },
});

export async function findUsers(repository: Repository<User>, tenantId: number, source: string) {
    const builder = repository.createQueryBuilder("user").where("user.tenantId = :tenantId", { tenantId }).take(50);

    return adapter.apply(builder, source).getMany();
}
```

Example query:

```text
active AND age >= 18 AND contains(name, "Al") SORT BY age DESC, name
```

The adapter does not execute queries or create joins. Configure joins, selections,
authorization constraints, limits, and offsets on the builder yourself. Joined
fields can map to an existing join alias, such as `team.name`. Use entity property
names, not database column names; TypeORM handles renamed columns and escaping.
Every schema field must have a mapping, including sort-only fields.

## API

### `new VeilTypeOrmAdapter(options)`

| Option            | Description                                                                     |
| ----------------- | ------------------------------------------------------------------------------- |
| `schema`          | Reusable Veil-QL `Schema`; required.                                            |
| `fields`          | Complete map of schema fields to trusted `alias.property` paths; required.      |
| `functions`       | Map of function names to trusted SQL translator callbacks.                      |
| `dialect`         | Optional `SqlDialect` strategy; otherwise inferred from the builder in `apply`. |
| `parameterPrefix` | ASCII identifier for generated parameter names; defaults to `veil`.             |

Mappings and the function registry are copied at construction. Compilation state
is isolated per call; adapters can be reused across independent builders.

### `adapter.apply(builder, input)`

Accepts a query string, Veil-QL `Expr`, or Veil-QL `Query`. AST inputs are
schema-validated again. Returns the same builder for chaining.

- Fully validates and compiles before changing the builder. Parse, validation,
  and translation failures leave the builder untouched.
- Intersects the entire existing `WHERE` with the new filter, preserving the
  grouping of existing `OR` conditions and nested `Brackets`.
- Avoids collisions with existing parameters, previous applications, and parent
  query parameters when applying to a subquery.
- Appends sort fields without resetting existing ordering. As with TypeORM's
  `addOrderBy`, sorting the same property again updates its direction in place.
- Leaves joins, selection, grouping, pagination, and query execution to TypeORM.

### `adapter.compile(input, options?)`

Returns `{ sql, parameters, sorts }` without mutating a builder. Sorts contain
mapped property paths and `ASC` / `DESC` directions. The returned objects and
arrays are shallow-frozen; custom bound objects are not deep-frozen.

```ts
import { PostgreSqlDialect } from "@hiddendevs/veil-ql-typeorm";

const compiled = adapter.compile('age >= 18 AND contains(name, "Al") SORT BY age DESC', {
    dialect: new PostgreSqlDialect(),
    reservedParameters: ["veil_0"],
});
```

`reservedParameters` also accepts `(name: string) => boolean`, allowing callers
to use `builder.hasParameter(name)`. A per-call dialect overrides the constructor
dialect. Without either, standalone compilation supports portable operations but
rejects string `contains` and native array membership. `apply` infers its dialect
from the builder instead.

Compiled SQL uses TypeORM property paths and named parameters. It is intended for
TypeORM, not direct execution through a database client. Prefer `apply` when
combining with existing queries so grouping and parameter reservations are handled.

## Dialects And Semantics

| Strategy             | Automatically detected drivers               | String `contains`  | Native list membership |
| -------------------- | -------------------------------------------- | ------------------ | ---------------------- |
| `PostgreSqlDialect`  | `postgres`, `aurora-postgres`, `cockroachdb` | `STRPOS`           | `= ANY(...)`           |
| `SqliteDialect`      | `sqlite`, `better-sqlite3`, `sqljs`          | `INSTR`            | Not supported          |
| `MySqlDialect`       | `mysql`, `mariadb`, `aurora-mysql`           | Binary `LOCATE`    | Not supported          |
| `PortableSqlDialect` | Standalone `compile` fallback only           | Requires a dialect | Not supported          |

Other drivers require an application-provided `SqlDialect`. Custom strategies can
implement the interface or extend an existing dialect.

Supported translations:

- Scalar literals, fields, field-to-field comparisons, boolean fields, grouping,
  `AND`, `OR`, `NOT`, unary minus, and all scalar comparison operators.
- `== null` / `!= null` on either side become `IS NULL` / `IS NOT NULL`, including
  nullable list fields.
- `IN` / `NOT IN` with flat lists of literals or scalar expressions. Nested lists
  are rejected. Empty lists become constant false / true predicates instead of
  invalid `IN ()`.
- `contains(string, string)` performs case-sensitive literal substring matching;
  `%`, `_`, and backslashes are not wildcard syntax.
- `contains([a, b], value)` uses membership on every dialect.
- PostgreSQL membership against native array columns or
  list-returning custom functions, including `contains(tags, "trusted")`.
- Multi-column sorting, restricted by the schema's `sortable` configuration.

List equality, nested list membership, and list literals outside membership need
custom function translators; they are rejected rather than silently assigned
database-specific semantics. PostgreSQL array support expects actual SQL array
columns, not JSON, `simple-json`, or `simple-array` storage. Other list storage
formats need application-owned translators.

Ordinary nullable comparisons and membership retain SQL three-valued logic. For
example, `email != "x"` does not match rows whose email is null. Use explicit null
checks when needed. Other than the dedicated case-sensitive `contains` translation,
string comparison behavior follows your database's collation. Numeric precision
and SQL value conversions are also governed by the database and driver.

## Custom Functions

Declare a function's signature in Veil-QL and its implementation in the adapter.
Callbacks receive validated AST arguments, a recursive `compile` method, and a
collision-safe `bind` method. Calls can be nested.

```ts
const customSchema = Schema.fromObject({
    fields: { name: { type: "string" } },
    functions: {
        length: { parameters: ["string"], returns: "number" },
    },
});

const customAdapter = new VeilTypeOrmAdapter({
    schema: customSchema,
    fields: { name: "user.name" },
    functions: {
        length: ({ args, compile }) => `LENGTH(${compile(args[0]!)})`,
    },
});

const result = customAdapter.compile("length(name) >= 5");
```

Use `compile(argument)` for query-provided arguments and `bind(value)` for
additional values. Never interpolate literal AST values into SQL. Translator
output is trusted application SQL and is parenthesized by the compiler. Translators
must be synchronous and return nonempty SQL; avoid side effects in callbacks.

A registered `contains` translator overrides the built-in translation, which can
be useful for JSON list storage. Schema validation still controls its allowed
argument types. A declared custom function without a translator fails only when
used in a query.

## Errors

Veil-QL parsing and validation errors propagate unchanged as `QueryError`
subclasses. Translation and configuration errors use the exported `AdapterError`,
with a `code`, readable `message`, and an AST `span` where available:

- `InvalidConfiguration`
- `UnmappedField`
- `UnsupportedExpression`
- `UnsupportedFunction`
- `UnsupportedDialect`

These are distinct from TypeORM execution errors. Database errors occur when
you execute the builder; the adapter does not wrap them. Veil-QL spans are
half-open UTF-8 byte offsets, not JavaScript string indices.

## Design

The implementation uses a small set of focused objects rather than a class for
every AST node:

| Component                                                 | Responsibility / Pattern                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| [VeilTypeOrmAdapter](src/adapter/veil-typeorm-adapter.ts) | Adapter and facade: validate input and apply a compiled query to TypeORM.  |
| [QueryCompiler](src/compiler/query-compiler.ts)           | AST interpreter: recursively translate expressions with explicit grouping. |
| [SqlDialect](src/dialects/sql-dialect.ts)                 | Strategy: isolate database-specific substring and array SQL.               |
| `FunctionTranslator`                                      | Registry of application-owned translation strategies.                      |
| [FieldResolver](src/compiler/field-resolver.ts)           | Resolve and validate the explicit field allowlist.                         |
| [ParameterBag](src/compiler/parameter-bag.ts)             | Encapsulate per-compilation parameter state and collision checks.          |

Source modules are grouped by responsibility:

```text
src/
  adapter/
    resolve-dialect.ts
    types.ts
    veil-typeorm-adapter.ts
  compiler/
    field-resolver.ts
    parameter-bag.ts
    query-compiler.ts
    types.ts
  dialects/
    mysql-dialect.ts
    portable-sql-dialect.ts
    postgresql-dialect.ts
    sql-dialect.ts
    sqlite-dialect.ts
  errors.ts
  index.ts
```

The adapter owns TypeORM interaction and driver selection. The compiler depends
on the dialect interface, not concrete database strategies or TypeORM. Each SQL
dialect has a dedicated implementation module. Public contracts live in the
corresponding `types.ts` modules, separate from their implementations. Internal
imports target their owning modules directly; [src/index.ts](src/index.ts)
remains the single consumer-facing entry point.

Only the adapter, dialects, errors, and public configuration/result types are
exported from [src/index.ts](src/index.ts). Compiler implementation details remain
internal. Preserving pre-existing `OR` grouping uses TypeORM's typed
`expressionMap.wheres` representation, covered by integration tests and scoped
to the supported TypeORM 0.3.x line.

## Development

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

Vitest covers generated SQL and executes QueryBuilders against an in-memory
SQLite database using `sql.js`. `npm test` builds first and also checks native
Node.js ESM and CommonJS loading of the built package. Tests include existing
predicates, OR grouping, injection-shaped values, parameter collisions, parent/subquery interaction,
joins, renamed columns, pagination, sorting, AST validation, and custom functions.
All dialect SQL translations are unit-tested. SQLite execution is covered through
`sql.js`; PostgreSQL and MySQL integration are not run against live database
servers. Run database-specific integration checks against your deployed versions
and column types before release.
