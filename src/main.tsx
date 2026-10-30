import { render } from "preact";
import { App } from "./ui/App.tsx";
import "./ui/style.css";

// The Vite root of the lab (lab_ui.md section 2): create the Worker and mount the app. The engine runs in the Worker (ADR-0003, ADR-0018); the page imports no engine module.
const worker = new Worker(new URL("./worker/worker.ts", import.meta.url), { type: "module" });
const root = document.getElementById("app");
if (root) render(<App worker={worker} />, root);
