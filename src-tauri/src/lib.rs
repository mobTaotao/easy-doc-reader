use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};

const MARKDOWN_EXTS: [&str; 5] = ["md", "markdown", "mdown", "mkd", "txt"];
const MAX_FILE_SIZE: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MdFile {
    pub path: String,
    pub name: String,
    pub content: String,
    pub mtime: u64,
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MARKDOWN_EXTS.iter().any(|known| known.eq_ignore_ascii_case(ext)))
        .unwrap_or(false)
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let dir = PathBuf::from(&path);
    let read = fs::read_dir(&dir).map_err(|err| format!("无法读取目录：{err}"))?;

    let mut entries: Vec<DirEntryInfo> = Vec::new();
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let full_path = item.path();
        let meta = match item.metadata() {
            Ok(meta) => meta,
            Err(_) => continue,
        };

        if meta.is_dir() {
            entries.push(DirEntryInfo {
                name,
                path: full_path.to_string_lossy().to_string(),
                is_dir: true,
            });
        } else if meta.is_file() && is_markdown(&full_path) {
            entries.push(DirEntryInfo {
                name,
                path: full_path.to_string_lossy().to_string(),
                is_dir: false,
            });
        }
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(entries)
}

#[tauri::command]
fn read_markdown(path: String) -> Result<MdFile, String> {
    let file_path = PathBuf::from(&path);
    let meta = fs::metadata(&file_path).map_err(|err| format!("无法读取文件：{err}"))?;

    if meta.len() > MAX_FILE_SIZE {
        return Err("文件超过 8 MB，暂不支持预览".into());
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|_| "读取失败：请确认文件为 UTF-8 编码".to_string())?;

    let name = file_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    Ok(MdFile {
        path,
        name,
        content,
        mtime: modified_ms(&meta),
    })
}

#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let meta = fs::metadata(&path).map_err(|err| err.to_string())?;
    Ok(modified_ms(&meta))
}

/// 保存 Markdown：原子写入（临时文件 + rename），可选 mtime 冲突检测。
/// 冲突时返回 `CONFLICT:<当前 mtime>`，前端据此弹窗让用户选择是否覆盖。
#[tauri::command]
fn write_markdown(path: String, content: String, expected_mtime: Option<u64>) -> Result<u64, String> {
    let file_path = PathBuf::from(&path);

    if content.len() as u64 > MAX_FILE_SIZE {
        return Err("内容超过 8 MB，暂不支持保存".into());
    }

    if let Some(expected) = expected_mtime {
        let current = fs::metadata(&file_path)
            .map(|meta| modified_ms(&meta))
            .map_err(|_| "CONFLICT:0".to_string())?;
        if current != expected {
            return Err(format!("CONFLICT:{current}"));
        }
    }

    let tmp = file_path.with_extension("md.tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|err| format!("无法写入文件：{err}"))?;
    if file_path.exists() {
        fs::remove_file(&file_path).map_err(|err| format!("保存失败：{err}"))?;
    }
    fs::rename(&tmp, &file_path).map_err(|err| {
        let _ = fs::remove_file(&tmp);
        format!("保存失败：{err}")
    })?;

    let meta = fs::metadata(&file_path).map_err(|err| err.to_string())?;
    Ok(modified_ms(&meta))
}

/// 在目录下创建"未命名.md"，自动避免重名，返回新文件完整路径。
#[tauri::command]
fn create_markdown(dir: String) -> Result<String, String> {
    let folder = PathBuf::from(&dir);
    if !folder.is_dir() {
        return Err(format!("目录不存在：{dir}"));
    }

    let mut index: u32 = 1;
    loop {
        let name = if index == 1 {
            "未命名.md".to_string()
        } else {
            format!("未命名-{index}.md")
        };
        let target = folder.join(&name);
        if !target.exists() {
            fs::write(&target, "# 未命名\n\n").map_err(|err| format!("创建失败：{err}"))?;
            return Ok(target.to_string_lossy().to_string());
        }
        index += 1;
        if index > 999 {
            return Err("无法创建更多文件".into());
        }
    }
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    let allowed = ["http://", "https://", "mailto:"]
        .iter()
        .any(|prefix| url.starts_with(prefix));
    if !allowed {
        return Err("不支持的链接协议".into());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|err| err.to_string())?;
    }

    Ok(())
}

/// 从命令行参数中取出第一个可打开的 Markdown 文件（绝对路径）
fn pick_markdown_arg(args: &[String]) -> Option<String> {
    for arg in args.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = Path::new(arg);
        if path.is_file() && is_markdown(path) {
            return Some(
                path.canonicalize()
                    .unwrap_or_else(|_| path.to_path_buf())
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    None
}

/// 启动参数中的待打开文件（窗口尚未创建时先暂存）
struct PendingLaunch(Mutex<Option<String>>);

fn focus_and_notify(app: &AppHandle, path: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    let _ = app.emit("open-file", path.to_string());
}

#[tauri::command]
fn take_pending_launch(state: tauri::State<PendingLaunch>) -> Option<String> {
    state.0.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let launch_arg = pick_markdown_arg(&std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(path) = pick_markdown_arg(&argv) {
                focus_and_notify(app, &path);
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_markdown,
            file_mtime,
            open_external,
            take_pending_launch,
            write_markdown,
            create_markdown
        ])
        .setup(move |app| {
            app.manage(PendingLaunch(Mutex::new(launch_arg)));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_markdown_roundtrip_and_conflict() {
        let dir = temp_dir("mdreader-write");
        let file = dir.join("t.md");
        fs::write(&file, "old").unwrap();
        let path = file.to_string_lossy().to_string();

        let mtime = write_markdown(path.clone(), "new content".into(), None).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "new content");
        assert!(mtime > 0);
        assert!(!dir.join("t.md.tmp").exists(), "临时文件应被清理");

        let err = write_markdown(path.clone(), "x".into(), Some(mtime + 999_999)).unwrap_err();
        assert!(err.starts_with("CONFLICT"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn create_markdown_avoids_duplicate() {
        let dir = temp_dir("mdreader-create");
        let a = create_markdown(dir.to_string_lossy().to_string()).unwrap();
        let b = create_markdown(dir.to_string_lossy().to_string()).unwrap();
        assert_ne!(a, b);
        assert!(Path::new(&a).is_file() && Path::new(&b).is_file());
        let _ = fs::remove_dir_all(&dir);
    }
}
