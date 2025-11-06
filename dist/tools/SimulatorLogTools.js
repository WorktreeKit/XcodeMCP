import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createWriteStream, promises as fsPromises } from 'fs';
import { access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import Logger from '../utils/Logger.js';
export class SimulatorLogTools {
    static sessions = new Map();
    static async startLogCapture(params) {
        const { simulatorUuid, bundleId, captureConsole = false, args = [] } = params;
        const sessionId = randomUUID();
        const logFile = join(tmpdir(), `xcodemcp_simlog_${sessionId}.log`);
        const processes = [];
        const logStream = createWriteStream(logFile, { flags: 'a' });
        logStream.write(`# Simulator log capture\n# Simulator: ${simulatorUuid}\n# Bundle: ${bundleId}\n# Started: ${new Date().toISOString()}\n\n`);
        try {
            if (captureConsole) {
                const consoleArgs = [
                    'simctl',
                    'launch',
                    '--console-pty',
                    '--terminate-running-process',
                    simulatorUuid,
                    bundleId,
                    ...args,
                ];
                const consoleProcess = spawn('xcrun', consoleArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
                consoleProcess.stdout?.on('data', (chunk) => {
                    logStream.write(`[console] ${chunk.toString()}`);
                });
                consoleProcess.stderr?.on('data', (chunk) => {
                    logStream.write(`[stderr] ${chunk.toString()}`);
                });
                consoleProcess.on('error', (error) => {
                    Logger.error(`Console log capture failed: ${error.message}`);
                });
                processes.push(consoleProcess);
            }
            const predicate = `process == "${bundleId}" OR subsystem == "${bundleId}"`;
            const osLogArgs = [
                'simctl',
                'spawn',
                simulatorUuid,
                'log',
                'stream',
                '--style=json',
                '--level=debug',
                '--predicate',
                predicate,
            ];
            const osLogProcess = spawn('xcrun', osLogArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            osLogProcess.stdout?.on('data', (chunk) => {
                logStream.write(chunk);
            });
            osLogProcess.stderr?.on('data', (chunk) => {
                logStream.write(`[log stderr] ${chunk.toString()}`);
            });
            osLogProcess.on('error', (error) => {
                Logger.error(`OS log capture failed: ${error.message}`);
            });
            processes.push(osLogProcess);
            this.sessions.set(sessionId, { processes, logFile, stream: logStream });
            return {
                content: [
                    {
                        type: 'text',
                        text: `Log capture started for simulator ${simulatorUuid} (bundle ${bundleId}).\nSession ID: ${sessionId}\nLogs are streaming to ${logFile}.\nUse stop_sim_log_cap({ session_id: "${sessionId}" }) to finish.`,
                    },
                ],
            };
        }
        catch (error) {
            for (const process of processes) {
                if (!process.killed) {
                    process.kill('SIGTERM');
                }
            }
            logStream.end();
            const message = error instanceof Error ? error.message : String(error);
            Logger.error(`Failed to start log capture: ${message}`);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Failed to start log capture: ${message}`,
                    },
                ],
                isError: true,
            };
        }
    }
    static async stopLogCapture(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Log capture session not found: ${sessionId}`,
                    },
                ],
                isError: true,
            };
        }
        for (const process of session.processes) {
            if (!process.killed && process.exitCode === null) {
                process.kill('SIGTERM');
            }
        }
        session.stream.end();
        this.sessions.delete(sessionId);
        try {
            await access(session.logFile);
            const logContent = await fsPromises.readFile(session.logFile, 'utf8');
            return {
                content: [
                    {
                        type: 'text',
                        text: `Simulator log capture complete for session ${sessionId}.\nLog file: ${session.logFile}\n\n--- LOG START ---\n${logContent}`,
                    },
                ],
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            Logger.error(`Failed to read log file for session ${sessionId}: ${message}`);
            return {
                content: [
                    {
                        type: 'text',
                        text: `Log capture stopped but the log file could not be read: ${message}\nFile path: ${session.logFile}`,
                    },
                ],
                isError: true,
            };
        }
    }
}
export default SimulatorLogTools;
//# sourceMappingURL=SimulatorLogTools.js.map