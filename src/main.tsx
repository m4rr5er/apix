import { createRoot } from "react-dom/client";

import App from "./App";
import { applyBootTheme } from "./hooks/useAppearance";
import "./fonts.css";
import "./styles.css";
import "./settings.css";

// Resolve the theme before the first paint so the window never flashes.
applyBootTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("missing #root container");
}

createRoot(container).render(<App />);
