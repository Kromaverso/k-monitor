//! Tiny local HTTP endpoint (127.0.0.1 only) that the kMonitor Stream Deck plugin reads.
//! GET /v1/stats -> totals for CPU, GPU and memory plus a short history.

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use serde_json::json;

use tauri::AppHandle;

use crate::state::Shared;

pub const PORT: u16 = 47615;

fn stats(shared: &Shared) -> serde_json::Value {
    let last = shared.last.lock().clone().unwrap_or_default();
    let g = last.gpus.iter().max_by(|a, b| a.vram_total.cmp(&b.vram_total)).cloned().unwrap_or_default();
    let hist: Vec<_> = shared.history.lock().iter().rev().take(40).rev().copied().collect();
    json!({
        "app": "kMonitor",
        "t": last.t,
        "cpu": { "name": last.cpu.name, "usage": last.cpu.usage, "temp": last.cpu.temp, "power": last.cpu.power, "mhz": last.cpu.mhz },
        "power": { "wall": last.power.wall, "cpu": last.power.cpu, "gpu": last.power.gpu },
        "gpu": {
            "name": g.name, "usage": g.usage, "temp": g.temp, "power": g.power, "powerLimit": g.power_limit,
            "clock": g.clock, "fan": g.fan, "vramUsed": g.vram_used, "vramTotal": g.vram_total
        },
        "mem": { "used": last.mem.used, "total": last.mem.total },
        "history": {
            "cpu": hist.iter().map(|p| p.cpu).collect::<Vec<_>>(),
            "gpu": hist.iter().map(|p| p.gpu).collect::<Vec<_>>(),
            "mem": hist.iter().map(|p| p.mem).collect::<Vec<_>>(),
            "cpuTemp": hist.iter().map(|p| p.cpu_temp).collect::<Vec<_>>(),
            "gpuTemp": hist.iter().map(|p| p.gpu_temp).collect::<Vec<_>>(),
        }
    })
}

fn handle(mut s: TcpStream, shared: &Shared, app: &AppHandle) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 1024];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req.split_whitespace().nth(1).unwrap_or("");
    let (status, body) = if path == "/v1/stats" && !shared.settings.lock().api_enabled {
        ("503 Service Unavailable", json!({ "error": "API desativada no kMonitor" }).to_string())
    } else if path == "/v1/stats" {
        ("200 OK", stats(shared).to_string())
    } else if path == "/v1/open" || path == "/v1/mini" {
        let app = app.clone();
        let mini = path == "/v1/mini";
        let _ = app.clone().run_on_main_thread(move || {
            if mini { crate::shell::toggle_mini(&app) } else { crate::shell::show_main(&app) }
        });
        ("200 OK", json!({ "ok": true }).to_string())
    } else {
        ("404 Not Found", json!({ "error": "not found" }).to_string())
    };
    let _ = write!(
        s,
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

pub fn spawn(shared: Arc<Shared>, app: AppHandle) {
    std::thread::Builder::new()
        .name("api".into())
        .spawn(move || {
            let Ok(listener) = TcpListener::bind(("127.0.0.1", PORT)) else { return };
            for s in listener.incoming().flatten() {
                handle(s, &shared, &app);
            }
        })
        .expect("api thread");
}
