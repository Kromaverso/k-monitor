import streamDeck, { KeyDownEvent, SingletonAction, WillAppearEvent, WillDisappearEvent, DidReceiveSettingsEvent, KeyAction } from "@elgato/streamdeck";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { render, setLanguage, Settings, Stats } from "./render";

const API = "http://127.0.0.1:47615";
const UUID = "com.kromaverso.kmonitor.gauge";

type Visible = { action: KeyAction<Settings>; settings: Settings };

/** One poller shared by every key: a single request per second, only while keys are visible. */
class Poller {
  keys = new Map<string, Visible>();
  stats: Stats | null = null;
  timer: NodeJS.Timeout | null = null;

  add(id: string, v: Visible) {
    this.keys.set(id, v);
    this.draw(v);
    if (!this.timer) {
      this.tick();
      this.timer = setInterval(() => this.tick(), 1000);
    }
  }

  remove(id: string) {
    this.keys.delete(id);
    if (!this.keys.size && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    try {
      const r = await fetch(`${API}/v1/stats`, { signal: AbortSignal.timeout(900) });
      this.stats = r.ok ? ((await r.json()) as Stats) : null;
    } catch {
      this.stats = null;
    }
    for (const v of this.keys.values()) this.draw(v);
  }

  draw(v: Visible) {
    v.action.setImage(`data:image/svg+xml;charset=utf8,${encodeURIComponent(render(v.settings, this.stats))}`).catch(() => {});
  }
}

const poller = new Poller();

/** Where the kMonitor installer puts the app (per-user NSIS install). */
function launchKMonitor() {
  const candidates = [
    join(process.env.LOCALAPPDATA ?? "", "kMonitor", "kMonitor.exe"),
    join(process.env.ProgramFiles ?? "C:\\Program Files", "kMonitor", "kMonitor.exe"),
  ];
  const exe = candidates.find((p) => existsSync(p));
  if (exe) spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
}

class Gauge extends SingletonAction<Settings> {
  override readonly manifestId = UUID;

  override onWillAppear(ev: WillAppearEvent<Settings>) {
    if (!ev.action.isKey()) return;
    poller.add(ev.action.id, { action: ev.action, settings: ev.payload.settings });
  }

  override onWillDisappear(ev: WillDisappearEvent<Settings>) {
    poller.remove(ev.action.id);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>) {
    const v = poller.keys.get(ev.action.id);
    if (v) {
      v.settings = ev.payload.settings;
      poller.draw(v);
    }
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>) {
    const press = ev.payload.settings.press ?? "open";
    if (press === "none") return;
    if (!poller.stats) {
      launchKMonitor();
      return;
    }
    await fetch(`${API}/v1/${press === "mini" ? "mini" : "open"}`).catch(() => ev.action.showAlert());
  }
}

streamDeck.actions.registerAction(new Gauge());
// Key texts follow the Stream Deck app's language.
setLanguage(streamDeck.info.application.language);
streamDeck.connect();
