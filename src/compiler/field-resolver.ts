import type { PathExpr, SchemaDescription } from "@hiddendevs/veil-ql";
import { AdapterError } from "../errors.js";

export class FieldResolver {
    private readonly mappings: ReadonlyMap<string, string>;
    private readonly types: ReadonlyMap<string, string>;

    constructor(fields: Readonly<Record<string, string>>, description: SchemaDescription) {
        this.mappings = new Map(Object.entries(fields));
        this.types = new Map(description.fields.map((field) => [field.name, field.type]));
        for (const [field, target] of this.mappings) {
            if (!this.types.has(field)) {
                throw new AdapterError(
                    "InvalidConfiguration",
                    `Mapping '${field}' is not declared in the Veil-QL schema.`,
                );
            }
            if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(target)) {
                throw new AdapterError(
                    "InvalidConfiguration",
                    `Mapping '${field}' must be an alias.property path, not SQL.`,
                );
            }
        }
        for (const field of this.types.keys()) {
            if (!this.mappings.has(field)) {
                throw new AdapterError("UnmappedField", `No TypeORM property mapping was provided for '${field}'.`);
            }
        }
    }

    resolve(path: PathExpr): string {
        const field = path.parts.join(".");
        const target = this.mappings.get(field);
        if (target === undefined) {
            throw new AdapterError(
                "UnmappedField",
                `No TypeORM property mapping was provided for '${field}'.`,
                path.span,
            );
        }
        return target;
    }

    typeOf(path: PathExpr): string {
        this.resolve(path);
        return this.types.get(path.parts.join("."))!;
    }
}
