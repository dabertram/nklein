export interface SendTerminalInputOptions {
	appendNewline?: boolean;
	mode?: "type" | "paste";
	preferTerminal?: boolean;
	/** F12.56: deliver into a RUNNING session ahead of other pending input (lands before the next iteration). */
	steer?: boolean;
}
