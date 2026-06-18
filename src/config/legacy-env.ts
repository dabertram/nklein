const warnedLegacyEnvNames = new Set<string>();

interface ReadLegacyEnvOptions {
	currentName: string;
	legacyName: string;
	env?: NodeJS.ProcessEnv;
}

export function readEnvWithLegacyFallback(options: ReadLegacyEnvOptions): string | undefined {
	const env = options.env ?? process.env;
	const currentValue = env[options.currentName]?.trim();
	if (currentValue) {
		return currentValue;
	}

	const legacyValue = env[options.legacyName]?.trim();
	if (!legacyValue) {
		return undefined;
	}

	if (!warnedLegacyEnvNames.has(options.legacyName)) {
		warnedLegacyEnvNames.add(options.legacyName);
		process.emitWarning(
			`[nklein] Environment variable ${options.legacyName} is deprecated; please use ${options.currentName} instead.`,
			"DeprecationWarning",
		);
	}

	return legacyValue;
}

export function resetLegacyEnvWarningsForTests(): void {
	warnedLegacyEnvNames.clear();
}
