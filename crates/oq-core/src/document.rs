use crate::Error;
use orgize::ast::{
    Headline, Keyword, ListItem, OrgTable, OrgTableCell, OrgTableRow, Paragraph, Section,
};
use orgize::rowan::ast::AstNode;
use orgize::{Org, SyntaxKind, SyntaxNode};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;
use std::ops::Range;

/// JSON view of an Org document, with private source locations for edits.
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct Document {
    /// Ordered heading tree and queryable document metadata.
    pub value: Value,
    #[serde(skip)]
    pub(crate) source: String,
    #[serde(skip)]
    pub(crate) slots: BTreeMap<String, Slot>,
    #[serde(skip)]
    pub(crate) drawers: BTreeMap<String, DrawerTarget>,
}

#[derive(Debug, Clone)]
pub(crate) struct Slot {
    pub range: Range<usize>,
    pub kind: Kind,
    pub target: String,
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum Kind {
    Text,
    Checkbox,
    Cell,
}

#[derive(Debug, Clone)]
pub(crate) struct DrawerTarget {
    pub at: usize,
    pub indent: String,
    pub newline: String,
    pub existing: bool,
    pub prefix: String,
    pub terminal_newline: bool,
    pub target: String,
}

pub(crate) fn pointer(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn offset(n: orgize::rowan::TextSize) -> usize {
    u32::from(n) as usize
}

/// Parse an Org document without normalizing its source bytes.
pub fn parse(source: &str) -> Result<Document, Error> {
    if source.len() > 32 * 1024 * 1024 {
        return Err(Error::Document("source exceeds 32 MiB".into()));
    }
    // Delegate context-free headings and comma quoting in literal blocks to
    // Org's grammar: https://orgmode.org/manual/Literal-Examples.html
    let org = Org::parse(source);
    let mut builder = Builder {
        source,
        starts: std::iter::once(0)
            .chain(source.match_indices('\n').map(|(i, _)| i + 1))
            .collect(),
        slots: BTreeMap::new(),
        drawers: BTreeMap::new(),
    };
    let root = org.document();
    let mut value = builder.body(root.section(), "", None);
    value["title"] = Value::Null;
    value["title_line"] = Value::Null;
    let mut keywords = Vec::new();
    // Literal blocks contain raw tokens, not Keyword nodes. Traversing the
    // concrete tree therefore cannot mistake examples for document metadata.
    for keyword in root.syntax().descendants().filter_map(Keyword::cast) {
        let start = offset(keyword.start());
        let raw = keyword.raw();
        if let Some((key, _)) = raw
            .trim_start()
            .strip_prefix("#+")
            .and_then(|s| s.split_once(':'))
        {
            let span =
                builder.trimmed(start + raw.find(':').unwrap_or(0) + 1..offset(keyword.end()));
            let text = source[span.clone()].to_string();
            keywords
                .push(json!({"key":key.to_lowercase(),"value":text,"line":builder.line(start)}));
            if key.eq_ignore_ascii_case("TITLE")
                && value["title"].is_null()
                && root
                    .first_headline()
                    .is_none_or(|h| start < offset(h.start()))
            {
                value["title"] = json!(text);
                value["title_line"] = json!(builder.line(start));
                builder.slot("/title", span, Kind::Text);
            }
        }
    }
    value["keywords"] = json!(keywords);
    let mut children = Vec::new();
    let mut sections = Map::new();
    for (i, headline) in root.headlines().enumerate() {
        let path = format!("/children/{i}");
        let child = builder.heading(headline, &path, 0)?;
        let title = child["title"].as_str().unwrap_or_default();
        if !sections.contains_key(title) {
            builder.alias(&path, &format!("/sections/{}", pointer(title)));
            sections.insert(title.to_owned(), child.clone());
        }
        children.push(child);
    }
    value["children"] = json!(children);
    value["sections"] = Value::Object(sections);
    Ok(Document {
        value,
        source: source.into(),
        slots: builder.slots,
        drawers: builder.drawers,
    })
}

struct Builder<'a> {
    source: &'a str,
    starts: Vec<usize>,
    slots: BTreeMap<String, Slot>,
    drawers: BTreeMap<String, DrawerTarget>,
}

impl Builder<'_> {
    fn line(&self, at: usize) -> usize {
        self.starts.partition_point(|&i| i <= at)
    }

