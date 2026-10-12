/**
 * Theme and motion preferences.
 *
 * `data-theme` on <html> always holds the *resolved* theme ("light" | "dark"),
 * so the stylesheet needs no media query and no duplicated token block. The
 * "follow system" choice is resolved here; the Rust state file is the source of
 * truth, and localStorage keeps a boot copy so the first paint is already
 * correct instead of flashing the default theme.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  configApi,
  DEFAULT_UI,
  normalizeUi,
  type ThemePreference,
  type UiPreferences,
} from "../lib/configBridge";
import { setWindowBackground } from "../lib/bridge";

const BOOT_THEME_KEY = "apix.ui.theme";
const BOOT_SCALE_KEY = "apix.ui.fontScale";

function readBootTheme(): ThemePreference {
  try {
    const raw = window.localStorage.getItem(BOOT_THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* storage can be unavailable; fall through */
  }
  return DEFAULT_UI.theme;
}

function readBootScale(): number {
  try {
    const raw = window.localStorage.getItem(BOOT_SCALE_KEY);
    const parsed = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  } catch {
    /* ignore */
  }
  return DEFAULT_UI.fontScale;
}

function resolve(theme: ThemePreference): "light" | "dark" {
  if (theme !== "system") return theme;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Every font-size and line-height in the stylesheets reads this. */
function applyScale(scale: number): void {
  document.documentElement.style.setProperty("--apx-font-scale", String(scale));
}

/** Call before the first render so the window never flashes the wrong theme. */
export function applyBootTheme(): void {
  const resolved = resolve(readBootTheme());
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  applyScale(readBootScale());
}

export interface AppearanceApi {
  prefs: UiPreferences;
  /** The theme actually in effect, after resolving "system". */
  resolved: "light" | "dark";
  loaded: boolean;
  update: (patch: Partial<UiPreferences>) => void;
}

export function useAppearance(): AppearanceApi {
  const [prefs, setPrefs] = useState<UiPreferences>(() => ({
    ...DEFAULT_UI,
    theme: readBootTheme(),
    fontScale: readBootScale(),
  }));
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    readBootTheme() === "light" ? "light" : "dark",
  );
  const [loaded, setLoaded] = useState(false);
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    void (async () => {
      try {
        const state = await configApi.stateRead();
        setPrefs(normalizeUi(state.ui));
      } catch {
        /* keep whatever the boot cache gave us */
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Apply the resolved theme, keep tracking the OS while on "system", and keep
  // the native window background in step so resizing never flashes white.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = resolve(prefs.theme);
      document.documentElement.dataset.theme = next;
      document.documentElement.style.colorScheme = next;
      setResolved(next);

      const background = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue("--apx-bg")
        .trim();
      if (background) setWindowBackground(background);
    };
    apply();
    if (prefs.theme !== "system") return;
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [prefs.theme]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = prefs.reduceMotion ? "true" : "false";
  }, [prefs.reduceMotion]);

  useEffect(() => {
    applyScale(prefs.fontScale);
  }, [prefs.fontScale]);

  // Persist after hydration, so the initial read never writes back over itself.
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(BOOT_THEME_KEY, prefs.theme);
      window.localStorage.setItem(BOOT_SCALE_KEY, String(prefs.fontScale));
    } catch {
      /* ignore */
    }
    void configApi.writeUi(prefs).catch(() => {
      /* non-fatal: the UI already reflects the change */
    });
  }, [prefs, loaded]);

  const update = useCallback((patch: Partial<UiPreferences>) => {
    setPrefs((current) => ({ ...current, ...patch }));
  }, []);

  return { prefs, resolved, loaded, update };
}
