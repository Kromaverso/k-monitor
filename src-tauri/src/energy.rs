//! Energy log: integrates the PC's power draw over time into per-hour and per-day buckets,
//! and splits it between process categories.
//!
//! What is measured: GPU board power (NVML) and CPU package power (RAPL via PawnIO).
//! What is estimated: the CPU when PawnIO is unavailable, and the rest of the PC
//! (board, RAM, disks, fans) as a fixed wattage. Everything is converted to wall power
//! with the PSU efficiency, plus the monitor if configured.
//!
//! Stored in energy.json next to the settings. Every hour is kept (about 1 MB per year).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::time::Instant;

use chrono::{Local, Timelike};
use serde::{Deserialize, Serialize};

/// Category id for energy no app caused: idle CPU/GPU, board, RAM, disks, fans, monitor.
pub const BASE: &str = "__base";

#[derive(Serialize, Deserialize, Clone, Copy, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Bucket {
    /// Wall energy in Wh, and its split (also at the wall).
    pub wh: f64,
    pub cpu: f64,
    pub gpu: f64,
    pub rest: f64,
    /// Seconds the PC was measured in this bucket.
    pub secs: f64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Store {
    days: BTreeMap<String, Bucket>,
    hours: BTreeMap<String, Bucket>,
    /// day -> category id -> Wh at the wall.
    categories: BTreeMap<String, BTreeMap<String, f64>>,
}

#[derive(Serialize, Clone, Copy, Default)]
#[serde(rename_all = "camelCase")]
pub struct Power {
    pub cpu: f32,
    pub cpu_measured: bool,
    pub gpu: f32,
    pub rest: f32,
    pub monitor: f32,
    /// Estimated draw at the wall socket.
    pub wall: f32,
}

/// How much of the CPU and GPU load a category had (percent of the whole machine).
pub struct Share {
    pub id: String,
    pub cpu: f32,
    pub gpu: f32,
}

pub struct Energy {
    path: PathBuf,
    store: Store,
    last: Option<Instant>,
    saved: Instant,
}

impl Energy {
    pub fn load(path: PathBuf) -> Self {
        let store = std::fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Self { path, store, last: None, saved: Instant::now() }
    }

    /// Adds the energy used since the previous call at the current power draw.
    pub fn add(&mut self, p: &Power, eff: f64, shares: &[Share]) {
        let now = Instant::now();
        let Some(prev) = self.last.replace(now) else { return };
        // A long gap means the PC slept or the app was suspended: don't count it.
        let secs = now.duration_since(prev).as_secs_f64();
        if secs > 15.0 {
            return;
        }
        let h = secs / 3600.0;
        let eff = eff.clamp(0.5, 1.0);
        let add = |b: &mut Bucket| {
            b.cpu += p.cpu as f64 / eff * h;
            b.gpu += p.gpu as f64 / eff * h;
            b.rest += (p.rest as f64 / eff + p.monitor as f64) * h;
            b.wh += p.wall as f64 * h;
            b.secs += secs;
        };
        let t = Local::now();
        let day = t.format("%Y-%m-%d").to_string();
        add(self.store.days.entry(day.clone()).or_default());
        add(self.store.hours.entry(format!("{day} {:02}", t.hour())).or_default());

        // CPU energy goes to categories by their share of CPU load, GPU energy by GPU load.
        // Whatever no app claims (idle, the rest of the PC, the monitor) is the base.
        let cats = self.store.categories.entry(day).or_default();
        let total_cpu: f32 = shares.iter().map(|s| s.cpu).sum();
        let total_gpu: f32 = shares.iter().map(|s| s.gpu).sum();
        let mut claimed = 0.0;
        for s in shares {
            let mut wh = 0.0;
            if total_cpu > 0.5 {
                wh += (p.cpu * s.cpu / total_cpu) as f64 / eff * h;
            }
            if total_gpu > 0.5 {
                wh += (p.gpu * s.gpu / total_gpu) as f64 / eff * h;
            }
            if wh > 0.0 {
                *cats.entry(s.id.clone()).or_default() += wh;
                claimed += wh;
            }
        }
        *cats.entry(BASE.into()).or_default() += (p.wall as f64 * h - claimed).max(0.0);

        if self.saved.elapsed().as_secs() >= 30 {
            self.save();
        }
    }

    pub fn save(&mut self) {
        if let Ok(s) = serde_json::to_string(&self.store) {
            // Write then rename, so a crash mid-write never loses the history.
            let tmp = self.path.with_extension("json.tmp");
            if std::fs::write(&tmp, s).is_ok() {
                let _ = std::fs::rename(&tmp, &self.path);
            }
        }
        self.saved = Instant::now();
    }

