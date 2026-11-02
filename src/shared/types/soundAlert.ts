export type SoundAlertKind = "done" | "error" | "waiting";

export type SoundAlertPresetId = "done-chime" | "done-bell" | "done-pop" | "error-buzz" | "error-alert" | "waiting-ping" | "waiting-knock";

export type SoundAlertEventConfig = {
	enabled: boolean;

	sound: string;
};

export type SoundAlertSettings = {
	enabled: boolean;

	volume: number;
	done: SoundAlertEventConfig;
	error: SoundAlertEventConfig;
	waiting: SoundAlertEventConfig;
};

export type SoundAlertPlayEvent = {
	kind: SoundAlertKind;

	title: string;

	soundId: string;

	volume: number;
};

export type CustomSoundInfo = {
	name: string;

	size: number;
};

export type SoundImportResult = { ok: true; info: CustomSoundInfo } | { ok: false; error: "canceled" | "invalidType" | "tooLarge" | "readFailed" };

export const DEFAULT_SOUND_BY_KIND: Record<SoundAlertKind, SoundAlertPresetId> = {
	done: "done-chime",
	error: "error-buzz",
	waiting: "waiting-ping",
};

export const SOUND_ALERT_PRESETS: readonly {
	id: SoundAlertPresetId;
	file: string;
	labelKey: string;
}[] = [
	{ id: "done-chime", file: "done-chime.wav", labelKey: "settings.sound.preset.doneChime" },
	{ id: "done-bell", file: "done-bell.wav", labelKey: "settings.sound.preset.doneBell" },
	{ id: "done-pop", file: "done-pop.wav", labelKey: "settings.sound.preset.donePop" },
	{ id: "error-buzz", file: "error-buzz.wav", labelKey: "settings.sound.preset.errorBuzz" },
	{ id: "error-alert", file: "error-alert.wav", labelKey: "settings.sound.preset.errorAlert" },
	{ id: "waiting-ping", file: "waiting-ping.wav", labelKey: "settings.sound.preset.waitingPing" },
	{ id: "waiting-knock", file: "waiting-knock.wav", labelKey: "settings.sound.preset.waitingKnock" },
];

export const SOUND_ALERT_PRESET_IDS: readonly SoundAlertPresetId[] = SOUND_ALERT_PRESETS.map((entry) => entry.id);

export const CUSTOM_SOUND_EXTENSIONS = ["wav", "mp3", "ogg", "m4a", "flac"] as const;

export const MAX_CUSTOM_SOUND_BYTES = 5 * 1024 * 1024;

export const DEFAULT_SOUND_ALERT_SETTINGS: SoundAlertSettings = {
	enabled: true,
	volume: 0.6,
	done: { enabled: true, sound: DEFAULT_SOUND_BY_KIND.done },
	error: { enabled: true, sound: DEFAULT_SOUND_BY_KIND.error },
	waiting: { enabled: false, sound: DEFAULT_SOUND_BY_KIND.waiting },
};

export function createDefaultSoundAlertSettings(): SoundAlertSettings {
	return {
		enabled: true,
		volume: DEFAULT_SOUND_ALERT_SETTINGS.volume,
		done: { ...DEFAULT_SOUND_ALERT_SETTINGS.done },
		error: { ...DEFAULT_SOUND_ALERT_SETTINGS.error },
		waiting: { ...DEFAULT_SOUND_ALERT_SETTINGS.waiting },
	};
}

export function isAllowedCustomSoundName(name: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(wav|mp3|ogg|m4a|flac)$/i.test(name);
}

export function parseSoundAlertRef(value: string): { kind: "preset"; id: SoundAlertPresetId } | { kind: "custom"; file: string } | null {
	if (value.startsWith("custom:")) {
		const file = value.slice("custom:".length);
		if (isAllowedCustomSoundName(file)) return { kind: "custom", file };
		return null;
	}
	if ((SOUND_ALERT_PRESET_IDS as readonly string[]).includes(value)) {
		return { kind: "preset", id: value as SoundAlertPresetId };
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clampVolume(value: unknown): number {
	const n = Number(value);
	if (!Number.isFinite(n)) return DEFAULT_SOUND_ALERT_SETTINGS.volume;
	return Math.min(1, Math.max(0, n));
}

function normalizeEventConfig(raw: unknown, fallback: SoundAlertEventConfig): SoundAlertEventConfig {
	if (!isRecord(raw)) return { ...fallback };
	const enabled = typeof raw.enabled === "boolean" ? raw.enabled : fallback.enabled;
	const sound = typeof raw.sound === "string" && parseSoundAlertRef(raw.sound) ? raw.sound : fallback.sound;
	return { enabled, sound };
}

export function normalizeSoundAlertSettings(raw: unknown): SoundAlertSettings {
	if (!isRecord(raw)) return createDefaultSoundAlertSettings();
	return {
		enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SOUND_ALERT_SETTINGS.enabled,
		volume: clampVolume(raw.volume),
		done: normalizeEventConfig(raw.done, DEFAULT_SOUND_ALERT_SETTINGS.done),
		error: normalizeEventConfig(raw.error, DEFAULT_SOUND_ALERT_SETTINGS.error),
		waiting: normalizeEventConfig(raw.waiting, DEFAULT_SOUND_ALERT_SETTINGS.waiting),
	};
}
