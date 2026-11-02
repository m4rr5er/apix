import type { CSSProperties } from "react";
import { useMemo } from "react";

import CloudSky from "./CloudSky";
import CosmicBG from "./CosmicBG";
import DitherReveal from "./DitherReveal";
import GlobeStudy from "./GlobeStudy";
import MoodField from "./MoodField";
import ReflectShader from "./ReflectShader";

const WORDMARK = "APIX";

export type BackdropTheme = "light" | "dark";

export type BackdropVariant = "globe" | "sky" | "cosmic" | "dither" | "mood" | "reflect";

const VARIANTS: BackdropVariant[] = ["globe", "sky", "cosmic", "dither", "mood", "reflect"];

function gradientImage(from: string, via: string, to: string): string {
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600">` +
		`<defs>` +
		`<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
		`<stop offset="0" stop-color="${from}"/>` +
		`<stop offset="0.55" stop-color="${via}"/>` +
		`<stop offset="1" stop-color="${to}"/>` +
		`</linearGradient>` +
		`<radialGradient id="b" cx="0.72" cy="0.28" r="0.62">` +
		`<stop offset="0" stop-color="${to}" stop-opacity="0.85"/>` +
		`<stop offset="1" stop-color="${to}" stop-opacity="0"/>` +
		`</radialGradient>` +
		`</defs>` +
		`<rect width="960" height="600" fill="url(#g)"/>` +
		`<rect width="960" height="600" fill="url(#b)"/>` +
		`</svg>`;
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

interface Palette {
	globe: { background: string; baseColor: string };
	sky: { background: string; baseColor: string; accentColor: string };
	cosmic: {
		coreColor: string;
		midColor: string;
		accentColor: string;
		outerColor: string;
		brightness: number;
	};
	mood: { background: string; intenseColor: string; calmColor: string; mood: "intense" | "calm" };
	dither: { image: string; dotSize: number; revealRadius: number };
	reflect: { background: string; tint: string; brightness: number; thickness: number };
}

const PALETTE: Record<BackdropTheme, Palette> = {
	dark: {
		globe: { background: "#000000", baseColor: "#E2E4E9" },
		sky: { background: "#05070D", baseColor: "#16243A", accentColor: "#3E6FA8" },
		cosmic: {
			coreColor: "#5B21B6",
			midColor: "#1D4ED8",
			accentColor: "#9333EA",

			outerColor: "#0E1220",
			brightness: 30,
		},
		dither: {
			image: gradientImage("#1B1030", "#0B4A6F", "#F0883E"),
			dotSize: 5,
			revealRadius: 120,
		},
		mood: {
			background: "#05060A",
			intenseColor: "#F0883E",
			calmColor: "#2F6BFF",
			mood: "intense",
		},
		reflect: { background: "#020202", tint: "#F0883E", brightness: 100, thickness: 20 },
	},
	light: {
		globe: { background: "#FFFFFF", baseColor: "#1C1C1E" },

		sky: { background: "#0075FF", baseColor: "#B4D2F0", accentColor: "#FFFFFF" },
		cosmic: {
			coreColor: "#7C3AED",
			midColor: "#2563EB",
			accentColor: "#A855F7",
			outerColor: "#EEF1F6",
			brightness: 26,
		},
		dither: {
			image: gradientImage("#E8EEF9", "#BFD7F5", "#0A84FF"),
			dotSize: 5,
			revealRadius: 120,
		},
		mood: {
			background: "#FFFFFF",
			intenseColor: "#0A84FF",
			calmColor: "#7C3AED",
			mood: "calm",
		},
		reflect: { background: "#FFFFFF", tint: "#1D4ED8", brightness: 70, thickness: 26 },
	},
};

const FILL: CSSProperties = { minWidth: 0, minHeight: 0 };

function roll(): BackdropVariant {
	return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

export const BACKDROP_VARIANTS: readonly BackdropVariant[] = VARIANTS;

export function NewChatBackdrop({ theme, variant: pinned }: { theme: BackdropTheme; variant?: BackdropVariant }) {
	const rolled = useMemo(roll, []);
	const variant = pinned ?? rolled;
	const palette = PALETTE[theme];

	return (
		<div className="newchat-backdrop" data-variant={variant} aria-hidden="true">
			{variant === "globe" ? <GlobeStudy phrase={WORDMARK} background={palette.globe.background} baseColor={palette.globe.baseColor} style={{ ...FILL }} /> : null}

			{variant === "sky" ? <CloudSky background={palette.sky.background} baseColor={palette.sky.baseColor} accentColor={palette.sky.accentColor} style={{ ...FILL }} /> : null}

			{variant === "cosmic" ? <CosmicBG core coreColor={palette.cosmic.coreColor} midColor={palette.cosmic.midColor} accentColor={palette.cosmic.accentColor} outerColor={palette.cosmic.outerColor} brightness={palette.cosmic.brightness} style={{ ...FILL }} /> : null}

			{variant === "dither" ? <DitherReveal image={{ src: palette.dither.image }} ditherStyle="bayer8" dotSize={palette.dither.dotSize} revealRadius={palette.dither.revealRadius} wave style={{ ...FILL }} /> : null}

			{variant === "mood" ? <MoodField background={palette.mood.background} intenseColor={palette.mood.intenseColor} calmColor={palette.mood.calmColor} mood={palette.mood.mood} speed={44} density={80} style={{ ...FILL }} /> : null}

			{variant === "reflect" ? <ReflectShader background={palette.reflect.background} tint={palette.reflect.tint} brightness={palette.reflect.brightness} thickness={palette.reflect.thickness} chromatic={12} bandGap={18} zoom={280} hover={90} speed={46} style={{ ...FILL }} /> : null}
		</div>
	);
}