    fn trimmed(&self, range: Range<usize>) -> Range<usize> {
        let raw = &self.source[range.clone()];
        let start = range.start + raw.len() - raw.trim_start().len();
        start..start + raw.trim().len()
    }

    fn slot(&mut self, path: &str, range: Range<usize>, kind: Kind) {
        self.slots.insert(
            path.into(),
            Slot {
                range,
                kind,
                target: path.into(),
            },
        );
    }

    fn alias(&mut self, from: &str, to: &str) {
        let prefix = format!("{from}/");
        let slots = self
            .slots
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<Vec<_>>();
        for (key, value) in slots {
            if let Some(suffix) = key.strip_prefix(from) {
                self.slots.insert(format!("{to}{suffix}"), value);
            }
        }
        let drawers = self
            .drawers
            .range(prefix.clone()..)
            .take_while(|(k, _)| k.starts_with(&prefix))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect::<Vec<_>>();
        for (key, value) in drawers {
            if let Some(suffix) = key.strip_prefix(from) {
                self.drawers.insert(format!("{to}{suffix}"), value);
            }
        }
    }

    fn line_end(&self, at: usize) -> usize {
        self.source[at..]
            .find(['\r', '\n'])
            .map_or(self.source.len(), |i| at + i)
    }

    fn heading(&mut self, h: Headline, path: &str, depth: usize) -> Result<Value, Error> {
        if depth > 128 {
            return Err(Error::Document("heading nesting exceeds 128 levels".into()));
        }
        let start = offset(h.start());
        let header_end = self.line_end(start);
        let after_header = self.source[header_end..]
            .find('\n')
            .map_or(header_end, |i| header_end + i + 1);
        let direct_end = h
            .headlines()
            .next()
            .map_or(offset(h.end()), |child| offset(child.start()));
        let newline = if self.source[start..after_header].ends_with("\r\n") {
            "\r\n"
        } else {
            "\n"
        };
        let mut props = Map::new();
        let mut property_lines = Map::new();
        let mut property_order = Vec::new();
        let mut stray = Vec::new();
        let mut drawer = None;
        let mut drawer_start = None;
        let mut drawer_closed = true;
        let mut indent = String::new();
        let mut in_drawer = false;
        // Org places a drawer after an optional planning line. Let the CST
        // locate valid metadata; raw scanning preserves malformed-drawer lines
        // for validation without reimplementing the planning grammar.
        let metadata_start = h
            .properties()
            .map(|p| self.starts[self.line(offset(p.start())) - 1])
            .or_else(|| h.planning().map(|p| offset(p.end())))
            .unwrap_or(after_header);
        let mut at = metadata_start;
        for raw in self.source[metadata_start..direct_end].split_inclusive('\n') {
            let text = raw.trim();
            if !in_drawer {
                if text.is_empty() {
                    at += raw.len();
                    continue;
                }
                if !text.eq_ignore_ascii_case(":PROPERTIES:") {
                    break;
                }
                in_drawer = true;
                drawer_closed = false;
                drawer_start = Some(at);
                indent = raw[..raw.len() - raw.trim_start().len()].into();
            } else if text.eq_ignore_ascii_case(":END:") {
                drawer = Some(drawer_start.unwrap_or(at)..at + raw.len());
                self.drawers.insert(
                    format!("{path}/properties"),
                    DrawerTarget {
                        at,
                        indent: indent.clone(),
                        newline: newline.into(),
                        existing: true,
                        prefix: String::new(),
                        terminal_newline: true,
                        target: format!("{path}/properties"),
                    },
                );
                drawer_closed = true;
                break;
            } else if let Some(rest) = text.strip_prefix(':') {
                if let Some((key, _)) = rest
                    .split_once(':')
                    .filter(|(key, _)| !key.is_empty() && !key.chars().any(char::is_whitespace))
                {
                    let colon = raw.find(':').unwrap_or(0) + 1 + key.len();
                    let key = key.to_lowercase();
                    let span =
                        self.trimmed(at + colon + 1..at + raw.trim_end_matches(['\r', '\n']).len());
                    props.insert(key.clone(), json!(&self.source[span.clone()]));
                    property_lines.insert(key.clone(), json!(self.line(at)));
                    property_order.push(key.clone());
                    self.slot(
                        &format!("{path}/properties/{}", pointer(&key)),
                        span,
                        Kind::Text,
                    );
                } else {
                    stray.push(json!({"line":self.line(at),"text":text}));
                }
            } else {
                stray.push(json!({"line":self.line(at),"text":text}));
            }
            at += raw.len();
        }
        if !drawer_closed {
            drawer = drawer_start.map(|s| s..direct_end);
        }
        if drawer_start.is_none() {
            let insertion = h.planning().map_or(after_header, |p| offset(p.end()));
            let has_newline = self.source[..insertion].ends_with('\n');
            self.drawers.insert(
                format!("{path}/properties"),
                DrawerTarget {
                    at: insertion,
                    indent,
                    newline: newline.into(),
                    existing: false,
                    prefix: if !has_newline {
                        newline.into()
                    } else {
                        String::new()
                    },
                    terminal_newline: has_newline,
                    target: format!("{path}/properties"),
                },
            );
        }
        let mut value = self.body(h.section(), path, drawer);
        let title_raw = h.title_raw();
        let title = title_raw.trim();
        let title_node = h
            .syntax()
            .children()
            .find(|n| n.kind() == SyntaxKind::HEADLINE_TITLE);
        if let Some(n) = title_node {
            let span = self.trimmed(offset(n.text_range().start())..offset(n.text_range().end()));
            self.slot(&format!("{path}/title"), span, Kind::Text);
        }
        value["title"] = json!(title);
        value["level"] = json!(h.level());
        value["line"] = json!(self.line(start));
        value["start"] = json!(start);
        value["end"] = json!(offset(h.end()));
        value["properties"] = Value::Object(props);
        value["property_lines"] = Value::Object(property_lines);
        value["property_order"] = json!(property_order);
        value["drawer_stray_lines"] = json!(stray);
        value["drawer_closed"] = json!(drawer_closed);
        value["drawer_line"] = json!(drawer_start.map(|at| self.line(at)));
        let children = h
            .headlines()
            .enumerate()
            .map(|(i, h)| self.heading(h, &format!("{path}/children/{i}"), depth + 1))
            .collect::<Result<Vec<_>, _>>()?;
        value["children"] = json!(children);
        Ok(value)
    }

