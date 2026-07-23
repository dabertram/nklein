export interface FrontendPreviewPlan {
	readonly argv: readonly string[];
	readonly env: Readonly<Record<string, string>>;
	readonly route: string;
	readonly framework: "vite" | "next" | "angular" | "vue-cli" | "react-scripts" | "generic";
}

interface FrontendPackageShape {
	readonly scripts?: Readonly<Record<string, string>>;
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly devDependencies?: Readonly<Record<string, string>>;
}

/** Derive only filesystem routers whose route is provable; ambiguous/dynamic routers fall back to root. */
export function deriveFrontendRouteFromChangedPaths(paths: readonly string[]): string {
	for (const path of paths) {
		const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
		const nextApp = normalized.match(/(?:^|\/)app\/(.+)\/page\.[jt]sx?$/i);
		const svelteKit = normalized.match(/(?:^|\/)src\/routes\/(.+)\/\+page\.svelte$/i);
		const nextPages = normalized.match(/(?:^|\/)pages\/(.+)\.[jt]sx?$/i);
		const raw = nextApp?.[1] ?? svelteKit?.[1] ?? nextPages?.[1];
		if (!raw || /\[[^\]]+\]/.test(raw)) continue;
		const segments = raw.split("/").filter((segment) => segment !== "index" && !/^\(.+\)$/.test(segment));
		return `/${segments.join("/")}`;
	}
	return "/";
}

function packageManagerArgv(packageManager: string, script: string): string[] {
	switch (packageManager) {
		case "pnpm":
			return ["pnpm", "run", script];
		case "yarn":
			return ["yarn", script];
		case "bun":
			return ["bun", "run", script];
		default:
			return ["npm", "run", script];
	}
}

/** Pure, allowlisted derivation: only declared package scripts can become a preview process. */
export function deriveFrontendPreviewPlan(input: {
	readonly packageJson: FrontendPackageShape;
	readonly packageManager: string;
	readonly port: number;
	readonly route?: string;
}): FrontendPreviewPlan | null {
	const scripts = input.packageJson.scripts ?? {};
	const script = ["dev", "start", "preview"].find(
		(name) => typeof scripts[name] === "string" && scripts[name]?.trim(),
	);
	if (!script) return null;
	const command = scripts[script] ?? "";
	const dependencies = { ...(input.packageJson.dependencies ?? {}), ...(input.packageJson.devDependencies ?? {}) };
	const base = packageManagerArgv(input.packageManager, script);
	const host = "127.0.0.1";
	const env = { HOST: host, PORT: String(input.port), BROWSER: "none", CI: "1" };
	let framework: FrontendPreviewPlan["framework"] = "generic";
	let args: string[] = [];
	if (/\bnext\b/.test(command) || dependencies.next) {
		framework = "next";
		args = ["--", "-H", host, "-p", String(input.port)];
	} else if (/\bng\s+serve\b/.test(command) || dependencies["@angular/core"]) {
		framework = "angular";
		args = ["--", "--host", host, "--port", String(input.port)];
	} else if (/vue-cli-service\s+serve/.test(command) || dependencies["@vue/cli-service"]) {
		framework = "vue-cli";
		args = ["--", "--host", host, "--port", String(input.port)];
	} else if (/react-scripts\s+start/.test(command) || dependencies["react-scripts"]) {
		framework = "react-scripts";
	} else if (/\bvite\b/.test(command) || dependencies.vite) {
		framework = "vite";
		args = ["--", "--host", host, "--port", String(input.port), "--strictPort"];
	}
	const rawRoute = input.route?.trim() || "/";
	const route = rawRoute.startsWith("/") ? rawRoute : `/${rawRoute}`;
	return { argv: [...base, ...args], env, route, framework };
}
