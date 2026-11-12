use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::categories::{self, Category};
use crate::monitor::{HistPoint, Snapshot};
use crate::state::{Settings, Shared};
use crate::energy::Bucket;
use crate::{cputemp, elevate, shell, specs};

type S<'a> = State<'a, Arc<Shared>>;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Initial {
    snapshot: Option<Snapshot>,
    history: Vec<HistPoint>,
    settings: Settings,
    categories: Vec<Category>,
    autostart: bool,
    api_port: u16,
    /// Running as administrator (CPU sensors available).
    elevated: bool,
    /// The elevated logon task exists.
    admin_mode: bool,
    pawnio: bool,
}

#[tauri::command]
pub fn initial(app: AppHandle, s: S) -> Initial {
    s.wake();
    Initial {
        snapshot: s.last.lock().clone(),
        history: s.history.lock().iter().copied().collect(),
        settings: s.settings.lock().clone(),
        categories: s.categories.lock().clone(),
        autostart: if elevate::task_exists() { elevate::task_enabled() } else { app.autolaunch().is_enabled().unwrap_or(false) },
        api_port: crate::server::PORT,
        elevated: elevate::is_elevated(),
        admin_mode: elevate::task_exists(),
        pawnio: cputemp::installed(),
    }
}

#[tauri::command]
pub fn set_settings(app: AppHandle, s: S, settings: Settings) {
    let (pinned_changed, lang_changed) = {
        let old = s.settings.lock();
        (old.mini_pinned != settings.mini_pinned, old.language != settings.language)
    };
    let _ = app.emit("settings", &settings);
    *s.settings.lock() = settings;
    if lang_changed {
        shell::refresh_tray_menu(&app);
    }
    s.save_settings();
    s.wake();
    if pinned_changed {
        shell::apply_pin(&app);
    }
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, on: bool) -> Result<(), String> {
    // In admin mode the logon task is what starts kMonitor.
    if elevate::task_exists() {
        return if elevate::set_task_enabled(on) { Ok(()) } else { Err("não consegui mudar a tarefa agendada".into()) };
    }
    let a = app.autolaunch();
    if on { a.enable() } else { a.disable() }.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_categories(s: S, categories: Vec<Category>) {
    *s.categories.lock() = categories;
    s.save_categories();
}

#[tauri::command]
pub fn reset_categories(s: S) -> Vec<Category> {
    let d = categories::defaults();
    *s.categories.lock() = d.clone();
    s.save_categories();
    d
}

/// Moves every process with this executable name into a category.
#[tauri::command]
pub fn assign_process(s: S, name: String, category: String) -> Vec<Category> {
    let name = name.to_ascii_lowercase();
    {
        let mut cats = s.categories.lock();
        for c in cats.iter_mut() {
            c.patterns.retain(|p| p.to_ascii_lowercase() != name);
        }
        // Explicit assignments go first so they beat broader patterns in other categories.
        if let Some(i) = cats.iter().position(|c| c.id == category) {
            let mut c = cats.remove(i);
            c.patterns.insert(0, name);
            cats.insert(0, c);
        }
    }
    s.save_categories();
    s.categories.lock().clone()
}

#[tauri::command]
pub fn end_processes(pids: Vec<u32>) -> usize {
    pids.iter()
        .filter(|pid| {
            Command::new("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .creation_flags(0x0800_0000)
                .status()
                .map(|st| st.success())
                .unwrap_or(false)
        })
        .count()
}

#[tauri::command]
pub fn reveal(path: String) {
    let _ = Command::new("explorer").arg(format!("/select,{path}")).spawn();
}

#[tauri::command]
pub async fn hardware_specs(s: S<'_>, force: bool) -> Result<serde_json::Value, String> {
    let dir = s.dir.clone();
    tauri::async_runtime::spawn_blocking(move || specs::get(&dir, force)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn open_main(app: AppHandle) {
    shell::show_main(&app);
}

#[tauri::command]
pub fn show_mini(app: AppHandle) {
    if let Some(w) = app.get_webview_window("mini") {
        if !w.is_visible().unwrap_or(false) {
            shell::toggle_mini(&app);
        }
    }
}

#[tauri::command]
pub fn hide_mini(app: AppHandle) {
    if let Some(w) = app.get_webview_window("mini") {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn open_logs() {
    let dir = dirs::document_dir().unwrap_or_else(std::env::temp_dir).join("kMonitor");
    let _ = std::fs::create_dir_all(&dir);
    let _ = Command::new("explorer").arg(dir).spawn();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyReport {
    days: Vec<(String, Bucket)>,
    hours: Vec<(String, Bucket)>,
    /// Category id -> Wh, for this month and for today.
    month_categories: std::collections::BTreeMap<String, f64>,
    today_categories: std::collections::BTreeMap<String, f64>,
}

#[tauri::command]
pub fn energy_report(s: S) -> EnergyReport {
    let e = s.energy.lock();
    let now = chrono::Local::now();
    EnergyReport {
        days: e.days(),
        hours: e.hours(),
        month_categories: e.categories(&now.format("%Y-%m").to_string()),
        today_categories: e.categories(&now.format("%Y-%m-%d").to_string()),
    }
}

/// Turns on CPU temperature: needs PawnIO installed and kMonitor running as administrator.
#[tauri::command]
pub fn enable_cpu_sensors(app: AppHandle, s: S) -> Result<(), String> {
    if !cputemp::installed() {
        return Err("nodriver".into());
    }
    s.energy.lock().save();
    // The logon task replaces the normal autostart entry.
    let _ = app.autolaunch().disable();
    elevate::enable_admin_mode()
}

#[tauri::command]
pub fn disable_admin_mode(app: AppHandle) -> bool {
    let ok = elevate::disable_admin_mode();
    if ok {
        let _ = app.autolaunch().enable();
    }
    ok
}

#[tauri::command]
pub fn open_url(url: String) {
    if url.starts_with("https://") {
        let _ = Command::new("explorer").arg(url).spawn();
    }
}

/// Exports the energy history to CSV in Documents\kMonitor and shows the folder.
#[tauri::command]
pub fn export_energy(s: S) -> Result<String, String> {
    let price = s.settings.lock().price_per_kwh();
    let mut names: std::collections::BTreeMap<String, String> =
        s.categories.lock().iter().map(|c| (c.id.clone(), c.name.clone())).collect();
    names.insert(crate::energy::BASE.into(), "Base do PC".into());
    names.insert(crate::categories::OTHER.into(), "Outros apps".into());
    let dir = dirs::document_dir().unwrap_or_else(std::env::temp_dir).join("kMonitor");
    let mut e = s.energy.lock();
    e.save();
    let out = e.export_csv(&dir, price, &names).map_err(|e| e.to_string())?;
    let _ = Command::new("explorer").arg(format!("/select,{}", out.join("consumo-por-dia.csv").to_string_lossy().replace('/', "\\"))).spawn();
    Ok(out.to_string_lossy().into_owned())
}

/// Saves a PNG (the shareable specs card) to Documents\kMonitor and shows it in Explorer.
#[tauri::command]
pub fn save_png(bytes: Vec<u8>, name: String) -> Result<String, String> {
    if !bytes.starts_with(b"\x89PNG") {
        return Err("imagem inválida".into());
    }
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let dir = dirs::document_dir().unwrap_or_else(std::env::temp_dir).join("kMonitor");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.png", if safe.is_empty() { "specs" } else { &safe }));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    let _ = Command::new("explorer").arg(format!("/select,{}", path.to_string_lossy())).spawn();
    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn quit(app: AppHandle, s: S) {
    s.energy.lock().save();
    app.exit(0);
}
