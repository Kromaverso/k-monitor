//! Static hardware inventory (CPU, board, RAM sticks, GPUs, disks, displays, OS).
//! Read through WMI via a hidden PowerShell (slow: several seconds), so the result is
//! kept in specs.json and refreshed in the background each time kMonitor starts.

use std::os::windows::process::CommandExt;
use std::process::Command;

use parking_lot::Mutex;

static CACHE: Mutex<Option<serde_json::Value>> = Mutex::new(None);

const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
$bb = Get-CimInstance Win32_BaseBoard
$bios = Get-CimInstance Win32_BIOS
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$gpuReg = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' |
  Where-Object { $_.DriverDesc } | Select-Object DriverDesc, @{n='Vram';e={ [uint64]$_.'HardwareInformation.qwMemorySize' }}
[pscustomobject]@{
  computer = [pscustomobject]@{ name = $env:COMPUTERNAME; maker = $cs.Manufacturer; model = $cs.Model }
  os = [pscustomobject]@{
    name = $os.Caption; version = $cv.DisplayVersion; build = "$($os.BuildNumber).$($cv.UBR)"; arch = $os.OSArchitecture
    installed = $os.InstallDate.ToString('yyyy-MM-dd'); boot = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm')
  }
  cpu = [pscustomobject]@{
    name = $p.Name.Trim(); maker = $p.Manufacturer; cores = $p.NumberOfCores; threads = $p.NumberOfLogicalProcessors
    maxMhz = $p.MaxClockSpeed; l2Kb = $p.L2CacheSize; l3Kb = $p.L3CacheSize; socket = $p.SocketDesignation
    virtualization = $p.VirtualizationFirmwareEnabled; id = $p.ProcessorId
  }
  board = [pscustomobject]@{
    maker = $bb.Manufacturer; product = $bb.Product; version = $bb.Version
    bios = "$($bios.Manufacturer) $($bios.SMBIOSBIOSVersion)"; biosDate = $bios.ReleaseDate.ToString('yyyy-MM-dd')
  }
  ram = @(Get-CimInstance Win32_PhysicalMemory | ForEach-Object { [pscustomobject]@{
    slot = $_.DeviceLocator; bank = $_.BankLabel; maker = $_.Manufacturer; part = "$($_.PartNumber)".Trim()
    bytes = [uint64]$_.Capacity; mhz = $_.Speed; configuredMhz = $_.ConfiguredClockSpeed; volts = $_.ConfiguredVoltage; type = $_.SMBIOSMemoryType
  } })
  ramSlots = (Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object -Property MemoryDevices -Sum).Sum
  gpus = @(Get-CimInstance Win32_VideoController | Where-Object { $_.PNPDeviceID -like 'PCI*' } | ForEach-Object {
    $n = $_.Name
    [pscustomobject]@{
      name = $n; maker = $_.AdapterCompatibility; driver = $_.DriverVersion; driverDate = $_.DriverDate.ToString('yyyy-MM-dd')
      vram = ($gpuReg | Where-Object { $_.DriverDesc -eq $n } | Select-Object -First 1).Vram
      mode = "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution) @ $($_.CurrentRefreshRate) Hz"
    } })
  disks = @(Get-PhysicalDisk | ForEach-Object { [pscustomobject]@{
    name = $_.FriendlyName; media = "$($_.MediaType)"; bus = "$($_.BusType)"; bytes = [uint64]$_.Size; health = "$($_.HealthStatus)"
  } })
  volumes = @(Get-Volume | Where-Object { $_.DriveLetter } | Sort-Object DriveLetter | ForEach-Object { [pscustomobject]@{
    letter = "$($_.DriveLetter):"; label = $_.FileSystemLabel; fs = $_.FileSystem; bytes = [uint64]$_.Size; free = [uint64]$_.SizeRemaining
  } })
  displays = @(Get-CimInstance -Namespace root\wmi WmiMonitorID | ForEach-Object {
    [pscustomobject]@{
      name = (($_.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '')
      maker = (($_.ManufacturerName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '')
      year = $_.YearOfManufacture
    } })
  network = @(Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{
    name = $_.Name; desc = $_.InterfaceDescription; speed = $_.LinkSpeed
  } })
} | ConvertTo-Json -Depth 4 -Compress
"#;

fn cache_file(dir: &std::path::Path) -> std::path::PathBuf {
    dir.join("specs.json")
}

pub fn get(dir: &std::path::Path, force: bool) -> Result<serde_json::Value, String> {
    if !force {
        if let Some(v) = CACHE.lock().clone() {
            return Ok(v);
        }
        let saved = std::fs::read_to_string(cache_file(dir)).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
        if let Some(v) = saved {
            *CACHE.lock() = Some(v.clone());
            return Ok(v);
        }
    }
    let out = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("não consegui ler as specs: {e}"))?;
    let text = String::from_utf8_lossy(&out.stdout);
    let v: serde_json::Value =
        serde_json::from_str(text.trim()).map_err(|e| format!("resposta inválida do WMI: {e}"))?;
    *CACHE.lock() = Some(v.clone());
    let _ = std::fs::write(cache_file(dir), v.to_string());
    Ok(v)
}

/// Re-reads the inventory a little after startup so "Meu PC" opens instantly and stays current.
pub fn refresh_in_background(dir: std::path::PathBuf) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(8));
        let _ = get(&dir, true);
    });
}
