import type { McpResult } from '../types/index.js';
export declare class SimulatorUiTools {
    static describeUI(simulatorUuid: string): Promise<McpResult>;
    static tap(simulatorUuid: string, x: number, y: number, options?: {
        preDelay?: number;
        postDelay?: number;
    }): Promise<McpResult>;
    static typeText(simulatorUuid: string, text: string): Promise<McpResult>;
    static swipe(simulatorUuid: string, start: {
        x: number;
        y: number;
    }, end: {
        x: number;
        y: number;
    }, options?: {
        duration?: number;
        delta?: number;
        preDelay?: number;
        postDelay?: number;
    }): Promise<McpResult>;
}
export declare function resetAxeCacheForTesting(): void;
export default SimulatorUiTools;
//# sourceMappingURL=SimulatorUiTools.d.ts.map