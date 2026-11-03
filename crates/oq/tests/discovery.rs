//! Execute the actual discovery examples with the compiled CLI and real files.
//! The shell function only selects that executable; it does not mock commands.
use serde_json::{Value, json};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::tempdir;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(path: &str) -> String {
    fs::read_to_string(root().join(path))
        .unwrap()
        .replace("\r\n", "\n")
}

fn logged(name: &str, command: &mut Command) -> Output {
    let output = command.output().unwrap();
    let logs = root().join(".result/logs");
    fs::create_dir_all(&logs).unwrap();
    let (mut log, path) = tempfile::Builder::new()
        .prefix(&format!("discovery-{name}-"))
        .suffix(".log")
        .tempfile_in(logs)
        .unwrap()
        .keep()
        .unwrap();
    writeln!(
        log,
        "command: {command:?}\nstatus: {}\nstdout:",
        output.status
    )
    .unwrap();
    log.write_all(&output.stdout).unwrap();
    writeln!(log, "\nstderr:").unwrap();
    log.write_all(&output.stderr).unwrap();
    log.flush().unwrap();
    println!(
        "discovery subprocess: {} ({} bytes)",
        path.display(),
        log.metadata().unwrap().len()
    );
    output
}

fn cli(name: &str, directory: &Path, args: &[&str]) -> Output {
    logged(
        name,
        Command::new(env!("CARGO_BIN_EXE_oq"))
            .current_dir(directory)
            .args(args),
    )
}

fn cases(document: &str) -> Vec<(String, String)> {
    let mut rest = document;
    let mut result = Vec::new();
    while let Some((_, tail)) = rest.split_once("<!-- oq:case:") {
        let (name, tail) = tail.split_once(" -->").expect("unclosed case marker");
        let (_, tail) = tail
            .split_once("```sh\n")
            .expect("case needs an executable shell block");
        let (script, tail) = tail.split_once("\n```").expect("unclosed shell block");
        result.push((name.into(), script.into()));
        rest = tail;
    }
    result
}

