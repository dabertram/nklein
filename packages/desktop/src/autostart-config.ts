/**
 * Autostart-on-boot configuration (§ desktop app — "the user shall be able to configure !Klein so that it autostarts on
 * boot"). PURE plan + a dependency-injected applier, so the cross-platform logic is fully unit-testable without a live
 * Electron `app` or touching the real OS.
 *
 * Platform strategy:
 *   - macOS + Windows → Electron's built-in login-item API (`app.setLoginItemSettings({ openAtLogin })`). One call,
 *     no files to write; the plan just carries the desired `openAtLogin` boolean.
 *   - Linux → the freedesktop XDG autostart spec: a `.desktop` entry under `~/.config/autostart/`. Electron has no
 *     login-item support there, so the plan carries the file path + contents to write (enable) or the path to remove
 *     (disable).
 *
 * The effectful `applyAutostartPlan` takes its side-effects as injected functions (the Electron login-item setter + a
 * tiny fs shim), so main.ts wires the real ones and tests pass fakes.
 */

export type AutostartPlatform = "darwin" | "win32" | "linux";

export interface AutostartRequest {
	platform: AutostartPlatform;
	/** Desired state: true = start on boot, false = do not. */
	enabled: boolean;
	/** Display name for the login item / .desktop `Name=` (e.g. "!Klein"). */
	appName: string;
	/** The executable (+ args) to launch on boot — the app binary path, or the launcher command. */
	execPath: string;
	/** Home directory (for the Linux XDG autostart path). Defaults handled by the caller/applier. */
	homeDir?: string;
}

/** A login-item plan (macOS/Windows): flip Electron's openAtLogin. */
export interface LoginItemAutostartPlan {
	kind: "login-item";
	openAtLogin: boolean;
}

/** An XDG-autostart plan (Linux): write the `.desktop` file to enable, or remove it to disable. */
export interface XdgAutostartPlan {
	kind: "xdg-autostart";
	/** Absolute path of the `.desktop` file under `<home>/.config/autostart/`. */
	path: string;
	/** When enabling: the file contents. `null` when disabling (⇒ remove the file). */
	content: string | null;
}

export type AutostartPlan = LoginItemAutostartPlan | XdgAutostartPlan;

/** Slugify an app name into a safe `.desktop` filename stem (lowercased, non-alphanumerics → `-`, trimmed). */
function autostartFileStem(appName: string): string {
	const slug = appName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "app";
}

/**
 * Build the freedesktop XDG autostart `.desktop` entry contents. `X-GNOME-Autostart-enabled=true` + `Hidden=false` make
 * it active across the common desktop environments; `execPath` is the command run at login.
 */
export function buildXdgAutostartEntry(appName: string, execPath: string): string {
	return [
		"[Desktop Entry]",
		"Type=Application",
		`Name=${appName}`,
		`Exec=${execPath}`,
		"X-GNOME-Autostart-enabled=true",
		"Hidden=false",
		"Terminal=false",
		"",
	].join("\n");
}

/** Resolve the platform-appropriate {@link AutostartPlan} for a request (pure). */
export function resolveAutostartPlan(request: AutostartRequest): AutostartPlan {
	if (request.platform === "linux") {
		const home = request.homeDir ?? "";
		const path = `${home.replace(/\/+$/, "")}/.config/autostart/${autostartFileStem(request.appName)}.desktop`;
		return {
			kind: "xdg-autostart",
			path,
			content: request.enabled ? buildXdgAutostartEntry(request.appName, request.execPath) : null,
		};
	}
	// macOS + Windows: Electron owns the login item.
	return { kind: "login-item", openAtLogin: request.enabled };
}

/** Side-effects the applier needs, injected so it is testable without Electron / the real filesystem. */
export interface AutostartEffects {
	/** Electron's `app.setLoginItemSettings` (macOS/Windows). */
	setLoginItemSettings: (settings: { openAtLogin: boolean }) => void;
	/** Write the XDG `.desktop` file (Linux enable), creating parent dirs. */
	writeAutostartFile: (path: string, content: string) => Promise<void>;
	/** Remove the XDG `.desktop` file (Linux disable); a missing file is not an error. */
	removeAutostartFile: (path: string) => Promise<void>;
}

/** Apply a resolved plan via the injected effects. Pure-ish: all side-effects go through {@link AutostartEffects}. */
export async function applyAutostartPlan(plan: AutostartPlan, effects: AutostartEffects): Promise<void> {
	if (plan.kind === "login-item") {
		effects.setLoginItemSettings({ openAtLogin: plan.openAtLogin });
		return;
	}
	if (plan.content !== null) {
		await effects.writeAutostartFile(plan.path, plan.content);
	} else {
		await effects.removeAutostartFile(plan.path);
	}
}
