import type { McpResult } from '../types/index.js';
export declare class SimulatorLogTools {
    private static readonly sessions;
    static startLogCapture(params: {
        simulatorUuid: string;
        bundleId: string;
        captureConsole?: boolean;
        args?: string[];
    }): Promise<McpResult>;
    static stopLogCapture(sessionId: string): Promise<McpResult>;
}
export default SimulatorLogTools;
//# sourceMappingURL=SimulatorLogTools.d.ts.map