fn report(output: &Output, code: i32, severity: Option<&str>) {
    assert_eq!(
        output.status.code(),
        Some(code),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let stdout = std::str::from_utf8(&output.stdout).unwrap();
    assert_eq!(
        stdout.lines().count(),
        1,
        "validate must emit exactly one JSON report"
    );
    let expected = match severity {
        None => json!({"mode":null,"diagnostics":[]}),
        Some(severity) => {
            json!({"mode":null,"diagnostics":[{"rule_id":"note.state","severity":severity,"line":3,"message":"State must be ready"}]})
        }
    };
    assert_eq!(serde_json::from_str::<Value>(stdout).unwrap(), expected);
}

#[test]
fn discovery_compiled_help_and_generated_surfaces_stay_synchronised() {
    let directory = tempdir().unwrap();
    let help = cli("help", directory.path(), &["--help"]);
    assert!(help.status.success());
    assert!(help.stderr.is_empty());
    let actual = String::from_utf8(help.stdout)
        .unwrap()
        .replace("\r\n", "\n");
    assert_eq!(actual, read("crates/oq/src/help.txt"));
    let short_help = cli("short-help", directory.path(), &["-h"]);
    assert!(short_help.status.success());
    assert_eq!(
        String::from_utf8(short_help.stdout)
            .unwrap()
            .replace("\r\n", "\n"),
        actual
    );
    let version = cli("version", directory.path(), &["--version"]);
    assert!(version.status.success());
    assert_eq!(
        String::from_utf8(version.stdout).unwrap(),
        format!("oq {}\n", env!("CARGO_PKG_VERSION"))
    );
    for flag in ["--help", "-h", "--version", "-i", "--in-place", "--schema"] {
        assert!(actual.contains(flag), "missing {flag}");
    }
    for path in ["README.md", "llms-full.txt"] {
        let document = read(path);
        assert!(
            document.contains(&format!("```text\n{actual}```")),
            "{path} differs from compiled help"
        );
    }
    let short = read("llms.txt");
    assert!(
        short.len() < 2500,
        "conservative byte budget keeps the file below 2500 tokens"
    );
    assert!(short.starts_with("# oq\n> "));
    for path in [
        "docs/index.md",
        "docs/contract.md",
        "docs/contributors/README.md",
        "docs/fragments/validation-example.md",
        "AGENTS.md",
        "README.md",
        "llms-full.txt",
    ] {
        assert!(
            short.contains(path),
            "missing annotated documentation link {path}"
        );
    }
}

#[test]
fn discovery_all_published_schema_workflows_execute_real_rejection_twins() {
    let expected_names = ["valid", "rejected", "warning", "malformed", "usage"];
    for surface in ["README.md", "llms.txt", "llms-full.txt"] {
        let blocks = cases(&read(surface));
        assert_eq!(
            blocks
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            expected_names,
            "{surface}"
        );
        let directory = tempdir().unwrap();
        for (name, script) in blocks {
            let script = format!(
                "oq_discovery_binary=$1\nshift\noq() {{ \"$oq_discovery_binary\" \"$@\"; }}\n{script}"
            );
            let binary = env!("CARGO_BIN_EXE_oq").replace('\\', "/");
            let output = logged(
                &name,
                Command::new("bash").current_dir(directory.path()).args([
                    "-euo",
                    "pipefail",
                    "-c",
                    &script,
                    "oq-discovery",
                    &binary,
                ]),
            );
            match name.as_str() {
                "valid" => report(&output, 0, None),
                "rejected" => {
                    report(&output, 1, Some("error"));
                    assert_eq!(
                        fs::read_to_string(directory.path().join("note.org")).unwrap(),
                        "* Note\n:PROPERTIES:\n:state: blocked\n:END:\n"
                    );
                }
                "warning" => report(&output, 0, Some("warning")),
                "malformed" | "usage" => {
                    assert_eq!(output.status.code(), Some(2));
                    assert!(output.stdout.is_empty());
                    let error = String::from_utf8_lossy(&output.stderr);
                    assert!(
                        error.contains(if name == "malformed" {
                            "invalid schema"
                        } else {
                            "requires --schema"
                        }),
                        "{error}"
                    );
                }
                _ => unreachable!(),
            }
        }
        // The example's min_matches is an actual required-node guard, not just
        // a schema that happens to pass its only positive fixture.
        fs::write(directory.path().join("empty.org"), "").unwrap();
        let output = cli(
            "required-node",
            directory.path(),
            &["validate", "--schema", "strict.toml", "empty.org"],
        );
        assert_eq!(output.status.code(), Some(1));
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["diagnostics"][0]["rule_id"], "note.state");
        assert_eq!(report["diagnostics"].as_array().unwrap().len(), 1);
    }
    // Execute the complete schema embedded in the full reference as well.
    // A missing conditional property must yield false and an exit-1 diagnostic,
    // not an empty jq stream and an exit-2 schema-evaluation error.
    let full = read("llms-full.txt");
    let schema = full
        .split_once("```toml\n")
        .unwrap()
        .1
        .split_once("\n```")
        .unwrap()
        .0;
    let directory = tempdir().unwrap();
    fs::write(directory.path().join("scope.toml"), schema).unwrap();
    let valid = "* Entry\n:PROPERTIES:\n:scope: project\n:refs: repo/file#entry\n:project: product\n:END:\nSummary.\n";
    fs::write(directory.path().join("entry.org"), valid).unwrap();
    let accepted = cli(
        "full-schema-valid",
        directory.path(),
        &["validate", "--schema", "scope.toml", "entry.org"],
    );
    assert_eq!(accepted.status.code(), Some(0));
    assert!(accepted.stderr.is_empty());
    assert_eq!(
        serde_json::from_slice::<Value>(&accepted.stdout).unwrap(),
        json!({"mode":"single","diagnostics":[]})
    );
    fs::write(
        directory.path().join("entry.org"),
        valid.replace(":project: product\n", ""),
    )
    .unwrap();
    let rejected = cli(
        "full-schema-missing-property",
        directory.path(),
        &["validate", "--schema", "scope.toml", "entry.org"],
    );
    assert_eq!(rejected.status.code(), Some(1));
    assert!(rejected.stderr.is_empty());
    assert_eq!(
        serde_json::from_slice::<Value>(&rejected.stdout).unwrap(),
        json!({"mode":"single","diagnostics":[{"rule_id":"entry.project","severity":"error","line":1,"message":"Project scope requires a project"}]})
    );
    fs::write(directory.path().join("entry.org"), valid).unwrap();
    for predicate in ["empty", "null"] {
        let schema = format!(
            "version=1\n[[rules]]\nid='predicate'\nselect='.children[]'\nassert='{predicate}'\nmessage='Assertion must return a boolean'\n"
        );
        fs::write(directory.path().join("evaluation.toml"), schema).unwrap();
        let output = cli(
            "schema-evaluation-error",
            directory.path(),
            &["validate", "--schema", "evaluation.toml", "entry.org"],
        );
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(
            error.contains(if predicate == "empty" {
                "exactly one value"
            } else {
                "predicate must emit one boolean"
            }),
            "{error}"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("entry.org")).unwrap(),
            valid
        );
    }
}

