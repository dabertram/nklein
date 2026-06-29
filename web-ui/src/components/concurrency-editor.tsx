// §5.W Settings editor for the per-provider / per-model concurrency caps. Controlled: the settings dialog owns the two
// maps + the unified save (mirrors ModelRolesEditor). Each section lists the current entries (key shown read-only, cap
// editable, removable) plus an add-row; to change a key you remove + re-add. Blank/0 caps are dropped on save by the
// runtime `normalizeConcurrencyMap`, so the editor stays permissive.
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

export type ConcurrencyMap = Record<string, number>;

interface ConcurrencyMapEditorProps {
	title: string;
	keyLabel: string;
	keyPlaceholder: string;
	value: ConcurrencyMap;
	onChange: (next: ConcurrencyMap) => void;
	disabled?: boolean;
}

function ConcurrencyMapEditor({
	title,
	keyLabel,
	keyPlaceholder,
	value,
	onChange,
	disabled,
}: ConcurrencyMapEditorProps) {
	const [newKey, setNewKey] = useState("");
	const [newCap, setNewCap] = useState("");
	const entries = Object.entries(value);

	const addEntry = () => {
		const key = newKey.trim();
		const cap = Number.parseInt(newCap, 10);
		if (!key || !Number.isFinite(cap) || cap < 1) {
			return;
		}
		onChange({ ...value, [key]: cap });
		setNewKey("");
		setNewCap("");
	};

	return (
		<div className="rounded-md border border-border bg-surface-2 p-2">
			<div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-tertiary">{title}</div>
			{entries.length === 0 ? (
				<div className="mb-1.5 text-[11px] text-text-secondary">
					No {keyLabel} caps — the default serialization applies.
				</div>
			) : (
				<div className="mb-1.5 flex flex-col gap-1">
					{entries.map(([key, cap]) => (
						<div key={key} className="flex items-center gap-2">
							<span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary" title={key}>
								{key}
							</span>
							<input
								type="number"
								min={1}
								max={256}
								value={cap}
								disabled={disabled}
								aria-label={`${key} concurrency cap`}
								onChange={(event) => {
									const next = Number.parseInt(event.target.value, 10);
									onChange({ ...value, [key]: Number.isFinite(next) ? next : cap });
								}}
								className="w-16 rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
							/>
							<button
								type="button"
								disabled={disabled}
								aria-label={`Remove ${key} cap`}
								onClick={() => {
									const next = { ...value };
									delete next[key];
									onChange(next);
								}}
								className="rounded-sm border border-border bg-surface-1 p-1 text-text-secondary hover:text-status-red disabled:opacity-40"
							>
								<Trash2 size={12} />
							</button>
						</div>
					))}
				</div>
			)}
			<div className="flex items-center gap-2">
				<input
					value={newKey}
					disabled={disabled}
					placeholder={keyPlaceholder}
					aria-label={`New ${keyLabel} key`}
					onChange={(event) => setNewKey(event.target.value)}
					className="min-w-0 flex-1 rounded-sm border border-border bg-surface-1 px-2 py-1 text-[12px] text-text-primary disabled:opacity-40"
				/>
				<input
					type="number"
					min={1}
					max={256}
					value={newCap}
					disabled={disabled}
					placeholder="cap"
					aria-label={`New ${keyLabel} cap`}
					onChange={(event) => setNewCap(event.target.value)}
					className="w-16 rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
				/>
				<button
					type="button"
					disabled={disabled || !newKey.trim() || !newCap.trim()}
					aria-label={`Add ${keyLabel} cap`}
					onClick={addEntry}
					className="rounded-sm border border-border bg-surface-1 p-1 text-text-secondary hover:text-text-primary disabled:opacity-40"
				>
					<Plus size={12} />
				</button>
			</div>
		</div>
	);
}

export interface ConcurrencyMaps {
	perProvider: ConcurrencyMap;
	perModel: ConcurrencyMap;
	/** §5.AB per-MACHINE pool caps, keyed by endpoint/baseUrl (an LM-Studio-linked machine). */
	perEndpoint: ConcurrencyMap;
}

interface ConcurrencyEditorProps {
	perProvider: ConcurrencyMap;
	perModel: ConcurrencyMap;
	perEndpoint: ConcurrencyMap;
	onChange: (next: ConcurrencyMaps) => void;
	disabled?: boolean;
}

export function ConcurrencyEditor({ perProvider, perModel, perEndpoint, onChange, disabled }: ConcurrencyEditorProps) {
	return (
		<div className="flex flex-col gap-2">
			<div className="grid gap-2 sm:grid-cols-2">
				<ConcurrencyMapEditor
					title="Per provider"
					keyLabel="provider"
					keyPlaceholder="e.g. lmstudio"
					value={perProvider}
					disabled={disabled}
					onChange={(next) => onChange({ perProvider: next, perModel, perEndpoint })}
				/>
				<ConcurrencyMapEditor
					title="Per model"
					keyLabel="model"
					keyPlaceholder="provider:model:endpoint"
					value={perModel}
					disabled={disabled}
					onChange={(next) => onChange({ perProvider, perModel: next, perEndpoint })}
				/>
			</div>
			<ConcurrencyMapEditor
				title="Per machine (pool)"
				keyLabel="machine"
				keyPlaceholder="endpoint, e.g. http://m4mini.local:1234/v1"
				value={perEndpoint}
				disabled={disabled}
				onChange={(next) => onChange({ perProvider, perModel, perEndpoint: next })}
			/>
		</div>
	);
}
