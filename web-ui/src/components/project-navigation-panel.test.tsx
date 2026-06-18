import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { useProjectNavigationLayout } from "@/resize/use-project-navigation-layout";
import type { RuntimeClineProviderSettings, RuntimeProjectSummary } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";

vi.mock("@/resize/layout-customizations", () => ({
	useLayoutResetEffect: () => {},
}));

/** Wrapper that owns the sidebar layout state via the hook and passes it as props. */
function PanelWithLayout(
	props: Omit<
		ComponentProps<typeof ProjectNavigationPanel>,
		"sidebarWidth" | "setExpandedSidebarWidth" | "isCollapsed" | "setSidebarCollapsed"
	>,
): React.ReactElement {
	const layout = useProjectNavigationLayout();
	return <ProjectNavigationPanel {...props} {...layout} />;
}

const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;
const BOARD_SURFACE_HORIZONTAL_CHROME_PX = 40;

const cleanupDevTestProjectsMock = vi.hoisted(() => vi.fn());
const createDevTestProjectMock = vi.hoisted(() => vi.fn());
const migrateAccidentalProjectArtifactsMock = vi.hoisted(() => vi.fn());
const fetchClineCodeIntelligenceStatusMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/runtime-config-query", () => ({
	cleanupDevTestProjects: cleanupDevTestProjectsMock,
	createDevTestProject: createDevTestProjectMock,
	migrateAccidentalProjectArtifacts: migrateAccidentalProjectArtifactsMock,
	fetchClineCodeIntelligenceStatus: fetchClineCodeIntelligenceStatusMock,
}));

const PROJECTS: RuntimeProjectSummary[] = [
	{
		id: "project-1",
		name: "Kanban",
		path: "/tmp/kanban",
		taskCounts: {
			backlog: 0,
			planning: 0,
			in_progress: 0,
			review: 0,
			completed: 0,
			trash: 0,
		},
		healthIssues: [],
	},
];

const ACCIDENTAL_PROJECTS: RuntimeProjectSummary[] = [
	PROJECTS[0] as RuntimeProjectSummary,
	{
		id: "worktree-project",
		name: "Kanban",
		path: "/Users/david/.cline/worktrees/source-card/kanban",
		taskCounts: {
			backlog: 10,
			planning: 0,
			in_progress: 0,
			review: 0,
			completed: 0,
			trash: 0,
		},
		gitRepositoryCreatedByKanban: true,
		healthIssues: [
			{
				kind: "task_worktree_project",
				severity: "warning",
				title: "Task worktree added as project",
				message: "This project points at a task worktree.",
				taskId: "source-card",
				parentWorkspaceId: "project-1",
				parentWorkspacePath: "/tmp/kanban",
				artifactCount: 1,
				canRemove: true,
				canMigrateArtifacts: true,
			},
		],
	},
];

const CLINE_OAUTH_SETTINGS: RuntimeClineProviderSettings = {
	providerId: null,
	modelId: "cline-sonnet",
	baseUrl: null,
	reasoningEffort: null,
	apiKeyConfigured: false,
	oauthProvider: "cline",
	oauthAccessTokenConfigured: true,
	oauthRefreshTokenConfigured: true,
	oauthAccountId: "acc-1",
	oauthExpiresAt: 1_800_000_000_000,
};

function getSidebar(container: HTMLElement): HTMLElement {
	const sidebar = container.querySelector("aside");
	if (!sidebar) {
		throw new Error("Sidebar was not rendered");
	}
	return sidebar;
}

function getResizeHandle(container: HTMLElement): HTMLElement {
	const handle = container.querySelector('[aria-label="Resize sidebar"]');
	if (!handle) {
		throw new Error("Resize handle was not rendered");
	}
	return handle as HTMLElement;
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
	const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === text);
	if (!(button instanceof HTMLButtonElement)) {
		throw new Error(`Button with text "${text}" was not rendered`);
	}
	return button;
}

