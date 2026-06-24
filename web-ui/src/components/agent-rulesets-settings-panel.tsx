// Settings UI for the two per-role agent-ruleset dials (todo §5.L): capability (in-sandbox tool/network access)
// and delivery (commit/PR/merge autonomy). Each dial has a global preset plus optional per-role overrides
// (architect / worker / reviewer). The tier copy is the single source of truth re-exported from the runtime
// contract so the labels/descriptions never drift from the resolver. Self-contained: parent owns the value +
// onChange + dirty/save plumbing (the state already lives in the settings dialog).
import {
	AGENT_CAPABILITY_TIER_INFO,
	AGENT_DELIVERY_TIER_INFO,
	AGENT_RULESET_ROLES,
	type AgentRulesetsConfigPayload,
} from "@runtime-contract";

type Dial = "capability" | "delivery";
type AnyTier = string;

const ROLE_LABELS: Record<string, string> = {
	architect: "Architect",
	worker: "Worker",
	reviewer: "Reviewer",
};

function tierInfoFor(dial: Dial): Record<string, { label: string; description: string }> {
	return dial === "capability" ? AGENT_CAPABILITY_TIER_INFO : AGENT_DELIVERY_TIER_INFO;
}

function tierOptions(dial: Dial): { value: string; label: string; description: string }[] {
	const info = tierInfoFor(dial);
	return Object.entries(info).map(([value, copy]) => ({ value, label: copy.label, description: copy.description }));
}

const SELECT_CLASS =
	"h-8 w-full rounded-md border border-border bg-surface-0 px-2 text-xs text-text-primary outline-none focus:border-border-focus disabled:opacity-40";

interface AgentRulesetsSettingsPanelProps {
	value: AgentRulesetsConfigPayload;
	disabled?: boolean;
	onChange: (next: AgentRulesetsConfigPayload) => void;
}

export function AgentRulesetsSettingsPanel({ value, disabled = false, onChange }: AgentRulesetsSettingsPanelProps) {
	const setGlobalPreset = (dial: Dial, preset: AnyTier) => {
		onChange({ ...value, [dial]: { ...value[dial], globalPreset: preset } });
	};
	const setRoleOverride = (dial: Dial, role: string, tier: AnyTier | "") => {
		const overrides = { ...(value[dial].roleOverrides ?? {}) } as Record<string, string>;
		if (tier === "") {
			delete overrides[role];
		} else {
			overrides[role] = tier;
		}
		const nextDial = {
			globalPreset: value[dial].globalPreset,
			...(Object.keys(overrides).length > 0 ? { roleOverrides: overrides } : {}),
		};
		onChange({ ...value, [dial]: nextDial });
	};

	const renderDial = (dial: Dial, title: string, blurb: string) => {
		const options = tierOptions(dial);
		const globalPreset = value[dial].globalPreset;
		const globalDescription = tierInfoFor(dial)[globalPreset]?.description ?? "";
		const overrides = (value[dial].roleOverrides ?? {}) as Record<string, string>;
		return (
			<div className="rounded-md border border-border bg-surface-1 p-3">
				<div className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary">{title}</div>
				<p className="mt-0.5 mb-2 text-[11px] text-text-tertiary">{blurb}</p>
				<label className="grid gap-1 text-[11px] text-text-secondary">
					<span>Global preset</span>
					<select
						className={SELECT_CLASS}
						value={globalPreset}
						disabled={disabled}
						onChange={(event) => setGlobalPreset(dial, event.target.value)}
						aria-label={`${title} global preset`}
					>
						{options.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					<span className="text-text-tertiary">{globalDescription}</span>
				</label>
				<div className="mt-2 grid gap-2 sm:grid-cols-3">
					{AGENT_RULESET_ROLES.map((role) => (
						<label key={role} className="grid gap-1 text-[11px] text-text-secondary">
							<span>{ROLE_LABELS[role] ?? role} override</span>
							<select
								className={SELECT_CLASS}
								value={overrides[role] ?? ""}
								disabled={disabled}
								onChange={(event) => setRoleOverride(dial, role, event.target.value)}
								aria-label={`${title} ${ROLE_LABELS[role] ?? role} override`}
							>
								<option value="">Use global</option>
								{options.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					))}
				</div>
			</div>
		);
	};

	return (
		<div className="grid gap-3">
			{renderDial(
				"capability",
				"Capability",
				"What each agent can do inside its Docker sandbox: network egress, web research, headless browser, MCP. Docker isolation itself is always on.",
			)}
			{renderDial(
				"delivery",
				"Delivery autonomy",
				"How far an agent may take a passing card on its own: commit, open a PR, merge, and self-merge on an unknown regression delta.",
			)}
		</div>
	);
}
