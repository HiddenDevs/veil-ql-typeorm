import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cwd = fileURLToPath(new URL("..", import.meta.url));

describe("built package exports", () => {
    it.each(["module", "commonjs"])("loads the adapter and dialects from %s", (mode) => {
        const load =
            mode === "module"
                ? 'await import("@hiddendevs/veil-ql-typeorm")'
                : 'require("@hiddendevs/veil-ql-typeorm")';
        execFileSync(
            process.execPath,
            [
                `--input-type=${mode}`,
                "-e",
                `
                const { VeilTypeOrmAdapter, PortableSqlDialect, AdapterError } = ${load};
                if (typeof VeilTypeOrmAdapter !== "function") throw new Error("Missing adapter");
                const dialect = new PortableSqlDialect();
                try {
                    dialect.contains("name", ":search");
                    throw new Error("Expected an unsupported dialect error");
                } catch (error) {
                    if (!(error instanceof AdapterError) || error.code !== "UnsupportedDialect") throw error;
                }
                `,
            ],
            { cwd, stdio: "pipe" },
        );
    });

    it("shares classes between import and require", () => {
        const output = execFileSync(
            process.execPath,
            [
                "--input-type=module",
                "-e",
                `
                import { createRequire } from "node:module";
                import { VeilTypeOrmAdapter, AdapterError } from "@hiddendevs/veil-ql-typeorm";
                const cjs = createRequire(import.meta.url)("@hiddendevs/veil-ql-typeorm");
                console.log(VeilTypeOrmAdapter === cjs.VeilTypeOrmAdapter && AdapterError === cjs.AdapterError);
                `,
            ],
            { cwd, encoding: "utf8" },
        );
        expect(output.trim()).toBe("true");
    });
});
