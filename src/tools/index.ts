import { BaseTool } from "./base";
import { DrizzleQueryTool, DrizzleSchemaTool } from "./drizzle";
import { MemoryTools } from "./memory";


/**
 * Returns an array of ALL available tool instances.
 * This can be filtered by the Agent if they only want specific ones.
 */
export function getAllTools(env: Env): BaseTool[] {
  return [
    // Database
    new DrizzleQueryTool(env),
    new DrizzleSchemaTool(env)
  ];
}

export * from "./types";
export * from "./base";