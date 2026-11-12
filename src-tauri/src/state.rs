use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::mpsc::Sender;
use std::time::Instant;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

use crate::categories::{self, Category};
use crate::energy::Energy;
use crate::monitor::{HistPoint, Snapshot};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Sampling period while a window is open.
    pub interval_ms: u64,
    /// "bars" (CPU + GPU), "cpu" or "gpu" (number).
    pub tray_style: String,
    pub log_csv: bool,
    pub mini_pinned: bool,
    pub mini_pos: Option<(i32, i32)>,
    /// Local endpoint used by the Stream Deck plugin.
    pub api_enabled: bool,
    /// Energy price in R$/kWh before taxes (Enel SP, B1 residencial, REH ANEEL 3.596/2026).
    pub tariff: f64,
    /// ICMS + PIS/COFINS, charged "por dentro": price = (tariff + flag) / (1 - tax).
    pub tax_pct: f64,
    /// Bandeira tarifária: verde, amarela, vermelha1, vermelha2.
    pub flag: String,
    /// Board, RAM, disks and fans, which have no sensor.
    pub base_watts: f64,
    pub psu_eff: f64,
    pub monitor_watts: f64,
    pub location: String,
    /// "auto" (Windows language), "pt", "en" or "es".
    pub language: String,
}

/// Bandeiras tarifárias (ANEEL), extra R$ per kWh. Kept in sync with FLAGS in src/api.ts.
const FLAGS: [(&str, f64); 4] = [("verde", 0.0), ("amarela", 0.01885), ("vermelha1", 0.04463), ("vermelha2", 0.07877)];

impl Settings {
    /// The language in use: the chosen one, or the Windows display language for "auto".
    pub fn lang(&self) -> &'static str {
        match self.language.as_str() {
            "pt" => "pt",
            "en" => "en",
            "es" => "es",
            _ => {
                // Primary language id: 0x16 Portuguese, 0x0a Spanish.
                let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() } & 0x3ff;
                match id { 0x16 => "pt", 0x0a => "es", _ => "en" }
            }
        }
    }

    /// Final R$/kWh: (tariff + flag) grossed up by ICMS + PIS/COFINS.
    pub fn price_per_kwh(&self) -> f64 {
        let flag = FLAGS.iter().find(|f| f.0 == self.flag).map(|f| f.1).unwrap_or(0.0);
        (self.tariff + flag) / (1.0 - self.tax_pct.clamp(0.0, 60.0) / 100.0)
    }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            interval_ms: 1000,
            tray_style: "bars".into(),
            log_csv: false,
            mini_pinned: false,
            mini_pos: None,
            api_enabled: true,
            tariff: 0.78938,
            tax_pct: 23.0,
            flag: "verde".into(),
            base_watts: 55.0,
            psu_eff: 0.90,
            monitor_watts: 0.0,
            location: "São Paulo, SP · Enel SP".into(),
            language: "auto".into(),
        }
    }
}

pub struct Shared {
    pub dir: PathBuf,
    pub last: Mutex<Option<Snapshot>>,
    pub history: Mutex<VecDeque<HistPoint>>,
    pub settings: Mutex<Settings>,
    pub categories: Mutex<Vec<Category>>,
    /// Bumped when categories change so the sampler drops its cache.
    pub cat_version: Mutex<u64>,
    pub wake: Mutex<Option<Sender<()>>>,
    pub mini_hidden_at: Mutex<Option<Instant>>,
    pub energy: Mutex<Energy>,
}

fn read_json<T: for<'a> Deserialize<'a>>(p: &PathBuf) -> Option<T> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

impl Shared {
    pub fn load(dir: PathBuf) -> Self {
        let settings = read_json(&dir.join("settings.json")).unwrap_or_default();
        let cats: Vec<Category> = read_json(&dir.join("categories.json")).unwrap_or_else(categories::defaults);
        let energy = Energy::load(dir.join("energy.json"));
        Self {
            energy: Mutex::new(energy),
            dir,
            last: Mutex::new(None),
            history: Mutex::new(VecDeque::new()),
            settings: Mutex::new(settings),
            categories: Mutex::new(cats),
            cat_version: Mutex::new(0),
            wake: Mutex::new(None),
            mini_hidden_at: Mutex::new(None),
        }
    }

    pub fn save_settings(&self) {
        let s = self.settings.lock().clone();
        let _ = std::fs::write(self.dir.join("settings.json"), serde_json::to_string_pretty(&s).unwrap_or_default());
    }

    pub fn save_categories(&self) {
        let c = self.categories.lock().clone();
        let _ = std::fs::write(self.dir.join("categories.json"), serde_json::to_string_pretty(&c).unwrap_or_default());
        *self.cat_version.lock() += 1;
        self.wake();
    }

    /// Makes the sampler take a sample now instead of waiting for the next tick.
    pub fn wake(&self) {
        if let Some(tx) = self.wake.lock().as_ref() {
            let _ = tx.send(());
        }
    }
}
