import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Theme contrast ratchet (2026-08-20).
 *
 * A live audit of the running app found 55 sub-AA text elements in the default theme alone, and 36 in EACH
 * light theme — because `--color-text-tertiary`/`-secondary` were below AA on their own surfaces, and the
 * `--color-status-*` palette was defined once for dark surfaces and never themed. Colour regressions are
 * invisible in review (every value looks plausible in a diff), so the invariant is pinned arithmetically
 * here rather than left to the eye.
 *
 * This checks the TOKENS. It cannot see a component that hardcodes a colour or picks the wrong token — the
 * live DOM sweep remains the way to catch those.
 */

const CSS = readFileSync(join(__dirname, "globals.css"), "utf8");

function luminance(hex: string): number {
	const h = hex.replace("#", "");
	const channels = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
	const linear = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
	return 0.2126 * (linear[0] as number) + 0.7152 * (linear[1] as number) + 0.0722 * (linear[2] as number);
}
function contrast(a: string, b: string): number {
	const [la, lb] = [luminance(a), luminance(b)];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

interface Theme {
	name: string;
	tokens: Map<string, string>;
}

function parseThemes(): Theme[] {
	const themes: Theme[] = [];
	const segments = CSS.split(/(?=\[data-theme=")/);
	for (const segment of segments) {
		const named = segment.match(/^\[data-theme="([^"]+)"\]/);
		const name = named ? named[1] : "root";
		const tokens = new Map<string, string>();
		for (const m of segment.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
			if (!tokens.has(m[1] as string)) tokens.set(m[1] as string, (m[2] as string).toUpperCase());
		}
		if (tokens.size > 0) themes.push({ name: name as string, tokens });
	}
	return themes;
}

const themes = parseThemes();
// A theme block may inherit tokens it does not restate; resolve against the root defaults.
const root = themes.find((t) => t.name === "root");
function resolve(theme: Theme, token: string): string | undefined {
	return theme.tokens.get(token) ?? root?.tokens.get(token);
}

describe("theme token contrast", () => {
	it("parses every theme in globals.css", () => {
		expect(themes.length).toBeGreaterThanOrEqual(11);
	});

	for (const theme of themes) {
		const surfaces = ["surface-1", "surface-2"].map((s) => resolve(theme, s)).filter((v): v is string => Boolean(v));
		if (surfaces.length === 0) continue;

		it(`${theme.name}: body text tokens clear AA on their own surfaces`, () => {
			for (const token of ["text-primary", "text-secondary", "text-tertiary"]) {
				const value = resolve(theme, token);
				if (!value) continue;
				const worst = Math.min(...surfaces.map((s) => contrast(value, s)));
				expect(`${token}=${value} ${worst.toFixed(2)}`).toBe(
					`${token}=${value} ${Math.max(worst, 4.5).toFixed(2)}`,
				);
			}
		});

		it(`${theme.name}: secondary text stays more readable than tertiary`, () => {
			// A contrast fix that inverts the hierarchy is not a fix — tertiary must remain the quieter of the two.
			const secondary = resolve(theme, "text-secondary");
			const tertiary = resolve(theme, "text-tertiary");
			if (!secondary || !tertiary) return;
			const s = Math.min(...surfaces.map((x) => contrast(secondary, x)));
			const t = Math.min(...surfaces.map((x) => contrast(tertiary, x)));
			expect(s).toBeGreaterThan(t);
		});

		it(`${theme.name}: status + accent-as-text tokens clear AA`, () => {
			const textish = [...new Set([...(root?.tokens.keys() ?? []), ...theme.tokens.keys()])].filter(
				(t) => t.startsWith("status-") || t === "accent-text" || t === "accent-2-text",
			);
			for (const token of textish) {
				const value = resolve(theme, token);
				if (!value) continue;
				const worst = Math.min(...surfaces.map((s) => contrast(value, s)));
				expect(`${token}=${value} ${worst.toFixed(2)}`).toBe(
					`${token}=${value} ${Math.max(worst, 4.5).toFixed(2)}`,
				);
			}
		});

		it(`${theme.name}: accent foregrounds are readable ON their accent fill`, () => {
			for (const [fill, fg] of [
				["accent", "accent-fg"],
				["accent-2", "accent-2-fg"],
			]) {
				const fillValue = resolve(theme, fill as string);
				const fgValue = resolve(theme, fg as string);
				if (!fillValue || !fgValue) continue;
				const ratio = contrast(fgValue, fillValue);
				expect(`${fg} on ${fill}: ${ratio.toFixed(2)}`).toBe(
					`${fg} on ${fill}: ${Math.max(ratio, 4.5).toFixed(2)}`,
				);
			}
		});
	}
});
