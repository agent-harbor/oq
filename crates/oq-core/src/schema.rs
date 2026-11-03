use crate::{Error, expression, parse};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

/// Severity of a schema diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    /// A violation that fails validation.
    #[default]
    Error,
    /// Advisory feedback that does not fail validation.
    Warning,
}

/// Stable, source-located feedback from one declarative schema rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Schema-defined identifier.
    pub rule_id: String,
    /// Failure or advisory.
    pub severity: Severity,
    /// One-based source line, or absent for whole-document failures.
    pub line: Option<usize>,
    /// Schema-defined, optionally computed text.
    pub message: String,
}

/// Ordered diagnostics and the selected document mode.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Validation {
    /// First matching declared mode, if the schema declares modes.
    pub mode: Option<String>,
    /// Rule and selection order is retained.
    pub diagnostics: Vec<Diagnostic>,
}

impl Validation {
    /// Whether every diagnostic is advisory.
    pub fn is_valid(&self) -> bool {
        self.diagnostics
            .iter()
            .all(|d| d.severity != Severity::Error)
    }
}

/// Validated, application-independent TOML schema.
#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "RawSchema")]
pub struct Schema {
    version: u32,
    modes: Vec<Mode>,
    rules: Vec<Rule>,
}

// Only this private DTO can temporarily hold unchecked input. Both the public
// Serde implementation and from_toml cross the same validated conversion.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSchema {
    version: u32,
    #[serde(default)]
    modes: Vec<Mode>,
    #[serde(default)]
    rules: Vec<Rule>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Mode {
    name: String,
    when: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rule {
    id: String,
    #[serde(default = "identity")]
    select: String,
    #[serde(rename = "assert")]
    assertion: String,
    message: String,
    message_query: Option<String>,
    #[serde(default = "line_query")]
    line: String,
    #[serde(default)]
    severity: Severity,
    #[serde(default)]
    modes: Vec<String>,
    #[serde(default)]
    min_matches: usize,
}

fn identity() -> String {
    ".".into()
}
fn line_query() -> String {
    ".line // null".into()
}

impl Schema {
    /// Decode TOML and validate every rule, including inactive modes.
    pub fn from_toml(source: &str) -> Result<Self, Error> {
        let raw: RawSchema = toml::from_str(source).map_err(|e| Error::Schema(e.to_string()))?;
        Self::try_from(raw)
    }

    fn check_invariants(&self) -> Result<(), Error> {
        let schema = self;
        if schema.version != 1 {
            return Err(Error::Schema("only schema version 1 is supported".into()));
        }
        let mut modes = BTreeSet::new();
        for mode in &schema.modes {
            if mode.name.trim().is_empty() || !modes.insert(&mode.name) {
                return Err(Error::Schema(
                    "mode names must be nonempty and unique".into(),
                ));
            }
            expression::check(&mode.when)
                .map_err(|e| Error::Schema(format!("mode {}: {e}", mode.name)))?;
        }
        let mut ids = BTreeSet::new();
        for rule in &schema.rules {
            if rule.id.trim().is_empty() || rule.message.trim().is_empty() || !ids.insert(&rule.id)
            {
                return Err(Error::Schema(
                    "rule ids must be unique and nonempty; messages must be nonempty".into(),
                ));
            }
            if rule.modes.iter().any(|m| !modes.contains(m)) {
                return Err(Error::Schema(format!(
                    "rule {} references an unknown mode",
                    rule.id
                )));
            }
            for code in [&rule.select, &rule.assertion, &rule.line]
                .into_iter()
                .chain(rule.message_query.iter())
            {
                expression::check(code)
                    .map_err(|e| Error::Schema(format!("rule {}: {e}", rule.id)))?;
            }
        }
        Ok(())
    }

    /// Validate source using only the schema's predicates and diagnostics.
    pub fn validate(&self, source: &str) -> Result<Validation, Error> {
        let document = parse(source)?;
        let mut mode = None;
        for candidate in &self.modes {
            if boolean(&candidate.when, &document.value)? {
                mode = Some(candidate.name.clone());
                break;
            }
        }
        let mut diagnostics = Vec::new();
        if mode.is_none() && !self.modes.is_empty() {
            diagnostics.push(Diagnostic {
                rule_id: "oq.schema.mode".into(),
                severity: Severity::Error,
                line: Some(1),
                message: "No schema document mode matches".into(),
            });
            return Ok(Validation { mode, diagnostics });
        }
        for rule in &self.rules {
            if !rule.modes.is_empty() && !mode.as_ref().is_some_and(|m| rule.modes.contains(m)) {
                continue;
            }
            let selected = expression::evaluate(&rule.select, &document.value)?;
            let predicate = expression::Program::compile(&rule.assertion)?;
            let line_program = expression::Program::compile(&rule.line)?;
            let message_program = rule
                .message_query
                .as_ref()
                .map(|q| expression::Program::compile(q))
                .transpose()?;
            if selected.len() < rule.min_matches {
                diagnostics.push(Diagnostic {
                    rule_id: rule.id.clone(),
                    severity: rule.severity,
                    line: None,
                    message: rule.message.clone(),
                });
            }
            for node in selected {
                if single_result(predicate.run(&node)?)?
                    .as_bool()
                    .ok_or_else(|| {
                        Error::Schema(format!("rule {} predicate must emit one boolean", rule.id))
                    })?
                {
                    continue;
                }
                let line = single_result(line_program.run(&node)?)?;
                let line = if line.is_null() {
                    None
                } else {
                    Some(
                        line.as_u64()
                            .and_then(|n| usize::try_from(n).ok())
                            .filter(|&n| n > 0)
                            .ok_or_else(|| {
                                Error::Schema(format!(
                                    "rule {} line must be a positive integer or null",
                                    rule.id
                                ))
                            })?,
                    )
                };
                let message = match &message_program {
                    Some(program) => single_result(program.run(&node)?)?
                        .as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| {
                            Error::Schema(format!(
                                "rule {} message_query must return a string",
                                rule.id
                            ))
                        })?,
                    None => rule.message.clone(),
                };
                diagnostics.push(Diagnostic {
                    rule_id: rule.id.clone(),
                    severity: rule.severity,
                    line,
                    message,
                });
            }
        }
        Ok(Validation { mode, diagnostics })
    }
}

impl TryFrom<RawSchema> for Schema {
    type Error = Error;

    fn try_from(raw: RawSchema) -> Result<Self, Self::Error> {
        let schema = Self {
            version: raw.version,
            modes: raw.modes,
            rules: raw.rules,
        };
        schema.check_invariants()?;
        Ok(schema)
    }
}

fn single(code: &str, value: &Value) -> Result<Value, Error> {
    let values = expression::evaluate(code, value)?;
    single_result(values)
}

fn single_result(values: Vec<Value>) -> Result<Value, Error> {
    let [value] = values.as_slice() else {
        return Err(Error::Schema(
            "expression must emit exactly one value".into(),
        ));
    };
    Ok(value.clone())
}

fn boolean(code: &str, value: &Value) -> Result<bool, Error> {
    single(code, value)?
        .as_bool()
        .ok_or_else(|| Error::Schema(format!("predicate must emit one boolean: {code}")))
}

/// Load a TOML schema and validate an Org source string.
pub fn validate(source: &str, schema_toml: &str) -> Result<Validation, Error> {
    Schema::from_toml(schema_toml)?.validate(source)
}
