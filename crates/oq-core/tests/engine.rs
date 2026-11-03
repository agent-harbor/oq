//! Real Org sources and jq execution; no mocks or substitute parsers.
use oq_core::{Schema, parse, query, set, validate};
use serde_json::{Value, json};
const RICH: &str = include_str!("../../../tests/fixtures/rich.org");
const SCHEMA: &str = include_str!("../../../tests/fixtures/shapes.schema.toml");
const JOURNAL: &str = include_str!("../../../tests/fixtures/journal.schema.toml");

#[test]
fn core_display_projections_preserve_raw_values_and_owned_source_spans() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/display-cases.json")).unwrap();
    for case in cases {
        let source = case["source"].as_str().unwrap();
        let d = parse(source).unwrap().value;
        assert_eq!(
            query(source, "[.children[].title_plain]").unwrap(),
            vec![case["titles"].clone()],
            "{}",
            case["name"]
        );
        assert_eq!(
            query(source, "[.children[0].items[].text_plain]").unwrap(),
            vec![case["items"].clone()]
        );
        assert_eq!(d["paragraphs"], case["preamble"]);
        assert_eq!(d["children"][0]["paragraphs"], case["body"]);
        assert_eq!(d["children"][0]["children"][0]["paragraphs"], case["child"]);
        assert_eq!(
            d["children"].as_array().unwrap().last().unwrap()["paragraphs"],
            case["last"]
        );
        for p in [&d["paragraphs"], &d["children"][0]["paragraphs"]]
            .into_iter()
            .flat_map(|p| p.as_array().unwrap())
        {
            assert_eq!(
                &source[p["start"].as_u64().unwrap() as usize..p["end"].as_u64().unwrap() as usize],
                p["text"].as_str().unwrap()
            );
        }
        assert_eq!(set(source, ".").unwrap(), source);
    }
    let source = cases_source();
    let d = parse(&source).unwrap().value;
    let h = &d["children"][0];
    assert_eq!(
        h["title"],
        "Deploy =tool= with *care* and [[file:a][the /guide/]]"
    );
    assert_eq!(h["properties"]["raw"], "=keep= [[file:b]]");
    assert_eq!(
        h["items"][0]["text"],
        "First *bold /nested/*, ~code~ and =verbatim=, _under_ +strike+."
    );
    assert_eq!(
        h["items"][3]["fields"],
        json!({"test_name":"keep [[server]] =raw= ~raw~ `raw`", "description":"label [[file:a][*raw label*]]"})
    );
    assert_eq!(
        h["items"][3]["field_lines"],
        json!({"test_name":28,"description":29})
    );
    assert_eq!(
        parse("  =雪=").unwrap().value["paragraphs"],
        json!([
            {"text":"  =雪=", "plain":"  雪", "line":1, "start":0, "end":7}
        ])
    );
    for expression in [
        r#".children[0].title_plain = "changed""#,
        r#".children[0].items[0].text_plain = "changed""#,
        r#".paragraphs[0].plain = "changed""#,
        r#".children[0].paragraphs = []"#,
    ] {
        assert!(
            set(&source, expression)
                .unwrap_err()
                .to_string()
                .contains("read-only"),
            "{expression}"
        );
    }
    let edited = set(&source, r#".children[0].title="New *title*" | .children[0].items[0].text="New /item/" | .children[0].items[3].fields.description="New =field=""#).unwrap();
    assert_eq!(
        edited,
        source
            .replacen(
                "Deploy =tool= with *care* and [[file:a][the /guide/]]",
                "New *title*",
                1
            )
            .replacen(
                "First *bold /nested/*, ~code~ and =verbatim=, _under_ +strike+.",
                "New /item/",
                1
            )
            .replacen("label [[file:a][*raw label*]]", "New =field=", 1)
    );
    let reparsed = parse(&edited).unwrap().value;
    assert_eq!(reparsed["children"][0]["title_plain"], "New title");
    assert!(
        reparsed["children"][0]["items"][0]["text_plain"]
            .as_str()
            .unwrap()
            .starts_with("New item\r\n  continuation")
    );
    assert_eq!(
        reparsed["children"][0]["items"][3]["fields"]["description"],
        "New =field="
    );
}

