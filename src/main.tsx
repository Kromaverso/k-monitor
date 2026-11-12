import { createRoot } from "react-dom/client";
import "./styles.css";
import { resolveLang, setLang } from "./i18n";

async function start() {
  // README screenshots: outside Tauri, ?capture=<page>&lang=<xx> runs the UI on sample data.
  const q = new URLSearchParams(location.search);
  if (q.has("capture") && !("__TAURI_INTERNALS__" in window)) {
    const { installCaptureMocks } = await import("./capture");
    installCaptureMocks(q.get("lang") ?? "en");
  }
  setLang(resolveLang("auto"));
  const [{ default: App }, { default: Mini }] = await Promise.all([import("./App"), import("./Mini")]);
  createRoot(document.getElementById("root")!).render(location.hash === "#mini" ? <Mini /> : <App />);
}

start();
