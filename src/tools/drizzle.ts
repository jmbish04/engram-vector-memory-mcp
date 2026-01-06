import { BaseTool } from "./base";
import { z } from "@hono/zod-openapi";
// import { drizzle } from 'drizzle-orm/d1'; // Not used in raw execution mode

export class DrizzleQueryTool extends BaseTool<{ sql: string; params?: any[] }, any> {
    name = "drizzle_query";
    description = "Execute a raw SQL query against the D1 database. Use this for reading data (SELECT) or inspecting tables.";

    schema = z.object({
        sql: z.string().describe("The raw SQL query to execute. e.g. 'SELECT * FROM User LIMIT 5'"),
        params: z.array(z.any()).optional().describe("Optional parameters for prepared statements.")
    });

    protected async execute(args: { sql: string; params?: any[] }) {
        const { sql, params = [] } = args;

        try {
            // Using raw D1 binding for maximum flexibility
            const stmt = this.env.DB.prepare(sql).bind(...params);
            const result = await stmt.all();

            return {
                results: result.results,
                meta: result.meta
            };
        } catch (e: any) {
            return { error: `SQL Error: ${e.message}` };
        }
    }
}

// Fixed generic type to Record<string, never> to match z.object({})
export class DrizzleSchemaTool extends BaseTool<Record<string, never>, any> {
    name = "drizzle_schema_inspect";
    description = "Returns the list of tables and their columns in the database.";

    schema = z.object({});

    protected async execute() {
        // Query SQLite master table directly via D1
        const sql = "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'";
        const stmt = this.env.DB.prepare(sql);
        const { results } = await stmt.all();

        return results;
    }
}