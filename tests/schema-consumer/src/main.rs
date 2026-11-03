//! External API regression: no access to oq-core's private schema DTO or fields.
use oq_core::Schema;
use serde_json::{Value, json};

fn main() {
    for (name, text, value, reason) in [
        (
            "unsupported version",
            "version=2",
            json!({"version":2}),
            "only schema version 1",
        ),
        (
            "unknown rule mode",
            "version=1\n[[rules]]\nid='reject'\nassert='false'\nmessage='Must reject'\nmodes=['missing']",
            json!({"version":1,"rules":[{"id":"reject","assert":"false","message":"Must reject","modes":["missing"]}]}),
            "unknown mode",
        ),
    ] {
        let toml_error = toml::from_str::<Schema>(text).expect_err(name).to_string();
        let json_error = serde_json::from_value::<Schema>(value)
            .expect_err(name)
            .to_string();
        let constructor_error = Schema::from_toml(text).expect_err(name).to_string();
        for error in [toml_error, json_error, constructor_error] {
            assert!(error.contains(reason), "{name}: {error}");
        }
    }
    let text = "version=1\n[[rules]]\nid='state'\nselect='.children[]'\nassert='.properties.state == \"ready\"'\nmessage='State must be ready'\nline='.property_lines.state'";
    let value: Value = json!({"version":1,"rules":[{"id":"state","select":".children[]","assert":".properties.state == \"ready\"","message":"State must be ready","line":".property_lines.state"}]});
    for schema in [
        toml::from_str::<Schema>(text).unwrap(),
        serde_json::from_value::<Schema>(value).unwrap(),
    ] {
        let source = "* Note\n:PROPERTIES:\n:state: ready\n:END:\n";
        assert_eq!(
            serde_json::to_value(schema.validate(source).unwrap()).unwrap(),
            json!({"mode":null,"diagnostics":[]})
        );
        let report = schema
            .validate(&source.replace("ready", "blocked"))
            .unwrap();
        assert!(!report.is_valid());
        assert_eq!(
            serde_json::to_value(report).unwrap(),
            json!({"mode":null,"diagnostics":[{"rule_id":"state","severity":"error","line":3,"message":"State must be ready"}]})
        );
    }
    println!(
        "Validated external TOML/JSON construction rejects invalid schemas and enforces valid rules"
    );
}
