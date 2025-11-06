import type { McpResult } from '../types/index.js';
export declare class SimulatorTools {
    static listSimulators(): Promise<McpResult>;
    static bootSimulator(simulatorUuid: string): Promise<McpResult>;
    static openSimulator(): Promise<McpResult>;
    static captureScreenshot(simulatorUuid?: string, savePath?: string): Promise<McpResult>;
    static shutdownSimulator(simulatorUuid: string): Promise<McpResult>;
}
export default SimulatorTools;
//# sourceMappingURL=SimulatorTools.d.ts.map