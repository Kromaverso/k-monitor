//! GPU data on Windows, gathered the same way Task Manager does it:
//! - DXGI lists the adapters (name, LUID, dedicated VRAM).
//! - PDH "GPU Engine" counters give utilisation per process and per engine.
//! - PDH "GPU Adapter Memory" / "GPU Process Memory" give VRAM in use.
//! - NVML (when an NVIDIA driver is present) adds temperature, power, clocks and fan.

use std::collections::HashMap;

use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};
use nvml_wrapper::Nvml;
use windows::core::PCWSTR;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1};
use windows::Win32::System::Performance::*;

/// A PDH query with helpers for wildcard counters.
pub struct Pdh {
    query: isize,
}

impl Pdh {
    pub fn new() -> Option<Self> {
        let mut q = 0isize;
        let r = unsafe { PdhOpenQueryW(PCWSTR::null(), 0, &mut q) };
        (r == 0).then_some(Self { query: q })
    }

    pub fn add(&self, path: &str) -> Option<isize> {
        let wide: Vec<u16> = path.encode_utf16().chain([0]).collect();
        let mut c = 0isize;
        let r = unsafe { PdhAddEnglishCounterW(self.query, PCWSTR(wide.as_ptr()), 0, &mut c) };
        (r == 0).then_some(c)
    }

    pub fn collect(&self) {
        unsafe { PdhCollectQueryData(self.query) };
    }

    pub fn value(&self, counter: isize) -> Option<f64> {
        let mut v = PDH_FMT_COUNTERVALUE::default();
        let r = unsafe { PdhGetFormattedCounterValue(counter, fmt(), None, &mut v) };
        (r == 0 && v.CStatus <= 1).then(|| unsafe { v.Anonymous.doubleValue })
    }

    /// Every instance of a wildcard counter as (instance name, value).
    pub fn array(&self, counter: isize) -> Vec<(String, f64)> {
        for _ in 0..4 {
            let (mut size, mut count) = (0u32, 0u32);
            let r = unsafe { PdhGetFormattedCounterArrayW(counter, fmt(), &mut size, &mut count, None) };
            if r != PDH_MORE_DATA {
                return Vec::new();
            }
            // u64 storage keeps the item array correctly aligned.
            let mut buf = vec![0u64; (size as usize).div_ceil(8) + 1];
            let ptr = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            let r = unsafe { PdhGetFormattedCounterArrayW(counter, fmt(), &mut size, &mut count, Some(ptr)) };
            if r == PDH_MORE_DATA {
                continue; // an instance appeared between the two calls
            }
            if r != 0 {
                return Vec::new();
            }
            let items = unsafe { std::slice::from_raw_parts(ptr, count as usize) };
            return items
                .iter()
                .filter(|it| it.FmtValue.CStatus <= 1)
                .map(|it| unsafe { (it.szName.to_string().unwrap_or_default(), it.FmtValue.Anonymous.doubleValue) })
                .collect();
        }
        Vec::new()
    }
}

impl Drop for Pdh {
    fn drop(&mut self) {
        unsafe { PdhCloseQuery(self.query) };
    }
}

fn fmt() -> PDH_FMT {
    // PDH_FMT_NOCAP100: rates above 100 are kept (they are clamped later where it matters).
    PDH_FMT(PDH_FMT_DOUBLE.0 | 0x8000)
}

#[derive(Clone)]
pub struct Adapter {
    pub name: String,
    pub luid: String,
    pub vram_total: u64,
}

pub fn adapters() -> Vec<Adapter> {
    let mut out = Vec::new();
    let Ok(factory) = (unsafe { CreateDXGIFactory1::<IDXGIFactory1>() }) else { return out };
    let mut i = 0;
    while let Ok(a) = unsafe { factory.EnumAdapters1(i) } {
        i += 1;
        let Ok(d) = (unsafe { a.GetDesc1() }) else { continue };
        // Skip software adapters (Microsoft Basic Render Driver).
        if d.Flags & 2 != 0 || d.VendorId == 0x1414 {
            continue;
        }
        let len = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
        let name = String::from_utf16_lossy(&d.Description[..len]).trim().to_string();
        let luid = format!("0x{:08x}_0x{:08x}", d.AdapterLuid.HighPart as u32, d.AdapterLuid.LowPart);
        if out.iter().any(|x: &Adapter| x.luid == luid) {
            continue;
        }
        out.push(Adapter { name, luid, vram_total: d.DedicatedVideoMemory as u64 });
    }
    out
}

