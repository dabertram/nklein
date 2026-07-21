export interface SendTerminalInputOptions {
	appendNewline?: boolean;
	mode?: "type" | "paste";
	preferTerminal?: boolean;
	/** F12.56: deliver into a RUNNING session ahead of other pending input (lands before the next iteration). */
	steer?: boolean;
	/** N18: explicit review feedback; forces the backend path so the successful delivery is durably observed. */
	interventionSeverity?: "correction";
}
