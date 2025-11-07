export interface ToolDefinition {
    name: string;
    description: string;
    inputSchema: any;
    cliName?: string;
    cliAliases?: string[];
    cliHidden?: boolean;
}
/**
 * Get all tool definitions shared between CLI and MCP
 */
export declare function getToolDefinitions(options?: {
    includeClean?: boolean;
    preferredScheme?: string;
    preferredXcodeproj?: string;
}): ToolDefinition[];
//# sourceMappingURL=toolDefinitions.d.ts.map