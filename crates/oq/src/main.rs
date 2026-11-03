use std::io::Write;
use std::process::ExitCode;

fn main() -> ExitCode {
    let mut out = std::io::BufWriter::new(std::io::stdout().lock());
    let result = oq::run(std::env::args_os().skip(1).collect(), &mut out)
        .and_then(|code| out.flush().map(|()| code).map_err(|e| e.to_string()));
    match result {
        Ok(code) => ExitCode::from(code),
        Err(error) => {
            eprintln!("oq: {error}");
            ExitCode::from(2)
        }
    }
}
