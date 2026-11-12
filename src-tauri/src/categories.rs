//! Groups processes into categories ("Unreal Engine", "Navegadores", ...).
//!
//! A pattern containing a slash is matched as a substring of the executable path
//! (`\engine\binaries\` catches every Unreal tool). Any other pattern is a glob on the
//! executable name, with or without ".exe" (`unreal*`, `chrome`).

use serde::{Deserialize, Serialize};

pub const SYSTEM: &str = "system";
pub const OTHER: &str = "other";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub patterns: Vec<String>,
}

fn cat(id: &str, name: &str, color: &str, icon: &str, patterns: &[&str]) -> Category {
    Category {
        id: id.into(),
        name: name.into(),
        color: color.into(),
        icon: icon.into(),
        patterns: patterns.iter().map(|s| s.to_string()).collect(),
    }
}

pub fn defaults() -> Vec<Category> {
    vec![
        cat("unreal", "Unreal Engine", "#a78bfa", "unreal", &[
            "unreal*", "ue4editor*", "ue5editor*", "shadercompileworker*", "crashreportclient*",
            "livecodingconsole*", "zenserver*", "zen", "unrealtraceserver*", "unrealbuildtool*", "unrealpak*",
            r"\engine\binaries\", r"\epic games\ue_",
        ]),
        cat("unity", "Unity", "#e5e7eb", "unity", &["unity*", r"\unity\hub\editor\"]),
        cat("godot", "Godot", "#60a5fa", "godot", &["godot*"]),
        cat("blender", "Blender", "#fb923c", "blender", &["blender*"]),
        cat("design", "Design & Criação", "#ff375f", "palette", &[
            "figma*", "aseprite", "affinity*", "krita", "gimp*", "inkscape", "ableton*", "audacity", "fl64", "reaper",
            "resolve", "capcut", "handbrake", "insta360*", "quick-look", "clipchamp", "substance*", "zbrush", "houdini*", "maya", "3dsmax",
        ]),
        cat("adobe", "Adobe", "#f87171", "adobe", &[
            r"\adobe\", "photoshop", "afterfx", "adobe premiere pro", "illustrator", "creative cloud*", "adobe*",
            "ccxprocess", "coresync", "ccLibrary",
        ]),
        cat("ai", "IA & Assistentes", "#fbbf24", "ai", &["claude", "chatgpt", "ollama*", "lm studio", "codex*", "copilot*"]),
        cat("dev", "Desenvolvimento", "#34d399", "dev", &[
            "code", "cursor", "windsurf", "zed", "devenv", "msbuild", "servicehub*", "rider*", "idea*",
            "node", "cargo", "rustc", "rust-analyzer", "python*", "git", "git-*", "dotnet", "vctip", "cl", "link",
            "windowsterminal", "openconsole", "wsl*", "vmmem*", "docker*", "com.docker.*", "perfwatson2",
            r"\microsoft visual studio\", r"\nodejs\", "android studio*", "studio64", "fork", "github*", "gitkraken",
        ]),
        cat("browsers", "Navegadores", "#38bdf8", "browser", &[
            "chrome", "msedge", "firefox", "brave", "opera*", "vivaldi", "arc", "zen browser", "librewolf",
        ]),
        cat("productivity", "Produtividade", "#ffd60a", "shapes", &[
            "notion*", "obsidian", "everything*", "googledrivefs", "onedrive*", "dropbox*", "p4v", "p4merge", "p4admin", "p4d",
            "1password*", "todo", "outlook", "olk", "winword", "excel", "powerpnt", "onenote*", "snippingtool",
        ]),
        cat("comms", "Comunicação", "#818cf8", "chat", &[
            "discord*", "slack", "teams", "ms-teams", "whatsapp*", "telegram", "zoom", "signal", "phoneexperiencehost", "crossdeviceservice",
        ]),
        cat("media", "Mídia & Streaming", "#f472b6", "media", &["spotify", "vlc", "obs64", "obs*", "streamlabs*", "mpc-hc*", "potplayer*", "fxsound", "wallpaper32", "wallpaper64", r"\wallpaper_engine\"]),
        cat("launchers", "Lojas de jogos", "#94a3b8", "store", &[
            "steam", "steamwebhelper", "steamservice", "epicgameslauncher", "epicwebhelper", "battle.net*",
            "eadesktop", "eabackgroundservice", "galaxyclient*", "riotclient*", "ubisoftconnect", "upc",
        ]),
        cat("games", "Jogos", "#4ade80", "game", &[r"\steamapps\common\", r"\epic games\", r"\xboxgames\", r"\riot games\", r"\gog galaxy\games\"]),
        cat("drivers", "Drivers & Utilitários", "#a3a3a3", "chip", &[
            "nvcontainer", "nvdisplay.container", "nvidia*", "nvsphelper*", "nvbroadcast*", "amd*", "radeon*",
            "lghub*", "icue*", "razer*", "armourycrate*", "msiafterburner", "rtss", "rtsshooks*", "corsair*",
            "kmonitor", "streamdeck", "qtwebengineprocess", r"\elgato\", "ddm", r"\dell\", "msi center", r"\asus\", "joytokey",
        ]),
        cat(SYSTEM, "Windows", "#64748b", "windows", &[r"\windows\"]),
    ]
}

/// System processes that report no executable path.
const SYSTEM_NAMES: &[&str] = &[
    "system", "registry", "memory compression", "secure system", "smss", "csrss", "wininit", "services",
    "lsass", "svchost", "fontdrvhost", "lsaiso", "vmcompute", "msmpeng", "nissrv", "securityhealthservice",
];

/// Helpers that belong to whatever started them (a WebView2 inside the Unreal launcher
/// counts as Unreal, a console window under Cargo counts as development).
pub const INHERIT: &[&str] = &["msedgewebview2", "conhost", "cmd", "powershell", "pwsh", "crashpad_handler", "werfault"];

pub fn glob(pat: &str, s: &str) -> bool {
    let (p, s): (Vec<char>, Vec<char>) = (pat.chars().collect(), s.chars().collect());
    let (mut pi, mut si, mut star, mut mark) = (0, 0, None, 0);
    while si < s.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == s[si]) {
            pi += 1;
            si += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            pi += 1;
            mark = si;
        } else if let Some(st) = star {
            pi = st + 1;
            mark += 1;
            si = mark;
        } else {
            return false;
        }
    }
    while pi < p.len() && p[pi] == '*' {
        pi += 1;
    }
    pi == p.len()
}

/// `name` is the lower-case executable name without ".exe"; `path` the lower-case full path.
pub fn classify(cats: &[Category], name: &str, path: &str) -> String {
    let path = path.replace('/', "\\");
    for c in cats {
        for p in &c.patterns {
            let p = p.to_ascii_lowercase().replace('/', "\\");
            let hit = if p.contains('\\') {
                !path.is_empty() && path.contains(&p)
            } else {
                let p = p.trim_end_matches(".exe");
                glob(p, name)
            };
            if hit {
                return c.id.clone();
            }
        }
    }
    if path.is_empty() && SYSTEM_NAMES.contains(&name) {
        return SYSTEM.into();
    }
    OTHER.into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn globbing() {
        assert!(glob("unreal*", "unrealeditor"));
        assert!(glob("unreal*", "unreal"));
        assert!(!glob("unreal*", "xunreal"));
        assert!(glob("a?c", "abc"));
        assert!(glob("*web*", "steamwebhelper"));
    }

    #[test]
    fn unreal_tools_group_together() {
        let c = defaults();
        assert_eq!(classify(&c, "unrealeditor", r"c:\program files\epic games\ue_5.4\engine\binaries\win64\unrealeditor.exe"), "unreal");
        assert_eq!(classify(&c, "shadercompileworker", ""), "unreal");
        assert_eq!(classify(&c, "dotnet", r"d:\ue\engine\binaries\thirdparty\dotnet\8.0\win-x64\dotnet.exe"), "unreal");
        assert_eq!(classify(&c, "chrome", r"c:\program files\google\chrome\application\chrome.exe"), "browsers");
        assert_eq!(classify(&c, "svchost", r"c:\windows\system32\svchost.exe"), "system");
        assert_eq!(classify(&c, "csrss", ""), "system");
        assert_eq!(classify(&c, "figma", r"c:\users\x\appdata\local\figma\figma.exe"), "design");
        assert_eq!(classify(&c, "servicehub.indexingservice", r"c:\program files\microsoft visual studio\2022\x.exe"), "dev");
        assert_eq!(classify(&c, "whatever", r"c:\tools\whatever.exe"), "other");
    }
}
