import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import BuildTools from './tools/BuildTools.js';
import ProjectTools from './tools/ProjectTools.js';
import InfoTools from './tools/InfoTools.js';
import XCResultTools from './tools/XCResultTools.js';
import SimulatorTools from './tools/SimulatorTools.js';
import SimulatorLogTools from './tools/SimulatorLogTools.js';
import SimulatorUiTools from './tools/SimulatorUiTools.js';
import PathValidator from './utils/PathValidator.js';
import { EnvironmentValidator } from './utils/EnvironmentValidator.js';
import Logger from './utils/Logger.js';
import type {
  EnvironmentValidation,
  ToolLimitations,
  McpResult,
  OpenProjectCallback,
} from './types/index.js';
import { getToolDefinitions } from './shared/toolDefinitions.js';

type TestJobOptions = {
  testPlanPath?: string;
  selectedTests?: string[];
  selectedTestClasses?: string[];
  testTargetIdentifier?: string;
  testTargetName?: string;
  schemeName?: string;
  deviceType?: string;
  osVersion?: string;
};

type TestJobRequest = {
  projectPath: string;
  destination: string | null;
  commandLineArguments: string[];
  options?: TestJobOptions;
  asyncMode?: boolean;
};

type TestJobRecord = {
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  lastAccessed: number;
  resultRetrieved?: boolean;
  request: {
    projectPath: string;
    destination: string | null;
    commandLineArguments: string[];
    options?: TestJobOptions;
  };
  result?: McpResult;
  error?: string;
};


export class XcodeServer {
  public server: Server;
  public currentProjectPath: string | null = null;
  private environmentValidation: EnvironmentValidation | null = null;
  private isValidated = false;
  private canOperateInDegradedMode = false;
  private includeClean: boolean;
  private preferredScheme: string | undefined;
  private preferredXcodeproj: string | undefined;
  private readonly testJobs: Map<string, TestJobRecord>;
  private readonly testJobRetentionMs = 15 * 60 * 1000; // 15 minutes

  constructor(options: { 
    includeClean?: boolean;
    preferredScheme?: string;
    preferredXcodeproj?: string;
  } = {}) {
    this.includeClean = options.includeClean ?? true;
    this.preferredScheme = options.preferredScheme;
    this.preferredXcodeproj = options.preferredXcodeproj;
    this.testJobs = new Map();
    
    // Log preferred values if set
    if (this.preferredScheme) {
      Logger.info(`Using preferred scheme: ${this.preferredScheme}`);
    }
    if (this.preferredXcodeproj) {
      Logger.info(`Using preferred xcodeproj: ${this.preferredXcodeproj}`);
    }
    
    this.server = new Server(
      {
        name: 'xcode-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupToolHandlers();
  }

  /**
   * Validates the environment and sets up the server accordingly
   */
  public async validateEnvironment(): Promise<EnvironmentValidation> {
    if (this.isValidated && this.environmentValidation) {
      return this.environmentValidation;
    }

    try {
      this.environmentValidation = await EnvironmentValidator.validateEnvironment();
      this.isValidated = true;
      this.canOperateInDegradedMode = this.environmentValidation.overall.canOperateInDegradedMode;

      // Log validation results
      const validationStatus = this.environmentValidation.overall.valid ? 'PASSED' : 
        this.canOperateInDegradedMode ? 'DEGRADED' : 'FAILED';
      Logger.info('Environment Validation:', validationStatus);

      if (!this.environmentValidation.overall.valid) {
        Logger.warn('Environment issues detected:');
        [...this.environmentValidation.overall.criticalFailures, 
         ...this.environmentValidation.overall.nonCriticalFailures].forEach(component => {
          const result = this.environmentValidation![component];
          if (result && 'valid' in result) {
            const validationResult = result as import('./types/index.js').EnvironmentValidationResult;
            Logger.warn(`  ${component}: ${validationResult.message || 'Status unknown'}`);
          }
        });
      }

      return this.environmentValidation;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      Logger.error('Environment validation failed:', errorMessage);
      // Create minimal validation result for graceful degradation
      this.environmentValidation = {
        overall: { 
          valid: false, 
          canOperateInDegradedMode: false,
          criticalFailures: ['validation'],
          nonCriticalFailures: []
        }
      };
      this.isValidated = true;
      return this.environmentValidation;
    }
  }

  /**
   * Checks if a tool operation should be blocked due to environment issues
   */
  public async validateToolOperation(toolName: string): Promise<McpResult | null> {
    // Health check tool should never be blocked
    if (toolName === 'xcode_health_check') {
      return null;
    }

    const validation = await this.validateEnvironment();
    
    if (validation.overall.valid) {
      return null; // All good
    }

    // Check for critical failures that prevent all operations
    if (!validation.overall.canOperateInDegradedMode) {
      const criticalFailures = validation.overall.criticalFailures
        .map(component => {
          const result = validation[component];
          if (result && 'valid' in result) {
            const validationResult = result as import('./types/index.js').EnvironmentValidationResult;
            return validationResult.message || 'Unknown failure';
          }
          return 'Unknown failure';
        })
        .filter(Boolean)
        .join(', ');
      
      return {
        content: [{
          type: 'text',
          text: `❌ Cannot execute ${toolName}: Critical environment failures detected.\n\n${criticalFailures}\n\nPlease run the 'xcode_health_check' tool for detailed recovery instructions.`
        }]
      };
    }

    // Check for specific tool limitations in degraded mode
    const limitations = this.getToolLimitations(toolName, validation);
    if (limitations.blocked) {
      return {
        content: [{
          type: 'text',
          text: `❌ Cannot execute ${toolName}: ${limitations.reason}\n\nRecovery instructions:\n${limitations.instructions?.map(i => `• ${i}`).join('\n') || ''}`
        }]
      };
    }

    // Issue warning for degraded functionality but allow operation
    if (limitations.degraded) {
      Logger.warn(`${toolName} operating in degraded mode - ${limitations.reason}`);
    }

    return null; // Operation can proceed
  }

  private parseNumericArg(value: unknown, name: string): number {
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(numeric)) {
      throw new McpError(ErrorCode.InvalidParams, `Parameter '${name}' must be a number`);
    }
    return numeric;
  }

  private parseOptionalNumericArg(value: unknown, name: string): number | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;
    if (!Number.isFinite(numeric)) {
      throw new McpError(ErrorCode.InvalidParams, `Parameter '${name}' must be numeric when provided`);
    }
    return numeric;
  }

