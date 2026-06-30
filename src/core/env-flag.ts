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