    fn body(&mut self, section: Option<Section>, path: &str, skip: Option<Range<usize>>) -> Value {
        let Some(section) = section else {
            return json!({"content":[],"items":[],"tables":[]});
        };
        let mut content = Vec::new();
        let mut at = offset(section.start());
        for raw in self.source[offset(section.start())..offset(section.end())].split_inclusive('\n')
        {
            if !skip.as_ref().is_some_and(|r| r.contains(&at)) {
                content
                    .push(json!({"text":raw.trim_end_matches(['\r','\n']),"line":self.line(at)}));
            }
            at += raw.len();
        }
        let items = section
            .syntax()
            .descendants()
            .filter_map(ListItem::cast)
            .enumerate()
            .map(|(i, item)| self.item(item, &format!("{path}/items/{i}")))
            .collect::<Vec<_>>();
        let mut tables = Vec::new();
        for (i, table) in section
            .syntax()
            .descendants()
            .filter_map(OrgTable::cast)
            .enumerate()
        {
            let mut rows = Vec::new();
            for row in table
                .syntax()
                .children()
                .filter_map(OrgTableRow::cast)
                .filter(|r| r.is_standard())
            {
                let row_index = rows.len();
                let mut cells = Vec::new();
                for (column, cell) in row
                    .syntax()
                    .children()
                    .filter_map(OrgTableCell::cast)
                    .enumerate()
                {
                    let span = self.trimmed(offset(cell.start())..offset(cell.end()));
                    cells.push(json!(&self.source[span.clone()]));
                    self.slot(
                        &format!("{path}/tables/{i}/{row_index}/cells/{column}"),
                        span,
                        Kind::Cell,
                    );
                }
                rows.push(json!({"line":self.line(offset(row.start())),"cells":cells}));
            }
            tables.push(json!(rows));
        }
        json!({"content":content,"items":items,"tables":tables})
    }

