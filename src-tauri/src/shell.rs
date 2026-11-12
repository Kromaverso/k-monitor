//! Main window, the mini flyout and the tray icon.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, PhysicalPosition, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

use crate::state::Shared;

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
    app.state::<Arc<Shared>>().wake();
}

/// Places the mini window: where the user left it when pinned, otherwise above the tray
/// in the bottom-right corner of the work area, like a Windows 11 flyout.
fn place_mini(app: &AppHandle, w: &tauri::WebviewWindow) {
    let shared = app.state::<Arc<Shared>>();
    let s = shared.settings.lock().clone();
    if s.mini_pinned {
        if let Some((x, y)) = s.mini_pos {
            let _ = w.set_position(PhysicalPosition::new(x, y));
            return;
        }
    }
    let Ok(Some(m)) = w.primary_monitor() else { return };
    let wa = m.work_area();
    let Ok(size) = w.outer_size() else { return };
    let margin = (12.0 * m.scale_factor()) as i32;
    let x = wa.position.x + wa.size.width as i32 - size.width as i32 - margin;
    let y = wa.position.y + wa.size.height as i32 - size.height as i32 - margin;
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

pub fn toggle_mini(app: &AppHandle) {
    let Some(w) = app.get_webview_window("mini") else { return };
    let shared = app.state::<Arc<Shared>>();
    // A click on the tray steals focus first, which already hid the flyout: don't reopen it.
    let just_hidden = shared.mini_hidden_at.lock().map(|t| t.elapsed() < Duration::from_millis(350)).unwrap_or(false);
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    if just_hidden {
        return;
    }
    place_mini(app, &w);
    let _ = w.show();
    let _ = w.set_focus();
    shared.wake();
}

pub fn apply_pin(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("mini") {
        let pinned = app.state::<Arc<Shared>>().settings.lock().mini_pinned;
        let _ = w.set_always_on_top(true);
        if !pinned {
            place_mini(app, &w);
        }
    }
}

pub fn on_window_event(w: &tauri::Window, e: &WindowEvent) {
    let app = w.app_handle();
    let shared = app.state::<Arc<Shared>>();
    match (w.label(), e) {
        // Closing the main window keeps kMonitor running in the tray.
        ("main", WindowEvent::CloseRequested { api, .. }) => {
            api.prevent_close();
            let _ = w.hide();
        }
        ("mini", WindowEvent::Focused(false)) => {
            if !shared.settings.lock().mini_pinned {
                let _ = w.hide();
                *shared.mini_hidden_at.lock() = Some(Instant::now());
            }
        }
        ("mini", WindowEvent::Moved(p)) => {
            let mut s = shared.settings.lock();
            if s.mini_pinned && w.is_visible().unwrap_or(false) {
                s.mini_pos = Some((p.x, p.y));
                drop(s);
                shared.save_settings();
            }
        }
        _ => {}
    }
}

/// Tray menu labels: (open, mini, autostart, quit).
fn tray_labels(lang: &str) -> [&'static str; 4] {
    match lang {
        "en" => ["Open kMonitor", "Mini monitor", "Start with Windows", "Quit kMonitor"],
        "es" => ["Abrir kMonitor", "Mini monitor", "Iniciar con Windows", "Salir de kMonitor"],
        _ => ["Abrir kMonitor", "Mini monitor", "Iniciar com o Windows", "Sair do kMonitor"],
    }
}

fn tray_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let lang = app.state::<Arc<Shared>>().settings.lock().lang();
    let [open, mini, auto, quit] = tray_labels(lang);
    let open = MenuItemBuilder::with_id("open", open).build(app)?;
    let mini = MenuItemBuilder::with_id("mini", mini).build(app)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let on = if crate::elevate::task_exists() { crate::elevate::task_enabled() } else { app.autolaunch().is_enabled().unwrap_or(false) };
    let auto = CheckMenuItemBuilder::with_id("autostart", auto).checked(on).build(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItemBuilder::with_id("quit", quit).build(app)?;
    MenuBuilder::new(app).items(&[&open, &mini, &sep, &auto, &sep2, &quit]).build()
}

pub fn refresh_tray_menu(app: &AppHandle) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("tray"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let menu = tray_menu(app)?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().cloned().expect("icon"))
        .tooltip("kMonitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "open" => show_main(app),
            "mini" => toggle_mini(app),
            "autostart" => {
                // In admin mode the logon task starts kMonitor; otherwise the Run entry does.
                if crate::elevate::task_exists() {
                    let on = crate::elevate::task_enabled();
                    crate::elevate::set_task_enabled(!on);
                } else {
                    let a = app.autolaunch();
                    let on = a.is_enabled().unwrap_or(false);
                    let _ = if on { a.disable() } else { a.enable() };
                }
                refresh_tray_menu(app);
            }
            "quit" => {
                app.state::<Arc<Shared>>().energy.lock().save();
                app.exit(0)
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| match ev {
            TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } => {
                toggle_mini(tray.app_handle())
            }
            TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => show_main(tray.app_handle()),
            _ => {}
        })
        .build(app)?;
    Ok(())
}
