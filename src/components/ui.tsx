import { ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  LuAppWindow, LuBot, LuChrome, LuClapperboard, LuCode, LuCpu, LuGamepad2, LuMessageCircle, LuMonitor, LuPalette, LuShapes, LuStore,
} from "react-icons/lu";
import { SiBlender, SiGodotengine, SiUnity, SiUnrealengine } from "react-icons/si";
import { Category } from "../api";

const ICONS: Record<string, typeof LuCpu> = {
  unreal: SiUnrealengine, unity: SiUnity, godot: SiGodotengine, blender: SiBlender, adobe: LuPalette, ai: LuBot, dev: LuCode,
  browser: LuChrome, chat: LuMessageCircle, media: LuClapperboard, store: LuStore, game: LuGamepad2, chip: LuCpu, windows: LuMonitor,
  app: LuAppWindow, palette: LuPalette, shapes: LuShapes,
};
export const ICON_NAMES = Object.keys(ICONS);

export function CatIcon({ cat, size = 30 }: { cat: Pick<Category, "icon" | "color">; size?: number }) {
  const I = ICONS[cat.icon] ?? LuShapes;
  return (
    <span className="cat-icon" style={{ width: size, height: size, borderRadius: size * 0.28, ["--c" as string]: cat.color }}>
      <I size={size * 0.52} />
    </span>
  );
}

/** Circular gauge in the style of the Apple Watch activity rings. */
export function Ring({ value, color, size = 120, stroke = 11, children, track = "var(--track)" }: {
  value: number; color: string; size?: number; stroke?: number; children?: ReactNode; track?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value || 0));
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray .6s cubic-bezier(.2,.8,.2,1), stroke .4s", filter: `drop-shadow(0 0 6px ${color}55)` }}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  );
}

/** Smooth area chart for 0-100 series. */
export function Area({ series, height = 120, max = 100 }: { series: { values: number[]; color: string }[]; height?: number; max?: number }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(50, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = Math.max(2, ...series.map((s) => s.values.length));
  const path = (vals: number[]) => {
    if (vals.length < 2) return "";
    const step = w / (n - 1);
    const off = (n - vals.length) * step;
    const pts = vals.map((v, i) => [off + i * step, height - (Math.min(max, Math.max(0, v)) / max) * (height - 4) - 2]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const cx = (x0 + x1) / 2;
      d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
    }
    return d;
  };
  return (
    <div ref={ref} className="area">
      <svg width={w} height={height} viewBox={`0 0 ${w} ${height}`}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`${id}g${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={s.color} stopOpacity=".32" />
              <stop offset="1" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {[25, 50, 75].map((g) => (
          <line key={g} x1="0" x2={w} y1={height - (g / max) * height} y2={height - (g / max) * height} stroke="var(--line)" strokeDasharray="2 4" />
        ))}
        {series.map((s, i) => {
          const d = path(s.values);
          if (!d) return null;
          return (
            <g key={i}>
              <path d={`${d} L${w},${height} L${w - ((s.values.length - 1) * w) / (n - 1)},${height} Z`} fill={`url(#${id}g${i})`} />
              <path d={d} fill="none" stroke={s.color} strokeWidth="1.8" strokeLinejoin="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Meter({ value, color, thin }: { value: number; color: string; thin?: boolean }) {
  return (
    <div className={"meter" + (thin ? " thin" : "")}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

export function Stat({ label, value, sub, color }: { label: string; value: ReactNode; sub?: ReactNode; color?: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b style={color ? { color } : undefined}>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map(([v, l]) => (
        <button key={v} className={v === value ? "on" : ""} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={"toggle" + (on ? " on" : "")} onClick={() => onChange(!on)}>
      <i />
    </button>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