#[test]
fn discovery_stream_defaults_aliases_and_explicit_configuration_are_true() {
    let directory = tempdir().unwrap();
    let original = "* Note\n:PROPERTIES:\n:state: ready\n:END:\n";
    fs::write(directory.path().join("note.org"), original).unwrap();
    let stream = cli(
        "json-stream",
        directory.path(),
        &[
            "query",
            ".children[0].properties.state, false, null",
            "note.org",
        ],
    );
    assert!(stream.status.success());
    assert_eq!(stream.stdout, b"\"ready\"\nfalse\nnull\n");
    let implicit = cli(
        "implicit-query",
        directory.path(),
        &[".children[0].properties.state, false, null", "note.org"],
    );
    assert_eq!(implicit.stdout, stream.stdout);
    assert!(implicit.status.success());
    let empty = cli(
        "empty-stream",
        directory.path(),
        &["query", "empty", "note.org"],
    );
    assert!(empty.status.success());
    assert!(empty.stdout.is_empty());
    let expression = r#".children[0].properties.state="preview""#;
    let preview = cli(
        "stdout-set",
        directory.path(),
        &["set", expression, "note.org"],
    );
    assert!(preview.status.success());
    assert_eq!(
        preview.stdout,
        original.replace("ready", "preview").as_bytes()
    );
    assert_eq!(
        fs::read_to_string(directory.path().join("note.org")).unwrap(),
        original
    );
    for flag in ["-i", "--in-place"] {
        fs::write(directory.path().join("note.org"), original).unwrap();
        let edited = cli(
            "in-place-alias",
            directory.path(),
            &["set", flag, expression, "note.org"],
        );
        assert!(edited.status.success());
        assert!(edited.stdout.is_empty());
        assert!(edited.stderr.is_empty());
        assert_eq!(
            fs::read_to_string(directory.path().join("note.org")).unwrap(),
            original.replace("ready", "preview")
        );
    }
    fs::write(directory.path().join("oq.toml"), "invalid config = [").unwrap();
    fs::write(directory.path().join("strict.toml"), "version=1\n").unwrap();
    let no_default = logged(
        "no-ambient-schema",
        Command::new(env!("CARGO_BIN_EXE_oq"))
            .current_dir(directory.path())
            .env("OQ_SCHEMA", "strict.toml")
            .env("OQ_CONFIG", "oq.toml")
            .args(["validate", "note.org"]),
    );
    assert_eq!(no_default.status.code(), Some(2));
    assert!(no_default.stdout.is_empty());
    assert!(String::from_utf8_lossy(&no_default.stderr).contains("requires --schema"));
    let explicit = logged(
        "explicit-schema",
        Command::new(env!("CARGO_BIN_EXE_oq"))
            .current_dir(directory.path())
            .env("OQ_SCHEMA", "missing.toml")
            .env("OQ_CONFIG", "oq.toml")
            .args(["validate", "--schema", "strict.toml", "note.org"]),
    );
    report(&explicit, 0, None);
}
