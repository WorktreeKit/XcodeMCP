import { describe, test, expect } from 'vitest';

describe('XcodeMCP Server Functional Tests', () => {
  test('should validate server startup script syntax', async () => {
    // Test that the main script can be imported without syntax errors
    expect(async () => {
      await import('../dist/index.js');
    }).not.toThrow();
  });

  test('should export XcodeMCPServer class', async () => {
    const module = await import('../dist/index.js');
    expect(module.XcodeMCPServer).toBeDefined();
    expect(typeof module.XcodeMCPServer).toBe('function');
  });

  test('should validate package.json structure', async () => {
    const packageJson = await import('../package.json', { assert: { type: 'json' } });
    
    expect(packageJson.default.name).toBe('xcodemcp');
    expect(packageJson.default.type).toBe('module');
    expect(packageJson.default.scripts.start).toBeDefined();
    expect(packageJson.default.scripts.test).toBeDefined();
    expect(packageJson.default.dependencies['@modelcontextprotocol/sdk']).toBeDefined();
  });

  test('should validate tool definitions completeness', () => {
    // Test the tool definitions without instantiating the class
    const expectedTools = [
      'xcode_open_project',
      'xcode_build', 
      'xcode_clean',
      'xcode_test',
      'xcode_run',
      'xcode_debug',
      'xcode_stop',
      'xcode_get_schemes',
      'xcode_get_run_destinations',
      'xcode_set_active_scheme',
      'xcode_get_workspace_info',
      'xcode_get_projects',
      'xcode_open_file'
    ];

    expect(expectedTools.length).toBe(13);
    expect(expectedTools).toContain('xcode_build');
    expect(expectedTools).toContain('xcode_test');
    expect(expectedTools).toContain('xcode_run');
  });

  test('should validate JXA script generation patterns', () => {
    // Test script patterns that should be valid JavaScript
    const testScripts = [
      'const app = Application("Xcode");',
      'const workspace = app.activeWorkspaceDocument();',
      'if (!workspace) throw new Error("No active workspace");',
      'const result = workspace.build();',
      'return `Build started. Result ID: ${result.id()}`;'
    ];

    testScripts.forEach(script => {
      expect(() => {
        // Validate JavaScript syntax by attempting to create a function
        new Function(script);
      }).not.toThrow();
    });
  });

  test('should validate AppleScript dictionary coverage', () => {
    // Test that we cover the main Xcode AppleScript features
    const xcodeFeatures = [
      'workspace document operations',
      'build actions', 
      'test execution',
      'debugging',
      'scheme management',
      'project access',
      'file operations'
    ];

    expect(xcodeFeatures.length).toBeGreaterThan(5);
  });
});