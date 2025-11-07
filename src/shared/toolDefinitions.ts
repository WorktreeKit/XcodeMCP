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
export function getToolDefinitions(options: { 
  includeClean?: boolean;
  preferredScheme?: string;
  preferredXcodeproj?: string;
} = { includeClean: true }): ToolDefinition[] {
  const { includeClean = true, preferredScheme, preferredXcodeproj } = options;
  const tools: ToolDefinition[] = [
    {
      name: 'xcode_open_project',
      description: 'Open an Xcode project or workspace',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_close_project',
      description: 'Close the currently active Xcode project or workspace (automatically stops any running actions first)',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_build',
      description: 'Build a specific Xcode project or workspace with the specified scheme. If destination is not provided, uses the currently active destination. ⏱️ Can take minutes to hours - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file to build (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file to build (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme: {
            type: 'string',
            description: preferredScheme 
              ? `Name of the scheme to build - defaults to ${preferredScheme}`
              : 'Name of the scheme to build',
          },
          destination: {
            type: 'string',
            description: 'Build destination (optional - uses active destination if not provided)',
          },
        },
        required: [
          ...(!preferredXcodeproj ? ['xcodeproj'] : []),
          ...(!preferredScheme ? ['scheme'] : [])
        ],
      },
    },
    {
      name: 'xcode_get_schemes',
      description: 'Get list of available schemes for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_set_active_scheme',
      description: 'Set the active scheme for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme_name: {
            type: 'string',
            description: 'Name of the scheme to activate',
          },
        },
        required: preferredXcodeproj ? ['scheme_name'] : ['xcodeproj', 'scheme_name'],
      },
    },
    {
      name: 'xcode_test',
      description: 'Run tests for a specific project. Optionally run only specific tests or test classes by temporarily modifying the test plan (automatically restored after completion). ⏱️ Can take minutes to hours - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          destination: {
            type: 'string',
            description: 'Explicit xcodebuild destination string (e.g., "platform=iOS Simulator,name=iPhone 16"). Optional when device_type/os_version are supplied.',
          },
          device_type: {
            type: 'string',
            description: 'High-level device family to target (e.g., iphone, ipad, mac, watch, tv, vision). When provided, os_version is recommended.',
          },
          os_version: {
            type: 'string',
            description: 'Desired OS version for the selected device family (e.g., 18.0, 26.0). Used with device_type.',
          },
          command_line_arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional command line arguments',
          },
          test_plan_path: {
            type: 'string',
            description: 'Optional: Absolute path to .xctestplan file to temporarily modify for selective test execution',
          },
          selected_tests: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Array of specific test identifiers to run. Format depends on test framework: XCTest: "TestAppUITests/testExample" (no parentheses), Swift Testing: "TestAppTests/example". Requires test_plan_path.',
          },
          selected_test_classes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional: Array of test class names to run (e.g., ["TestAppTests", "TestAppUITests"]). This runs ALL tests in the specified classes. Requires test_plan_path.',
          },
          test_target_identifier: {
            type: 'string',
            description: 'Optional: Target identifier for the test target (required when using test filtering). Can be found in project.pbxproj.',
          },
          test_target_name: {
            type: 'string',
            description: 'Optional: Target name for the test target (alternative to test_target_identifier). Example: "TestAppTests".',
          },
          scheme: {
            type: 'string',
            description: preferredScheme
              ? `Name of the test scheme - defaults to ${preferredScheme}`
              : 'Name of the test scheme to run',
          },
          run_async: {
            type: 'boolean',
            description: 'Return immediately with a background job ID instead of waiting for completion (default: false).',
          },
        },
        required: [
          ...(!preferredXcodeproj ? ['xcodeproj'] : []),
          ...(!preferredScheme ? ['scheme'] : [])
        ],
      },
    },
    {
      name: 'xcode_test_status',
      description: 'Check the status of an asynchronous test job started via xcode_test.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: {
            type: 'string',
            description: 'Job identifier returned by xcode_test.',
          },
        },
        required: ['job_id'],
      },
    },
    {
      name: 'xcode_build_and_run',
      description: 'Build and run a specific project with the specified scheme. ⏱️ Can run indefinitely - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme: {
            type: 'string',
            description: preferredScheme 
              ? `Name of the scheme to run - defaults to ${preferredScheme}`
              : 'Name of the scheme to run',
          },
          command_line_arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Additional command line arguments',
          },
        },
        required: [
          ...(!preferredXcodeproj ? ['xcodeproj'] : []),
          ...(!preferredScheme ? ['scheme'] : [])
        ],
      },
    },
    {
      name: 'xcode_debug',
      description: 'Start debugging session for a specific project. ⏱️ Can run indefinitely - do not timeout.',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
          scheme: {
            type: 'string',
            description: preferredScheme 
              ? `Scheme name (optional) - defaults to ${preferredScheme}` 
              : 'Scheme name (optional)',
          },
          skip_building: {
            type: 'boolean',
            description: 'Whether to skip building',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_stop',
      description: 'Stop the current scheme action for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'find_xcresults',
      description: 'Find all XCResult files for a specific project with timestamps and file information',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_get_run_destinations',
      description: 'Get list of available run destinations for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_get_workspace_info',
      description: 'Get information about a specific workspace',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_get_projects',
      description: 'Get list of projects in a specific workspace',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    },
    {
      name: 'xcode_open_file',
      description: 'Open a file in Xcode',
      inputSchema: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Absolute path to the file to open',
          },
          line_number: {
            type: 'number',
            description: 'Optional line number to navigate to',
          },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'list_sims',
      description: 'List available iOS simulators with their states and runtime information.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'boot_sim',
      description: 'Boot an iOS simulator using its UUID.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to boot (use list_sims to discover).',
          },
        },
        required: ['simulator_uuid'],
      },
    },
    {
      name: 'open_sim',
      description: 'Open the Simulator application.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'shutdown_sim',
      description: 'Shut down a running simulator.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to shut down.',
          },
        },
        required: ['simulator_uuid'],
      },
    },
    {
      name: 'screenshot',
      description: 'Capture a PNG screenshot from a simulator. Returns the image as base64 data.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'Optional simulator UUID (defaults to the booted simulator).',
          },
          save_path: {
            type: 'string',
            description: 'Optional path to save the screenshot on disk.',
          },
        },
      },
    },
    {
      name: 'start_sim_log_cap',
      description:
        'Start capturing logs from a simulator. Returns a session ID for stop_sim_log_cap. Optional console capture relaunches the app.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to capture.',
          },
          bundle_id: {
            type: 'string',
            description: 'Bundle identifier of the target app (e.g., com.example.MyApp).',
          },
          capture_console: {
            type: 'boolean',
            description: 'Capture console output by relaunching the app (defaults to false).',
          },
          command_line_arguments: {
            type: 'array',
            items: { type: 'string' },
            description: 'Arguments forwarded when relaunching the app for console capture.',
          },
        },
        required: ['simulator_uuid', 'bundle_id'],
      },
    },
    {
      name: 'stop_sim_log_cap',
      description: 'Stop log capture started by start_sim_log_cap and return collected output.',
      inputSchema: {
        type: 'object',
        properties: {
          session_id: {
            type: 'string',
            description: 'Session ID returned by start_sim_log_cap.',
          },
        },
        required: ['session_id'],
      },
    },
    {
      name: 'describe_ui',
      description:
        'Return the accessibility hierarchy for the running simulator using AXe. Provides coordinates for automation.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to inspect.',
          },
        },
        required: ['simulator_uuid'],
      },
    },
    {
      name: 'tap',
      description:
        'Tap at specific coordinates using AXe. Use describe_ui first to gather accurate positions.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to interact with.',
          },
          x: {
            type: 'number',
            description: 'X coordinate in simulator points.',
          },
          y: {
            type: 'number',
            description: 'Y coordinate in simulator points.',
          },
          pre_delay: {
            type: 'number',
            description: 'Optional delay before performing the tap (seconds).',
          },
          post_delay: {
            type: 'number',
            description: 'Optional delay after performing the tap (seconds).',
          },
        },
        required: ['simulator_uuid', 'x', 'y'],
      },
    },
    {
      name: 'type_text',
      description: 'Type text into the simulator using AXe keyboard events. Focus the target field first.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to interact with.',
          },
          text: {
            type: 'string',
            description: 'Text to type (standard US keyboard characters).',
          },
        },
        required: ['simulator_uuid', 'text'],
      },
    },
    {
      name: 'swipe',
      description:
        'Swipe from one coordinate to another using AXe. Coordinates are provided in simulator points.',
      inputSchema: {
        type: 'object',
        properties: {
          simulator_uuid: {
            type: 'string',
            description: 'UUID of the simulator to interact with.',
          },
          x1: {
            type: 'number',
            description: 'Start X coordinate.',
          },
          y1: {
            type: 'number',
            description: 'Start Y coordinate.',
          },
          x2: {
            type: 'number',
            description: 'End X coordinate.',
          },
          y2: {
            type: 'number',
            description: 'End Y coordinate.',
          },
          duration: {
            type: 'number',
            description: 'Optional swipe duration in seconds.',
          },
          delta: {
            type: 'number',
            description: 'Optional sampling delta for the gesture.',
          },
          pre_delay: {
            type: 'number',
            description: 'Optional delay before performing the swipe.',
          },
          post_delay: {
            type: 'number',
            description: 'Optional delay after performing the swipe.',
          },
        },
        required: ['simulator_uuid', 'x1', 'y1', 'x2', 'y2'],
      },
    },
    {
      name: 'xcode_health_check',
      description: 'Perform a comprehensive health check of the XcodeMCP environment and configuration',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'xcresult_browse',
      description: 'Browse XCResult files - list all tests or show details for a specific test. Returns comprehensive test results including pass/fail status, failure details, and browsing instructions. Large console output (>20 lines or >2KB) is automatically saved to a temporary file.',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
          test_id: {
            type: 'string',
            description: 'Optional test ID or index number to show details for a specific test',
          },
          include_console: {
            type: 'boolean',
            description: 'Whether to include console output and test activities (only used with test_id)',
            default: false,
          },
        },
        required: ['xcresult_path'],
      },
    },
    {
      name: 'xcresult_browser_get_console',
      description: 'Get console output and test activities for a specific test in an XCResult file. Large output (>20 lines or >2KB) is automatically saved to a temporary file.',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
          test_id: {
            type: 'string',
            description: 'Test ID or index number to get console output for',
          },
        },
        required: ['xcresult_path', 'test_id'],
      },
    },
    {
      name: 'xcresult_summary',
      description: 'Get a quick summary of test results from an XCResult file',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
        },
        required: ['xcresult_path'],
      },
    },
    {
      name: 'xcresult_get_screenshot',
      description: 'Get screenshot from a failed test at specific timestamp - extracts frame from video attachment using ffmpeg',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
          test_id: {
            type: 'string',
            description: 'Test ID or index number to get screenshot for',
          },
          timestamp: {
            type: 'number',
            description: 'Timestamp in seconds when to extract the screenshot. WARNING: Use a timestamp BEFORE the failure (e.g., if failure is at 30.71s, use 30.69s) as failure timestamps often show the home screen after the app has crashed or reset.',
          },
        },
        required: ['xcresult_path', 'test_id', 'timestamp'],
      },
    },
    {
      name: 'xcresult_get_ui_hierarchy',
      description: 'Get UI hierarchy attachment from test. Returns raw accessibility tree (best for AI), slim AI-readable JSON (default), or full JSON.',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
          test_id: {
            type: 'string',
            description: 'Test ID or index number to get UI hierarchy for',
          },
          timestamp: {
            type: 'number',
            description: 'Optional timestamp in seconds to find the closest UI snapshot. If not provided, uses the first available UI snapshot.',
          },
          full_hierarchy: {
            type: 'boolean',
            description: 'Set to true to get the full hierarchy (several MB). Default is false for AI-readable slim version.',
          },
          raw_format: {
            type: 'boolean',
            description: 'Set to true to get the raw accessibility tree text (most AI-friendly). Default is false for JSON format.',
          },
        },
        required: ['xcresult_path', 'test_id'],
      },
    },
    {
      name: 'xcresult_get_ui_element',
      description: 'Get full details of a specific UI element by index from a previously exported UI hierarchy JSON file',
      inputSchema: {
        type: 'object',
        properties: {
          hierarchy_json_path: {
            type: 'string',
            description: 'Absolute path to the UI hierarchy JSON file (the full version saved by xcresult-get-ui-hierarchy)',
          },
          element_index: {
            type: 'number',
            description: 'Index of the element to get details for (the "j" value from the slim hierarchy)',
          },
          include_children: {
            type: 'boolean',
            description: 'Whether to include children in the response. Defaults to false.',
          },
        },
        required: ['hierarchy_json_path', 'element_index'],
      },
    },
    {
      name: 'xcresult_list_attachments',
      description: 'List all attachments for a specific test - shows attachment names, types, and indices for export',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
          test_id: {
            type: 'string',
            description: 'Test ID or index number to list attachments for',
          },
        },
        required: ['xcresult_path', 'test_id'],
      },
    },
    {
      name: 'xcresult_export_attachment',
      description: 'Export a specific attachment by index - can convert App UI hierarchy attachments to JSON',
      inputSchema: {
        type: 'object',
        properties: {
          xcresult_path: {
            type: 'string',
            description: 'Absolute path to the .xcresult file',
          },
          test_id: {
            type: 'string',
            description: 'Test ID or index number that contains the attachment',
          },
          attachment_index: {
            type: 'number',
            description: 'Index number of the attachment to export (1-based, from xcresult-list-attachments)',
          },
          convert_to_json: {
            type: 'boolean',
            description: 'If true and attachment is an App UI hierarchy, convert to JSON format',
          },
        },
        required: ['xcresult_path', 'test_id', 'attachment_index'],
      },
    },
    {
      name: 'xcode_refresh_project',
      description: 'Refresh/reload an Xcode project by closing and reopening it to pick up external changes like modified .xctestplan files',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available) to refresh',
          },
        },
        required: ['xcodeproj'],
      },
    },
    {
      name: 'xcode_get_test_targets',
      description: 'Get information about test targets in a project, including names and identifiers',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: 'Absolute path to the .xcodeproj file (or .xcworkspace if available)',
          },
        },
        required: ['xcodeproj'],
      },
    },
    {
      name: 'webview_start_proxy',
      description: 'Start ios_webkit_debug_proxy for a specific simulator or device',
      cliName: 'webview:proxy',
      cliAliases: ['webview-start-proxy'],
      cliHidden: true,
      inputSchema: {
        type: 'object',
        properties: {
          udid: {
            type: 'string',
            description: 'Target simulator/device UDID. Defaults to the first booted target.',
          },
          port: {
            type: 'number',
            description: 'Base port for inspectable tabs (device list uses port-1). Defaults to 9222.',
          },
          foreground: {
            type: 'boolean',
            description: 'Run ios_webkit_debug_proxy in the foreground (stream logs).',
          },
        },
        required: [],
      },
    },
    {
      name: 'webview_stop_proxy',
      description: 'Stop a running ios_webkit_debug_proxy instance for the provided UDID',
      cliName: 'webview:proxy --stop',
      cliAliases: ['webview-stop-proxy'],
      cliHidden: true,
      inputSchema: {
        type: 'object',
        properties: {
          udid: {
            type: 'string',
            description: 'Target simulator/device UDID to stop.',
          },
        },
        required: ['udid'],
      },
    },
    {
      name: 'webview_list_targets',
      description: 'List inspectable WKWebView or Safari targets exposed via ios_webkit_debug_proxy',
      cliName: 'webview:list',
      cliAliases: ['webview-list'],
      cliHidden: true,
      inputSchema: {
        type: 'object',
        properties: {
          udid: {
            type: 'string',
            description: 'Optional UDID to scope the listing. Defaults to the first booted target.',
          },
          port: {
            type: 'number',
            description: 'Base port for inspectable tabs (device list uses port-1). Defaults to 9222.',
          },
        },
        required: [],
      },
    },
    {
      name: 'webview_eval',
      description: 'Evaluate JavaScript inside a WKWebView/Safari target exposed via ios_webkit_debug_proxy',
      cliName: 'webview:eval',
      cliAliases: ['webview-eval'],
      cliHidden: true,
      inputSchema: {
        type: 'object',
        properties: {
          udid: {
            type: 'string',
            description: 'Target simulator/device UDID.',
          },
          target_id_or_url: {
            type: 'string',
            description: 'Page identifier or URL substring to select the target.',
          },
          expr: {
            type: 'string',
            description: 'JavaScript expression to evaluate.',
          },
          port: {
            type: 'number',
            description: 'Base port (tabs). Defaults to 9222.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Timeout in milliseconds for the evaluation (default 5000).',
          },
        },
        required: ['udid', 'target_id_or_url', 'expr'],
      },
    },
    {
      name: 'webview_open_ui',
      description: 'Open the ios_webkit_debug_proxy device or page inspector UI in the default browser',
      cliName: 'webview:open',
      cliAliases: ['webview-open'],
      cliHidden: true,
      inputSchema: {
        type: 'object',
        properties: {
          udid: {
            type: 'string',
            description: 'Optional UDID to scope the UI. Defaults to first booted.',
          },
          port: {
            type: 'number',
            description: 'Base port for tabs (device list uses port-1). Defaults to 9222.',
          },
          page_id: {
            type: 'string',
            description: 'Optional page identifier to open directly.',
          },
        },
        required: [],
      },
    },
  ];

  // Conditionally add the clean tool
  if (includeClean) {
    tools.splice(5, 0, {
      name: 'xcode_clean',
      description: 'Clean the build directory for a specific project',
      inputSchema: {
        type: 'object',
        properties: {
          xcodeproj: {
            type: 'string',
            description: preferredXcodeproj 
              ? `Absolute path to the .xcodeproj file (or .xcworkspace if available) - defaults to ${preferredXcodeproj}`
              : 'Absolute path to the .xcodeproj file (or .xcworkspace if available) - e.g., /path/to/project.xcodeproj',
          },
        },
        required: preferredXcodeproj ? [] : ['xcodeproj'],
      },
    });
  }

  return tools;
}