/// Pulls "luid_0x..._0x..." out of a PDH instance name.
fn luid_of(inst: &str) -> Option<String> {
    let i = inst.find("luid_")? + 5;
    let mut parts = inst[i..].split('_');
    Some(format!("{}_{}", parts.next()?, parts.next()?).to_ascii_lowercase())
}

fn pid_of(inst: &str) -> Option<u32> {
    inst.strip_prefix("pid_")?.split('_').next()?.parse().ok()
}

fn engine_of(inst: &str) -> String {
    let t = inst.rsplit_once("engtype_").map(|x| x.1).unwrap_or("");
    let t = t.trim_end_matches(|c: char| c.is_ascii_digit() || c == '_');
    if t.is_empty() { "Outro".into() } else { t.into() }
}

#[derive(Default, Clone)]
pub struct NvStats {
    pub temp: Option<u32>,
    pub power: Option<f32>,
    pub power_limit: Option<f32>,
    pub clock: Option<u32>,
    pub mem_clock: Option<u32>,
    pub fan: Option<u32>,
}

pub struct GpuReader {
    pdh: Option<Pdh>,
    engine: Option<isize>,
    adapter_mem: Option<isize>,
    proc_mem: Option<isize>,
    pub adapters: Vec<Adapter>,
    nvml: Option<Nvml>,
    nv_index: HashMap<String, u32>,
}

pub struct GpuSample {
    /// Per adapter LUID: (utilisation %, VRAM used, engines sorted by load).
    pub per_adapter: HashMap<String, (f32, u64, Vec<(String, f32)>)>,
    /// Per PID: (utilisation %, VRAM used).
    pub per_pid: HashMap<u32, (f32, u64)>,
}

impl GpuReader {
    pub fn new() -> Self {
        let pdh = Pdh::new();
        let (engine, adapter_mem, proc_mem) = match &pdh {
            Some(p) => (
                p.add(r"\GPU Engine(*)\Utilization Percentage"),
                p.add(r"\GPU Adapter Memory(*)\Dedicated Usage"),
                p.add(r"\GPU Process Memory(*)\Dedicated Usage"),
            ),
            None => (None, None, None),
        };
        if let Some(p) = &pdh {
            p.collect();
        }
        // DXGI also lists virtual copies of the same card (other LUIDs, no counters).
        // Keep the adapters Windows actually measures, one per name.
        let mut adapters = adapters();
        if let (Some(p), Some(c)) = (&pdh, adapter_mem) {
            let measured: Vec<String> = p.array(c).iter().filter_map(|(i, _)| luid_of(i)).collect();
            if !measured.is_empty() {
                adapters.retain(|a| measured.contains(&a.luid));
            }
        }
        let mut seen = std::collections::HashSet::new();
        adapters.retain(|a| seen.insert(a.name.clone()));
        let nvml = Nvml::init().ok();
        let mut nv_index = HashMap::new();
        if let Some(n) = &nvml {
            for i in 0..n.device_count().unwrap_or(0) {
                if let Ok(name) = n.device_by_index(i).and_then(|d| d.name()) {
                    nv_index.insert(name.to_ascii_lowercase(), i);
                }
            }
        }
        Self { pdh, engine, adapter_mem, proc_mem, adapters, nvml, nv_index }
    }