describe("ProjectNavigationPanel width persistence", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;
	let previousAppVersion: unknown;
	let previousInnerWidth: number;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		previousAppVersion = (globalThis as typeof globalThis & { __APP_VERSION__?: unknown }).__APP_VERSION__;
		(globalThis as typeof globalThis & { __APP_VERSION__?: string }).__APP_VERSION__ = "test";
		previousInnerWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", {
			value: 1600,
			configurable: true,
			writable: true,
		});
		localStorage.clear();
		cleanupDevTestProjectsMock.mockReset();
		createDevTestProjectMock.mockReset();
		migrateAccidentalProjectArtifactsMock.mockReset();
		migrateAccidentalProjectArtifactsMock.mockResolvedValue({
			ok: true,
			migratedArtifacts: 1,
			skippedArtifacts: 0,
			parentWorkspaceId: "project-1",
			parentWorkspacePath: "/tmp/kanban",
			errors: [],
		});
		fetchClineCodeIntelligenceStatusMock.mockReset();
		fetchClineCodeIntelligenceStatusMock.mockResolvedValue({
			codeEmbeddingSettings: {
				globalDefaults: {
					provider: "local_lexical",
					model: "kanban-local-lexical-vector-v1",
					baseUrl: null,
				},
				projectOverride: null,
				effective: {
					provider: "local_lexical",
					model: "kanban-local-lexical-vector-v1",
					baseUrl: null,
				},
				source: "global",
			},
			repoMap: {
				filesScanned: 12,
				symbols: 34,
				tokenCount: 900,
				truncated: false,
				available: true,
				error: null,
			},
			codeIndex: {
				cachePath: "/repo/.cline/nklein/code-index-v1.json",
				cacheExists: true,
				embeddingProvider: "local_lexical",
				embeddingModel: "kanban-local-lexical-vector-v1",
				updatedAt: Date.now(),
				totalFiles: 12,
				totalChunks: 20,
				indexedFiles: 10,
				indexedChunks: 16,
				staleFiles: 1,
				missingFiles: 1,
				searchAvailable: true,
				progress: {
					phase: "idle",
					startedAt: null,
					updatedAt: null,
					filesTotal: 0,
					filesProcessed: 0,
					chunksTotal: 0,
					chunksProcessed: 0,
					cacheHitCount: 0,
					cacheMissCount: 0,
					message: null,
				},
				error: null,
			},
		});
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		localStorage.clear();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
		if (typeof previousAppVersion === "undefined") {
			delete (globalThis as typeof globalThis & { __APP_VERSION__?: unknown }).__APP_VERSION__;
		} else {
			(globalThis as typeof globalThis & { __APP_VERSION__?: unknown }).__APP_VERSION__ = previousAppVersion;
		}
		Object.defineProperty(window, "innerWidth", {
			value: previousInnerWidth,
			configurable: true,
			writable: true,
		});
	});

	function renderPanel(overrides: Partial<ComponentProps<typeof PanelWithLayout>> = {}): void {
		act(() => {
			root.render(
				<PanelWithLayout
					projects={PROJECTS}
					currentProjectId="project-1"
					removingProjectId={null}
					activeSection="projects"
					onActiveSectionChange={() => {}}
					canShowAgentSection
					selectedAgentId={null}
					clineProviderSettings={null}
					featurebaseFeedbackState={undefined}
					onSelectProject={() => {}}
					onRemoveProject={async () => true}
					onAddProject={() => {}}
					{...overrides}
				/>,
			);
		});
	}

	function getExpectedDefaultWidthPx(viewportWidth: number): number {
		const proportionalWidth = Math.round((viewportWidth - BOARD_SURFACE_HORIZONTAL_CHROME_PX) / 5);
		return Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, Math.min(SIDEBAR_MAX_EXPANDED_WIDTH, proportionalWidth));
	}

	function clampExpandedWidth(width: number): number {
		return Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, Math.min(SIDEBAR_MAX_EXPANDED_WIDTH, width));
	}

	it("uses a proportional one-fifth default width when no value is persisted", () => {
		renderPanel();
		const sidebar = getSidebar(container);
		expect(sidebar.style.width).toBe(`${getExpectedDefaultWidthPx(window.innerWidth)}px`);
	});

	it("persists resized width and restores it on remount", () => {
		renderPanel();
		const initialWidth = getExpectedDefaultWidthPx(window.innerWidth);
		const expectedResizedWidth = clampExpandedWidth(initialWidth + 160);
		const resizeHandle = getResizeHandle(container);
		act(() => {
			resizeHandle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 300 }));
		});
		act(() => {
			window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 460 }));
		});
		act(() => {
			window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
		});

		expect(localStorage.getItem(LocalStorageKey.ProjectNavigationPanelWidth)).toBe(String(expectedResizedWidth));

		act(() => {
			root.unmount();
		});
		root = createRoot(container);

		renderPanel();
		const sidebar = getSidebar(container);
		expect(sidebar.style.width).toBe(`${expectedResizedWidth}px`);
	});

	it("renders beta hint card with report issue in the projects view", () => {
		renderPanel();
		expect(container.textContent).toContain("!Klein is in beta. Help us improve by sharing your experience.");
		expect(container.textContent).toContain("Report issue");
	});

	it("shows send feedback instead of report issue when Cline OAuth is available", () => {
		renderPanel({
			cloudProviderSupportEnabled: true,
			selectedAgentId: "cline",
			clineProviderSettings: CLINE_OAUTH_SETTINGS,
			featurebaseFeedbackState: {
				authState: "ready",
				widgetOpenCount: 0,
				openFeedbackWidget: vi.fn(async () => {}),
			},
		});
		expect(container.textContent).toContain("!Klein is in beta. Help us improve by sharing your experience.");
		expect(container.textContent).toContain("Send feedback");
		expect(container.textContent).not.toContain("Report issue");
	});

	it("shows selected project code intelligence status in the projects view", async () => {
		renderPanel();
		await act(async () => {
			await Promise.resolve();
		});

		expect(fetchClineCodeIntelligenceStatusMock).toHaveBeenCalledWith("project-1");
		expect(container.textContent).toContain("Code intelligence");
		expect(container.textContent).toContain("16/20 chunks (80%) indexed");
		expect(container.textContent).toContain("repo map ready");
		expect(container.textContent).toContain("12 files scanned");
		expect(container.textContent).toContain("34 symbols");
		expect(container.textContent).toContain("Local lexical fallback");
	});

	it("does not load project code intelligence without a selected project", async () => {
		renderPanel({ currentProjectId: null });
		await act(async () => {
			await Promise.resolve();
		});

		expect(fetchClineCodeIntelligenceStatusMock).not.toHaveBeenCalled();
		expect(container.textContent).not.toContain("Code intelligence");
	});

	it("hides dev-test project tools unless debug mode is enabled", () => {
		renderPanel();

		expect(container.textContent).not.toContain("Create fixture projects");
		expect(container.textContent).not.toContain("Create mid task project");
	});

	it("shows dev-test project tools in debug mode", () => {
		renderPanel({ debugModeEnabled: true });

		expect(container.textContent).toContain("Create fixture projects");
		expect(container.textContent).toContain("Create mid task project");
		expect(container.textContent).toContain("Create complex product project");
	});

	it("requires confirmation before creating dev-test projects", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		try {
			renderPanel({ debugModeEnabled: true });

			act(() => {
				getButtonByText(container, "Create mid task project").click();
			});

			expect(confirmSpy).toHaveBeenCalledWith(
				"Create a marked !Klein dev-test project and make it the active project?",
			);
			expect(createDevTestProjectMock).not.toHaveBeenCalled();
		} finally {
			confirmSpy.mockRestore();
		}
	});

	it("requires confirmation before deleting dev-test workspaces", () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		try {
			renderPanel({ debugModeEnabled: true });

			act(() => {
				getButtonByText(container, "Delete dev workspaces").click();
			});

			expect(confirmSpy).toHaveBeenCalledWith(
				"Delete marked !Klein dev-test projects, their task worktrees, and saved dev-test task patches?",
			);
			expect(cleanupDevTestProjectsMock).not.toHaveBeenCalled();
		} finally {
			confirmSpy.mockRestore();
		}
	});

	it("shows accidental task worktree projects with explicit recovery actions", () => {
		renderPanel({ projects: ACCIDENTAL_PROJECTS });

		expect(container.textContent).toContain("Project Health");
		expect(container.textContent).toContain("Task worktree projects need a decision before cleanup.");
		expect(container.textContent).toContain("1 artifacts");
		expect(container.textContent).toContain("Inspect");
		expect(container.textContent).toContain("Migrate");
		expect(container.textContent).toContain("Remove");
	});

	it("requires confirmation before migrating accidental project artifacts", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
		try {
			renderPanel({ projects: ACCIDENTAL_PROJECTS });

			act(() => {
				getButtonByText(container, "Migrate").click();
			});

			expect(confirmSpy).toHaveBeenCalledWith(
				"Copy this accidental task-worktree project's plan artifacts into the detected parent project?",
			);
			expect(migrateAccidentalProjectArtifactsMock).not.toHaveBeenCalled();
		} finally {
			confirmSpy.mockRestore();
		}
	});

	it("migrates accidental project artifacts only after confirmation", async () => {
		const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
		try {
			renderPanel({ projects: ACCIDENTAL_PROJECTS });

			await act(async () => {
				getButtonByText(container, "Migrate").click();
				await Promise.resolve();
			});

			expect(migrateAccidentalProjectArtifactsMock).toHaveBeenCalledWith("project-1", "worktree-project");
		} finally {
			confirmSpy.mockRestore();
		}
	});

	it("persists terminal tips dismissal", () => {
		renderPanel({
			activeSection: "agent",
			selectedAgentId: "droid",
		});
		expect(container.textContent).toContain("Tips");
		expect(localStorage.getItem(LocalStorageKey.AgentTipsDismissed)).toBeNull();

		const hideButton = container.querySelector('[aria-label="Dismiss tips"]') as HTMLButtonElement;
		act(() => {
			hideButton.click();
		});

		expect(container.textContent).toContain("Show tips");
		expect(localStorage.getItem(LocalStorageKey.AgentTipsDismissed)).toBe("true");

		const showTipsButton = getButtonByText(container, "Show tips");
		act(() => {
			showTipsButton.click();
		});

		expect(container.textContent).toContain("Tips");
		expect(localStorage.getItem(LocalStorageKey.AgentTipsDismissed)).toBeNull();
	});
});
