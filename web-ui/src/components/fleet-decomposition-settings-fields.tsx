import { NativeSelect } from "@/components/ui/native-select";
import type { RuntimeFleetDecompositionSettings } from "@/runtime/types";

export function describeFleetDecompositionSettings(settings: RuntimeFleetDecompositionSettings): string {
	if (settings.mode === "off") return "Off";
	if (settings.mode === "fixed_target") return `Fixed target: ${settings.fixedTargetModelKey ?? "not selected"}`;
	if (settings.mode === "smallest" && settings.smallestBasis === "supported_floor") {
		return `Smallest supported: ${settings.smallestSupportedModelKey ?? "not selected"}`;
	}
	return settings.mode === "capability_weighted"
		? "Capability weighted"
		: settings.mode === "smallest"
			? "Smallest loaded"
			: "Auto";
}

export function FleetDecompositionSettingsFields({
	value,
	onChange,
	disabled = false,
	compact = false,
}: {
	value: RuntimeFleetDecompositionSettings;
	onChange: (value: RuntimeFleetDecompositionSettings) => void;
	disabled?: boolean;
	compact?: boolean;
}): React.ReactElement {
	const update = (patch: Partial<RuntimeFleetDecompositionSettings>): void => onChange({ ...value, ...patch });
	return (
		<div className={compact ? "grid gap-2" : "grid gap-3 sm:grid-cols-2"}>
			<div className="grid gap-1 text-[12px] text-text-secondary">
				Mode
				<NativeSelect
					aria-label="Fleet decomposition mode"
					value={value.mode}
					disabled={disabled}
					onChange={(event) => update({ mode: event.target.value as RuntimeFleetDecompositionSettings["mode"] })}
					fill
				>
					<option value="off">Off</option>
					<option value="auto">Auto</option>
					<option value="smallest">Smallest class</option>
					<option value="capability_weighted">Capability weighted</option>
					<option value="fixed_target">Fixed target</option>
				</NativeSelect>
			</div>
			{value.mode === "fixed_target" ? (
				<label className="grid gap-1 text-[12px] text-text-secondary">
					Target model key
					<input
						aria-label="Fleet decomposition target model key"
						value={value.fixedTargetModelKey ?? ""}
						disabled={disabled}
						onChange={(event) => update({ fixedTargetModelKey: event.target.value.trim() || null })}
						placeholder="provider/model"
						className="h-8 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
					/>
				</label>
			) : null}
			{value.mode === "smallest" ? (
				<>
					<div className="grid gap-1 text-[12px] text-text-secondary">
						Smallest-class basis
						<NativeSelect
							aria-label="Fleet decomposition smallest-class basis"
							value={value.smallestBasis}
							disabled={disabled}
							onChange={(event) =>
								update({
									smallestBasis: event.target.value as RuntimeFleetDecompositionSettings["smallestBasis"],
								})
							}
							fill
						>
							<option value="loaded">Smallest loaded model</option>
							<option value="supported_floor">Configured supported floor</option>
						</NativeSelect>
					</div>
					{value.smallestBasis === "supported_floor" ? (
						<label className="grid gap-1 text-[12px] text-text-secondary">
							Supported floor model key
							<input
								aria-label="Fleet decomposition supported floor model key"
								value={value.smallestSupportedModelKey ?? ""}
								disabled={disabled}
								onChange={(event) => update({ smallestSupportedModelKey: event.target.value.trim() || null })}
								placeholder="registry model key"
								className="h-8 rounded-md border border-border bg-surface-2 px-2 text-[12px] text-text-primary disabled:opacity-40"
							/>
						</label>
					) : null}
				</>
			) : null}
			<label className="flex items-center gap-2 text-[12px] text-text-secondary">
				<input
					type="checkbox"
					aria-label="Automatically re-shard stranded cards when the loaded fleet changes"
					checked={value.autoReshardOnFleetChange}
					disabled={disabled}
					onChange={(event) => update({ autoReshardOnFleetChange: event.target.checked })}
				/>
				Auto re-shard stranded cards when the loaded fleet changes
			</label>
		</div>
	);
}
