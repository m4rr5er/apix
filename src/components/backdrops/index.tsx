/**
 * Decorative backdrop for an empty chat.
 *
 * Every source in this folder is a vendored component from the "高级组件" set
 * (React + canvas / WebGL). Eleven variants, rolled once per mount; the caller
 * keys this on the workspace, so the artwork only changes when the project does.
 *
 *   globe      a globe whose surface is repeated glyphs      (GlobeStudy)
 *   glass      a wordmark behind a liquid-glass shape        (GlassIcon)
 *   sky        a drifting cloud field                        (CloudSky)
 *   rings      a field of rings around the pointer           (CursorRingField)
 *   cosmic     a rotating violet core with orbital rings     (CosmicBG)
 *   dither     a dithered wash revealed by the pointer       (DitherReveal)
 *   mood       a flowing turbulence field                    (MoodField)
 *   neon       a neon frame orbiting the edges               (NeonBorder)
 *   reflect    chromatic interference bands                  (ReflectShader)
 *   bubbles    a wordmark blown into soap bubbles            (BubbleText)
 *   particles  a drifting particle bloom                     (GlowingParticles)
 *
 * All of them are `pointer-events: none` via `.newchat-backdrop` — that rule
 * exists so the backdrop can cover the whole centre pane without swallowing
 * clicks meant for the composer. Two consequences worth knowing:
 *
 *   - Pieces that track the pointer on their own element (dither, bubbles, mood,
 *     reflect, neon) stay dormant; they still animate on their own, which is what
 *     a backdrop needs. `rings` works because it listens on `window`.
 *   - Nothing is focusable or screen-reader visible, which is why the container
 *     is `aria-hidden`.
 *
 * The palettes below are the whole tuning surface: each component ships
 * dark-background defaults, and with the stock colours the artwork simply
 * disappears against a white page.
 */

import type { CSSProperties } from "react";
import { Suspense, lazy, useMemo } from "react";

import CloudSky from "./CloudSky";
import CosmicBG from "./CosmicBG";
import CursorRingField from "./CursorRingField";
import DitherReveal from "./DitherReveal";
import GlassIcon from "./GlassIcon";
import GlobeStudy from "./GlobeStudy";
import MoodField from "./MoodField";
import NeonBorder from "./NeonBorder";
import ReflectShader from "./ReflectShader";

/**
 * The only two backdrops that pull in a dependency: `three`.
 *
 * Every other piece here is React plus its own canvas / WebGL code, but these
 * two are three.js scenes (a `ShaderMaterial` instanced-mesh scene, and a points
 * cloud with a multi-pass `WebGLRenderTarget` bloom chain) — they cannot be
 * written without it.
 *
 * Loaded lazily rather than with a static `import`, because a static one drags
 * all of three (~650 kB source) into the **initial** bundle: the empty chat
 * would pay for a library that eleven of the thirteen variants never touch, and
 * that two variants need only if the roll happens to pick them. As dynamic
 * imports, three lands in its own chunk and is fetched the first time either
 * variant is rolled — the empty chat stays as light as it was before they were
 * added, and nothing else in the pool is affected.
 */
const BubbleText = lazy(() => import("./BubbleText"));
const GlowingParticles = lazy(() => import("./GlowingParticles"));

const WORDMARK = "APIX";

export type BackdropTheme = "light" | "dark";

export type BackdropVariant =
  | "globe"
  | "glass"
  | "sky"
  | "rings"
  | "cosmic"
  | "dither"
  | "mood"
  | "neon"
  | "reflect"
  | "bubbles"
  | "particles";

const VARIANTS: BackdropVariant[] = [
  "globe",
  "glass",
  "sky",
  "rings",
  "cosmic",
  "dither",
  "mood",
  "neon",
  "reflect",
  "bubbles",
  "particles",
];

/**
 * The artwork `DitherReveal` dithers.
 *
 * The component's own default is a stock photo on Unsplash, which a desktop app
 * has no business fetching: it needs the network, taints the canvas unless CORS
 * cooperates, and paints a stranger's photograph behind the user's work. A
 * three-stop gradient drawn inline from the theme's own colours keeps the
 * effect, works offline, and matches the rest of the UI.
 */
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
  glass: { background: string; backdropTextColor: string; tint: string };
  sky: { background: string; baseColor: string; accentColor: string };
  rings: { background: string; colors: string[] };
  cosmic: {
    coreColor: string;
    midColor: string;
    accentColor: string;
    outerColor: string;
    brightness: number;
  };
  mood: { background: string; intenseColor: string; calmColor: string; mood: "intense" | "calm" };
  neon: { color: string; thickness: number; glow: number };
  dither: { image: string; dotSize: number; revealRadius: number };
  reflect: { background: string; tint: string; brightness: number; thickness: number };
  bubbles: { tint: string; opacity: number };
  particles: { color: string; hot: string; rim: number; haze: number; bloom: number };
}

