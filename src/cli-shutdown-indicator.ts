import ora, { type Ora } from "ora";

/**
 * CLI shutdown progress indicator (todo §5.U — extracted from cli.ts as a cohesive utility). A small spinner/plain-text
 * "Cleaning up..." reporter that degrades gracefully when the terminal is already tearing down (EIO / setRawMode).
 * Coupling is just `ora` + the stream, so it lifts out of the CLI wiring cleanly.
 */

export type ShutdownIndicatorResult = "done" | "interrupted" | "failed";

export interface ShutdownIndicator {
	start: () => void;
	stop: (result?: ShutdownIndicatorResult) => void;
}

/** True when an error is the terminal tearing down (EIO / a setRawMode EIO) rather than a real fault to propagate. */
export function isTerminalTeardownError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = "code" in error && typeof error.code === "string" ? error.code : null;
	return code === "EIO" || /setRawMode\s+EIO/i.test(error.message);
}

function safeShutdownIndicatorWrite(stream: NodeJS.WriteStream, text: string): void {
	try {
		stream.write(text);
	} catch (error) {
		if (!isTerminalTeardownError(error)) {
			throw error;
		}
	}
}

export function createShutdownIndicator(stream: NodeJS.WriteStream = process.stderr): ShutdownIndicator {
	let spinner: Ora | null = null;
	let running = false;

	return {
		start() {
			if (running) {
				return;
			}
			running = true;
			if (!stream.isTTY) {
				safeShutdownIndicatorWrite(stream, "Cleaning up...\n");
				return;
			}
			try {
				spinner = ora({
					text: "Cleaning up...",
					stream,
				}).start();
			} catch (error) {
				if (!isTerminalTeardownError(error)) {
					throw error;
				}
				spinner = null;
				safeShutdownIndicatorWrite(stream, "Cleaning up...\n");
			}
		},
		stop(result = "done") {
			if (!running) {
				return;
			}
			running = false;
			if (spinner) {
				try {
					if (result === "done") {
						spinner.succeed("Cleaning up... done");
					} else if (result === "failed") {
						spinner.fail("Cleaning up... failed");
					} else {
						spinner.warn("Cleaning up... interrupted");
					}
				} catch (error) {
					if (!isTerminalTeardownError(error)) {
						throw error;
					}
				}
				spinner = null;
				return;
			}

			const suffix = result === "done" ? "done" : result === "interrupted" ? "interrupted" : "failed";
			safeShutdownIndicatorWrite(stream, `Cleanup ${suffix}.\n`);
		},
	};
}
