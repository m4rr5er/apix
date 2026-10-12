/**
 * Dependency-free icon set.
 *
 * dsh ships icon fonts and StackFerry uses lucide-react; APIX keeps the bundle
 * light by inlining the few glyphs the UI needs. All icons are 16x16 strokes
 * on `currentColor`, so they inherit text colour and size like text does.
 */

import type { ReactNode } from "react";

function Svg({ children, size = 14 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none" }}
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

/** Providers — a chip with pins. */
export function IconChip({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
      <path d="M6.5 2v2.5M9.5 2v2.5M6.5 11.5V14M9.5 11.5V14M2 6.5h2.5M2 9.5h2.5M11.5 6.5H14M11.5 9.5H14" />
    </Svg>
  );
}

/** MCP — a plug. */
export function IconPlug({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M6 1.5V5M10 1.5V5" />
      <path d="M3.8 5h8.4v1.9a4.2 4.2 0 0 1-8.4 0z" />
      <path d="M8 11.1V14.5" />
    </Svg>
  );
}

/** Skills — a spark. */
export function IconSpark({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M8 1.8l1.7 3.9 3.9 1.7-3.9 1.7L8 13l-1.7-3.9L2.4 7.4l3.9-1.7z" />
    </Svg>
  );
}

/** General — sliders. */
export function IconSliders({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2 4.6h12M2 11.4h12" />
      <circle cx="6" cy="4.6" r="1.7" />
      <circle cx="10.5" cy="11.4" r="1.7" />
    </Svg>
  );
}

/** Raw config files — a document. */
export function IconFile({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3.5 1.8h5.3l3.7 3.7v8.7h-9z" />
      <path d="M8.8 1.8v3.7h3.7" />
    </Svg>
  );
}

export function IconPlus({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M8 3.2v9.6M3.2 8h9.6" />
    </Svg>
  );
}

export function IconTrash({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2.6 4.2h10.8" />
      <path d="M6.2 4.2V2.6h3.6v1.6" />
      <path d="M4.2 4.2l.7 9.2h6.2l.7-9.2" />
    </Svg>
  );
}

/** Archive — put a session away without deleting it. */
export function IconArchive({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2.4 5.8h11.2v7H2.4z" />
      <path d="M1.6 3.2h12.8v2.6H1.6z" />
      <path d="M6.4 8.8h3.2" />
    </Svg>
  );
}

export function IconPencil({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M11.1 2.3l2.6 2.6-8.3 8.3-3.3.7.7-3.3z" />
      <path d="M9.7 3.7l2.6 2.6" />
    </Svg>
  );
}

export function IconEye({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M1.4 8S3.7 4.1 8 4.1 14.6 8 14.6 8 12.3 11.9 8 11.9 1.4 8 1.4 8z" />
      <circle cx="8" cy="8" r="1.9" />
    </Svg>
  );
}

export function IconEyeOff({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M1.4 8S3.7 4.1 8 4.1c1 0 1.9.2 2.7.6M14.6 8s-2.3 3.9-6.6 3.9c-1 0-1.9-.2-2.7-.6" />
      <path d="M2.6 2.6l10.8 10.8" />
    </Svg>
  );
}

export function IconChevronRight({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M6.2 3.6L10.6 8l-4.4 4.4" />
    </Svg>
  );
}

export function IconChevronDown({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3.6 6.2L8 10.6l4.4-4.4" />
    </Svg>
  );
}

export function IconRefresh({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" />
      <path d="M13.4 1.9v3.1h-3.1" />
    </Svg>
  );
}

/** Power — quit the app from the tray menu. */
export function IconPower({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M8 1.8v6.4" />
      <path d="M12.2 4.2a5.2 5.2 0 1 1-8.4 0" />
    </Svg>
  );
}

/** Folder — a workspace (pi's cwd). */
export function IconFolder({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M1.6 3.5h4.2l1.5 2h7.1v8.4h-12.8z" />
    </Svg>
  );
}

/**
 * Expand arrow: a filled triangle pointing right when closed, rotated down when
 * open. Filled rather than stroked to match the reference's row affordance, so
 * it needs its own element instead of the {@link Svg} stroke helper.
 */
export function IconTriangleRight({ size = 10, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={className}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "none" }}
    >
      <path d="M6.2 3.6L12.1 8l-5.9 4.4z" />
    </svg>
  );
}

export function IconClose({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  );
}

export function IconCheck({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M3.2 8.4l3.4 3.4 6.2-7.6" />
    </Svg>
  );
}

export function IconInfo({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 7.4v4" />
      <path d="M8 5.1v.1" />
    </Svg>
  );
}

/** Appearance — the classic half-filled contrast disc. */
export function IconAppearance({ size }: IconProps) {
  return (
    <Svg size={size}>
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/*
 * There is deliberately no "gear" glyph: the old one was drawn as a centre
 * circle plus eight rays, which reads as a sun, not a cog. The settings entry
 * is text-only. If a real cog is ever needed, draw the toothed outline — do not
 * bring back the starburst.
 */

/** Queued work. */
export function IconStack({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2.2 5.6h11.6M2.2 8.9h11.6M2.2 12.2h7.4" />
    </Svg>
  );
}

/** Copy. */
export function IconCopy({ size }: IconProps) {
  return (
    <Svg size={size}>
      <rect x="5.8" y="5.8" width="8" height="8" rx="1.6" />
      <path d="M10.2 5.8V3.9a1.6 1.6 0 0 0-1.6-1.6H3.9a1.6 1.6 0 0 0-1.6 1.6v4.7a1.6 1.6 0 0 0 1.6 1.6h1.9" />
    </Svg>
  );
}

/** Star — marks the provider new sessions start on. */
export function IconStar({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M8 1.9l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.7l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
    </Svg>
  );
}

/** Sliders — the per-model detail toggle. */
export function IconTune({ size }: IconProps) {
  return (
    <Svg size={size}>
      <path d="M2.4 5h11.2M2.4 11h11.2" />
      <circle cx="6" cy="5" r="1.7" />
      <circle cx="10.4" cy="11" r="1.7" />
    </Svg>
  );
}