const PALETTE: Record<BackdropTheme, Palette> = {
  dark: {
    globe: { background: "#000000", baseColor: "#E2E4E9" },
    glass: { background: "#000000", backdropTextColor: "#F9FAFB", tint: "#FFFFFF" },
    sky: { background: "#05070D", baseColor: "#16243A", accentColor: "#3E6FA8" },
    rings: { background: "#0B0B18", colors: ["#7189FF", "#3074F9", "#0B0B18"] },
    cosmic: {
      coreColor: "#5B21B6",
      midColor: "#1D4ED8",
      accentColor: "#9333EA",
      // The canvas clears transparent, so this ring colour doubles as the
      // outermost falloff — dark keeps it near the page so the core reads.
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
    neon: { color: "#F0883E", thickness: 6, glow: 100 },
    reflect: { background: "#020202", tint: "#F0883E", brightness: 100, thickness: 20 },
    bubbles: { tint: "#DDE3EA", opacity: 4 },
    particles: { color: "#CFE6FF", hot: "#FFFFFF", rim: 24, haze: 20, bloom: 8 },
  },
  light: {
    globe: { background: "#FFFFFF", baseColor: "#1C1C1E" },
    glass: { background: "#FFFFFF", backdropTextColor: "#1C1C1E", tint: "#FFFFFF" },
    // CloudSky's stock colours are already a daylight sky; keep them.
    sky: { background: "#0075FF", baseColor: "#B4D2F0", accentColor: "#FFFFFF" },
    rings: { background: "#F2F2F7", colors: ["#007AFF", "#5AC8FA", "#C7C7CC"] },
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
    neon: { color: "#0A84FF", thickness: 6, glow: 70 },
    reflect: { background: "#FFFFFF", tint: "#1D4ED8", brightness: 70, thickness: 26 },
    bubbles: { tint: "#1C1C1E", opacity: 3 },
    particles: { color: "#1D4ED8", hot: "#0A84FF", rim: 30, haze: 14, bloom: 5 },
  },
};

/** Neutralises the fixed sizing the vendored components declare. */
const FILL: CSSProperties = { minWidth: 0, minHeight: 0 };

function roll(): BackdropVariant {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

/** Every variant, for callers that want to offer a choice. */
export const BACKDROP_VARIANTS: readonly BackdropVariant[] = VARIANTS;

/**
 * Render the empty-chat backdrop.
 *
 * `variant` pins one piece; omit it and the piece is rolled once per mount,
 * which is what the empty chat does — the caller keys the component on the chat
 * id, so a new chat re-rolls. The pin exists so a variant can be chosen
 * deliberately (a picker, or a side-by-side review page) without the component
 * having to expose its parts.
 */
export function NewChatBackdrop({
  theme,
  variant: pinned,
}: {
  theme: BackdropTheme;
  variant?: BackdropVariant;
}) {
  const rolled = useMemo(roll, []);
  const variant = pinned ?? rolled;
  const palette = PALETTE[theme];

  return (
    <div className="newchat-backdrop" data-variant={variant} aria-hidden="true">
      {/* Only the two lazy variants can suspend; the other nine render
          synchronously, so this boundary is invisible for them. A null fallback
          is right for decoration — there is nothing to show while three loads. */}
      <Suspense fallback={null}>
        {variant === "globe" ? (
        <GlobeStudy
          phrase={WORDMARK}
          background={palette.globe.background}
          baseColor={palette.globe.baseColor}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "glass" ? (
        <GlassIcon
          background={palette.glass.background}
          backdrop={{
            type: "Text",
            text: WORDMARK,
            textColor: palette.glass.backdropTextColor,
            font: {
              fontFamily:
                '"SF Mono", "JetBrains Mono", Consolas, "PingFang SC", monospace',
              fontSize: 240,
              fontWeight: 700,
              fontStyle: "normal",
              letterSpacing: 8,
              lineHeight: 1.1,
            },
          }}
          glass={{ tint: palette.glass.tint }}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "sky" ? (
        <CloudSky
          background={palette.sky.background}
          baseColor={palette.sky.baseColor}
          accentColor={palette.sky.accentColor}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "rings" ? (
        <CursorRingField
          background={palette.rings.background}
          colors={palette.rings.colors}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "cosmic" ? (
        <CosmicBG
          core
          coreColor={palette.cosmic.coreColor}
          midColor={palette.cosmic.midColor}
          accentColor={palette.cosmic.accentColor}
          outerColor={palette.cosmic.outerColor}
          brightness={palette.cosmic.brightness}
          style={{ ...FILL }}
        />
      ) : null}


      {variant === "dither" ? (
        <DitherReveal
          image={{ src: palette.dither.image }}
          ditherStyle="bayer8"
          dotSize={palette.dither.dotSize}
          revealRadius={palette.dither.revealRadius}
          wave
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "mood" ? (
        <MoodField
          background={palette.mood.background}
          intenseColor={palette.mood.intenseColor}
          calmColor={palette.mood.calmColor}
          mood={palette.mood.mood}
          speed={44}
          density={80}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "neon" ? (
        <NeonBorder
          color={palette.neon.color}
          thickness={palette.neon.thickness}
          glow={palette.neon.glow}
          rounded={28}
          borderSize={54}
          movement="continuous"
          speed={14}
          style={{ ...FILL }}
        />
      ) : null}


      {variant === "reflect" ? (
        <ReflectShader
          background={palette.reflect.background}
          tint={palette.reflect.tint}
          brightness={palette.reflect.brightness}
          thickness={palette.reflect.thickness}
          chromatic={12}
          bandGap={18}
          zoom={280}
          hover={90}
          speed={46}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "bubbles" ? (
        <BubbleText
          text={WORDMARK}
          font={{
            fontFamily: '"SF Mono", "JetBrains Mono", Consolas, "PingFang SC", monospace',
            fontSize: 70,
            fontWeight: 700,
            lineHeight: 1,
          }}
          tint={palette.bubbles.tint}
          opacity={palette.bubbles.opacity}
          bubbleSize={18}
          density={16}
          speed={8}
          scatter={10}
          style={{ ...FILL }}
        />
      ) : null}

      {variant === "particles" ? (
        <GlowingParticles
          color={palette.particles.color}
          hot={palette.particles.hot}
          density={16}
          streak={8}
          speed={18}
          size={4}
          rim={palette.particles.rim}
          haze={palette.particles.haze}
          bloom={palette.particles.bloom}
          spin={18}
          direction="right"
          style={{ ...FILL }}
        />
      ) : null}
      </Suspense>
    </div>
  );
}
