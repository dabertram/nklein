/**
 * Chat multimodal capability gating (todo §5.M) — pure policy mapping a model's advertised capabilities to the
 * input/output modalities the chat may use, **degrading to text** when a modality isn't supported. Driven off the
 * provider/registry metadata (`supportsVision` / `supportsAttachments`); audio has no capability flag yet, so it
 * degrades to text until one exists. Kept pure so the gate is unit-testable; the runtime + UI consult it to
 * decide which attachments to offer/accept and otherwise fall back to a text transcript.
 */

export interface ChatModelModalitySupport {
	supportsVision?: boolean;
	supportsAttachments?: boolean;
}

export type ChatModality = "text" | "image" | "attachment" | "audio";

export interface ChatModalityAccess {
	/** Always available — the universal fallback. */
	text: true;
	/** Images (vision) in/out. */
	image: boolean;
	/** File attachments (e.g. PDF). */
	attachment: boolean;
	/** Audio — no capability flag yet, so always degraded to text for now. */
	audio: boolean;
}

export function resolveChatModalities(model: ChatModelModalitySupport): ChatModalityAccess {
	return {
		text: true,
		image: model.supportsVision === true,
		attachment: model.supportsAttachments === true,
		audio: false,
	};
}

/** Whether a given input modality may be used with this model (text always may). */
export function isChatModalityAllowed(model: ChatModelModalitySupport, modality: ChatModality): boolean {
	return resolveChatModalities(model)[modality] === true;
}
