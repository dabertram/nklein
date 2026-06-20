export interface KickVoiceSettings {
	sampleRate: number;
	durationSeconds: number;
	fundamentalHz: number;
	clickLevel: number;
	decay: number;
}

export interface BassVoiceSettings {
	sampleRate: number;
	noteHz: number;
	durationSeconds: number;
	drive: number;
}

export interface RenderedBuffer {
	sampleRate: number;
	samples: Float32Array;
}

export function renderKick(settings: KickVoiceSettings): RenderedBuffer {
	const length = Math.max(1, Math.round(settings.sampleRate * settings.durationSeconds));
	const samples = new Float32Array(length);
	let phase = 0;
	for (let index = 0; index < length; index += 1) {
		const t = index / settings.sampleRate;
		const envelope = Math.exp(-settings.decay * t);
		const pitch = settings.fundamentalHz * (1 + 2.5 * Math.exp(-35 * t));
		phase += (2 * Math.PI * pitch) / settings.sampleRate;
		const click = index < 16 ? settings.clickLevel * (1 - index / 16) : 0;
		samples[index] = Math.max(-1, Math.min(1, Math.sin(phase) * envelope + click));
	}
	return { sampleRate: settings.sampleRate, samples };
}

export function renderBass(settings: BassVoiceSettings): RenderedBuffer {
	const length = Math.max(1, Math.round(settings.sampleRate * settings.durationSeconds));
	const samples = new Float32Array(length);
	let phase = 0;
	for (let index = 0; index < length; index += 1) {
		phase += (2 * Math.PI * settings.noteHz) / settings.sampleRate;
		const raw = Math.sin(phase);
		samples[index] = Math.tanh(raw * Math.max(1, settings.drive));
	}
	return { sampleRate: settings.sampleRate, samples };
}

export function peakLevel(buffer: RenderedBuffer): number {
	return buffer.samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
}
