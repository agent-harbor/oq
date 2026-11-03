//! Invokes the real binary against temporary files; no mocked filesystem or CLI.
use serde_json::{Value, json};
use std::fs;
use std::io::Write;
use std::process::{Command, Output};
use tempfile::tempdir;
fn cli(args: &[&str]) -> Output {
    let output = Command::new(env!("CARGO_BIN_EXE_oq"))
        .args(args)
        .output()
        .unwrap();
    let logs = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.result/logs");
    fs::create_dir_all(&logs).unwrap();
    let (mut log, path) = tempfile::Builder::new()
        .prefix("cli-")
        .suffix(".log")
        .tempfile_in(logs)
        .unwrap()
        .keep()
        .unwrap();
    writeln!(log, "argv: {args:?}\nstatus: {}\nstdout:", output.status).unwrap();
    log.write_all(&output.stdout).unwrap();
    writeln!(log, "\nstderr:").unwrap();
    log.write_all(&output.stderr).unwrap();
    log.flush().unwrap();
    // Cargo captures this on success and shows the full set of subprocess log
    // paths when any assertion in the containing test fails.
    println!(
        "subprocess log: {} ({} bytes)",
        path.display(),
        log.metadata().unwrap().len()
    );
    output
}
#[test]
fn cli_queries_and_atomic_edits_retain_permissions_and_reject_errors() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("notes.org");
    let path = file.to_str().unwrap();
    let original = "* Notes\n:PROPERTIES:\n:state: old\n:END:\nUntouched 雪.\n";
    fs::write(&file, original).unwrap();
    let permission = fs::metadata(&file).unwrap().permissions();
    let result = cli(&["query", ".sections.Notes.properties.state", path]);
    assert!(result.status.success());
    assert_eq!(result.stdout, b"\"old\"\n");
    let result = cli(&[
        "set",
        "-i",
        r#".children[0].properties.state = "new""#,
        path,
    ]);
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(result.stdout.is_empty());
    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        original.replace(":state: old", ":state: new")
    );
    assert_eq!(fs::metadata(&file).unwrap().permissions(), permission);
    let snapshot = fs::read(&file).unwrap();
    for expr in [".[", r#".children=[]"#, "halt"] {
        let result = cli(&["set", "-i", expr, path]);
        assert_eq!(result.status.code(), Some(2));
        assert!(!result.stderr.is_empty());
        assert_eq!(fs::read(&file).unwrap(), snapshot);
    }
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[test]
fn cli_schema_exit_codes_real_files_and_usage_failures() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("notes.org");
    let schema = dir.path().join("schema.toml");
    fs::write(&file, "* Notes\n").unwrap();
    fs::write(&schema,"version=1\n[[rules]]\nid='title'\nassert='.title != null'\nmessage='Missing title'\nline='1'").unwrap();
    let args = [
        "validate",
        "--schema",
        schema.to_str().unwrap(),
        file.to_str().unwrap(),
    ];
    let result = cli(&args);
    assert_eq!(result.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(
        report["diagnostics"],
        json!([{"rule_id":"title","severity":"error","line":1,"message":"Missing title"}])
    );
    fs::write(
        &schema,
        fs::read_to_string(&schema).unwrap() + "\nseverity='warning'",
    )
    .unwrap();
    assert_eq!(cli(&args).status.code(), Some(0));
    fs::write(&schema, "invalid = ]").unwrap();
    assert_eq!(cli(&args).status.code(), Some(2));
    assert_eq!(
        cli(&["query", ".", "does-not-exist.org"]).status.code(),
        Some(2)
    );
    assert_eq!(cli(&["validate"]).status.code(), Some(2));
    assert_eq!(cli(&["--help"]).status.code(), Some(0));
}
#[cfg(unix)]
#[test]
fn cli_in_place_refuses_symlinks_and_changed_snapshots() {
    let dir = tempdir().unwrap();
    let file = dir.path().join("source.org");
    let link = dir.path().join("link.org");
    fs::write(&file, "* A\n").unwrap();
    std::os::unix::fs::symlink(&file, &link).unwrap();
    let result = cli(&[
        "set",
        "-i",
        r#".children[0].title="B""#,
        link.to_str().unwrap(),
    ]);
    assert_eq!(result.status.code(), Some(2));
    assert!(link.is_symlink());
    assert_eq!(fs::read_to_string(&file).unwrap(), "* A\n");
    assert!(oq::replace_file(&file, "* old\n", "* changed\n").is_err());
    assert_eq!(fs::read_to_string(&file).unwrap(), "* A\n");
}
