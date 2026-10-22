export interface SqlDialect {
    readonly name: string;
    contains(text: string, search: string): string;
    membership(value: string, collection: string): string;
}