  /**
   * Determines tool limitations based on environment validation
   */
  private getToolLimitations(toolName: string, validation: EnvironmentValidation): ToolLimitations {
    // Health check tool should never be limited
    if (toolName === 'xcode_health_check') {
      return { blocked: false, degraded: false };
    }

    const buildTools = ['xcode_build', 'xcode_test', 'xcode_build_and_run', 'xcode_debug', 'xcode_clean'];
    const xcodeTools = [...buildTools, 'xcode_open_project', 'xcode_get_schemes', 'xcode_set_active_scheme', 
                       'xcode_get_run_destinations', 'xcode_get_workspace_info', 'xcode_get_projects'];
    const simulatorTools = [
      'list_sims',
      'boot_sim',
      'shutdown_sim',
      'open_sim',
      'screenshot',
      'start_sim_log_cap',
      'stop_sim_log_cap',
      'describe_ui',
      'tap',
      'type_text',
      'swipe',
    ];
    const xcresultTools = ['xcresult_browse', 'xcresult_browser_get_console', 'xcresult_summary', 'xcresult_get_screenshot', 'xcresult_get_ui_hierarchy', 'xcresult_get_ui_element', 'xcresult_list_attachments', 'xcresult_export_attachment'];

    if (simulatorTools.includes(toolName) && !validation.xcode?.valid) {
      return {
        blocked: true,
        degraded: false,
        reason: 'Xcode Command Line Tools are required for simulator operations',
        instructions: [
          'Install Xcode Command Line Tools: xcode-select --install',
          'Ensure the iOS Simulator is installed from Xcode',
        ],
      };
    }

    // Check Xcode availability
    if (xcodeTools.includes(toolName) && !validation.xcode?.valid) {
      return {
        blocked: true,
        degraded: false,
        reason: 'Xcode is not properly installed or accessible',
        instructions: validation.xcode?.recoveryInstructions || [
          'Install Xcode from the Mac App Store',
          'Launch Xcode once to complete installation'
        ]
      };
    }

    // Check osascript availability  
    if (xcodeTools.includes(toolName) && !validation.osascript?.valid) {
      return {
        blocked: true,
        degraded: false,
        reason: 'JavaScript for Automation (JXA) is not available',
        instructions: validation.osascript?.recoveryInstructions || [
          'This tool requires macOS',
          'Ensure osascript is available'
        ]
      };
    }

    // Build tools have additional dependencies and warnings
    if (buildTools.includes(toolName)) {
      if (!validation.xclogparser?.valid) {
        return {
          blocked: false,
          degraded: true,
          reason: 'XCLogParser not available - build results will have limited detail',
          instructions: validation.xclogparser?.recoveryInstructions || [
            'Install XCLogParser with: brew install xclogparser'
          ]
        };
      }

      if (!validation.permissions?.valid && 
          !validation.permissions?.degradedMode?.available) {
        return {
          blocked: true,
          degraded: false,
          reason: 'Automation permissions not granted',
          instructions: validation.permissions?.recoveryInstructions || [
            'Grant automation permissions in System Preferences'
          ]
        };
      }
    }

    // XCResult tools only need xcresulttool (part of Xcode Command Line Tools)
    if (xcresultTools.includes(toolName)) {
      // Check if we can run xcresulttool - this is included with Xcode Command Line Tools
      if (!validation.xcode?.valid) {
        return {
          blocked: true,
          degraded: false,
          reason: 'XCResult tools require Xcode Command Line Tools for xcresulttool',
          instructions: [
            'Install Xcode Command Line Tools: xcode-select --install',
            'Or install full Xcode from the Mac App Store'
          ]
        };
      }
    }

    return { blocked: false, degraded: false };
  }

