// The NKlein advisor actions panel (extracted from runtime-settings-dialog.tsx, §5.U — the dialog is the codebase's
// largest file). A self-contained stateful child component: build advisor prompts (model freshness / MCP discovery /
// config explainer / log analysis), load+select advisor models, send the prompt, and parse/add suggested MCP servers.
import { Clipboard, ExternalLink, Plus, Search, SlidersHorizontal, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ParsedMcpSuggestion, parseMcpSuggestionText } from "@/components/runtime-settings-mcp-parsing";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import type { UseRuntimeSettingsNKleinMcpControllerResult } from "@/hooks/use-runtime-settings-nklein-mcp-controller";
import { formatModelOptionLabel } from "@/runtime/nklein-context-window-policy";
import {
	buildNKleinAdvisorRequest,
	fetchNKleinProviderModels,
	sendNKleinAdvisorRequest,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeNKleinAdvisorKind,
	RuntimeNKleinAdvisorRequest,
	RuntimeNKleinAdvisorSendResponse,
	RuntimeNKleinProviderModel,
} from "@/runtime/types";
import { useUnmount } from "@/utils/react-use";

const NKLEIN_ADVISOR_ACTIONS: ReadonlyArray<{
	kind: RuntimeNKleinAdvisorKind;
	label: string;
	icon: React.ReactNode;
}> = [
	{ kind: "model_freshness", label: "Check models", icon: <Sparkles size={14} /> },
	{ kind: "mcp_discovery", label: "Find MCP plugins", icon: <Search size={14} /> },
	{ kind: "config_explainer", label: "Explain config", icon: <SlidersHorizontal size={14} /> },
	{ kind: "log_analysis", label: "Analyze logs", icon: <Clipboard size={14} /> },
];

