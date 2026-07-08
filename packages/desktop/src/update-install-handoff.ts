import {
	inferDesktopReleaseAssetKind,
	type DesktopReleaseAsset,
	type DesktopReleaseAssetKind,
	type DesktopUpdatePlatform,
} from "./update-plan.js";

export interface DesktopInstallerHandoffInput {
	asset: DesktopReleaseAsset;
	filePath: string;
	platform: DesktopUpdatePlatform;
}

export type DesktopInstallerHandoffPlan =
	| {
			status: "ready";
			command: string;
			args: string[];
			requiresAppQuit: boolean;
			userActionRequired: boolean;
			requiresExecutableBit: boolean;
			notes: string[];
	  }
	| {
			status: "unsupported";
			reason: string;
	  };

export type DesktopInstallerHandoffResult =
	| { status: "launched"; command: string; args: string[] }
	| { status: "unsupported"; reason: string }
	| { status: "launch_failed"; message: string };

export interface DesktopInstallerHandoffRunner {
	spawnDetached(command: string, args: string[]): void;
}

function resolveKind(asset: DesktopReleaseAsset): DesktopReleaseAssetKind | null {
	return asset.kind ?? inferDesktopReleaseAssetKind(asset.name);
}

export function planDesktopInstallerHandoff(input: DesktopInstallerHandoffInput): DesktopInstallerHandoffPlan {
	const kind = resolveKind(input.asset);
	if (!kind) {
		return { status: "unsupported", reason: `Unsupported update asset: ${input.asset.name}` };
	}

	if (input.platform === "darwin") {
		if (kind === "mac_dmg" || kind === "mac_zip") {
			return {
				status: "ready",
				command: "open",
				args: [input.filePath],
				requiresAppQuit: true,
				userActionRequired: true,
				requiresExecutableBit: false,
				notes: ["Open the package and follow the macOS installer prompt."],
			};
		}
		return { status: "unsupported", reason: `Unsupported macOS update asset kind: ${kind}` };
	}

	if (input.platform === "win32") {
		if (kind === "windows_nsis") {
			return {
				status: "ready",
				command: input.filePath,
				args: [],
				requiresAppQuit: true,
				userActionRequired: true,
				requiresExecutableBit: false,
				notes: ["Run the signed Windows installer."],
			};
		}
		if (kind === "windows_msi") {
			return {
				status: "ready",
				command: "msiexec.exe",
				args: ["/i", input.filePath],
				requiresAppQuit: true,
				userActionRequired: true,
				requiresExecutableBit: false,
				notes: ["Run the signed MSI installer."],
			};
		}
		return { status: "unsupported", reason: `Unsupported Windows update asset kind: ${kind}` };
	}

	if (kind === "linux_appimage" || kind === "linux_deb" || kind === "linux_rpm") {
		return {
			status: "ready",
			command: "xdg-open",
			args: [input.filePath],
			requiresAppQuit: true,
			userActionRequired: true,
			requiresExecutableBit: kind === "linux_appimage",
			notes:
				kind === "linux_appimage"
					? ["Mark the AppImage executable before opening it."]
					: ["Open the package with the system package installer."],
		};
	}

	return { status: "unsupported", reason: `Unsupported Linux update asset kind: ${kind}` };
}

export function runDesktopInstallerHandoff(
	plan: DesktopInstallerHandoffPlan,
	runner: DesktopInstallerHandoffRunner,
): DesktopInstallerHandoffResult {
	if (plan.status === "unsupported") {
		return plan;
	}
	try {
		runner.spawnDetached(plan.command, plan.args);
		return { status: "launched", command: plan.command, args: plan.args };
	} catch (error) {
		return {
			status: "launch_failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