    pub fn sample(&self) -> GpuSample {
        let mut per_adapter = HashMap::new();
        let mut per_pid: HashMap<u32, (f32, u64)> = HashMap::new();
        let Some(pdh) = &self.pdh else { return GpuSample { per_adapter, per_pid } };
        pdh.collect();

        let mut by_luid_eng: HashMap<(String, String), f64> = HashMap::new();
        let mut by_pid_eng: HashMap<(u32, String), f64> = HashMap::new();
        if let Some(c) = self.engine {
            for (inst, v) in pdh.array(c) {
                if v <= 0.0 {
                    continue;
                }
                let eng = engine_of(&inst);
                if let Some(l) = luid_of(&inst) {
                    *by_luid_eng.entry((l, eng.clone())).or_default() += v;
                }
                if let Some(pid) = pid_of(&inst) {
                    *by_pid_eng.entry((pid, eng)).or_default() += v;
                }
            }
        }
        // Utilisation is the busiest engine, like Task Manager.
        for ((pid, _), v) in by_pid_eng {
            let e = per_pid.entry(pid).or_default();
            e.0 = e.0.max(v.min(100.0) as f32);
        }
        let mut vram_by_luid: HashMap<String, u64> = HashMap::new();
        if let Some(c) = self.adapter_mem {
            for (inst, v) in pdh.array(c) {
                if let Some(l) = luid_of(&inst) {
                    *vram_by_luid.entry(l).or_default() += v as u64;
                }
            }
        }
        if let Some(c) = self.proc_mem {
            for (inst, v) in pdh.array(c) {
                if let Some(pid) = pid_of(&inst) {
                    per_pid.entry(pid).or_default().1 += v as u64;
                }
            }
        }
        for a in &self.adapters {
            let mut engines: Vec<(String, f32)> = by_luid_eng
                .iter()
                .filter(|((l, _), _)| *l == a.luid)
                .map(|((_, e), v)| (e.clone(), v.min(100.0) as f32))
                .collect();
            engines.sort_by(|x, y| y.1.total_cmp(&x.1));
            let usage = engines.first().map(|x| x.1).unwrap_or(0.0);
            per_adapter.insert(a.luid.clone(), (usage, vram_by_luid.get(&a.luid).copied().unwrap_or(0), engines));
        }
        GpuSample { per_adapter, per_pid }
    }

    pub fn nv(&self, adapter_name: &str) -> NvStats {
        let Some(n) = &self.nvml else { return NvStats::default() };
        let key = adapter_name.to_ascii_lowercase();
        let idx = self
            .nv_index
            .get(&key)
            .or_else(|| self.nv_index.iter().find(|(k, _)| key.contains(k.as_str()) || k.contains(&key)).map(|x| x.1));
        let Some(&idx) = idx else { return NvStats::default() };
        let Ok(d) = n.device_by_index(idx) else { return NvStats::default() };
        NvStats {
            temp: d.temperature(TemperatureSensor::Gpu).ok(),
            power: d.power_usage().ok().map(|mw| mw as f32 / 1000.0),
            power_limit: d.enforced_power_limit().ok().map(|mw| mw as f32 / 1000.0),
            clock: d.clock_info(Clock::Graphics).ok(),
            mem_clock: d.clock_info(Clock::Memory).ok(),
            fan: d.fan_speed(0).ok(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_engine_instance() {
        let i = "pid_1234_luid_0x00000000_0x0000D1F5_phys_0_eng_0_engtype_3D";
        assert_eq!(pid_of(i), Some(1234));
        assert_eq!(luid_of(i).as_deref(), Some("0x00000000_0x0000d1f5"));
        assert_eq!(engine_of(i), "3D");
        assert_eq!(engine_of("pid_1_luid_0x0_0x1_phys_0_eng_5_engtype_VideoDecode"), "VideoDecode");
        assert_eq!(luid_of("luid_0x00000000_0x0000D1F5_phys_0").as_deref(), Some("0x00000000_0x0000d1f5"));
    }
}

#[cfg(test)]
mod live {
    use super::*;

    #[test]
    #[ignore]
    fn dump() {
        let p = Pdh::new().unwrap();
        let c = p.add(r"\GPU Adapter Memory(*)\Dedicated Usage");
        println!("counter {:?}", c);
        p.collect();
        let c = c.unwrap();
        let (mut size, mut count) = (0u32, 0u32);
        let r = unsafe { PdhGetFormattedCounterArrayW(c, fmt(), &mut size, &mut count, None) };
        println!("first call r={r:#x} size={size} count={count}");
        println!("array {:?}", p.array(c));
        for a in adapters() { println!("adapter {} {}", a.name, a.luid); }
    }
}