    fn item(&mut self, item: ListItem, path: &str) -> Value {
        let start = offset(item.start());
        let end = self.line_end(start);
        let paragraphs = item
            .syntax()
            .descendants()
            .filter_map(Paragraph::cast)
            .filter(|p| nearest_item(p.syntax()).as_ref() == Some(item.syntax()))
            .collect::<Vec<_>>();
        let text_start = paragraphs
            .first()
            .map_or(end, |p| offset(p.start()).min(end));
        let span = self.trimmed(text_start..end);
        let text = self.source[span.clone()].to_string();
        self.slot(&format!("{path}/text"), span, Kind::Text);
        let checkbox = item.checkbox().map(|t| {
            self.slot(
                &format!("{path}/checkbox"),
                offset(t.text_range().start())..offset(t.text_range().end()),
                Kind::Checkbox,
            );
            t.to_string()
        });
        let mut fields = Map::new();
        let mut lines = Map::new();
        let mut spans: BTreeMap<String, Range<usize>> = BTreeMap::new();
        let mut previous: Option<String> = None;
        let field_indent = text_start.saturating_sub(self.starts[self.line(text_start) - 1]);
        for paragraph in paragraphs {
            let mut at = offset(paragraph.start());
            for raw in paragraph.raw().split_inclusive('\n') {
                let trimmed = raw.trim();
                let indent =
                    at - self.starts[self.line(at) - 1] + raw.len() - raw.trim_start().len();
                let pair = trimmed
                    .split_once(" :: ")
                    .or_else(|| trimmed.split_once(':'));
                if let Some((key, _)) = pair.filter(|(key, _)| {
                    !key.is_empty()
                        && key
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || "_-".contains(c))
                        && indent == field_indent
                }) {
                    let separator = if trimmed.contains(" :: ") {
                        " :: "
                    } else {
                        ":"
                    };
                    let local = raw.find(separator).unwrap_or(0) + separator.len();
                    let span =
                        self.trimmed(at + local..at + raw.trim_end_matches(['\r', '\n']).len());
                    fields.insert(key.into(), json!(&self.source[span.clone()]));
                    lines.insert(key.into(), json!(self.line(at)));
                    spans.insert(key.into(), span);
                    previous = Some(key.into());
                } else if !trimmed.is_empty()
                    && indent > field_indent
                    && let Some(key) = &previous
                    && let Some(value) = fields.get_mut(key)
                {
                    *value = json!(format!("{}\n{trimmed}", value.as_str().unwrap_or_default()));
                    spans.remove(key);
                }
                at += raw.len();
            }
        }
        for (key, span) in spans {
            self.slot(
                &format!("{path}/fields/{}", pointer(&key)),
                span,
                Kind::Text,
            );
        }
        let tag = item
            .tag()
            .map(|n| n.to_string())
            .collect::<String>()
            .trim()
            .to_string();
        if !tag.is_empty() {
            fields.insert(tag.clone(), json!(text));
            lines.insert(tag.clone(), json!(self.line(text_start)));
            self.slot(
                &format!("{path}/fields/{}", pointer(&tag)),
                self.trimmed(text_start..end),
                Kind::Text,
            );
        }
        json!({"line":self.line(start),"indent":item.indent(),"text":text,"checkbox":checkbox,"fields":fields,"field_lines":lines})
    }
}

fn nearest_item(node: &SyntaxNode) -> Option<SyntaxNode> {
    node.ancestors()
        .skip(1)
        .find(|n| n.kind() == SyntaxKind::LIST_ITEM)
}
