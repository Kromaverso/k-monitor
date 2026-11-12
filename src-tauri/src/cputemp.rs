//! CPU temperature on AMD Ryzen (Zen 1 to Zen 5) through the PawnIO driver.
//!
//! Windows gives no CPU temperature to normal programs. PawnIO (pawnio.eu) is a signed
//! kernel driver that runs small signed modules; its official `AMDFamily17` module exposes
//! `ioctl_read_smn`, which reads the SMU registers holding Tctl and the per-CCD sensors.
//! This is the same route LibreHardwareMonitor takes. kMonitor talks to the driver directly
//! (\\Device\\PawnIO); only SYSTEM and administrators may open it.

use serde::Serialize;
use windows::core::w;
use windows::Win32::Foundation::{CloseHandle, ERROR_ACCESS_DENIED, GENERIC_READ, GENERIC_WRITE, HANDLE, WAIT_ABANDONED, WAIT_OBJECT_0};
use windows::Win32::Storage::FileSystem::{CreateFileW, FILE_FLAGS_AND_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING};
use windows::Win32::System::Threading::{CreateMutexW, ReleaseMutex, WaitForSingleObject};
use windows::Win32::System::IO::DeviceIoControl;

static MODULE: &[u8] = include_bytes!("../pawnio/AMDFamily17.bin");

const THM_TCON_CUR_TMP: u64 = 0x0005_9800;
const TEMP_OFFSET_FLAG: u32 = 0x8_0000;
/// Zen 4 / Zen 5 per-CCD temperature registers.
const CCD_TEMP_ZEN4: u64 = 0x0005_9b08;
/// Zen 2 / Zen 3 per-CCD temperature registers.
const CCD_TEMP_ZEN2: u64 = 0x0005_9954;
const MSR_RAPL_PWR_UNIT: u64 = 0xC001_0299;
const MSR_PKG_ENERGY_STAT: u64 = 0xC001_029B;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Reading fine.
    Ok,
    /// PawnIO is not installed.
    #[default]
    NoDriver,
    /// PawnIO is installed but kMonitor is not running as administrator.
    NeedsAdmin,
    /// Not an AMD Zen CPU, or the module refused to load.
    Unsupported,
}

const DEVICE: windows::core::PCWSTR = w!("\\\\?\\GLOBALROOT\\Device\\PawnIO");
// CTL_CODE(0xA1B2, fn, METHOD_BUFFERED, FILE_ANY_ACCESS), from PawnIO's pawnio_um.h.
const IOCTL_PIO_LOAD_BINARY: u32 = 0xA1B2_2084;
const IOCTL_PIO_EXECUTE_FN: u32 = 0xA1B2_2104;
const FN_NAME_LENGTH: usize = 32;

pub struct Reader {
    device: HANDLE,
    pci_mutex: HANDLE,
    family: u32,
    model: u32,
    energy_unit: Option<f64>,
    last_energy: Option<(u32, std::time::Instant)>,
}

unsafe impl Send for Reader {}

/// (family, model) from CPUID, or None for non-AMD CPUs.
fn amd_family() -> Option<(u32, u32)> {
    use std::arch::x86_64::__cpuid;
    let v = __cpuid(0);
    let vendor = [v.ebx.to_le_bytes(), v.edx.to_le_bytes(), v.ecx.to_le_bytes()].concat();
    if vendor != b"AuthenticAMD" {
        return None;
    }
    let l1 = __cpuid(1).eax;
    let base = (l1 >> 8) & 0xf;
    let family = if base == 0xf { base + ((l1 >> 20) & 0xff) } else { base };
    let model = ((l1 >> 4) & 0xf) | (((l1 >> 16) & 0xf) << 4);
    Some((family, model))
}

fn open_device() -> Result<HANDLE, Status> {
    unsafe {
        CreateFileW(DEVICE, (GENERIC_READ | GENERIC_WRITE).0, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, None, OPEN_EXISTING, FILE_FLAGS_AND_ATTRIBUTES(0), None)
            .map_err(|e| if e.code() == ERROR_ACCESS_DENIED.to_hresult() { Status::NeedsAdmin } else { Status::NoDriver })
    }
}

/// True when the PawnIO driver is present (whether or not we may open it).
pub fn installed() -> bool {
    match open_device() {
        Ok(h) => {
            unsafe { let _ = CloseHandle(h); }
            true
        }
        Err(st) => st == Status::NeedsAdmin,
    }
}

