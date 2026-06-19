function parseBooleanEnvValue(value: string | undefined): boolean {
	const normalized = value?.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isDebugOverrideEnvEnabled(): boolean {
	const debugModeValue =
		process.env.NKLEIN_DEBUG ??
		process.env.KANBAN_DEBUG ??
		process.env.KANBAN_DEBUG_MODE ??
		process.env.DEBUG_MODE ??
		process.env.debug_mode;
	return parseBooleanEnvValue(debugModeValue);
}
