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

/// Only local programs (the Stream Deck plugin, kMonitor itself) may call the API.
/// - Host must be this machine: blocks DNS rebinding, where a website points its own
///   domain at 127.0.0.1 to read the answer.
/// - Browsers mark their requests with Origin or Sec-Fetch-Site/Dest headers; refusing those
///   stops any web page from reading stats or opening kMonitor's windows. (Node's fetch, used
///   by the plugin, sends Sec-Fetch-Mode too, so that one is allowed.)
fn trusted(req: &str) -> bool {
    let mut host_ok = false;
    for line in req.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else { continue };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim().to_ascii_lowercase();
        if name == "origin" || name == "sec-fetch-site" || name == "sec-fetch-dest" {
            return false;
        }
        if name == "host" {
            host_ok = value == format!("127.0.0.1:{PORT}") || value == format!("localhost:{PORT}");
        }
    }
    host_ok
}

fn handle(mut s: TcpStream, shared: &Shared, app: &AppHandle) {
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let mut buf = [0u8; 1024];
    let n = s.read(&mut buf).unwrap_or(0);
    let req = String::from_utf8_lossy(&buf[..n]);
    let path = req.split_whitespace().nth(1).unwrap_or("");
    let (status, body) = if !trusted(&req) {
        ("403 Forbidden", json!({ "error": "forbidden" }).to_string())
    } else if path == "/v1/stats" && !shared.settings.lock().api_enabled {
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

#[cfg(test)]
mod tests {
    use super::trusted;

    #[test]
    fn only_local_programs_are_trusted() {
        assert!(trusted("GET /v1/stats HTTP/1.1\r\nHost: 127.0.0.1:47615\r\nConnection: close\r\n\r\n"));
        assert!(trusted("GET /v1/stats HTTP/1.1\r\nhost: localhost:47615\r\n\r\n"));
        // The Stream Deck plugin: Node's fetch adds Sec-Fetch-Mode on its own.
        assert!(trusted("GET /v1/stats HTTP/1.1\r\nhost: 127.0.0.1:47615\r\nsec-fetch-mode: cors\r\nuser-agent: node\r\n\r\n"));
        // DNS rebinding: a website's domain resolved to 127.0.0.1.
        assert!(!trusted("GET /v1/stats HTTP/1.1\r\nHost: evil.example:47615\r\n\r\n"));
        // Any browser request.
        assert!(!trusted("GET /v1/open HTTP/1.1\r\nHost: 127.0.0.1:47615\r\nSec-Fetch-Site: cross-site\r\n\r\n"));
        assert!(!trusted("GET /v1/stats HTTP/1.1\r\nHost: 127.0.0.1:47615\r\nOrigin: https://evil.example\r\n\r\n"));
        assert!(!trusted("GET /v1/stats HTTP/1.1\r\n\r\n"));
    }
}