fn ioctl(device: HANDLE, code: u32, input: &[u8], output: &mut [u8]) -> Option<usize> {
    let mut returned = 0u32;
    unsafe {
        DeviceIoControl(
            device,
            code,
            Some(input.as_ptr() as *const _),
            input.len() as u32,
            if output.is_empty() { None } else { Some(output.as_mut_ptr() as *mut _) },
            output.len() as u32,
            Some(&mut returned),
            None,
        )
        .ok()?;
    }
    Some(returned as usize)
}

impl Reader {
    pub fn open() -> Result<Self, Status> {
        let Some((family, model)) = amd_family() else { return Err(Status::Unsupported) };
        if !(0x17..=0x1a).contains(&family) {
            return Err(Status::Unsupported);
        }
        let device = open_device()?;
        if ioctl(device, IOCTL_PIO_LOAD_BINARY, MODULE, &mut []).is_none() {
            unsafe { let _ = CloseHandle(device); }
            return Err(Status::Unsupported);
        }
        // Shared with HWiNFO, LibreHardwareMonitor and others so SMN index/data writes don't interleave.
        let pci_mutex = unsafe { CreateMutexW(None, false, w!("Global\\Access_PCI")) }.unwrap_or_default();
        let mut r = Self { device, pci_mutex, family, model, energy_unit: None, last_energy: None };
        // RAPL energy unit: joules = counter / 2^ESU.
        r.energy_unit = r.read_msr(MSR_RAPL_PWR_UNIT).map(|v| 1.0 / f64::from(1u32 << ((v >> 8) & 0x1f)));
        Ok(r)
    }

    /// Runs a function of the loaded module: input is a 32-byte name followed by u64 arguments.
    fn exec(&self, name: &str, arg: u64) -> Option<u64> {
        let mut input = [0u8; FN_NAME_LENGTH + 8];
        input[..name.len()].copy_from_slice(name.as_bytes());
        input[FN_NAME_LENGTH..].copy_from_slice(&arg.to_le_bytes());
        let mut out = [0u8; 8];
        let n = ioctl(self.device, IOCTL_PIO_EXECUTE_FN, &input, &mut out)?;
        (n >= 8).then(|| u64::from_le_bytes(out))
    }

    fn read_msr(&self, msr: u64) -> Option<u64> {
        self.exec("ioctl_read_msr", msr)
    }

    /// CPU package power in watts, from the RAPL energy counter (needs two calls).
    pub fn package_power(&mut self) -> Option<f32> {
        let unit = self.energy_unit?;
        let now = std::time::Instant::now();
        let e = self.read_msr(MSR_PKG_ENERGY_STAT)? as u32;
        let prev = self.last_energy.replace((e, now));
        let (pe, pt) = prev?;
        let dt = now.duration_since(pt).as_secs_f64();
        if dt < 0.1 {
            return None;
        }
        let joules = e.wrapping_sub(pe) as f64 * unit;
        let w = joules / dt;
        (0.0..1000.0).contains(&w).then_some(w as f32)
    }

    fn read_smn(&self, addr: u64) -> Option<u32> {
        let locked = !self.pci_mutex.is_invalid() && {
            let r = unsafe { WaitForSingleObject(self.pci_mutex, 50) };
            r == WAIT_OBJECT_0 || r == WAIT_ABANDONED
        };
        let v = self.exec("ioctl_read_smn", addr);
        if locked {
            unsafe { let _ = ReleaseMutex(self.pci_mutex); }
        }
        v.map(|x| x as u32)
    }

    /// Tctl/Tdie in °C.
    pub fn tctl(&self) -> Option<f32> {
        let v = self.read_smn(THM_TCON_CUR_TMP)?;
        let mut t = ((v >> 21) & 0x7ff) as f32 / 8.0;
        if v & TEMP_OFFSET_FLAG != 0 {
            t -= 49.0;
        }
        (t > 0.0 && t < 125.0).then_some(t)
    }

    /// Temperature of each populated CCD (core complex die) in °C.
    pub fn ccds(&self) -> Vec<f32> {
        let base = if self.family >= 0x1a || (self.family == 0x19 && self.model >= 0x60) { CCD_TEMP_ZEN4 } else { CCD_TEMP_ZEN2 };
        (0..8u64)
            .filter_map(|i| {
                let v = self.read_smn(base + i * 4)?;
                // Bit 11 marks a valid reading; absent CCDs read as zero.
                (v & 0x800 != 0).then(|| (v & 0x7ff) as f32 / 8.0 - 49.0)
            })
            .filter(|t| *t > 0.0 && *t < 125.0)
            .collect()
    }
}

impl Drop for Reader {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.device);
            if !self.pci_mutex.is_invalid() {
                let _ = CloseHandle(self.pci_mutex);
            }
        }
    }
}

