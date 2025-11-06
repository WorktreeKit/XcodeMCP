import type { McpResult, OpenProjectCallback } from '../types/index.js';
export declare class BuildTools {
    private static pendingTestOptions;
    static setPendingTestOptions(options: {
        testPlanPath?: string;
        selectedTests?: string[];
        selectedTestClasses?: string[];
        testTargetIdentifier?: string;
        testTargetName?: string;
        schemeName?: string;
        deviceType?: string;
        osVersion?: string;
    }): void;
    static build(projectPath: string, schemeName: string, destination: string | null | undefined, openProject: OpenProjectCallback): Promise<McpResult>;
    static clean(projectPath: string, openProject: OpenProjectCallback): Promise<McpResult>;
    static test(projectPath: string, destination: string | null, commandLineArguments: string[] | undefined, _openProject: OpenProjectCallback, options?: {
        testPlanPath?: string;
        selectedTests?: string[];
        selectedTestClasses?: string[];
        testTargetIdentifier?: string;
        testTargetName?: string;
        schemeName?: string;
        deviceType?: string;
        osVersion?: string;
    }): Promise<McpResult>;
    static run(projectPath: string, schemeName: string, commandLineArguments: string[] | undefined, openProject: OpenProjectCallback): Promise<McpResult>;
    static debug(projectPath: string, scheme?: string, skipBuilding?: boolean, openProject?: OpenProjectCallback): Promise<McpResult>;
    static stop(projectPath: string): Promise<McpResult>;
    private static _getAvailableSchemes;
    private static _getAvailableDestinations;
    private static _findXCResultFiles;
    /**
     * Find XCResult files for a given project
     */
    static findXCResults(projectPath: string): Promise<McpResult>;
    private static _getTimeAgo;
    private static _formatFileSize;
    private static _pathExists;
    private static _buildDestinationArgs;
    private static _buildDestinationArgsForDevice;
    private static _findBestSimulatorId;
    private static _getSchemesViaXcodebuild;
    private static _resolveSchemeName;
    private static _hasArgument;
    private static _createTemporaryResultBundlePath;
    private static simulatorPreferenceCache;
    private static _buildSimulatorPreferenceKey;
    private static _getSimulatorPreferenceFile;
    private static _loadSimulatorPreferences;
    private static _rememberSimulatorSelection;
    private static _versionScore;
    private static _runtimeMatchesRequested;
    private static _scoreSimulatorCandidate;
    private static _extractRuntimeVersion;
    private static _platformForRuntime;
    private static _getSimulatorInventory;
    private static _detectSimulatorCloneFailure;
    /**
     * Handle alerts that appear when starting builds/tests while another operation is in progress.
     * This includes "replace existing build" alerts and similar dialog overlays.
     */
    private static _handleReplaceExistingBuildAlert;
}
export default BuildTools;
//# sourceMappingURL=BuildTools.d.ts.map