  /**
   * Enhances error messages with configuration guidance
   */
  public async enhanceErrorWithGuidance(error: Error | { message?: string }, _toolName: string): Promise<string | null> {
    const errorMessage = error.message || error.toString();
    
    // Import ErrorHelper for common error patterns
    const { ErrorHelper } = await import('./utils/ErrorHelper.js');
    const commonError = ErrorHelper.parseCommonErrors(error as Error);
    if (commonError) {
      return commonError;
    }

    // Additional configuration-specific error patterns
    if (errorMessage.includes('command not found')) {
      if (errorMessage.includes('xclogparser')) {
        return `❌ XCLogParser not found\n\n💡 To fix this:\n• Install XCLogParser: brew install xclogparser\n• Or download from: https://github.com/MobileNativeFoundation/XCLogParser\n\nNote: Build operations will work but with limited error details.`;
      }
      if (errorMessage.includes('osascript')) {
        return `❌ macOS scripting tools not available\n\n💡 This indicates a critical system issue:\n• This MCP server requires macOS\n• Ensure you're running on a Mac with system tools available\n• Try restarting your terminal`;
      }
    }

    if (errorMessage.includes('No such file or directory')) {
      if (errorMessage.includes('Xcode.app')) {
        return `❌ Xcode application not found\n\n💡 To fix this:\n• Install Xcode from the Mac App Store\n• Ensure Xcode is in /Applications/Xcode.app\n• Launch Xcode once to complete installation`;
      }
    }

    // Only convert actual operation timeouts, not build errors containing 'timeout:' or transport errors
    if ((errorMessage.includes(' timeout') || errorMessage.includes('timed out') || errorMessage.includes('timeout after')) && 
        !errorMessage.includes('Body Timeout Error') &&
        !errorMessage.includes('Transport error') &&
        !errorMessage.includes('SSE error') &&
        !errorMessage.includes('terminated') &&
        !errorMessage.includes("'timeout:'") &&
        !errorMessage.includes("timeout:' in call") &&
        !errorMessage.includes('argument label') &&
        !errorMessage.includes('TEST BUILD FAILED')) {
      return `❌ Operation timed out\n\n💡 This might indicate:\n• Xcode is not responding (try restarting Xcode)\n• System performance issues\n• Large project taking longer than expected\n• Network issues if downloading dependencies`;
    }

    return null; // No specific guidance available
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolOptions: {
        includeClean: boolean;
        preferredScheme?: string;
        preferredXcodeproj?: string;
      } = { includeClean: this.includeClean };
      
      if (this.preferredScheme) toolOptions.preferredScheme = this.preferredScheme;
      if (this.preferredXcodeproj) toolOptions.preferredXcodeproj = this.preferredXcodeproj;
      
      const toolDefinitions = getToolDefinitions(toolOptions);
      return {
        tools: toolDefinitions.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request: any): Promise<CallToolResult> => {
      const { name, arguments: args = {} } = request.params as { name: string; arguments?: Record<string, unknown> };

      // Apply preferred values if parameters not provided
      if (!args.xcodeproj && this.preferredXcodeproj) {
        args.xcodeproj = this.preferredXcodeproj;
      }
      if (!args.scheme && this.preferredScheme) {
        args.scheme = this.preferredScheme;
      }

      // Resolve relative paths to absolute paths
      if (args.xcodeproj && typeof args.xcodeproj === 'string') {
        const { resolvedPath, error } = PathValidator.resolveAndValidateProjectPath(args.xcodeproj as string, 'xcodeproj');
        if (error) {
          return error;
        }
        args.xcodeproj = resolvedPath;
      }
      
      if (args.filePath && typeof args.filePath === 'string') {
        const path = await import('path');
        if (!path.default.isAbsolute(args.filePath)) {
          args.filePath = path.default.resolve(process.cwd(), args.filePath);
        }
      }

      try {
        // Handle health check tool first (no environment validation needed)
        if (name === 'xcode_health_check') {
          const report = await EnvironmentValidator.createHealthCheckReport();
          const versionInfo = await this.getVersionInfo();
          return {
            content: [
              { type: 'text', text: report },
              ...(versionInfo.content ?? []),
            ],
          };
        }

        // Validate environment for all other tools
        const validationError = await this.validateToolOperation(name);
        if (validationError) {
          return validationError;
        }

        switch (name) {
          case 'xcode_open_project':
            if (!args.xcodeproj) {
              throw new McpError(
                ErrorCode.InvalidParams,
                this.preferredXcodeproj 
                  ? `Missing required parameter: xcodeproj (no preferred value was applied)\n\n💡 Expected: absolute path to .xcodeproj or .xcworkspace file`
                  : `Missing required parameter: xcodeproj\n\n💡 Expected: absolute path to .xcodeproj or .xcworkspace file`
              );
            }
            const result = await ProjectTools.openProject(args.xcodeproj as string);
            if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
              const textContent = result.content[0];
              if (textContent.type === 'text' && typeof textContent.text === 'string') {
                if (!textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
                  this.currentProjectPath = args.xcodeproj as string;
                }
              }
            }
            return result;
          case 'xcode_close_project':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            try {
              const validationError = PathValidator.validateProjectPath(args.xcodeproj as string);
              if (validationError) return validationError;
              
              const closeResult = await ProjectTools.closeProject(args.xcodeproj as string);
              this.currentProjectPath = null;
              return closeResult;
            } catch (closeError) {
              // Ensure close project never crashes the server
              Logger.error('Close project error (handled):', closeError);
              this.currentProjectPath = null;
              return { content: [{ type: 'text', text: 'Project close attempted - may have completed with dialogs' }] };
            }
          case 'xcode_build':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            if (!args.scheme) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
            }
            return await BuildTools.build(
              args.xcodeproj as string, 
              args.scheme as string, 
              (args.destination as string) || null, 
              this.openProject.bind(this)
            );
          case 'xcode_clean':
            if (!this.includeClean) {
              throw new McpError(ErrorCode.MethodNotFound, `Clean tool is disabled`);
            }
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await BuildTools.clean(args.xcodeproj as string, this.openProject.bind(this));
        case 'xcode_test': {
          const request = this.prepareTestRequest(args);
          return this.startAsyncTestJob(request);
        }
        case 'xcode_test_status':
          if (!args.job_id || typeof args.job_id !== 'string') {
            return { content: [{ type: 'text', text: 'Error: job_id parameter is required' }] };
          }
          return this.getTestJobStatus(args.job_id as string);
          case 'xcode_build_and_run':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            if (!args.scheme) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
            }
            return await BuildTools.run(
              args.xcodeproj as string, 
              args.scheme as string,
              (args.command_line_arguments as string[]) || [], 
              this.openProject.bind(this)
            );
          case 'xcode_debug':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            if (!args.scheme) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
            }
            return await BuildTools.debug(
              args.xcodeproj as string, 
              args.scheme as string, 
              args.skip_building as boolean, 
              this.openProject.bind(this)
            );
          case 'xcode_stop':
            if (!args.xcodeproj) {
              return { content: [{ type: 'text', text: 'Error: xcodeproj parameter is required' }] };
            }
            return await BuildTools.stop(args.xcodeproj as string);
          case 'find_xcresults':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await BuildTools.findXCResults(args.xcodeproj as string);
          case 'xcode_get_schemes':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await ProjectTools.getSchemes(args.xcodeproj as string, this.openProject.bind(this));
          case 'xcode_get_run_destinations':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await ProjectTools.getRunDestinations(args.xcodeproj as string, this.openProject.bind(this));
          case 'xcode_set_active_scheme':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            if (!args.scheme_name) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme_name`);
            }
            return await ProjectTools.setActiveScheme(
              args.xcodeproj as string, 
              args.scheme_name as string, 
              this.openProject.bind(this)
            );
          case 'xcode_get_workspace_info':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await InfoTools.getWorkspaceInfo(args.xcodeproj as string, this.openProject.bind(this));
          case 'xcode_get_projects':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await InfoTools.getProjects(args.xcodeproj as string, this.openProject.bind(this));
          case 'xcode_open_file':
            if (!args.file_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: file_path`);
            }
            return await InfoTools.openFile(args.file_path as string, args.line_number as number);
          case 'list_sims':
            return await SimulatorTools.listSimulators();
          case 'boot_sim': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            return await SimulatorTools.bootSimulator(simulatorUuid);
          }
          case 'open_sim':
            return await SimulatorTools.openSimulator();
          case 'shutdown_sim': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            return await SimulatorTools.shutdownSimulator(simulatorUuid);
          }
          case 'screenshot': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid) ||
              undefined;
            const savePath = typeof args.save_path === 'string' ? args.save_path : undefined;
            return await SimulatorTools.captureScreenshot(simulatorUuid, savePath);
          }
          case 'start_sim_log_cap': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            const bundleId =
              (typeof args.bundle_id === 'string' && args.bundle_id) ||
              (typeof args.bundleId === 'string' && args.bundleId);
            if (!bundleId) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: bundle_id`);
            }
            const captureConsole =
              typeof args.capture_console === 'boolean'
                ? args.capture_console
                : typeof args.capture_console === 'string'
                  ? args.capture_console.toLowerCase() === 'true'
                  : false;
            const extraArgs = Array.isArray(args.command_line_arguments)
              ? (args.command_line_arguments as unknown[]).filter((item): item is string => typeof item === 'string')
              : [];
            return await SimulatorLogTools.startLogCapture({
              simulatorUuid,
              bundleId,
              captureConsole,
              args: extraArgs,
            });
          }
          case 'stop_sim_log_cap': {
            const sessionId =
              (typeof args.session_id === 'string' && args.session_id) ||
              (typeof args.sessionId === 'string' && args.sessionId);
            if (!sessionId) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: session_id`);
            }
            return await SimulatorLogTools.stopLogCapture(sessionId);
          }
          case 'describe_ui': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            return await SimulatorUiTools.describeUI(simulatorUuid);
          }
          case 'tap': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            const x = this.parseNumericArg(args.x, 'x');
            const y = this.parseNumericArg(args.y, 'y');
            const preDelay = this.parseOptionalNumericArg(args.pre_delay ?? args.preDelay, 'pre_delay');
            const postDelay = this.parseOptionalNumericArg(args.post_delay ?? args.postDelay, 'post_delay');
            const tapOptions: { preDelay?: number; postDelay?: number } = {};
            if (preDelay !== undefined) tapOptions.preDelay = preDelay;
            if (postDelay !== undefined) tapOptions.postDelay = postDelay;
            return await SimulatorUiTools.tap(simulatorUuid, x, y, tapOptions);
          }
          case 'type_text': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            if (typeof args.text !== 'string' || args.text.length === 0) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: text`);
            }
            return await SimulatorUiTools.typeText(simulatorUuid, args.text);
          }
          case 'swipe': {
            const simulatorUuid =
              (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
              (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
            if (!simulatorUuid) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
            }
            const x1 = this.parseNumericArg(args.x1, 'x1');
            const y1 = this.parseNumericArg(args.y1, 'y1');
            const x2 = this.parseNumericArg(args.x2, 'x2');
            const y2 = this.parseNumericArg(args.y2, 'y2');
            const duration = this.parseOptionalNumericArg(args.duration, 'duration');
            const delta = this.parseOptionalNumericArg(args.delta, 'delta');
            const preDelay = this.parseOptionalNumericArg(args.pre_delay ?? args.preDelay, 'pre_delay');
            const postDelay = this.parseOptionalNumericArg(args.post_delay ?? args.postDelay, 'post_delay');
            const swipeOptions: { duration?: number; delta?: number; preDelay?: number; postDelay?: number } = {};
            if (duration !== undefined) swipeOptions.duration = duration;
            if (delta !== undefined) swipeOptions.delta = delta;
            if (preDelay !== undefined) swipeOptions.preDelay = preDelay;
            if (postDelay !== undefined) swipeOptions.postDelay = postDelay;
            return await SimulatorUiTools.swipe(
              simulatorUuid,
              { x: x1, y: y1 },
              { x: x2, y: y2 },
              swipeOptions,
            );
          }
          case 'xcresult_browse':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            return await XCResultTools.xcresultBrowse(
              args.xcresult_path as string,
              args.test_id as string | undefined,
              args.include_console as boolean || false
            );
          case 'xcresult_browser_get_console':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            if (!args.test_id) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
            }
            return await XCResultTools.xcresultBrowserGetConsole(
              args.xcresult_path as string,
              args.test_id as string
            );
          case 'xcresult_summary':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            return await XCResultTools.xcresultSummary(args.xcresult_path as string);
          case 'xcresult_get_screenshot':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            if (!args.test_id) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
            }
            if (args.timestamp === undefined) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: timestamp`);
            }
            return await XCResultTools.xcresultGetScreenshot(
              args.xcresult_path as string,
              args.test_id as string,
              args.timestamp as number
            );
          case 'xcresult_get_ui_hierarchy':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            if (!args.test_id) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
            }
            return await XCResultTools.xcresultGetUIHierarchy(
              args.xcresult_path as string,
              args.test_id as string,
              args.timestamp as number | undefined,
              args.full_hierarchy as boolean | undefined,
              args.raw_format as boolean | undefined
            );
          case 'xcresult_get_ui_element':
            if (!args.hierarchy_json_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: hierarchy_json_path`);
            }
            if (args.element_index === undefined) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: element_index`);
            }
            return await XCResultTools.xcresultGetUIElement(
              args.hierarchy_json_path as string,
              args.element_index as number,
              args.include_children as boolean | undefined
            );
          case 'xcresult_list_attachments':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            if (!args.test_id) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
            }
            return await XCResultTools.xcresultListAttachments(
              args.xcresult_path as string,
              args.test_id as string
            );
          case 'xcresult_export_attachment':
            if (!args.xcresult_path) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
            }
            if (!args.test_id) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
            }
            if (args.attachment_index === undefined) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: attachment_index`);
            }
            return await XCResultTools.xcresultExportAttachment(
              args.xcresult_path as string,
              args.test_id as string,
              args.attachment_index as number,
              args.convert_to_json as boolean | undefined
            );
          case 'xcode_get_test_targets':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            return await ProjectTools.getTestTargets(args.xcodeproj as string);
          case 'xcode_refresh_project':
            if (!args.xcodeproj) {
              throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
            }
            // Close and reopen the project to refresh it
            await ProjectTools.closeProject(args.xcodeproj as string);
            const refreshResult = await ProjectTools.openProjectAndWaitForLoad(args.xcodeproj as string);
            return {
              content: [{
                type: 'text',
                text: `Project refreshed: ${refreshResult.content?.[0]?.type === 'text' ? refreshResult.content[0].text : 'Completed'}`
              }]
            };
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${name}`
            );
        }
      } catch (error) {
        // Enhanced error handling that doesn't crash the server
        Logger.error(`Tool execution error for ${name}:`, error);
        
        // Check if it's a configuration-related error that we can provide guidance for
        const enhancedError = await this.enhanceErrorWithGuidance(error as Error, name);
        if (enhancedError) {
          return { content: [{ type: 'text', text: enhancedError }] };
        }

        // For other errors, provide a helpful message but don't crash
        const errorMessage = error instanceof McpError ? error.message : 
          error instanceof Error ? `Tool execution failed: ${error.message}` : 
          `Tool execution failed: ${String(error)}`;
        
        return { 
          content: [{ 
            type: 'text', 
            text: `❌ ${name} failed: ${errorMessage}`
          }] 
        };
      }
    });
  }

  public async openProject(projectPath: string): Promise<McpResult> {
    const result = await ProjectTools.openProjectAndWaitForLoad(projectPath);
    if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
      const textContent = result.content[0];
      if (textContent.type === 'text' && typeof textContent.text === 'string') {
        if (!textContent.text.includes('❌') && !textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
          this.currentProjectPath = projectPath;
        }
      }
    }
    return result;
  }

  public async executeJXA(script: string): Promise<string> {
    const { JXAExecutor } = await import('./utils/JXAExecutor.js');
    return JXAExecutor.execute(script);
  }

  public validateProjectPath(projectPath: string): McpResult | null {
    return PathValidator.validateProjectPath(projectPath);
  }

  public async findProjectDerivedData(projectPath: string): Promise<string | null> {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.findProjectDerivedData(projectPath);
  }

  public async getLatestBuildLog(projectPath: string) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.getLatestBuildLog(projectPath);
  }

  // Direct method interfaces for testing/CLI compatibility
  public async build(projectPath: string, schemeName = 'Debug', destination: string | null = null): Promise<import('./types/index.js').McpResult> {
    const { BuildTools } = await import('./tools/BuildTools.js');
    return BuildTools.build(projectPath, schemeName, destination, this.openProject.bind(this));
  }

  public async clean(projectPath: string): Promise<import('./types/index.js').McpResult> {
    const { BuildTools } = await import('./tools/BuildTools.js');
    return BuildTools.clean(projectPath, this.openProject.bind(this));
  }

  public async test(projectPath: string, destination: string, commandLineArguments: string[] = []): Promise<import('./types/index.js').McpResult> {
    const { BuildTools } = await import('./tools/BuildTools.js');
    Logger.debug(`Direct XcodeServer.test invoked with destination '${destination}' and args length ${commandLineArguments.length}`);
    return BuildTools.test(projectPath, destination, commandLineArguments, this.openProject.bind(this));
  }

  public async run(projectPath: string, commandLineArguments: string[] = []): Promise<import('./types/index.js').McpResult> {
    const { BuildTools } = await import('./tools/BuildTools.js');
    return BuildTools.run(projectPath, 'Debug', commandLineArguments, this.openProject.bind(this));
  }

  public async debug(projectPath: string, scheme: string, skipBuilding = false): Promise<import('./types/index.js').McpResult> {
    const { BuildTools } = await import('./tools/BuildTools.js');
    return BuildTools.debug(projectPath, scheme, skipBuilding, this.openProject.bind(this));
  }

  public async stop(projectPath?: string): Promise<import('./types/index.js').McpResult> {
    if (!projectPath) {
      return { content: [{ type: 'text', text: 'Error: projectPath parameter is required' }] };
    }
    const { BuildTools } = await import('./tools/BuildTools.js');
    return BuildTools.stop(projectPath);
  }

  public async getSchemes(projectPath: string): Promise<import('./types/index.js').McpResult> {
    const { ProjectTools } = await import('./tools/ProjectTools.js');
    return ProjectTools.getSchemes(projectPath, this.openProject.bind(this));
  }

  public async getRunDestinations(projectPath: string): Promise<import('./types/index.js').McpResult> {
    const { ProjectTools } = await import('./tools/ProjectTools.js');
    return ProjectTools.getRunDestinations(projectPath, this.openProject.bind(this));
  }

  public async setActiveScheme(projectPath: string, schemeName: string): Promise<import('./types/index.js').McpResult> {
    const { ProjectTools } = await import('./tools/ProjectTools.js');
    return ProjectTools.setActiveScheme(projectPath, schemeName, this.openProject.bind(this));
  }

  public async getWorkspaceInfo(projectPath: string): Promise<import('./types/index.js').McpResult> {
    const { InfoTools } = await import('./tools/InfoTools.js');
    return InfoTools.getWorkspaceInfo(projectPath, this.openProject.bind(this));
  }

  public async getProjects(projectPath: string): Promise<import('./types/index.js').McpResult> {
    const { InfoTools } = await import('./tools/InfoTools.js');
    return InfoTools.getProjects(projectPath, this.openProject.bind(this));
  }

  public async openFile(filePath: string, lineNumber?: number): Promise<import('./types/index.js').McpResult> {
    const { InfoTools } = await import('./tools/InfoTools.js');
    return InfoTools.openFile(filePath, lineNumber);
  }

  public async parseBuildLog(logPath: string, retryCount?: number, maxRetries?: number) {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.parseBuildLog(logPath, retryCount, maxRetries);
  }

  public async canParseLog(logPath: string): Promise<boolean> {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.canParseLog(logPath);
  }

  public async getCustomDerivedDataLocationFromXcodePreferences(): Promise<string | null> {
    const { BuildLogParser } = await import('./utils/BuildLogParser.js');
    return BuildLogParser.getCustomDerivedDataLocationFromXcodePreferences();
  }

  /**
   * Call a tool directly without going through the MCP protocol
   * This is used by the CLI to bypass the JSON-RPC layer
   */
  public async callToolDirect(name: string, args: Record<string, unknown> = {}): Promise<CallToolResult> {
    // This is essentially the same logic as the CallToolRequestSchema handler
    
    // Resolve relative paths to absolute paths (this is actually handled by CLI now, but keep for safety)
    if (args.xcodeproj && typeof args.xcodeproj === 'string') {
      const { resolvedPath, error } = PathValidator.resolveAndValidateProjectPath(args.xcodeproj as string, 'xcodeproj');
      if (error) {
        return error;
      }
      args.xcodeproj = resolvedPath;
    }
    
    if (args.filePath && typeof args.filePath === 'string') {
      const path = await import('path');
      if (!path.default.isAbsolute(args.filePath)) {
        args.filePath = path.default.resolve(process.cwd(), args.filePath);
      }
    }
    
    try {
      // Handle health check tool first (no environment validation needed)
        if (name === 'xcode_health_check') {
          const report = await EnvironmentValidator.createHealthCheckReport();
          const versionInfo = await this.getVersionInfo();
          return {
            content: [
              { type: 'text', text: report },
              ...(versionInfo.content ?? []),
            ],
          };
        }

      Logger.debug(`callToolDirect: ${name} args = ${JSON.stringify(args)}`);

      // Validate environment for all other tools
      const validationError = await this.validateToolOperation(name);
      if (validationError) {
        return validationError;
      }

      switch (name) {
        case 'xcode_open_project':
          if (!args.xcodeproj) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Missing required parameter: xcodeproj\n\n💡 Expected: absolute path to .xcodeproj or .xcworkspace file`
            );
          }
          const result = await ProjectTools.openProject(args.xcodeproj as string);
          if (result && 'content' in result && result.content?.[0] && 'text' in result.content[0]) {
            const textContent = result.content[0];
            if (textContent.type === 'text' && typeof textContent.text === 'string') {
              if (!textContent.text.includes('Error') && !textContent.text.includes('does not exist')) {
                this.currentProjectPath = args.xcodeproj as string;
              }
            }
          }
          return result;
        case 'xcode_close_project':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          try {
            const validationError = PathValidator.validateProjectPath(args.xcodeproj as string);
            if (validationError) return validationError;
            
            const closeResult = await ProjectTools.closeProject(args.xcodeproj as string);
            this.currentProjectPath = null;
            return closeResult;
          } catch (closeError) {
            // Ensure close project never crashes the server
            Logger.error('Close project error (handled):', closeError);
            this.currentProjectPath = null;
            return { content: [{ type: 'text', text: 'Project close attempted - may have completed with dialogs' }] };
          }
        case 'xcode_build':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          if (!args.scheme) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
          }
          return await BuildTools.build(
            args.xcodeproj as string, 
            args.scheme as string, 
            (args.destination as string) || null, 
            this.openProject.bind(this)
          );
        case 'xcode_clean':
          if (!this.includeClean) {
            throw new McpError(ErrorCode.MethodNotFound, `Clean tool is disabled`);
          }
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await BuildTools.clean(args.xcodeproj as string, this.openProject.bind(this));
        case 'xcode_test': {
          const request = this.prepareTestRequest(args);
          return this.startAsyncTestJob(request);
        }
        case 'xcode_test_status':
          if (!args.job_id || typeof args.job_id !== 'string') {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: job_id`);
          }
          return this.getTestJobStatus(args.job_id as string);
        case 'xcode_build_and_run':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          if (!args.scheme) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
          }
          return await BuildTools.run(
            args.xcodeproj as string, 
            args.scheme as string,
            (args.command_line_arguments as string[]) || [], 
            this.openProject.bind(this)
          );
        case 'xcode_debug':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          if (!args.scheme) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme`);
          }
          return await BuildTools.debug(
            args.xcodeproj as string, 
            args.scheme as string, 
            args.skip_building as boolean, 
            this.openProject.bind(this)
          );
        case 'xcode_stop':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await BuildTools.stop(args.xcodeproj as string);
        case 'find_xcresults':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await BuildTools.findXCResults(args.xcodeproj as string);
        case 'xcode_get_schemes':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await ProjectTools.getSchemes(args.xcodeproj as string, this.openProject.bind(this));
        case 'xcode_get_run_destinations':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await ProjectTools.getRunDestinations(args.xcodeproj as string, this.openProject.bind(this));
        case 'xcode_set_active_scheme':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          if (!args.scheme_name) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: scheme_name`);
          }
          return await ProjectTools.setActiveScheme(
            args.xcodeproj as string, 
            args.scheme_name as string, 
            this.openProject.bind(this)
          );
        case 'xcode_get_workspace_info':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await InfoTools.getWorkspaceInfo(args.xcodeproj as string, this.openProject.bind(this));
        case 'xcode_get_projects':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await InfoTools.getProjects(args.xcodeproj as string, this.openProject.bind(this));
        case 'xcode_open_file':
          if (!args.file_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: file_path`);
          }
          return await InfoTools.openFile(args.file_path as string, args.line_number as number);
        case 'list_sims':
          return await SimulatorTools.listSimulators();
        case 'boot_sim': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          return await SimulatorTools.bootSimulator(simulatorUuid);
        }
        case 'open_sim':
          return await SimulatorTools.openSimulator();
        case 'shutdown_sim': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          return await SimulatorTools.shutdownSimulator(simulatorUuid);
        }
        case 'screenshot': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid) ||
            undefined;
          const savePath = typeof args.save_path === 'string' ? args.save_path : undefined;
          return await SimulatorTools.captureScreenshot(simulatorUuid, savePath);
        }
        case 'start_sim_log_cap': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          const bundleId =
            (typeof args.bundle_id === 'string' && args.bundle_id) ||
            (typeof args.bundleId === 'string' && args.bundleId);
          if (!bundleId) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: bundle_id`);
          }
          const captureConsole =
            typeof args.capture_console === 'boolean'
              ? args.capture_console
              : typeof args.capture_console === 'string'
                ? args.capture_console.toLowerCase() === 'true'
                : false;
          const extraArgs = Array.isArray(args.command_line_arguments)
            ? (args.command_line_arguments as unknown[]).filter((item): item is string => typeof item === 'string')
            : [];
          return await SimulatorLogTools.startLogCapture({
            simulatorUuid,
            bundleId,
            captureConsole,
            args: extraArgs,
          });
        }
        case 'stop_sim_log_cap': {
          const sessionId =
            (typeof args.session_id === 'string' && args.session_id) ||
            (typeof args.sessionId === 'string' && args.sessionId);
          if (!sessionId) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: session_id`);
          }
          return await SimulatorLogTools.stopLogCapture(sessionId);
        }
        case 'describe_ui': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          return await SimulatorUiTools.describeUI(simulatorUuid);
        }
        case 'tap': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          const x = this.parseNumericArg(args.x, 'x');
          const y = this.parseNumericArg(args.y, 'y');
          const preDelay = this.parseOptionalNumericArg(args.pre_delay ?? args.preDelay, 'pre_delay');
          const postDelay = this.parseOptionalNumericArg(args.post_delay ?? args.postDelay, 'post_delay');
          const tapOptions: { preDelay?: number; postDelay?: number } = {};
          if (preDelay !== undefined) tapOptions.preDelay = preDelay;
          if (postDelay !== undefined) tapOptions.postDelay = postDelay;
          return await SimulatorUiTools.tap(simulatorUuid, x, y, tapOptions);
        }
        case 'type_text': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          if (typeof args.text !== 'string' || args.text.length === 0) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: text`);
          }
          return await SimulatorUiTools.typeText(simulatorUuid, args.text);
        }
        case 'swipe': {
          const simulatorUuid =
            (typeof args.simulator_uuid === 'string' && args.simulator_uuid) ||
            (typeof args.simulatorUuid === 'string' && args.simulatorUuid);
          if (!simulatorUuid) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: simulator_uuid`);
          }
          const x1 = this.parseNumericArg(args.x1, 'x1');
          const y1 = this.parseNumericArg(args.y1, 'y1');
          const x2 = this.parseNumericArg(args.x2, 'x2');
          const y2 = this.parseNumericArg(args.y2, 'y2');
          const duration = this.parseOptionalNumericArg(args.duration, 'duration');
          const delta = this.parseOptionalNumericArg(args.delta, 'delta');
          const preDelay = this.parseOptionalNumericArg(args.pre_delay ?? args.preDelay, 'pre_delay');
          const postDelay = this.parseOptionalNumericArg(args.post_delay ?? args.postDelay, 'post_delay');
          const swipeOptions: { duration?: number; delta?: number; preDelay?: number; postDelay?: number } = {};
          if (duration !== undefined) swipeOptions.duration = duration;
          if (delta !== undefined) swipeOptions.delta = delta;
          if (preDelay !== undefined) swipeOptions.preDelay = preDelay;
          if (postDelay !== undefined) swipeOptions.postDelay = postDelay;
          return await SimulatorUiTools.swipe(
            simulatorUuid,
            { x: x1, y: y1 },
            { x: x2, y: y2 },
            swipeOptions,
          );
        }
        case 'xcresult_browse':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          return await XCResultTools.xcresultBrowse(
            args.xcresult_path as string,
            args.test_id as string | undefined,
            args.include_console as boolean || false
          );
        case 'xcresult_browser_get_console':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          if (!args.test_id) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
          }
          return await XCResultTools.xcresultBrowserGetConsole(
            args.xcresult_path as string,
            args.test_id as string
          );
        case 'xcresult_summary':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          return await XCResultTools.xcresultSummary(args.xcresult_path as string);
        case 'xcresult_get_screenshot':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          if (!args.test_id) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
          }
          if (args.timestamp === undefined) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: timestamp`);
          }
          return await XCResultTools.xcresultGetScreenshot(
            args.xcresult_path as string,
            args.test_id as string,
            args.timestamp as number
          );
        case 'xcresult_get_ui_hierarchy':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          if (!args.test_id) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
          }
          return await XCResultTools.xcresultGetUIHierarchy(
            args.xcresult_path as string,
            args.test_id as string,
            args.timestamp as number | undefined,
            args.full_hierarchy as boolean | undefined,
            args.raw_format as boolean | undefined
          );
        case 'xcresult_get_ui_element':
          if (!args.hierarchy_json_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: hierarchy_json_path`);
          }
          if (args.element_index === undefined) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: element_index`);
          }
          return await XCResultTools.xcresultGetUIElement(
            args.hierarchy_json_path as string,
            args.element_index as number,
            args.include_children as boolean | undefined
          );
        case 'xcresult_list_attachments':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          if (!args.test_id) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
          }
          return await XCResultTools.xcresultListAttachments(
            args.xcresult_path as string,
            args.test_id as string
          );
        case 'xcresult_export_attachment':
          if (!args.xcresult_path) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcresult_path`);
          }
          if (!args.test_id) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: test_id`);
          }
          if (args.attachment_index === undefined) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: attachment_index`);
          }
          return await XCResultTools.xcresultExportAttachment(
            args.xcresult_path as string,
            args.test_id as string,
            args.attachment_index as number,
            args.convert_to_json as boolean | undefined
          );
        case 'xcode_get_test_targets':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          return await ProjectTools.getTestTargets(args.xcodeproj as string);
        case 'xcode_refresh_project':
          if (!args.xcodeproj) {
            throw new McpError(ErrorCode.InvalidParams, `Missing required parameter: xcodeproj`);
          }
          // Close and reopen the project to refresh it
          await ProjectTools.closeProject(args.xcodeproj as string);
          const refreshResult = await ProjectTools.openProjectAndWaitForLoad(args.xcodeproj as string);
          return {
            content: [{
              type: 'text',
              text: `Project refreshed: ${refreshResult.content?.[0]?.type === 'text' ? refreshResult.content[0].text : 'Completed'}`
            }]
          };
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${name}`
          );
      }
    } catch (error) {
      // Enhanced error handling that doesn't crash the server
      Logger.error(`Tool execution error for ${name}:`, error);
      
      // Check if it's a configuration-related error that we can provide guidance for
      const enhancedError = await this.enhanceErrorWithGuidance(error as Error, name);
      if (enhancedError) {
        return { content: [{ type: 'text', text: enhancedError }] };
      }

      // For other errors, provide a helpful message but don't crash
      const errorMessage = error instanceof McpError ? error.message : 
        error instanceof Error ? `Tool execution failed: ${error.message}` : 
        `Tool execution failed: ${String(error)}`;
      
      return { 
        content: [{ 
          type: 'text', 
          text: `❌ ${name} failed: ${errorMessage}\n\n💡 If this persists, try running 'xcode_health_check' to diagnose potential configuration issues.`
        }] 
      };
    }
  }

  private cloneTestOptions(source?: TestJobOptions): TestJobOptions | undefined {
    if (!source) {
      return undefined;
    }

    const cloned: TestJobOptions = {};

    if (source.schemeName) cloned.schemeName = source.schemeName;
    if (source.testPlanPath) cloned.testPlanPath = source.testPlanPath;
    if (source.testTargetIdentifier) cloned.testTargetIdentifier = source.testTargetIdentifier;
    if (source.testTargetName) cloned.testTargetName = source.testTargetName;
    if (source.deviceType) cloned.deviceType = source.deviceType;
    if (source.osVersion) cloned.osVersion = source.osVersion;
    if (source.selectedTests) cloned.selectedTests = [...source.selectedTests];
    if (source.selectedTestClasses) cloned.selectedTestClasses = [...source.selectedTestClasses];

    return cloned;
  }

  private prepareTestRequest(args: Record<string, unknown>): TestJobRequest {
    if (!args.xcodeproj || typeof args.xcodeproj !== 'string') {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Missing required parameter: xcodeproj\n\n💡 Provide the absolute path to your .xcodeproj or .xcworkspace file.`,
      );
    }

    const projectPath = args.xcodeproj as string;

    const schemeFromArgs = typeof args.scheme === 'string' ? (args.scheme as string).trim() : '';
    const schemeName = schemeFromArgs || (this.preferredScheme ? this.preferredScheme.trim() : '');
    if (!schemeName) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Missing required parameter: scheme\n\n💡 Pass --scheme <SchemeName> or set XCODE_MCP_PREFERRED_SCHEME.`,
      );
    }

    const hasDestination = typeof args.destination === 'string' && (args.destination as string).trim().length > 0;
    const hasDeviceType = typeof args.device_type === 'string' && (args.device_type as string).trim().length > 0;
    if (!hasDestination && !hasDeviceType) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Missing required parameters. Provide either:\n• destination (e.g., "platform=iOS Simulator,name=iPhone 16")\n• or device_type with os_version (e.g., device_type="iphone" os_version="18.0").`,
      );
    }

    const destination = hasDestination ? (args.destination as string).trim() : null;

    const commandLineArguments: string[] = [];
    if (Array.isArray(args.command_line_arguments)) {
      (args.command_line_arguments as unknown[]).forEach(value => {
        const str = typeof value === 'string' ? value.trim() : String(value);
        if (str.length > 0) {
          commandLineArguments.push(str);
        }
      });
    } else if (typeof args.command_line_arguments === 'string') {
      const trimmed = (args.command_line_arguments as string).trim();
      if (trimmed.length > 0) {
        commandLineArguments.push(trimmed);
      }
    }

    const options: TestJobOptions = { schemeName };

    if (hasDeviceType) {
      options.deviceType = (args.device_type as string).trim();
    }
    if (typeof args.os_version === 'string' && (args.os_version as string).trim().length > 0) {
      options.osVersion = (args.os_version as string).trim();
    }
    if (typeof args.test_plan_path === 'string' && (args.test_plan_path as string).trim().length > 0) {
      options.testPlanPath = (args.test_plan_path as string).trim();
    }
    if (typeof args.test_target_identifier === 'string' && (args.test_target_identifier as string).trim().length > 0) {
      options.testTargetIdentifier = (args.test_target_identifier as string).trim();
    }
    if (typeof args.test_target_name === 'string' && (args.test_target_name as string).trim().length > 0) {
      options.testTargetName = (args.test_target_name as string).trim();
    }

    const normalizeStringArray = (value: unknown): string[] | undefined => {
      if (Array.isArray(value)) {
        const mapped = (value as unknown[])
          .map(entry => (typeof entry === 'string' ? entry.trim() : String(entry).trim()))
          .filter(str => str.length > 0);
        return mapped.length > 0 ? mapped : undefined;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? [trimmed] : undefined;
      }
      return undefined;
    };

    const selectedTests = normalizeStringArray(args.selected_tests);
    if (selectedTests) {
      options.selectedTests = selectedTests;
    }

    const selectedClasses = normalizeStringArray(args.selected_test_classes);
    if (selectedClasses) {
      options.selectedTestClasses = selectedClasses;
    }

    const parseBooleanFlag = (value: unknown): boolean | undefined => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'y'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'no', 'n'].includes(normalized)) {
          return false;
        }
      }
      return undefined;
    };

    const asyncFlagSource = args.run_async ?? args.async ?? args.background;
    const asyncMode = parseBooleanFlag(asyncFlagSource);

    const request: TestJobRequest = {
      projectPath,
      destination,
      commandLineArguments,
      options,
    };

    if (asyncMode) {
      request.asyncMode = asyncMode;
    }

    return request;
  }

  private async getVersionInfo(): Promise<McpResult> {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const projectRoot = join(moduleDir, '..');

    let packageVersion = 'unknown';
    try {
      const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf-8'));
      if (packageJson && typeof packageJson.version === 'string') {
        packageVersion = packageJson.version;
      }
    } catch (error) {
      Logger.warn(`Unable to read package.json for version info: ${error instanceof Error ? error.message : String(error)}`);
    }

    let gitDescription: string | null = null;
    try {
      const execFileAsync = promisify(execFile);
      const { stdout } = await execFileAsync('git', ['describe', '--tags', '--dirty', '--always'], {
        cwd: projectRoot,
        timeout: 2000,
      });
      const trimmed = stdout.trim();
      if (trimmed.length > 0) {
        gitDescription = trimmed;
      }
    } catch (error) {
      Logger.debug(`git describe unavailable for version info: ${error instanceof Error ? error.message : String(error)}`);
    }

    const keyArtifacts = [
      join(projectRoot, 'dist', 'XcodeServer.js'),
      join(projectRoot, 'dist', 'tools', 'BuildTools.js'),
      join(projectRoot, 'dist', 'tools', 'XCResultTools.js'),
    ];

    let latestModified: Date | null = null;
    for (const artifact of keyArtifacts) {
      try {
        const stats = await stat(artifact);
        if (!latestModified || stats.mtime > latestModified) {
          latestModified = stats.mtime;
        }
      } catch (error) {
        Logger.debug(`Version info: could not stat ${artifact}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: [
            '📦 XcodeMCP Version Information',
            '=============================='
          ].join('\n'),
        },
        {
          type: 'text',
          text: `Package version: ${packageVersion}`,
        },
        ...(gitDescription
          ? [{ type: 'text' as const, text: `Git describe: ${gitDescription}` }]
          : []),
        ...(latestModified
          ? [{
              type: 'text' as const,
              text: `Latest build artifact modified: ${latestModified.toLocaleString()}`,
            }]
          : []),
        {
          type: 'text',
          text: `Server root: ${projectRoot}`,
        },
      ],
    };
  }

  private cleanupExpiredJobs(): void {
    const now = Date.now();
    for (const [jobId, job] of this.testJobs.entries()) {
      if (job.status !== 'running' && now - job.updatedAt > this.testJobRetentionMs) {
        this.testJobs.delete(jobId);
        Logger.debug(`Cleaned up completed test job ${jobId} (age ${(now - job.updatedAt) / 1000}s).`);
      }
    }
  }

  private async startAsyncTestJob(request: TestJobRequest): Promise<McpResult> {
    if (request.asyncMode) {
      return this.startBackgroundTestJob(request);
    }
    return this.runSynchronousTestJob(request);
  }

  private startBackgroundTestJob(request: TestJobRequest): McpResult {
    this.cleanupExpiredJobs();

    const jobId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    const optionsCopy = this.cloneTestOptions(request.options);

    const storedRequest: TestJobRecord['request'] = {
      projectPath: request.projectPath,
      destination: request.destination,
      commandLineArguments: [...request.commandLineArguments],
    };
    const storedOptions = this.cloneTestOptions(optionsCopy);
    if (storedOptions) {
      storedRequest.options = storedOptions;
    }

    const jobRecord: TestJobRecord = {
      status: 'running',
      startedAt: Date.now(),
      updatedAt: Date.now(),
      lastAccessed: Date.now(),
      request: storedRequest,
    };

    this.testJobs.set(jobId, jobRecord);

    const openProject = this.openProject.bind(this);
    setImmediate(async () => {
      try {
        const runOptions = this.cloneTestOptions(optionsCopy);

        const result = await this.executeTestRun(request, openProject, runOptions);

        const job = this.testJobs.get(jobId);
        if (job) {
          job.status = 'succeeded';
          job.result = result;
          job.updatedAt = Date.now();
          job.completedAt = job.updatedAt;
          job.lastAccessed = job.updatedAt;
        }
      } catch (error) {
        const job = this.testJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);
          job.updatedAt = Date.now();
          job.completedAt = job.updatedAt;
          job.lastAccessed = job.updatedAt;
        }
      }
    });

    return {
      content: [
        {
          type: 'text',
          text: `🟡 TEST JOB STARTED\n\nJob ID: ${jobId}\nStarted: ${new Date(jobRecord.startedAt).toLocaleString()}\nDestination: ${request.destination ?? request.options?.deviceType ?? 'auto-selected'}\n\nPoll with xcode_test_status --job-id ${jobId}.`,
        },
      ],
      _meta: {
        job_id: jobId,
        status: 'running',
        started_at: jobRecord.startedAt,
        destination: request.destination ?? request.options?.deviceType ?? 'auto-selected',
      },
    };
  }

  private async runSynchronousTestJob(request: TestJobRequest): Promise<McpResult> {
    const openProject = this.openProject.bind(this);
    const optionsCopy = this.cloneTestOptions(request.options);
    const runOptions = this.cloneTestOptions(optionsCopy);

    return this.executeTestRun(request, openProject, runOptions);
  }

  private async executeTestRun(
    request: TestJobRequest,
    openProject: OpenProjectCallback,
    runOptions?: TestJobOptions,
  ): Promise<McpResult> {
    if (runOptions && Object.keys(runOptions).length > 0) {
      BuildTools.setPendingTestOptions(runOptions);
    }

    return await BuildTools.test(
      request.projectPath,
      request.destination,
      [...request.commandLineArguments],
      openProject,
      runOptions,
    );
  }

  private getTestJobStatus(jobId: string): McpResult {
    this.cleanupExpiredJobs();

    const job = this.testJobs.get(jobId);
    if (!job) {
      return {
        content: [
          {
            type: 'text',
            text: `❌ No test job found with ID '${jobId}'. It may have completed and been collected.`,
          },
        ],
        isError: true,
        _meta: {
          job_id: jobId,
          status: 'unknown',
        },
      };
    }

    job.lastAccessed = Date.now();

    if (job.status === 'running') {
      return {
        content: [
          {
            type: 'text',
            text: `🟡 TEST IN PROGRESS\n\nJob ID: ${jobId}\nStarted: ${new Date(job.startedAt).toLocaleString()}\nLast update: ${new Date(job.updatedAt).toLocaleString()}.`,
          },
        ],
        _meta: {
          job_id: jobId,
          status: 'running',
          started_at: job.startedAt,
          updated_at: job.updatedAt,
        },
      };
    }

    if (job.status === 'succeeded' && job.result) {
      const combinedContent = job.result.content ? [...job.result.content] : [];
      job.resultRetrieved = true;
      return {
        content: combinedContent,
        isError: job.result.isError,
        _meta: {
          job_id: jobId,
          status: 'succeeded',
          started_at: job.startedAt,
          completed_at: job.completedAt ?? job.updatedAt,
        },
      };
    }

    const failureMessage = job.error ?? 'Unknown error';
    return {
      content: [
        {
          type: 'text',
          text: `❌ Test job ${jobId} failed: ${failureMessage}\nStarted: ${new Date(job.startedAt).toLocaleString()}\nFinished: ${new Date(job.updatedAt).toLocaleString()}.`,
        },
      ],
      isError: true,
      _meta: {
        job_id: jobId,
        status: 'failed',
        started_at: job.startedAt,
        completed_at: job.completedAt ?? job.updatedAt,
      },
    };
  }
}
