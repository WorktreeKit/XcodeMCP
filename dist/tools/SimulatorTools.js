import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { promises as fsPromises } from 'fs';
import Logger from '../utils/Logger.js';
const execFileAsync = promisify(execFile);
export class SimulatorTools {
    static async listSimulators() {
        try {
            const { stdout } = await execFileAsync('xcrun', ['simctl', 'list', 'devices', '--json']);
            const parsed = JSON.parse(stdout);
            const deviceMap = parsed.devices ?? {};
            let response = 'Available iOS Simulators:\n\n';
            const lines = [];
            for (const [runtime, devices] of Object.entries(deviceMap)) {
                const available = devices.filter((device) => device.isAvailable ?? true);
                if (!available.length)
                    continue;
                lines.push(`${runtime}:`);
                for (const device of available) {
                    const status = device.state === 'Booted' ? ' [Booted]' : '';
                    lines.push(`- ${device.name} (${device.udid})${status}`);
                }
                lines.push('');
            }
            if (!lines.length) {
                response += 'No available simulators were returned by simctl.';
            }
            else {
                response += `${lines.join('\n')}\nNext Steps:\n- Boot a simulator: boot_sim({ simulator_uuid: 'UUID_FROM_ABOVE' })\n- Open the simulator UI: open_sim({})`;
            }
            return {
                content: [
                    {
                        type: 'text',
                        text: response,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error('Failed to list simulators', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to list simulators: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    static async bootSimulator(simulatorUuid) {
        try {
            await execFileAsync('xcrun', ['simctl', 'boot', simulatorUuid]);
            return {
                content: [
                    {
                        type: 'text',
                        text: `✅ Simulator ${simulatorUuid} booted successfully.\n\nNext Steps:\n- Make sure the Simulator UI is visible: open_sim({})\n- Launch your app with xcode_build_and_run or install it manually.`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error(`Failed to boot simulator ${simulatorUuid}`, error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to boot simulator ${simulatorUuid}: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    static async openSimulator() {
        try {
            await execFileAsync('open', ['-a', 'Simulator']);
            return {
                content: [
                    {
                        type: 'text',
                        text: 'Simulator app opened successfully.',
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error('Failed to open Simulator app', error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to open Simulator app: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    static async captureScreenshot(simulatorUuid, savePath) {
        const target = simulatorUuid ?? 'booted';
        const args = ['simctl', 'io', target, 'screenshot', '--type=png', '-'];
        return new Promise((resolve) => {
            const child = spawn('xcrun', args);
            const chunks = [];
            const errorChunks = [];
            child.stdout.on('data', (chunk) => chunks.push(chunk));
            child.stderr.on('data', (chunk) => errorChunks.push(chunk));
            child.on('close', async (code) => {
                if (code !== 0 || chunks.length === 0) {
                    const errorMessage = errorChunks.length > 0
                        ? Buffer.concat(errorChunks).toString('utf8')
                        : `simctl exited with code ${code}`;
                    Logger.error(`Screenshot capture failed for ${target}: ${errorMessage}`);
                    resolve({
                        content: [
                            {
                                type: 'text',
                                text: `Failed to capture screenshot: ${errorMessage.trim()}`,
                            },
                        ],
                        isError: true,
                    });
                    return;
                }
                const pngBuffer = Buffer.concat(chunks);
                let savedTo;
                if (savePath) {
                    try {
                        await fsPromises.writeFile(savePath, pngBuffer);
                        savedTo = savePath;
                    }
                    catch (writeError) {
                        const message = writeError instanceof Error ? writeError.message : String(writeError);
                        Logger.warn(`Failed to write screenshot to ${savePath}: ${message}`);
                    }
                }
                resolve({
                    content: [
                        {
                            type: 'image',
                            data: pngBuffer.toString('base64'),
                            mimeType: 'image/png',
                        },
                        ...(savedTo
                            ? [
                                {
                                    type: 'text',
                                    text: `Screenshot saved to ${savedTo}`,
                                },
                            ]
                            : []),
                    ],
                });
            });
        });
    }
    static async shutdownSimulator(simulatorUuid) {
        try {
            await execFileAsync('xcrun', ['simctl', 'shutdown', simulatorUuid]);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Simulator ${simulatorUuid} has been shut down.`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error(`Failed to shutdown simulator ${simulatorUuid}`, error);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to shutdown simulator ${simulatorUuid}: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    }
}
export default SimulatorTools;
//# sourceMappingURL=SimulatorTools.js.map