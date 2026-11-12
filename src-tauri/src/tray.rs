//! Live tray icon: two bars (CPU and GPU) or the load as a number, drawn into a 32x32 RGBA buffer.

use parking_lot::Mutex;
use tauri::image::Image;
use tauri::AppHandle;

use crate::monitor::Snapshot;

const S: usize = 32;
const CPU: [u8; 3] = [0x64, 0xd2, 0xff];
const GPU: [u8; 3] = [0x30, 0xd1, 0x58];
const WARN: [u8; 3] = [0xff, 0x9f, 0x0a];
const HOT: [u8; 3] = [0xff, 0x45, 0x3a];

static LAST: Mutex<(String, u32)> = Mutex::new((String::new(), u32::MAX));

/// 3x5 digits, one row per u8 (bits 2..0 = left..right).
const DIGITS: [[u8; 5]; 10] = [
    [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
    [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
];

fn px(buf: &mut [u8], x: usize, y: usize, c: [u8; 3], a: u8) {
    if x < S && y < S {
        let i = (y * S + x) * 4;
        buf[i..i + 4].copy_from_slice(&[c[0], c[1], c[2], a]);
    }
}

fn rounded_bar(buf: &mut [u8], x0: usize, w: usize, fill: f32, c: [u8; 3]) {
    let h = S - 2;
    let filled = ((fill.clamp(0.0, 100.0) / 100.0) * h as f32).round() as usize;
    for y in 1..S - 1 {
        for x in x0..x0 + w {
            // Trim the corners for a rounded look.
            let edge = x == x0 || x == x0 + w - 1;
            if edge && (y == 1 || y == S - 2) {
                continue;
            }
            let from_bottom = S - 1 - y;
            if from_bottom <= filled {
                px(buf, x, y, c, 255);
            } else {
                px(buf, x, y, [255, 255, 255], 60);
            }
        }
    }
}

fn load_color(v: f32, base: [u8; 3]) -> [u8; 3] {
    if v >= 90.0 { HOT } else if v >= 75.0 { WARN } else { base }
}

fn draw_number(buf: &mut [u8], v: f32, base: [u8; 3]) {
    let n = (v.round() as u32).min(99);
    let c = load_color(v, base);
    // Each digit cell is 5px wide x 6px tall: 15x30 per digit, 2px gap.
    let digits = [n / 10, n % 10];
    for (i, d) in digits.iter().enumerate() {
        let ox = i * 17;
        for (row, bits) in DIGITS[*d as usize].iter().enumerate() {
            for col in 0..3 {
                if bits & (4 >> col) != 0 {
                    for dy in 0..6 {
                        for dx in 0..5 {
                            px(buf, ox + col * 5 + dx, 1 + row * 6 + dy, c, 255);
                        }
                    }
                }
            }
        }
    }
}

pub fn render(style: &str, cpu: f32, gpu: f32) -> Vec<u8> {
    let mut buf = vec![0u8; S * S * 4];
    match style {
        "cpu" => draw_number(&mut buf, cpu, [255, 255, 255]),
        "gpu" => draw_number(&mut buf, gpu, [255, 255, 255]),
        _ => {
            rounded_bar(&mut buf, 2, 12, cpu, load_color(cpu, CPU));
            rounded_bar(&mut buf, 18, 12, gpu, load_color(gpu, GPU));
        }
    }
    buf
}

pub fn update(app: &AppHandle, s: &Snapshot, style: &str) {
    let gpu = s.gpus.iter().max_by(|a, b| a.vram_total.cmp(&b.vram_total));
    let g = gpu.map(|g| g.usage).unwrap_or(0.0);
    let Some(tray) = app.tray_by_id("tray") else { return };

    let mut tip = format!("kMonitor\nCPU {:.0}%", s.cpu.usage);
    if let Some(t) = s.cpu.temp {
        tip += &format!(" · {t:.0}°C");
    }
    if let Some(gp) = gpu {
        tip += &format!("\nGPU {:.0}%", gp.usage);
        if let Some(t) = gp.temp {
            tip += &format!(" · {t}°C");
        }
    }
    if s.mem.total > 0 {
        tip += &format!("\nRAM {:.0}%", s.mem.used as f64 * 100.0 / s.mem.total as f64);
    }
    let _ = tray.set_tooltip(Some(&tip));

    // Only redraw when what is drawn actually changes.
    let key = (s.cpu.usage.round() as u32) << 8 | g.round() as u32;
    let mut last = LAST.lock();
    if last.0 == style && last.1 == key {
        return;
    }
    *last = (style.to_string(), key);
    let _ = tray.set_icon(Some(Image::new_owned(render(style, s.cpu.usage, g), S as u32, S as u32)));
}
