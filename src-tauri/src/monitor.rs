//! The sampling loop. One thread, one sample per tick.
//! With no window open it only reads the totals the tray icon and the Stream Deck need,
//! at a slower pace, so kMonitor costs next to nothing while it sits in the tray.

use std::collections::HashMap;
use std::io::Write;
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter, Manager};

use crate::categories::{self, Category};
use crate::gpu::{GpuReader, Pdh};
use crate::state::Shared;
use crate::energy::{Power, Share};
use crate::{cputemp, tray};

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Cpu {
    pub name: String,
    pub usage: f32,
    pub cores: Vec<f32>,
    pub mhz: u32,
    pub base_mhz: u32,
    pub threads: usize,
    pub physical: usize,
    pub temp: Option<f32>,
    pub power: Option<f32>,
    pub ccd_temps: Vec<f32>,
    pub temp_status: cputemp::Status,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mem {
    pub used: u64,
    pub total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub usage: f32,
    pub vram_used: u64,
    pub vram_total: u64,
    pub temp: Option<u32>,
    pub power: Option<f32>,
    pub power_limit: Option<f32>,
    pub clock: Option<u32>,
    pub mem_clock: Option<u32>,
    pub fan: Option<u32>,
    pub engines: Vec<(String, f32)>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub name: String,
    pub exe: String,
    pub cpu: f32,
    pub mem: u64,
    pub gpu: f32,
    pub vram: u64,
    pub cat: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub cpu: f32,
    pub mem: u64,
    pub gpu: f32,
    pub vram: u64,
    pub count: u32,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Peak {
    pub cpu: f32,
    pub gpu: f32,
    pub cpu_temp: f32,
    pub gpu_temp: f32,
    pub gpu_power: f32,
    pub mem: u64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub t: u64,
    pub cpu: Cpu,
    pub mem: Mem,
    pub gpus: Vec<Gpu>,
    pub groups: Vec<Group>,
    /// Only filled while the main window is open.
    pub procs: Vec<Proc>,
    pub peak: Peak,
    pub power: Power,
}

#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct HistPoint {
    pub t: u64,
    pub cpu: f32,
    pub gpu: f32,
    pub mem: f32,
    pub cpu_temp: Option<f32>,
    pub gpu_temp: Option<f32>,
}

const HISTORY: usize = 300;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .map(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
        .unwrap_or(false)
}

/// Resolves a process's category, letting helpers (and unknown children) inherit
/// the category of the process that launched them.
fn resolve(
    pid: Pid,
    sys: &System,
    cats: &[Category],
    cache: &mut HashMap<Pid, String>,
    depth: u8,
) -> String {
    if let Some(c) = cache.get(&pid) {
        return c.clone();
    }
    let Some(p) = sys.process(pid) else { return categories::OTHER.into() };
    let name = p.name().to_string_lossy().to_ascii_lowercase();
    let name = name.trim_end_matches(".exe").to_string();
    let path = p.exe().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let own = categories::classify(cats, &name, &path);
    let inherits = categories::INHERIT.contains(&name.as_str()) || own == categories::OTHER;
    let mut out = own.clone();
    if inherits && depth < 8 {
        if let Some(parent) = p.parent().filter(|pp| *pp != pid) {
            let pc = resolve(parent, sys, cats, cache, depth + 1);
            if pc != categories::OTHER && pc != categories::SYSTEM {
                out = pc;
            }
        }
    }
    cache.insert(pid, out.clone());
    out
}

struct CsvLog {
    file: Option<std::fs::File>,
}

impl CsvLog {
    fn write(&mut self, on: bool, s: &Snapshot) {
        if !on {
            self.file = None;
            return;
        }
        if self.file.is_none() {
            let dir = dirs::document_dir().unwrap_or_else(std::env::temp_dir).join("kMonitor");
            let _ = std::fs::create_dir_all(&dir);
            let path = dir.join(format!("kmonitor-{}.csv", s.t / 1000));
            if let Ok(mut f) = std::fs::File::create(path) {
                let _ = writeln!(f, "unix_ms,cpu_pct,cpu_mhz,cpu_temp_c,cpu_w,ram_used_gb,gpu_pct,vram_used_gb,gpu_temp_c,gpu_w");
                self.file = Some(f);
            }
        }
        if let Some(f) = &mut self.file {
            let g = s.gpus.first().cloned().unwrap_or_default();
            let o = |v: Option<f32>| v.map(|x| format!("{x:.1}")).unwrap_or_default();
            let _ = writeln!(
                f,
                "{},{:.1},{},{},{},{:.2},{:.1},{:.2},{},{}",
                s.t, s.cpu.usage, s.cpu.mhz, o(s.cpu.temp), o(s.cpu.power),
                s.mem.used as f64 / 1e9, g.usage, g.vram_used as f64 / 1e9, o(g.temp.map(|t| t as f32)), o(g.power),
            );
        }
    }
}

pub fn spawn(app: AppHandle, shared: Arc<Shared>) {
    let (tx, rx) = mpsc::channel::<()>();
    *shared.wake.lock() = Some(tx);
    std::thread::Builder::new()
        .name("sampler".into())
        .spawn(move || run(app, shared, rx))
        .expect("sampler thread");
}

fn run(app: AppHandle, shared: Arc<Shared>, rx: mpsc::Receiver<()>) {
    let mut sys = System::new();
    sys.refresh_cpu_all();
    let base_mhz = sys.cpus().first().map(|c| c.frequency() as u32).unwrap_or(0);
    let cpu_name = sys.cpus().first().map(|c| c.brand().trim().to_string()).unwrap_or_default();
    let physical = sys.physical_core_count().unwrap_or(0);

    let gpu = GpuReader::new();
    let perf = Pdh::new();
    let perf_counter = perf.as_ref().and_then(|p| p.add(r"\Processor Information(_Total)\% Processor Performance"));
    if let Some(p) = &perf {
        p.collect();
    }

    let mut cache: HashMap<Pid, String> = HashMap::new();
    let mut cache_version = 0u64;
    let mut peak = Peak::default();
    let mut csv = CsvLog { file: None };
    let mut procs_warm = false;
    // Latest category load, reused for energy attribution between process scans.
    let mut last_groups: Vec<Group> = Vec::new();
    let mut tick = 0u64;
    let mut sensors: Result<cputemp::Reader, cputemp::Status> = cputemp::Reader::open();
    let mut sensor_retry = 0u32;

    loop {
        let detail = visible(&app, "main");
        let any_window = detail || visible(&app, "mini");
        let settings = shared.settings.lock().clone();
        tick = tick.wrapping_add(1);

        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let threads = sys.cpus().len().max(1);

        let mhz = match (&perf, perf_counter) {
            (Some(p), Some(c)) => {
                p.collect();
                p.value(c).map(|pct| (base_mhz as f64 * pct / 100.0) as u32).unwrap_or(base_mhz)
            }
            _ => base_mhz,
        };

        // PawnIO may be installed while kMonitor runs; look again now and then.
        if let Err(st) = &sensors {
            sensor_retry += 1;
            if *st == cputemp::Status::NoDriver && sensor_retry % 30 == 0 && cputemp::installed() {
                sensors = cputemp::Reader::open();
            }
        }
        let (cpu_temp, ccd_temps, cpu_power, temp_status) = match &mut sensors {
            Ok(r) => (r.tctl(), r.ccds(), r.package_power(), cputemp::Status::Ok),
            Err(st) => (None, Vec::new(), None, *st),
        };

        let gs = gpu.sample();
        let gpus: Vec<Gpu> = gpu
            .adapters
            .iter()
            .map(|a| {
                let (usage, vram_used, engines) = gs.per_adapter.get(&a.luid).cloned().unwrap_or_default();
                let nv = gpu.nv(&a.name);
                Gpu {
                    name: a.name.clone(),
                    usage,
                    vram_used,
                    vram_total: a.vram_total,
                    temp: nv.temp,
                    power: nv.power,
                    power_limit: nv.power_limit,
                    clock: nv.clock,
                    mem_clock: nv.mem_clock,
                    fan: nv.fan,
                    engines: engines.into_iter().take(5).collect(),
                }
            })
            .collect();

        // Processes are scanned every tick while a window is open, and every third tick
        // (about 6 s) in the tray, which is enough to attribute energy to categories.
        let mut procs: Vec<Proc> = Vec::new();
        if any_window || tick % 3 == 0 {
            sys.refresh_processes_specifics(
                ProcessesToUpdate::All,
                true,
                ProcessRefreshKind::nothing().with_cpu().with_memory().with_exe(UpdateKind::OnlyIfNotSet),
            );
            let v = *shared.cat_version.lock();
            if v != cache_version {
                cache.clear();
                cache_version = v;
            }
            cache.retain(|pid, _| sys.process(*pid).is_some());
            let cats = shared.categories.lock().clone();
            let mut by_cat: HashMap<String, Group> = HashMap::new();
            let pids: Vec<Pid> = sys.processes().keys().copied().collect();
            for pid in pids {
                if pid.as_u32() == 0 {
                    continue; // System Idle Process
                }
                let cat = resolve(pid, &sys, &cats, &mut cache, 0);
                let p = &sys.processes()[&pid];
                let cpu = if procs_warm { p.cpu_usage() / threads as f32 } else { 0.0 };
                let (g, vram) = gs.per_pid.get(&pid.as_u32()).copied().unwrap_or_default();
                let e = by_cat.entry(cat.clone()).or_insert_with(|| Group { id: cat.clone(), ..Default::default() });
                e.cpu += cpu;
                e.mem += p.memory();
                e.gpu += g;
                e.vram += vram;
                e.count += 1;
                if detail {
                    procs.push(Proc {
                        pid: pid.as_u32(),
                        name: p.name().to_string_lossy().trim_end_matches(".exe").to_string(),
                        exe: p.exe().map(|x| x.to_string_lossy().into_owned()).unwrap_or_default(),
                        cpu,
                        mem: p.memory(),
                        gpu: g,
                        vram,
                        cat,
                    });
                }
            }
            procs_warm = true;
            let mut groups: Vec<Group> = by_cat.into_values().collect();
            groups.iter_mut().for_each(|g| g.gpu = g.gpu.min(100.0));
            groups.sort_by(|a, b| (b.cpu + b.gpu).total_cmp(&(a.cpu + a.gpu)));
            last_groups = groups;
        }
        let groups = last_groups.clone();

        let cpu = Cpu {
            name: cpu_name.clone(),
            usage: sys.global_cpu_usage(),
            cores: sys.cpus().iter().map(|c| c.cpu_usage()).collect(),
            mhz,
            base_mhz,
            threads,
            physical,
            temp: cpu_temp,
            power: cpu_power,
            ccd_temps,
            temp_status,
        };
        let mem = Mem {
            used: sys.used_memory(),
            total: sys.total_memory(),
            swap_used: sys.used_swap(),
            swap_total: sys.total_swap(),
        };
        let g0 = gpus.iter().max_by(|a, b| a.vram_total.cmp(&b.vram_total)).cloned().unwrap_or_default();
        peak.cpu = peak.cpu.max(cpu.usage);
        peak.gpu = peak.gpu.max(g0.usage);
        peak.cpu_temp = peak.cpu_temp.max(cpu.temp.unwrap_or(0.0));
        peak.gpu_temp = peak.gpu_temp.max(g0.temp.unwrap_or(0) as f32);
        peak.gpu_power = peak.gpu_power.max(g0.power.unwrap_or(0.0));
        peak.mem = peak.mem.max(mem.used);

        let t = now_ms();
        let point = HistPoint {
            t,
            cpu: cpu.usage,
            gpu: g0.usage,
            mem: if mem.total > 0 { mem.used as f32 * 100.0 / mem.total as f32 } else { 0.0 },
            cpu_temp: cpu.temp,
            gpu_temp: g0.temp.map(|x| x as f32),
        };
        {
            let mut h = shared.history.lock();
            h.push_back(point);
            while h.len() > HISTORY {
                h.pop_front();
            }
        }

        // Power at the wall: measured parts, estimated parts, PSU losses and the monitor.
        let (cpu_w, cpu_measured) = match cpu.power {
            Some(w) => (w, true),
            // No sensor: idle around 25 W, roughly 1.6 W per % of load on a 16-core Ryzen.
            None => (25.0 + cpu.usage * 1.6, false),
        };
        let gpu_w: f32 = gpus.iter().filter_map(|g| g.power).sum();
        let eff = settings.psu_eff.clamp(0.5, 1.0) as f32;
        let rest = settings.base_watts.max(0.0) as f32;
        let monitor = settings.monitor_watts.max(0.0) as f32;
        let power = Power { cpu: cpu_w, cpu_measured, gpu: gpu_w, rest, monitor, wall: (cpu_w + gpu_w + rest) / eff + monitor };
        let shares: Vec<Share> = groups.iter().map(|g| Share { id: g.id.clone(), cpu: g.cpu, gpu: g.gpu }).collect();
        shared.energy.lock().add(&power, eff as f64, &shares);

        let snap = Snapshot { t, cpu, mem, gpus, groups, procs, peak: peak.clone(), power };
        csv.write(settings.log_csv, &snap);
        tray::update(&app, &snap, &settings.tray_style);
        if any_window {
            let _ = app.emit("snapshot", &snap);
        }
        // Keep the last sample (without the heavy process list) for late joiners and the HTTP API.
        *shared.last.lock() = Some(Snapshot { procs: Vec::new(), ..snap });

        let wait = if any_window { settings.interval_ms.clamp(250, 5000) } else { settings.interval_ms.max(2000) };
        let _ = rx.recv_timeout(Duration::from_millis(wait));
        while rx.try_recv().is_ok() {}
    }
}
