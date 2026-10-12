import { createRoot } from "react-dom/client";

import { TrayMenu } from "./components/TrayMenu";
import { applyBootTheme } from "./hooks/useAppearance";
import "./styles.css";
import "./tray.css";

// Resolve the theme before the first paint, exactly like the app window does, so
// the menu can never appear in the wrong theme for a frame.
applyBootTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root container");
}

createRoot(container).render(<TrayMenu />);
