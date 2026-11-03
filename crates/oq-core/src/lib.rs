//! Org document queries, lossless scalar edits, and schema validation.
//!
//! The public [contract](https://github.com/agent-harbor/oq/blob/dev/docs/contract.md)
//! describes the JSON view and its source-preservation guarantees.

mod document;
mod edit;
mod expression;
mod schema;

pub use document::{Document, parse};
pub use edit::set;
pub use schema::{Diagnostic, Schema, Severity, Validation, validate};

/// Failures in source editing, jq execution, and schema configuration.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid expression: {0}")]
    Expression(String),
    #[error("invalid schema: {0}")]
    Schema(String),
    #[error("unsupported edit: {0}")]
    Edit(String),
    #[error("document cannot be represented: {0}")]
    Document(String),
}

/// Evaluate a jq expression against a parsed Org document.
pub fn query(source: &str, expression: &str) -> Result<Vec<serde_json::Value>, Error> {
    expression::evaluate(expression, &parse(source)?.value)
}
