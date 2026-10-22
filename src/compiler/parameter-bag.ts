import { AdapterError } from "../errors.js";

export class ParameterBag {
    private readonly reserved: Set<string>;
    private readonly isReserved: (name: string) => boolean;
    private readonly values: Record<string, unknown> = {};
    private index = 0;

    constructor(
        private readonly prefix: string,
        reserved: readonly string[] | ((name: string) => boolean) = [],
    ) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) {
            throw new AdapterError("InvalidConfiguration", "parameterPrefix must be a nonempty ASCII identifier.");
        }
        this.reserved = new Set(typeof reserved === "function" ? [] : reserved);
        this.isReserved = typeof reserved === "function" ? reserved : () => false;
    }

    public bind(value: unknown): string {
        let name: string;
        do {
            name = `${this.prefix}_${this.index++}`;
        } while (this.reserved.has(name) || this.isReserved(name));
        this.reserved.add(name);
        this.values[name] = value;
        return `:${name}`;
    }

    public snapshot(): Readonly<Record<string, unknown>> {
        return Object.freeze({ ...this.values });
    }
}