fn cases_source() -> String {
    let cases: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/display-cases.json")).unwrap();
    cases[0]["source"].as_str().unwrap().into()
}

#[test]
fn core_checkbox_case_compatibility_keeps_original_bytes_and_normalized_edits() {
    let source = "* Work\r\n    - [x] Lower 雪\r\n      - [X] Nested\r\n    - [ ] Open\r\n    - [-] Partial\r\n    - [y] Ordinary\r\n    - [x] term :: Definition\r\n    1. [@2] [x] Ordered\r\n";
    assert_eq!(
        query(
            source,
            "[.children[0].items[] | [.text, .checkbox, .text_plain]]"
        )
        .unwrap(),
        vec![json!([
            ["Lower 雪", "X", "Lower 雪"],
            ["Nested", "X", "Nested"],
            ["Open", " ", "Open"],
            ["Partial", "-", "Partial"],
            ["[y] Ordinary", null, "[y] Ordinary"],
            ["Definition", "X", "Definition"],
            ["Ordered", "X", "Ordered"]
        ])]
    );
    assert_eq!(
        query(source, ".children[0].items[5].fields").unwrap(),
        vec![json!({"term":"Definition"})]
    );
    let nested_lower = source.replace("[X] Nested", "[x] Nested");
    assert_eq!(
        parse(&nested_lower).unwrap().value["children"][0]["items"],
        parse(source).unwrap().value["children"][0]["items"]
    );
    assert_eq!(
        parse(&nested_lower).unwrap().value["children"][0]["content"][1]["text"],
        "      - [x] Nested"
    );
    assert_eq!(set(&nested_lower, ".").unwrap(), nested_lower);
    assert_eq!(set(source, ".").unwrap(), source);
    assert_eq!(
        set(source, r#".children[0].items[0].checkbox="X""#).unwrap(),
        source
    );
    assert_eq!(
        set(source, r#".children[0].title="Renamed""#).unwrap(),
        source.replacen("* Work", "* Renamed", 1)
    );
    for (index, old) in [(0, "[x] Lower"), (1, "[X] Nested"), (6, "[x] Ordered")] {
        let expression = format!(r#".children[0].items[{index}].checkbox=" ""#);
        let unchecked = set(source, &expression).unwrap();
        assert_eq!(
            unchecked,
            source.replacen(old, &old.replacen(['x', 'X'], " ", 1), 1)
        );
        let checked = set(
            &unchecked,
            &format!(r#".children[0].items[{index}].checkbox="X""#),
        )
        .unwrap();
        assert_eq!(checked, source.replacen(old, &old.replacen('x', "X", 1), 1));
    }
    assert!(
        set(source, r#".children[0].items[0].checkbox="x""#)
            .unwrap_err()
            .to_string()
            .contains("checkbox must be a space, X, or -")
    );
    assert_eq!(
        parse("- \n").unwrap().value["items"][0]["checkbox"],
        Value::Null
    );
}

#[test]
fn core_empty_table_cells_keep_cardinality_and_lossless_mutation_slots() {
    let source = "* Table 雪\r\n| | a || \t |z||\r\n|---+---|\r\n| a | b\r\n|   |\r\n|";
    assert_eq!(
        query(source, ".children[0].tables").unwrap(),
        vec![json!([[
            {"line":2,"cells":["","a","","","z",""]}, {"line":4,"cells":["a","b"]}, {"line":5,"cells":[""]}, {"line":6,"cells":[""]}
        ]])]
    );
    let row = "| | a || \t |z||";
    for (column, expected) in [
        "| new| a || \t |z||",
        "| | new || \t |z||",
        "| | a |new| \t |z||",
        "| | a || \t new|z||",
        "| | a || \t |new||",
        "| | a || \t |z|new|",
    ]
    .iter()
    .enumerate()
    {
        let result = set(
            source,
            &format!(r#".children[0].tables[0][0].cells[{column}]="new""#),
        )
        .unwrap();
        assert_eq!(result, source.replacen(row, expected, 1));
        assert_eq!(
            parse(&result).unwrap().value["children"][0]["tables"][0][0]["cells"][column],
            "new"
        );
    }
    assert_eq!(set(source, r#".children[0].tables[0][1].cells[1]="雪" | .children[0].tables[0][2].cells[0]="new" | .children[0].tables[0][3].cells[0]="end""#).unwrap(), source.replace("| a | b\r\n|   |\r\n|", "| a | 雪\r\n|   new|\r\n|end"));
    assert_eq!(set(source, ".").unwrap(), source);
    assert!(set(source, r#".children[0].tables[0][0].cells[0]="bad|cell""#).is_err());
}

#[test]
fn core_rich_tree_locations_code_blocks_and_duplicate_titles() {
    let d = parse(RICH).unwrap().value;
    assert_eq!(d["title"], "Unicode café Roadmap");
    assert_eq!(d["children"].as_array().unwrap().len(), 2);
    assert_eq!(d["sections"]["Work"], d["children"][0]);
    assert_eq!(d["children"][0]["properties"]["owner"], "Zoë");
    assert_eq!(d["children"][0]["property_lines"]["owner"], 5);
    let checks = &d["children"][0]["children"][0]["children"][0];
    assert_eq!(checks["line"], 11);
    assert_eq!(checks["items"].as_array().unwrap().len(), 3);
    assert_eq!(
        checks["items"][0]["fields"]["test_name"],
        "builds_without_network"
    );
    assert_eq!(
        checks["items"][0]["fields"]["description"],
        "checks the complete result\nincluding the Unicode payload"
    );
    assert_eq!(checks["items"][0]["field_lines"]["status"], 16);
    assert_eq!(checks["items"][1]["checkbox"], " ");
    assert_eq!(checks["items"][2]["checkbox"], "X");
    assert_eq!(checks["tables"][0][1]["cells"], json!(["α", "ready"]));
    assert_eq!(checks["tables"].as_array().unwrap().len(), 1);
    assert_eq!(d["keywords"].as_array().unwrap().len(), 1);
}

#[test]
fn core_jq_select_map_paths_regex_and_errors() {
    assert_eq!(
        query(
            RICH,
            r#".sections["Work"].children[] | select(.properties.state == "active") | .title"#
        )
        .unwrap(),
        vec![json!("A1: Build")]
    );
    assert_eq!(
        query(RICH, "[.children[].title] | unique | length").unwrap(),
        vec![json!(1)]
    );
    assert_eq!(
        query(RICH, r#".children[0].properties.owner | test("^Zo")"#).unwrap(),
        vec![json!(true)]
    );
    assert!(query(RICH, ".children[").is_err());
    assert!(query(RICH, "error(\"intentional\")").is_err());
    assert!(query(RICH, "env").is_err());
    assert!(query(RICH, "now").is_err());
    assert_eq!(query(RICH, "empty").unwrap(), Vec::<Value>::new());
    assert!(
        query(RICH, "halt")
            .unwrap_err()
            .to_string()
            .contains("not permitted")
    );
}

#[test]
fn core_lossless_edits_aliases_nested_items_and_table_cells() {
    let expression = r#".sections.Work.children[0].properties.state = "done" | .children[0].properties.owner = "李" | .children[0].children[0].children[0].items[1].checkbox = "X" | .children[0].children[0].children[0].tables[0][1].cells[1] = "complete""#;
    let expected = RICH
        .replacen(":state: active", ":state: done", 1)
        .replacen(":OWNER: Zoë", ":OWNER: 李", 1)
        .replacen("- [ ] ordinary", "- [X] ordinary", 1)
        .replacen("| α    | ready |", "| α    | complete |", 1);
    assert_eq!(set(RICH, expression).unwrap(), expected);
    assert_eq!(set(RICH, ".").unwrap(), RICH);
    assert_eq!(
        set(
            RICH,
            r#".children[0].properties.owner = "X" | .sections.Work.properties.owner = "X""#
        )
        .unwrap(),
        RICH.replacen("Zoë", "X", 1)
    );
    assert!(
        set(
            RICH,
            r#".children[0].properties.owner = "X" | .sections.Work.properties.owner = "Y""#
        )
        .is_err()
    );
}

#[test]
fn core_property_insertion_crlf_utf8_and_no_final_newline() {
    let source = "* Café\r\nBody stays.\r\n";
    assert_eq!(
        set(source, r#".children[0].properties.tag = "雪""#).unwrap(),
        "* Café\r\n:PROPERTIES:\r\n:tag: 雪\r\n:END:\r\nBody stays.\r\n"
    );
    assert_eq!(
        set("* A", r#".children[0].properties.tag = "a""#).unwrap(),
        "* A\n:PROPERTIES:\n:tag: a\n:END:"
    );
    let source = "* A\r\n  :PROPERTIES:\r\n  :state: old  \r\n  :END:\r\nBody";
    assert_eq!(
        set(source, r#".children[0].properties.state = "new""#).unwrap(),
        source.replacen("old", "new", 1)
    );
    assert_eq!(
        set(source, r#".children[0].properties.extra = "yes""#).unwrap(),
        source.replacen("  :END:", "  :extra: yes\r\n  :END:", 1)
    );
    let expected = "* A\n:PROPERTIES:\n:one: 1\n:two: 2\n:END:\n";
    let odd = "* A\n   :PROPERTIES:\n   :state: old\n   :END:\n";
    assert_eq!(
        set(odd, r#".children[0].properties.state="new""#).unwrap(),
        odd.replacen("old", "new", 1)
    );
    assert_eq!(
        set(
            "* A\n",
            r#".children[0].properties.one="1" | .sections.A.properties.two="2""#
        )
        .unwrap(),
        expected
    );
    assert!(
        set(
            "* A\n",
            r#".children[0].properties.one="1" | .sections.A.properties.one="2""#
        )
        .is_err()
    );
}

#[test]
fn core_scalar_fields_text_titles_and_rejected_structural_mutations() {
    assert_eq!(
        set(
            RICH,
            r#".children[0].children[0].children[0].items[0].fields.status = "passed""#
        )
        .unwrap(),
        RICH.replacen("status: pending", "status: passed", 1)
    );
    assert_eq!(
        set(RICH, r#".children[1].title = "Other""#).unwrap(),
        RICH.replacen("* Work\nSecond", "* Other\nSecond", 1)
    );
    assert_eq!(
        set(
            "* A\n- [ ] task\n",
            r#".children[0].items[0].text = "new task""#
        )
        .unwrap(),
        "* A\n- [ ] new task\n"
    );
    for expr in [
        "empty",
        "., .",
        r#".children = []"#,
        r#".children[0].line = 999"#,
        r#".children[0].properties.owner = "bad\n:END:""#,
        r#".children[0].children[0].children[0].tables[0][0].cells[0] = "bad|cell""#,
        r#".children[0].children[0].children[0].items[1].checkbox = "y""#,
        r#"del(.children[0].properties.owner)"#,
    ] {
        assert!(set(RICH, expr).is_err(), "accepted {expr}");
    }
}

#[test]
fn core_schema_modes_exact_diagnostics_and_custom_override() {
    for (source, mode) in [
        (include_str!("../../../tests/fixtures/inline.org"), "inline"),
        (include_str!("../../../tests/fixtures/wiki.org"), "wiki"),
        (include_str!("../../../tests/fixtures/split.org"), "split"),
        (
            include_str!("../../../tests/fixtures/refinement.org"),
            "refinement",
        ),
    ] {
        let report = validate(source, SCHEMA).unwrap();
        assert_eq!(
            serde_json::to_value(report).unwrap(),
            json!({"mode":mode,"diagnostics":[]}),
            "{mode}"
        );
    }
    let invalid = "#+TITLE: Wrong\n* Work\n** A1: First\n:PROPERTIES:\n:state: broken\n:END:\n";
    let report = validate(invalid, SCHEMA).unwrap();
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        json!({"mode":"inline","diagnostics":[
            {"rule_id":"title.suffix","severity":"warning","line":1,"message":"Title should end with Roadmap"},
            {"rule_id":"work.state","severity":"error","line":5,"message":"Invalid state for A1: First"}
        ]})
    );
    let custom = SCHEMA.replace(
        "\"planned\", \"active\", \"done\"",
        "\"planned\", \"active\", \"done\", \"broken\"",
    );
    let report = validate(invalid, &custom).unwrap();
    assert!(report.is_valid());
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        json!({"mode":"inline","diagnostics":[{"rule_id":"title.suffix","severity":"warning","line":1,"message":"Title should end with Roadmap"}]})
    );
}

#[test]
fn core_schema_conditional_properties_refs_and_body_rejection_twins() {
    let cases: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/journal-cases.json")).unwrap();
    assert_eq!(cases.as_array().unwrap().len(), 6);
    for case in cases.as_array().unwrap() {
        let source = case["source"].as_str().unwrap();
        let value = parse(source).unwrap().value;
        let node = &value["children"][0];
        assert_eq!(
            value["children"].as_array().unwrap().len(),
            1,
            "{}",
            case["name"]
        );
        let content = node["content"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|line| !line["text"].as_str().unwrap().trim().is_empty())
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(
            json!({"line":node["line"],"properties":node["properties"],"property_lines":node["property_lines"],"property_order":node["property_order"],"nonempty_content":content}),
            case["parsed"],
            "{}",
            case["name"]
        );
        let report = validate(source, JOURNAL).unwrap();
        assert_eq!(report.is_valid(), case["status"] == 0, "{}", case["name"]);
        assert_eq!(
            serde_json::to_value(report).unwrap(),
            case["report"],
            "{}",
            case["name"]
        );
    }
}

#[test]
fn core_schema_malformed_and_vacuous_predicates_fail() {
    for schema in [
        "version=2",
        "version=1\nunknown=true",
        "version=1\n[[rules]]\nid='x'\nassert='.'\nmessage='x'\nunknown=true",
        "version=1\n[[rules]]\nid='x'\nassert='.['\nmessage='x'",
        "version=1\n[[rules]]\nid='x'\nassert='true'\nmessage='x'\nmodes=['missing']",
    ] {
        assert!(Schema::from_toml(schema).is_err(), "{schema}");
    }
    for predicate in ["empty", "null", "true,false"] {
        let schema = format!("version=1\n[[rules]]\nid='x'\nassert='{predicate}'\nmessage='bad'");
        assert!(validate("* A\n", &schema).is_err(), "{predicate}");
    }
    let schema = "version=1\n[[rules]]\nid='not-empty'\nselect='.children[] | select(.title == \"Missing\")'\nassert='true'\nmessage='Required node missing'\nmin_matches=1";
    let report = validate("* A\n", schema).unwrap();
    assert!(!report.is_valid());
    assert_eq!(report.diagnostics[0].rule_id, "not-empty");
}

#[test]
fn core_malformed_drawer_is_observable_and_not_repaired() {
    let source = "* Work\n:PROPERTIES:\n:state: active\nnot a property\n";
    let d = parse(source).unwrap().value;
    assert_eq!(d["children"][0]["drawer_closed"], false);
    assert_eq!(d["children"][0]["properties"], json!({"state":"active"}));
    assert_eq!(d["children"][0]["property_lines"], json!({"state":3}));
    assert_eq!(
        d["children"][0]["drawer_stray_lines"],
        json!([{"line":4,"text":"not a property"}])
    );
    let report = validate(source, SCHEMA).unwrap();
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        json!({"mode":"inline","diagnostics":[
            {"rule_id":"title.required","severity":"error","line":1,"message":"Missing #+TITLE"},
            {"rule_id":"title.suffix","severity":"warning","line":null,"message":"Title should end with Roadmap"},
            {"rule_id":"drawer.closed","severity":"error","line":2,"message":"Malformed property drawer"}
        ]})
    );
    assert!(set(source, r#".children[0].properties.extra = "no""#).is_err());
}

#[test]
fn core_literal_blocks_keep_utf8_crlf_offsets_and_never_create_edit_targets() {
    let source = "#+TITLE: 雪\r\n#+BeGiN_sRc org\r\n,* False\r\n- [ ] false\r\n| α | false |\r\n#+END_SRC\r\n* Real\r\n:PROPERTIES:\r\n:OWNER: Zoë\r\n:END:\r\n- [ ] task\r\n";
    let d = parse(source).unwrap().value;
    assert_eq!(d["children"].as_array().unwrap().len(), 1);
    assert_eq!(d["children"][0]["line"], 7);
    assert_eq!(d["children"][0]["start"], source.find("* Real").unwrap());
    assert_eq!(d["children"][0]["property_lines"]["owner"], 9);
    assert_eq!(d["children"][0]["items"][0]["line"], 11);
    assert_eq!(d["content"][4]["text"], "| α | false |");
    let expr = r#".children[0].properties.owner="李" | .children[0].items[0].checkbox="X""#;
    assert_eq!(
        set(source, expr).unwrap(),
        source
            .replace(":OWNER: Zoë", ":OWNER: 李")
            .replace("- [ ] task", "- [X] task")
    );
    assert_eq!(query(source, ".sections.False").unwrap(), vec![Value::Null]);
    let unquoted = source.replace(",* False", "* False");
    assert_eq!(
        query(&unquoted, "[.children[].title]").unwrap(),
        vec![json!(["False", "Real"])]
    );
    assert_eq!(parse(&unquoted).unwrap().value["children"][0]["line"], 3);
    assert_eq!(
        set(&unquoted, r#".sections.False.title="Renamed""#).unwrap(),
        unquoted.replacen("* False", "* Renamed", 1)
    );
}

#[test]
fn core_org_description_records_and_schema_subsection_constraints() {
    let source =
        "* Record\n- Color :: blue\n- name: paint\n  amount: 2\n** Checks (local)\n- kind: real\n";
    let parsed = parse(source).unwrap().value;
    assert_eq!(parsed["children"][0]["items"][0]["fields"]["Color"], "blue");
    assert_eq!(parsed["children"][0]["line"], 1);
    assert_eq!(parsed["children"][0]["children"][0]["line"], 5);
    assert_eq!(
        parsed["children"][0]["items"][0]["field_lines"],
        json!({"Color":2})
    );
    assert_eq!(
        parsed["children"][0]["items"][1]["field_lines"],
        json!({"name":3,"amount":4})
    );
    assert_eq!(
        set(source, r#".children[0].items[0].fields.Color="red""#).unwrap(),
        source.replace(":: blue", ":: red")
    );
    let schema = r#"version=1
[[rules]]
id='structure'
select='.children[]'
assert='all(.children[]; .title | startswith("Checks")) and all(.items[]; (.fields | keys) | all(.[]; IN("Color", "name", "amount")))'
message='Disallowed subsection or record field'
[[rules]]
id='required-child'
select='.children[]'
assert='any(.children[]; .title | startswith("Checks"))'
message='Missing checks'
"#;
    assert_eq!(
        serde_json::to_value(validate(source, schema).unwrap()).unwrap(),
        json!({"mode":null,"diagnostics":[]})
    );
    let invalid = source.replace("Checks (local)", "Other");
    let report = validate(&invalid, schema).unwrap();
    assert_eq!(
        serde_json::to_value(report).unwrap(),
        json!({"mode":null,"diagnostics":[
            {"rule_id":"structure","severity":"error","line":1,"message":"Disallowed subsection or record field"},
            {"rule_id":"required-child","severity":"error","line":1,"message":"Missing checks"}
        ]})
    );
}

#[test]
fn core_invalid_runtime_regex_and_inactive_rule_syntax_are_errors() {
    let schema = "version=1\n[[rules]]\nid='pattern'\nassert='test(\"[\")'\nmessage='bad pattern'";
    assert!(validate("* A\n", schema).is_err());
    let schema = "version=1\n[[modes]]\nname='unused'\nwhen='false'\n[[modes]]\nname='used'\nwhen='true'\n[[rules]]\nid='bad'\nmodes=['unused']\nassert='.['\nmessage='must still compile'";
    assert!(Schema::from_toml(schema).is_err());
    for expression in ["debug", "stderr", "halt_error(2)"] {
        assert!(query("* A\n", expression).is_err());
    }
}

#[test]
fn core_planning_lines_preserve_drawer_grammar_and_source_positions() {
    let source = "* Task\nSCHEDULED: <2026-11-03 Tue>\n:PROPERTIES:\n:ID: 42\n:END:\nBody.\n";
    let value = parse(source).unwrap().value;
    assert_eq!(value["children"][0]["properties"]["id"], "42");
    assert_eq!(value["children"][0]["property_lines"]["id"], 4);
    assert_eq!(
        set(source, r#".children[0].properties.id="43""#).unwrap(),
        source.replace(":ID: 42", ":ID: 43")
    );
    let source = "* Task\nSCHEDULED: <2026-11-03 Tue>\nBody.\n";
    assert_eq!(
        set(source, r#".children[0].properties.id="new""#).unwrap(),
        "* Task\nSCHEDULED: <2026-11-03 Tue>\n:PROPERTIES:\n:id: new\n:END:\nBody.\n"
    );
}
