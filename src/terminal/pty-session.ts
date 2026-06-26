import * as pty from "node-pty";

import {
	buildWindowsCmdArgsCommandLine,
	resolveWindowsComSpec,
	shouldUseWindowsCmdLaunch,
} from "../core/windows-cmd-launch";
import { stripInternalAuthTokenFromEnv } from "../security/passcode-manager";

export interface PtyExitEvent {
	exitCode: number;
	signal?: number;
}

export interface SpawnPtySessionRequest {
	binary: string;
	args?: string[] | string;
	cwd: string;
	env?: Record<string, string | undefined>;
	cols: number;
	rows: number;
	onData?: (chunk: Buffer) => void;
	onExit?: (event: PtyExitEvent) => void;
}

type PtyOutputChunk = string | Buffer | Uint8Array;

function normalizeOutputChunk(data: PtyOutputChunk): Buffer {
	if (typeof data === "string") {
		return Buffer.from(data, "utf8");
	}
	return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function isIgnorablePtyWriteError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return code === "EIO" || code === "EBADF";
}

function isIgnorablePtyResizeError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "EIO" || code === "EBADF") {
		return true;
	}
	return error.message.toLowerCase().includes("already exited");
}

function terminatePtyProcess(ptyProcess: pty.IPty): void {
	const pid = ptyProcess.pid;
	ptyProcess.kill();
	if (process.platform !== "win32" && Number.isFinite(pid) && pid > 0) {
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			// Best effort: process group may already be gone or inaccessible.
		}
	}
}

export class PtySession {
	private readonly ptyProcess: pty.IPty;
	private interrupted = false;
	private exited = false;

	private constructor(
		ptyProcess: pty.IPty,
		private readonly onDataCallback?: (chunk: Buffer) => void,
		private readonly onExitCallback?: (event: PtyExitEvent) => void,
	) {
		this.ptyProcess = ptyProcess;
		(this.ptyProcess.onData as unknown as (listener: (data: PtyOutputChunk) => void) => void)((data) => {
			const chunk = normalizeOutputChunk(data);
			this.onDataCallback?.(chunk);
		});
		this.ptyProcess.onExit((event) => {
			this.exited = true;
			this.onExitCallback?.(event);
		});
	}

	static spawn({ binary, args = [], cwd, env, cols, rows, onData, onExit }: SpawnPtySessionRequest): PtySession {
		const normalizedArgs = typeof args === "string" ? [args] : args;
		const terminalName = env?.TERM?.trim() || process.env.TERM?.trim() || "xterm-256color";
		const launchEnv: NodeJS.ProcessEnv = env ? { ...process.env, ...env } : process.env;
		const useWindowsShellLaunch = shouldUseWindowsCmdLaunch(binary, process.platform, launchEnv);
		const spawnBinary = useWindowsShellLaunch ? resolveWindowsComSpec(launchEnv) : binary;
		const spawnArgs = useWindowsShellLaunch ? buildWindowsCmdArgsCommandLine(binary, normalizedArgs) : normalizedArgs;
		const ptyOptions: pty.IPtyForkOptions = {
			name: terminalName,
			cwd,
			// Scrub the internal CLI auth token (§5.Y #6): a terminal is a user-facing
			// shell — in remote mode possibly a remote user's — so it must never inherit
			// the trusted bearer token that authenticates runtime-API callers (it could
			// be read with `echo $NKLEIN_INTERNAL_AUTH_TOKEN` and replayed to impersonate
			// a trusted caller). `env ?? process.env` also covers the no-override case,
			// where node-pty would otherwise inherit process.env (and its token) directly.
			// The agent tool path is containerized (not a PTY), and the runtime spawns
			// trusted `nklein task`/hooks WITHOUT this scrub, so they still inherit the
			// token. No-op in local mode, where no internal token is generated.
			env: stripInternalAuthTokenFromEnv(env ?? process.env),
			cols,
			rows,
			encoding: null,
		};

		const ptyProcess = pty.spawn(spawnBinary, spawnArgs, ptyOptions);
		return new PtySession(ptyProcess, onData, onExit);
	}

	get pid(): number {
		return this.ptyProcess.pid;
	}

	write(data: string | Buffer): void {
		try {
			this.ptyProcess.write(typeof data === "string" ? data : data.toString("utf8"));
		} catch (error) {
			if (isIgnorablePtyWriteError(error)) {
				return;
			}
			throw error;
		}
	}

	resize(cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): void {
		if (this.exited) {
			return;
		}
		try {
			if (pixelWidth !== undefined && pixelHeight !== undefined) {
				this.ptyProcess.resize(cols, rows, {
					width: pixelWidth,
					height: pixelHeight,
				});
				return;
			}
			this.ptyProcess.resize(cols, rows);
		} catch (error) {
			if (isIgnorablePtyResizeError(error)) {
				this.exited = true;
				return;
			}
			throw error;
		}
	}

	pause(): void {
		this.ptyProcess.pause();
	}

	resume(): void {
		this.ptyProcess.resume();
	}

	stop(options?: { interrupted?: boolean }): void {
		if (options?.interrupted) {
			this.interrupted = true;
		}
		terminatePtyProcess(this.ptyProcess);
	}

	wasInterrupted(): boolean {
		return this.interrupted;
	}
}
