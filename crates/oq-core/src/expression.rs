use crate::Error;
use jaq_core::load::{Arena, File, Loader};
use jaq_core::{Ctx, Vars, data};
use jaq_json::Val;
use serde_json::Value;

/// A compiled, owned jq program reusable across every selected schema node.
pub(crate) struct Program(jaq_core::Filter<data::JustLut<Val>>);

impl Program {
    pub(crate) fn compile(code: &str) -> Result<Self, Error> {
        let arena = Arena::default();
        let loader = Loader::new(
            jaq_core::defs()
                .chain(
                    jaq_std::defs()
                        .filter(|d| !["debug", "stderr", "halt_error"].contains(&d.name)),
                )
                .chain(jaq_json::defs())
                .chain(extra_defs()),
        );
        let modules = loader
            .load(&arena, File { code, path: () })
            .map_err(|e| Error::Expression(format!("{e:?}")))?;
        // Exclude process environment, clock, and logging effects so native and
        // import-free WASM execution have the same deterministic boundary.
        let funs = jaq_core::funs()
            .chain(jaq_std::funs().filter(|(name, _, _)| {
                !["env", "now", "debug_empty", "stderr_empty"].contains(name)
            }))
            .chain(jaq_json::funs());
        let filter = jaq_core::Compiler::default()
            .with_funs(funs)
            .compile(modules)
            .map_err(|e| Error::Expression(format!("{e:?}")))?;
        Ok(Self(filter))
    }

    pub(crate) fn run(&self, input: &Value) -> Result<Vec<Value>, Error> {
        let bytes = serde_json::to_vec(input).map_err(|e| Error::Document(e.to_string()))?;
        let input =
            jaq_json::read::parse_single(&bytes).map_err(|e| Error::Document(format!("{e:?}")))?;
        let context = Ctx::<data::JustLut<Val>>::new(&self.0.lut, Vars::new([]));
        let mut out = Vec::new();
        for value in self.0.id.run((context, input)) {
            if out.len() >= 100_000 {
                return Err(Error::Expression("output exceeds 100000 values".into()));
            }
            // jaq's CLI-oriented unwrap_valr exits the process on halt. An
            // embeddable library must handle control flow without that helper.
            let value = match value {
                Ok(value) => value,
                Err(exception) => {
                    let message = match exception.get_err() {
                        Ok(error) => error.to_string(),
                        Err(control) => match control.get_halt() {
                            Ok(code) => {
                                format!("halt({code}) is not permitted in the embedded engine")
                            }
                            Err(_) => "unhandled jq control flow".into(),
                        },
                    };
                    return Err(Error::Expression(message));
                }
            };
            out.push(
                serde_json::from_str(&value.to_string())
                    .map_err(|e| Error::Expression(format!("non-JSON query result: {e}")))?,
            );
        }
        Ok(out)
    }
}

pub(crate) fn check(code: &str) -> Result<(), Error> {
    Program::compile(code).map(|_| ())
}

pub(crate) fn evaluate(code: &str, input: &Value) -> Result<Vec<Value>, Error> {
    Program::compile(code)?.run(input)
}

fn extra_defs() -> impl Iterator<Item = jaq_core::load::parse::Def<&'static str>> {
    // jq's stream membership helper is not in jaq-std's current definitions.
    jaq_core::load::parse("def IN(s): . as $x | any(s; . == $x);", |p| p.defs())
        .expect("the built-in membership definition is valid jq")
        .into_iter()
}
