use crate::document::{Document, DrawerTarget, Kind, pointer};
use crate::{Error, expression, parse};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ops::Range;

/// Apply a jq document transformation using source-span replacements only.
pub fn set(source: &str, expression: &str) -> Result<String, Error> {
    let document = parse(source)?;
    let values = expression::evaluate(expression, &document.value)?;
    let [next] = values.as_slice() else {
        return Err(Error::Edit(
            "transformation must emit exactly one document".into(),
        ));
    };
    let mut changes = Changes {
        document: &document,
        edits: BTreeMap::new(),
        checks: BTreeMap::new(),
        insertions: BTreeMap::new(),
    };
    changes.walk("", &document.value, next)?;
    for (at, (drawer, properties)) in changes.insertions {
        let mut content = drawer.prefix;
        if !drawer.existing {
            content.push_str(&format!("{}:PROPERTIES:{}", drawer.indent, drawer.newline));
        }
        for (key, value) in properties {
            content.push_str(&format!(
                "{}:{key}: {value}{}",
                drawer.indent, drawer.newline
            ));
        }
        if !drawer.existing {
            content.push_str(&format!("{}:END:", drawer.indent));
            if drawer.terminal_newline {
                content.push_str(&drawer.newline);
            }
        }
        changes.edits.insert((at, at), content);
    }
    let mut edits = changes
        .edits
        .into_iter()
        .map(|((s, e), v)| (s..e, v))
        .collect::<Vec<_>>();
    edits.sort_by_key(|(r, _)| (r.start, r.end));
    for pair in edits.windows(2) {
        if pair[0].0.end > pair[1].0.start || pair[0].0.start == pair[1].0.start {
            return Err(Error::Edit("overlapping source edits".into()));
        }
    }
    let mut result = document.source.clone();
    for (range, value) in edits.into_iter().rev() {
        result.replace_range(range, &value);
    }
    let reparsed = parse(&result)?;
    if shape(&document.value) != shape(&reparsed.value) {
        return Err(Error::Edit("replacement changes document structure".into()));
    }
    for (path, expected) in changes.checks {
        if reparsed.value.pointer(&path) != Some(&expected) {
            return Err(Error::Edit(format!(
                "replacement does not round-trip at {path}"
            )));
        }
    }
    Ok(result)
}

struct Changes<'a> {
    document: &'a Document,
    edits: BTreeMap<(usize, usize), String>,
    checks: BTreeMap<String, Value>,
    insertions: BTreeMap<usize, (DrawerTarget, BTreeMap<String, String>)>,
}

impl Changes<'_> {
    fn edit(
        &mut self,
        range: Range<usize>,
        text: String,
        target: &str,
        value: &Value,
    ) -> Result<(), Error> {
        if let Some(old) = self.edits.insert((range.start, range.end), text.clone())
            && old != text
        {
            return Err(Error::Edit(
                "conflicting edits through document aliases".into(),
            ));
        }
        if let Some(old) = self.checks.insert(target.into(), value.clone())
            && old != *value
        {
            return Err(Error::Edit("conflicting document values".into()));
        }
        Ok(())
    }

    fn walk(&mut self, path: &str, old: &Value, new: &Value) -> Result<(), Error> {
        if old == new {
            return Ok(());
        }
        if let Some(slot) = self.document.slots.get(path) {
            let text = new
                .as_str()
                .ok_or_else(|| Error::Edit(format!("{path} requires a string")))?;
            if text.contains(['\r', '\n', '\0'])
                || text.trim() != text && !matches!(slot.kind, Kind::Checkbox)
            {
                return Err(Error::Edit(format!(
                    "{path} requires a single trimmed line"
                )));
            }
            if matches!(slot.kind, Kind::Cell) && text.contains('|') {
                return Err(Error::Edit(
                    "a table cell cannot contain an unescaped delimiter".into(),
                ));
            }
            if matches!(slot.kind, Kind::Checkbox) && ![" ", "X", "-"].contains(&text) {
                return Err(Error::Edit("checkbox must be a space, X, or -".into()));
            }
            return self.edit(slot.range.clone(), text.into(), &slot.target, new);
        }
        match (old, new) {
            (Value::Object(a), Value::Object(b)) => {
                if a.keys().any(|k| !b.contains_key(k)) {
                    return Err(Error::Edit(format!(
                        "deleting fields at {path} is unsupported"
                    )));
                }
                let added = b
                    .iter()
                    .filter(|(k, _)| !a.contains_key(*k))
                    .collect::<Vec<_>>();
                if !added.is_empty() {
                    let drawer = self.document.drawers.get(path).ok_or_else(|| {
                        Error::Edit(format!("adding fields at {path} is unsupported"))
                    })?;
                    let (_, properties) = self
                        .insertions
                        .entry(drawer.at)
                        .or_insert_with(|| (drawer.clone(), BTreeMap::new()));
                    for (key, value) in added {
                        if key.is_empty()
                            || !key.bytes().all(|c| {
                                c.is_ascii_lowercase() || c.is_ascii_digit() || b"_-".contains(&c)
                            })
                        {
                            return Err(Error::Edit(
                                "new property keys must be lowercase ASCII identifiers".into(),
                            ));
                        }
                        let text = value
                            .as_str()
                            .filter(|v| v.trim() == *v && !v.contains(['\r', '\n', '\0']))
                            .ok_or_else(|| {
                                Error::Edit(
                                    "new property value must be a single trimmed string".into(),
                                )
                            })?;
                        if let Some(old) = properties.insert(key.clone(), text.into())
                            && old != text
                        {
                            return Err(Error::Edit(
                                "conflicting new properties through aliases".into(),
                            ));
                        }
                        self.checks
                            .insert(format!("{}/{}", drawer.target, pointer(key)), value.clone());
                    }
                }
                for (key, value) in a {
                    self.walk(&format!("{path}/{}", pointer(key)), value, &b[key])?;
                }
                Ok(())
            }
            (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
                for (i, (a, b)) in a.iter().zip(b).enumerate() {
                    self.walk(&format!("{path}/{i}"), a, b)?;
                }
                Ok(())
            }
            _ => Err(Error::Edit(format!("{path} is read-only"))),
        }
    }
}

fn shape(value: &Value) -> Value {
    serde_json::json!({
        "level":value.get("level"),
        "children":value["children"].as_array().map(|c|c.iter().map(shape).collect::<Vec<_>>()),
        "items":value["items"].as_array().map(|a|a.iter().map(|i|i["indent"].clone()).collect::<Vec<_>>()),
        "tables":value["tables"].as_array().map(|a|a.iter().map(|t|t.as_array().map(|rows|rows.iter().map(|r|r["cells"].as_array().map(Vec::len)).collect::<Vec<_>>())).collect::<Vec<_>>())
    })
}
