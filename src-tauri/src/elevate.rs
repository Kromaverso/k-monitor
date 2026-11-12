//! Running kMonitor as administrator, which PawnIO (CPU temperature and power) requires.
//!
//! Instead of a UAC prompt on every start, kMonitor registers a scheduled task "kMonitor"
//! that runs it with highest privileges at logon. Creating the task asks for UAC once.

use std::os::windows::process::CommandExt;
use std::process::Command;

use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

pub const TASK: &str = "kMonitor";
const NO_WINDOW: u32 = 0x0800_0000;

pub fn is_elevated() -> bool {
    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut e = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenElevation, Some(&mut e as *mut _ as *mut _), std::mem::size_of::<TOKEN_ELEVATION>() as u32, &mut len).is_ok();
        let _ = CloseHandle(token);
        ok && e.TokenIsElevated != 0
    }
}

pub fn task_exists() -> bool {
    Command::new("schtasks")
        .args(["/Query", "/TN", TASK])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Starts the elevated instance through the task (no UAC prompt).
pub fn run_task() -> bool {
    Command::new("schtasks")
        .args(["/Run", "/TN", TASK])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn set_task_enabled(on: bool) -> bool {
    Command::new("schtasks")
        .args(["/Change", "/TN", TASK, if on { "/ENABLE" } else { "/DISABLE" }])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn task_enabled() -> bool {
    Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &format!("(Get-ScheduledTask -TaskName '{TASK}').State")])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| !String::from_utf8_lossy(&o.stdout).contains("Disabled") && o.status.success())
        .unwrap_or(false)
}

fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Asks for UAC once: registers the logon task, closes this (non-elevated) instance and
/// starts kMonitor elevated. Returns an error if the prompt could not be shown.
pub fn enable_admin_mode() -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe = exe.to_string_lossy().to_string();
    let user = format!("{}\\{}", std::env::var("USERDOMAIN").unwrap_or_default(), std::env::var("USERNAME").unwrap_or_default());
    let pid = std::process::id();
    let script = format!(
        "Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue; \
         $a = New-ScheduledTaskAction -Execute {exe} -Argument '--tray'; \
         $t = New-ScheduledTaskTrigger -AtLogOn -User {user}; \
         $p = New-ScheduledTaskPrincipal -UserId {user} -LogonType Interactive -RunLevel Highest; \
         $s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew; \
         Register-ScheduledTask -TaskName '{TASK}' -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null; \
         Start-Process {exe}",
        exe = ps_quote(&exe),
        user = ps_quote(&user),
    );
    // The outer PowerShell only shows the UAC prompt; the inner one does the work elevated.
    let outer = format!(
        "Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',{}",
        ps_quote(&script)
    );
    Command::new("powershell.exe")
        .args(["-NoProfile", "-Command", &outer])
        .creation_flags(NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Removes the task (we are elevated at this point) so kMonitor goes back to normal mode.
pub fn disable_admin_mode() -> bool {
    Command::new("schtasks")
        .args(["/Delete", "/TN", TASK, "/F"])
        .creation_flags(NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}
