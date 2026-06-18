import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

interface ProtectedTestManifest {
	tests: Array<{
		path: string;
		rationale: string;
	}>;
}

function readProtectedTestManifest(): ProtectedTestManifest {
	const raw = readFileSync(new URL("./test/protected/protected-tests.json", import.meta.url), "utf8");
	const parsed = JSON.parse(raw) as ProtectedTestManifest;
	return {
		tests: parsed.tests.filter((entry) => entry.path.trim().length > 0),
	};
}

process.env.NODE_ENV = "production";

const manifest = readProtectedTestManifest();

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: manifest.tests.map((entry) => entry.path),
		testTimeout: 15_000,
	},
});
