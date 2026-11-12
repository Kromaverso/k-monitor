#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod categories;
mod commands;
mod cputemp;
mod elevate;
mod energy;
mod gpu;
mod monitor;
mod server;
mod specs;
mod state;
mod tray;
mod shell;

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;

/// If kMonitor already runs (possibly elevated, where the single-instance message can't
/// reach it), ask it to show itself over the local API. Returns true if it answered.
fn focus_running_instance() -> bool {
    use std::io::{Read, Write};
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], server::PORT));
    let Ok(mut s) = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(300)) else { return false };
    let _ = s.set_read_timeout(Some(std::time::Duration::from_millis(800)));
    if s.write_all(b"GET /v1/open HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut buf = [0u8; 256];
    let n = s.read(&mut buf).unwrap_or(0);
    String::from_utf8_lossy(&buf[..n]).starts_with("HTTP/1.1 200")
}

fn main() {
    use commands::*;
    if focus_running_instance() {
        return;
    }
    // Admin mode: a normal start (Start menu, Stream Deck) hands over to the elevated task.
    if !elevate::is_elevated() && elevate::task_exists() && elevate::run_task() {
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| shell::show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--tray"])))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            specs::refresh_in_background(dir.clone());
            let shared = Arc::new(state::Shared::load(dir));
            app.manage(shared.clone());

            let handle = app.handle().clone();
            shell::build_tray(&handle)?;
            monitor::spawn(handle.clone(), shared.clone());
            server::spawn(shared, handle.clone());

            // Started with Windows: stay in the tray.
            if !std::env::args().any(|a| a == "--tray") {
                shell::show_main(&handle);
            }
            Ok(())
        })
        .on_window_event(shell::on_window_event)
        .invoke_handler(tauri::generate_handler![
            initial, set_settings, set_autostart, save_categories, reset_categories, assign_process,
            end_processes, reveal, hardware_specs, open_main, show_mini, hide_mini, open_logs, quit,
            energy_report, export_energy, save_png, enable_cpu_sensors, disable_admin_mode, open_url
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o kMonitor");
}
