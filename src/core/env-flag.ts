/**
 * Parse an environment-variable string as a boolean flag — the ONE shared implementation (previously copy-pasted four
 * times with DIVERGENT acceptance: `klein-core-config` accepted 1/true/yes/on + trimmed, while three nklein-agent modules
 * accepted only 1/true). That divergence meant the SAME env var could read truthy at one site and falsy at another. This
 * is the robust, lenient standard: trim + lowercase, then accept `1` / `true` / `yes` / `on`. Pure.
 */
export function isTruthyEnv(value: string | undefined): boolean {
	if (!value) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

/**
 * Parse an env var as a DEFAULT-ON flag: enabled UNLESS explicitly disabled with `0` / `false` / `no` / `off`
 * (trim + lowercase). An unset or empty var reads ON. The mirror of {@link isTruthyEnv} for features that ship
 * on-by-default but keep an env escape hatch. Pure.
 */
export function isEnabledByDefaultEnv(value: string | undefined): boolean {
	if (value === undefined) {
		return true;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "") {
		return true;
	}
	return !(normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off");
}

/**
 * Resolve a DEFAULT-ON feature flag from a persisted config bit plus its env escape hatch (§5.BB): an explicitly SET
 * (non-empty) env var wins in BOTH directions — truthy forces ON (script/harness override), an explicit
 * `0`/`false`/`no`/`off` forces OFF — while an unset/empty var defers to the config setting. This keeps the
 * pre-Settings env contract byte-identical for scripts (e.g. `NKLEIN_CHAT_ADAPTIVE_TRUNCATION=0` still disables)
 * while making the Settings switch honest. Default-OFF flags don't need this — they compose as the plain
 * `config || isTruthyEnv(env)` (either enables). Pure.
 */
export function resolveDefaultOnFlag(configEnabled: boolean, envValue: string | undefined): boolean {
	if (envValue === undefined || envValue.trim() === "") {
		return configEnabled;
	}
	return isEnabledByDefaultEnv(envValue);
}
