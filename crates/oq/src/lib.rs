//! Filesystem and command-line adapter for the reusable oq engine.
use std::ffi::OsString;
use std::io::Write;
use std::path::Path;

const HELP: &str = include_str!("help.txt");

/// Run a CLI invocation without exiting the host process.
pub fn run(mut args: Vec<OsString>, out: &mut impl Write) -> Result<u8, String> {
    if args.len() == 1 && ["--help", "-h"].contains(&args[0].to_string_lossy().as_ref()) {
        out.write_all(HELP.as_bytes()).map_err(|e| e.to_string())?;
        return Ok(0);
    }
    if args.len() == 1 && args[0] == "--version" {
        writeln!(out, "oq {}", env!("CARGO_PKG_VERSION")).map_err(|e| e.to_string())?;
        return Ok(0);
    }
    if args.is_empty() {
        return Err(HELP.into());
    }
    let command = args[0].to_string_lossy().into_owned();
    if command == "validate" {
        args.remove(0);
        let flag = args
            .iter()
            .position(|a| a == "--schema")
            .ok_or("validate requires --schema <schema.toml>")?;
        if flag + 1 >= args.len() {
            return Err("missing schema path".into());
        }
        let schema_path = args.remove(flag + 1);
        args.remove(flag);
        if args.len() != 1 {
            return Err("validate requires exactly one Org file".into());
        }
        let source = std::fs::read_to_string(&args[0])
            .map_err(|e| format!("{}: {e}", args[0].to_string_lossy()))?;
        let schema = std::fs::read_to_string(&schema_path)
            .map_err(|e| format!("{}: {e}", schema_path.to_string_lossy()))?;
        let result = oq_core::validate(&source, &schema).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut *out, &result).map_err(|e| e.to_string())?;
        writeln!(out).map_err(|e| e.to_string())?;
        return Ok(u8::from(!result.is_valid()));
    }
    let in_place = command == "set" && args.iter().skip(1).any(|a| a == "-i" || a == "--in-place");
    if command == "set" {
        args.retain(|a| a != "-i" && a != "--in-place");
    }
    if command == "set" || command == "query" {
        args.remove(0);
    }
    if args.len() != 2 {
        return Err(HELP.into());
    }
    let expression = args[0].to_str().ok_or("expression is not UTF-8")?;
    let path = Path::new(&args[1]);
    let source = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if command == "set" {
        let replacement = oq_core::set(&source, expression).map_err(|e| e.to_string())?;
        if in_place {
            replace_file(path, &source, &replacement)?;
        } else {
            out.write_all(replacement.as_bytes())
                .map_err(|e| e.to_string())?;
        }
    } else {
        for value in oq_core::query(&source, expression).map_err(|e| e.to_string())? {
            serde_json::to_writer(&mut *out, &value).map_err(|e| e.to_string())?;
            writeln!(out).map_err(|e| e.to_string())?;
        }
    }
    Ok(0)
}

/// Atomically replace an unchanged regular file, retaining its permissions.
pub fn replace_file(path: &Path, expected: &str, replacement: &str) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("in-place editing requires a regular, non-symlink file".into());
    }
    if metadata.permissions().readonly() {
        return Err("in-place editing refuses a read-only file".into());
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temporary
        .write_all(replacement.as_bytes())
        .map_err(|e| e.to_string())?;
    temporary
        .as_file()
        .set_permissions(metadata.permissions())
        .map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    if std::fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
        || std::fs::read_to_string(path).map_err(|e| e.to_string())? != expected
    {
        return Err("file changed while preparing the edit".into());
    }
    temporary.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