    pub fn days(&self) -> Vec<(String, Bucket)> {
        self.store.days.iter().rev().take(400).map(|(k, v)| (k.clone(), *v)).collect()
    }

    pub fn hours(&self) -> Vec<(String, Bucket)> {
        self.store.hours.iter().rev().take(48).map(|(k, v)| (k.clone(), *v)).collect()
    }

    /// Category totals (Wh) for days starting with `prefix` ("2026-11" for a month, "2026-11-10" for a day).
    pub fn categories(&self, prefix: &str) -> BTreeMap<String, f64> {
        let mut out = BTreeMap::new();
        for (_, cats) in self.store.categories.iter().filter(|(d, _)| d.starts_with(prefix)) {
            for (id, wh) in cats {
                *out.entry(id.clone()).or_insert(0.0) += wh;
            }
        }
        out
    }

    /// Writes three CSVs (per day, per hour, per category and day) and returns their folder.
    /// `price` is R$/kWh; `names` maps category ids to display names.
    pub fn export_csv(&self, dir: &Path, price: f64, names: &BTreeMap<String, String>) -> std::io::Result<PathBuf> {
        std::fs::create_dir_all(dir)?;
        let n = |v: f64, d: usize| format!("{v:.d$}").replace('.', ",");
        // Semicolons and decimal commas: what Excel expects in pt-BR.
        let mut days = String::from("\u{feff}data;kwh;reais;cpu_kwh;gpu_kwh;resto_kwh;horas_medidas\n");
        for (d, b) in &self.store.days {
            let _ = writeln!(days, "{d};{};{};{};{};{};{}", n(b.wh / 1000.0, 4), n(b.wh / 1000.0 * price, 2), n(b.cpu / 1000.0, 4), n(b.gpu / 1000.0, 4), n(b.rest / 1000.0, 4), n(b.secs / 3600.0, 2));
        }
        let mut hours = String::from("\u{feff}data;hora;wh;reais;cpu_wh;gpu_wh;resto_wh;minutos_medidos\n");
        for (k, b) in &self.store.hours {
            let (d, h) = k.split_once(' ').unwrap_or((k, ""));
            let _ = writeln!(hours, "{d};{h};{};{};{};{};{};{}", n(b.wh, 1), n(b.wh / 1000.0 * price, 3), n(b.cpu, 1), n(b.gpu, 1), n(b.rest, 1), n(b.secs / 60.0, 1));
        }
        let mut cats = String::from("\u{feff}data;categoria;kwh;reais\n");
        for (d, m) in &self.store.categories {
            for (id, wh) in m {
                let name = names.get(id).cloned().unwrap_or_else(|| id.clone());
                let _ = writeln!(cats, "{d};{name};{};{}", n(wh / 1000.0, 4), n(wh / 1000.0 * price, 2));
            }
        }
        std::fs::write(dir.join("consumo-por-dia.csv"), days)?;
        std::fs::write(dir.join("consumo-por-hora.csv"), hours)?;
        std::fs::write(dir.join("consumo-por-categoria.csv"), cats)?;
        Ok(dir.to_path_buf())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_energy_between_categories_and_base() {
        let dir = std::env::temp_dir().join(format!("kmon-energy-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut e = Energy::load(dir.join("energy.json"));
        // 100 W CPU split 3:1, 50 W GPU all to "unreal", 50 W rest, 100% PSU efficiency.
        let p = Power { cpu: 100.0, cpu_measured: true, gpu: 50.0, rest: 50.0, monitor: 0.0, wall: 200.0 };
        let shares = [
            Share { id: "unreal".into(), cpu: 30.0, gpu: 80.0 },
            Share { id: "browsers".into(), cpu: 10.0, gpu: 0.0 },
        ];
        e.add(&p, 1.0, &shares); // first call only starts the clock
        e.last = Some(Instant::now() - std::time::Duration::from_secs(10));
        e.add(&p, 1.0, &shares);
        let day = Local::now().format("%Y-%m-%d").to_string();
        let c = e.categories(&day);
        let h = 10.0 / 3600.0;
        let close = |a: f64, b: f64| (a - b).abs() < 1e-3;
        assert!(close(c["unreal"], (75.0 + 50.0) * h), "{c:?}");
        assert!(close(c["browsers"], 25.0 * h), "{c:?}");
        assert!(close(c[BASE], 50.0 * h), "{c:?}");
        let total: f64 = c.values().sum();
        assert!(close(total, 200.0 * h));
        let out = e.export_csv(&dir, 1.0, &BTreeMap::new()).unwrap();
        let csv = std::fs::read_to_string(out.join("consumo-por-categoria.csv")).unwrap();
        assert!(csv.contains(";unreal;"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
