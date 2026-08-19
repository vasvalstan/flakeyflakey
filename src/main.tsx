import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./styles.css";
import "./styles/workspaces.css";
import "./styles/evidence.css";
import "./styles/manual.css";
import "./styles/traceability.css";
import "./styles/overlays.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
