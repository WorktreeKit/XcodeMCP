import { execFile } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import Logger from '../utils/Logger.js';
const execFileAsync = promisify(execFile);
class AxeInvoker {
    static cachedPath;
    static async resolveBinary() {
        if (this.cachedPath !== undefined) {
            return this.cachedPath;
        }
        const envOverride = process.env.XCODEMCP_AXE_PATH ?? process.env.AXE_PATH;
        if (envOverride) {
            try {
                await access(envOverride, constants.X_OK);
                this.cachedPath = envOverride;
                return envOverride;
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                Logger.warn(`AXe path specified but not executable (${envOverride}): ${message}`);
            }
        }
        // Try bundled binary if it exists (for future packaging)
        try {
            const __dirname = dirname(fileURLToPath(import.meta.url));
            const candidate = join(__dirname, '..', 'bundled', 'axe');
            await access(candidate, constants.X_OK);
            this.cachedPath = candidate;
            return candidate;
        }
        catch {
            // ignore - bundled binary not present
        }
        // Fall back to expecting axe in PATH
        this.cachedPath = 'axe';
        return 'axe';
    }
    static async run(options) {
        const axeBinary = await this.resolveBinary();
        if (!axeBinary) {
            return {
                success: false,
                errorMessage: "AXe binary not found. Install it with `brew install cameroncooke/axe/axe` or set XCODEMCP_AXE_PATH to the executable's location.",
            };
        }
        const fullArgs = [...options.args, '--udid', options.simulatorUuid];
        try {
            const { stdout, stderr } = await execFileAsync(axeBinary, fullArgs, {
                env: process.env,
            });
            const result = { success: true };
            const trimmedStdout = stdout?.trim();
            const trimmedStderr = stderr?.trim();
            if (trimmedStdout) {
                result.stdout = trimmedStdout;
            }
            if (trimmedStderr) {
                result.stderr = trimmedStderr;
            }
            return result;
        }
        catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                return {
                    success: false,
                    errorMessage: "AXe binary could not be executed. Install it with `brew install cameroncooke/axe/axe` or set XCODEMCP_AXE_PATH to the executable's location.",
                };
            }
            const execError = error;
            const payload = {
                success: false,
                errorMessage: execError.message ?? 'AXe command failed',
            };
            const trimmedStdout = execError.stdout?.toString().trim();
            const trimmedStderr = execError.stderr?.toString().trim();
            if (trimmedStdout) {
                payload.stdout = trimmedStdout;
            }
            if (trimmedStderr) {
                payload.stderr = trimmedStderr;
            }
            return payload;
        }
    }
}
const describeUiTracker = new Map();
const DESCRIBE_UI_STALENESS_MS = 60_000;
function formatCoordinateWarning(simulatorUuid) {
    const last = describeUiTracker.get(simulatorUuid);
    if (!last) {
        return 'Tip: call describe_ui first to capture precise coordinates instead of guessing from screenshots.';
    }
    const age = Date.now() - last;
    if (age > DESCRIBE_UI_STALENESS_MS) {
        const seconds = Math.round(age / 1000);
        return `Tip: describe_ui was last run ${seconds}s ago. Run it again if the UI has changed.`;
    }
    return null;
}
export class SimulatorUiTools {
    static async describeUI(simulatorUuid) {
        const result = await AxeInvoker.run({
            simulatorUuid,
            args: ['describe-ui'],
        });
        if (!result.success) {
            const message = result.errorMessage ??
                result.stderr ??
                'AXe could not describe the UI. Ensure the simulator is booted and your app is running.';
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to describe UI: ${message}`,
                    },
                ],
                isError: true,
            };
        }
        describeUiTracker.set(simulatorUuid, Date.now());
        const body = result.stdout ?? '';
        return {
            content: [
                {
                    type: 'text',
                    text: `Accessibility hierarchy for simulator ${simulatorUuid}:\n\`\`\`json\n${body}\n\`\`\`\nUse these frames to drive tap/swipe commands.`,
                },
            ],
        };
    }
    static async tap(simulatorUuid, x, y, options = {}) {
        const args = ['tap', '-x', String(Math.round(x)), '-y', String(Math.round(y))];
        if (options.preDelay !== undefined) {
            args.push('--pre-delay', String(options.preDelay));
        }
        if (options.postDelay !== undefined) {
            args.push('--post-delay', String(options.postDelay));
        }
        const result = await AxeInvoker.run({ simulatorUuid, args });
        if (!result.success) {
            const message = result.errorMessage ??
                result.stderr ??
                'Tap command failed. Ensure AXe has Accessibility permissions (System Settings > Privacy & Security > Accessibility).';
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to tap at (${x}, ${y}): ${message}`,
                    },
                ],
                isError: true,
            };
        }
        const warning = formatCoordinateWarning(simulatorUuid);
        return {
            content: [
                {
                    type: 'text',
                    text: `Tap at (${x}, ${y}) executed successfully.${warning ? `\n\n${warning}` : ''}`,
                },
            ],
        };
    }
    static async typeText(simulatorUuid, text) {
        const result = await AxeInvoker.run({
            simulatorUuid,
            args: ['type', text],
        });
        if (!result.success) {
            const message = result.errorMessage ??
                result.stderr ??
                'Type command failed. Make sure the target text field is focused (use tap first).';
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to type text: ${message}`,
                    },
                ],
                isError: true,
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: `Typed text "${text}" on simulator ${simulatorUuid}.`,
                },
            ],
        };
    }
    static async swipe(simulatorUuid, start, end, options = {}) {
        const args = [
            'swipe',
            '--start-x',
            String(Math.round(start.x)),
            '--start-y',
            String(Math.round(start.y)),
            '--end-x',
            String(Math.round(end.x)),
            '--end-y',
            String(Math.round(end.y)),
        ];
        if (options.duration !== undefined) {
            args.push('--duration', String(options.duration));
        }
        if (options.delta !== undefined) {
            args.push('--delta', String(options.delta));
        }
        if (options.preDelay !== undefined) {
            args.push('--pre-delay', String(options.preDelay));
        }
        if (options.postDelay !== undefined) {
            args.push('--post-delay', String(options.postDelay));
        }
        const result = await AxeInvoker.run({ simulatorUuid, args });
        if (!result.success) {
            const message = result.errorMessage ??
                result.stderr ??
                'Swipe command failed. Verify coordinates using describe_ui.';
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to swipe from (${start.x}, ${start.y}) to (${end.x}, ${end.y}): ${message}`,
                    },
                ],
                isError: true,
            };
        }
        const warning = formatCoordinateWarning(simulatorUuid);
        return {
            content: [
                {
                    type: 'text',
                    text: `Swipe from (${start.x}, ${start.y}) to (${end.x}, ${end.y}) executed successfully.${warning ? `\n\n${warning}` : ''}`,
                },
            ],
        };
    }
}
export function resetAxeCacheForTesting() {
    AxeInvoker.cachedPath = undefined;
}
export default SimulatorUiTools;
//# sourceMappingURL=SimulatorUiTools.js.map