export function NKleinAdvisorActions({
	workspaceId,
	disabled,
	mcpController,
	runtimeConfigSummary,
	advisorProviderId,
	advisorModelId,
	onError,
}: {
	workspaceId: string | null;
	disabled: boolean;
	mcpController: UseRuntimeSettingsNKleinMcpControllerResult;
	runtimeConfigSummary: string;
	advisorProviderId: string;
	advisorModelId: string;
	onError: (message: string | null) => void;
}): React.ReactElement {
	const [activeKind, setActiveKind] = useState<RuntimeNKleinAdvisorKind | null>(null);
	const [advisorRequest, setAdvisorRequest] = useState<RuntimeNKleinAdvisorRequest | null>(null);
	const [advisorModels, setAdvisorModels] = useState<RuntimeNKleinProviderModel[]>([]);
	const [selectedAdvisorModelId, setSelectedAdvisorModelId] = useState("");
	const [isLoadingAdvisorModels, setIsLoadingAdvisorModels] = useState(false);
	const [isSendingAdvisor, setIsSendingAdvisor] = useState(false);
	const [advisorResponse, setAdvisorResponse] = useState<RuntimeNKleinAdvisorSendResponse | null>(null);
	const [advisorSendError, setAdvisorSendError] = useState<string | null>(null);
	const [mcpSuggestionText, setMcpSuggestionText] = useState("");
	const [parsedMcpSuggestions, setParsedMcpSuggestions] = useState<ParsedMcpSuggestion[]>([]);
	const [addingMcpServerName, setAddingMcpServerName] = useState<string | null>(null);
	const [copyButtonText, setCopyButtonText] = useState("Copy prompt");
	const copyResetTimerRef = useRef<number | null>(null);
	const configuredAdvisorProviderId = advisorProviderId.trim();
	const configuredAdvisorModelId = advisorModelId.trim();

	useUnmount(() => {
		if (copyResetTimerRef.current !== null) {
			window.clearTimeout(copyResetTimerRef.current);
		}
	});

	useEffect(() => {
		let cancelled = false;
		setAdvisorModels([]);
		setSelectedAdvisorModelId(configuredAdvisorModelId);
		if (!workspaceId || !configuredAdvisorProviderId) {
			return;
		}
		setIsLoadingAdvisorModels(true);
		void fetchNKleinProviderModels(workspaceId, configuredAdvisorProviderId)
			.then((models) => {
				if (cancelled) {
					return;
				}
				setAdvisorModels(models);
				const configuredModelExists = models.some((model) => model.id === configuredAdvisorModelId);
				setSelectedAdvisorModelId(
					configuredModelExists ? configuredAdvisorModelId : (models[0]?.id ?? configuredAdvisorModelId),
				);
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					const message = error instanceof Error ? error.message : String(error);
					onError(`Could not load advisor models: ${message}`);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingAdvisorModels(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [configuredAdvisorProviderId, configuredAdvisorModelId, onError, workspaceId]);

	const handleBuildAdvisor = useCallback(
		(kind: RuntimeNKleinAdvisorKind) => {
			onError(null);
			setActiveKind(kind);
			void buildNKleinAdvisorRequest(workspaceId, {
				kind,
				...(kind === "config_explainer" ? { runtimeConfigSummary } : {}),
			})
				.then((request) => {
					setAdvisorRequest(request);
					setAdvisorResponse(null);
					setAdvisorSendError(null);
					if (kind !== "mcp_discovery") {
						setMcpSuggestionText("");
						setParsedMcpSuggestions([]);
					}
				})
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					onError(`Could not build advisor prompt: ${message}`);
				})
				.finally(() => {
					setActiveKind(null);
				});
		},
		[onError, runtimeConfigSummary, workspaceId],
	);

	const handleParseMcpSuggestions = useCallback(() => {
		onError(null);
		try {
			const suggestions = parseMcpSuggestionText(mcpSuggestionText);
			setParsedMcpSuggestions(suggestions);
			if (suggestions.length === 0) {
				onError("No addable HTTPS MCP servers found in the pasted advisor JSON.");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setParsedMcpSuggestions([]);
			onError(`Could not parse MCP suggestion JSON: ${message}`);
		}
	}, [mcpSuggestionText, onError]);

	const handleAddMcpSuggestion = useCallback(
		(suggestion: ParsedMcpSuggestion) => {
			onError(null);
			setAddingMcpServerName(suggestion.server.name);
			void mcpController
				.addMcpServer(suggestion.server)
				.then((result) => {
					if (!result.ok) {
						onError(result.message ?? `Could not add MCP server "${suggestion.server.name}".`);
					}
				})
				.catch((error) => {
					const message = error instanceof Error ? error.message : String(error);
					onError(`Could not add MCP server "${suggestion.server.name}": ${message}`);
				})
				.finally(() => {
					setAddingMcpServerName(null);
				});
		},
		[mcpController, onError],
	);

	const handleCopyPrompt = useCallback(() => {
		if (!advisorRequest) {
			return;
		}
		void navigator.clipboard
			.writeText(advisorRequest.prompt)
			.then(() => {
				setCopyButtonText("Copied");
				if (copyResetTimerRef.current !== null) {
					window.clearTimeout(copyResetTimerRef.current);
				}
				copyResetTimerRef.current = window.setTimeout(() => {
					setCopyButtonText("Copy prompt");
					copyResetTimerRef.current = null;
				}, 1800);
			})
			.catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				onError(`Could not copy advisor prompt: ${message}`);
			});
	}, [advisorRequest, onError]);

	const handleSendAdvisor = useCallback(() => {
		if (!advisorRequest) {
			return;
		}
		const modelId = selectedAdvisorModelId.trim();
		if (!configuredAdvisorProviderId || !modelId) {
			setAdvisorSendError("Choose a local !Klein model before sending the advisor prompt.");
			return;
		}
		setIsSendingAdvisor(true);
		setAdvisorSendError(null);
		setAdvisorResponse(null);
		void sendNKleinAdvisorRequest(workspaceId, {
			prompt: advisorRequest.prompt,
			providerId: configuredAdvisorProviderId,
			modelId,
		})
			.then((response) => {
				setAdvisorResponse(response);
			})
			.catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				setAdvisorSendError(message);
			})
			.finally(() => {
				setIsSendingAdvisor(false);
			});
	}, [configuredAdvisorProviderId, advisorRequest, selectedAdvisorModelId, workspaceId]);

	return (
		<div className="mt-4 border-t border-border pt-4">
			<div className="flex items-center justify-between gap-3 mb-2">
				<h6 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0">Advisor</h6>
				<div className="flex flex-wrap items-center justify-end gap-2">
					{NKLEIN_ADVISOR_ACTIONS.map((action) => (
						<Button
							key={action.kind}
							size="sm"
							variant="default"
							icon={action.icon}
							disabled={disabled || activeKind !== null}
							onClick={() => handleBuildAdvisor(action.kind)}
						>
							{activeKind === action.kind ? "Building..." : action.label}
						</Button>
					))}
				</div>
			</div>
			{advisorRequest ? (
				<div className="rounded-md border border-border bg-surface-2 p-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="text-[13px] font-medium text-text-primary m-0">{advisorRequest.title}</p>
							<p className="text-[12px] text-text-secondary mt-0.5 mb-0">
								{advisorRequest.requiresWebResearch ? "Uses web research sources" : "Uses local context only"}
							</p>
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2">
							<NativeSelect
								value={selectedAdvisorModelId}
								onChange={(event) => setSelectedAdvisorModelId(event.target.value)}
								disabled={
									disabled || isLoadingAdvisorModels || isSendingAdvisor || !configuredAdvisorProviderId
								}
							>
								{selectedAdvisorModelId &&
								!advisorModels.some((model) => model.id === selectedAdvisorModelId) ? (
									<option value={selectedAdvisorModelId}>{selectedAdvisorModelId}</option>
								) : null}
								{advisorModels.map((model) => (
									<option key={model.id} value={model.id}>
										{formatModelOptionLabel(model)}
									</option>
								))}
							</NativeSelect>
							<Button
								size="sm"
								variant="primary"
								icon={isSendingAdvisor ? <Spinner size={14} /> : <Sparkles size={14} />}
								disabled={
									disabled ||
									isSendingAdvisor ||
									isLoadingAdvisorModels ||
									!configuredAdvisorProviderId ||
									!selectedAdvisorModelId
								}
								onClick={handleSendAdvisor}
							>
								{isSendingAdvisor ? "Sending" : "Send prompt"}
							</Button>
							<Button
								size="sm"
								variant="ghost"
								icon={<Clipboard size={14} />}
								disabled={disabled}
								onClick={handleCopyPrompt}
							>
								{copyButtonText}
							</Button>
						</div>
					</div>
					<textarea
						readOnly
						value={advisorRequest.prompt}
						rows={8}
						className="mt-3 w-full resize-none rounded-md border border-border bg-surface-1 p-3 font-mono text-[12px] text-text-primary focus:outline-none"
					/>
					{advisorResponse || advisorSendError ? (
						<div className="mt-3 rounded-md border border-border bg-surface-1 p-3">
							<div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-text-secondary">
								<span>
									{advisorResponse
										? `${advisorResponse.providerId} / ${advisorResponse.modelId}`
										: "Advisor send failed"}
								</span>
								{advisorResponse ? (
									<span>
										Sent {new Date(advisorResponse.sentAt).toLocaleTimeString()} · Received{" "}
										{new Date(advisorResponse.receivedAt).toLocaleTimeString()}
									</span>
								) : null}
							</div>
							<textarea
								readOnly
								value={advisorResponse?.output ?? advisorSendError ?? ""}
								rows={8}
								className={cn(
									"w-full resize-none rounded-md border bg-surface-2 p-3 text-[12px] text-text-primary focus:outline-none",
									advisorSendError ? "border-status-red/50" : "border-border",
								)}
							/>
						</div>
					) : null}
					{advisorRequest.recommendedSources.length > 0 ? (
						<div className="mt-3 flex flex-wrap gap-2">
							{advisorRequest.recommendedSources.map((source) => (
								<a
									key={source}
									href={source}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-secondary hover:text-text-primary hover:border-border-bright"
								>
									<span>{new URL(source).hostname}</span>
									<ExternalLink size={12} />
								</a>
							))}
						</div>
					) : null}
					{advisorRequest.kind === "mcp_discovery" ? (
						<div className="mt-3 border-t border-border pt-3">
							<textarea
								value={mcpSuggestionText}
								onChange={(event) => setMcpSuggestionText(event.target.value)}
								rows={4}
								disabled={disabled || mcpController.isSavingMcpSettings}
								placeholder='Paste advisor JSON: {"mcpServers":[{"name":"linear","type":"streamableHttp","url":"https://mcp.linear.app/mcp"}]}'
								className="w-full resize-none rounded-md border border-border bg-surface-1 p-3 font-mono text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-40"
							/>
							<div className="mt-2 flex items-center justify-between gap-3">
								<p className="text-[12px] text-text-secondary m-0">HTTPS MCP suggestions only</p>
								<Button
									size="sm"
									variant="default"
									icon={<Search size={14} />}
									disabled={
										disabled || mcpController.isSavingMcpSettings || mcpSuggestionText.trim().length === 0
									}
									onClick={handleParseMcpSuggestions}
								>
									Find addable servers
								</Button>
							</div>
							{parsedMcpSuggestions.length > 0 ? (
								<div className="mt-2 grid gap-2">
									{parsedMcpSuggestions.map((suggestion) => (
										<div
											key={suggestion.server.name}
											className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-1 px-3 py-2"
										>
											<div className="min-w-0">
												<p className="text-[13px] font-medium text-text-primary m-0">{suggestion.label}</p>
												<p className="text-[12px] text-text-secondary m-0 break-all">
													{suggestion.server.name} ·{" "}
													{suggestion.server.type === "stdio"
														? suggestion.server.command
														: suggestion.server.url}
												</p>
											</div>
											<Button
												size="sm"
												variant="primary"
												icon={<Plus size={14} />}
												disabled={
													disabled || addingMcpServerName !== null || mcpController.isSavingMcpSettings
												}
												onClick={() => handleAddMcpSuggestion(suggestion)}
											>
												{addingMcpServerName === suggestion.server.name ? "Adding..." : "Add"}
											</Button>
										</div>
									))}
								</div>
							) : null}
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
