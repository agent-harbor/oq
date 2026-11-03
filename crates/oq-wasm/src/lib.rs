//! Minimal import-free WebAssembly ABI; ownership is documented in docs/contract.md.
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Parse { source: String },
    Query { source: String, expression: String },
    Set { source: String, expression: String },
    Validate { source: String, schema: String },
}

/// Dispatch one UTF-8 JSON request without process or filesystem dependencies.
pub fn dispatch(request: &[u8]) -> Vec<u8> {
    let result = (|| -> Result<Value, String> {
        let request: Request = serde_json::from_slice(request).map_err(|e| e.to_string())?;
        match request {
            Request::Parse { source } => oq_core::parse(&source).map(|d| d.value),
            Request::Query { source, expression } => {
                oq_core::query(&source, &expression).map(|v| json!(v))
            }
            Request::Set { source, expression } => {
                oq_core::set(&source, &expression).map(|s| json!(s))
            }
            Request::Validate { source, schema } => {
                oq_core::validate(&source, &schema).map(|r| json!(r))
            }
        }
        .map_err(|e| e.to_string())
    })();
    let response = match result {
        Ok(value) => json!({"ok":value}),
        Err(error) => json!({"error":error}),
    };
    response.to_string().into_bytes()
}

#[cfg(target_arch = "wasm32")]
mod abi {
    /// Allocate a live zero-filled byte slice. Ownership passes to the caller.
    #[unsafe(no_mangle)]
    pub extern "C" fn oq_alloc(length: usize) -> *mut u8 {
        Box::into_raw(vec![0u8; length].into_boxed_slice()).cast::<u8>()
    }

    /// Release a buffer returned by oq_alloc or oq_execute exactly once.
    ///
    /// # Safety
    /// `pointer` and `length` must describe a currently live allocation returned
    /// by this module. Arbitrary pointers, resizing, and double frees are invalid.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn oq_free(pointer: *mut u8, length: usize) {
        // SAFETY: the caller transfers back the exact slice allocation.
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                pointer, length,
            )));
        }
    }

    /// Borrow a request and return a separately owned response as pointer/length.
    ///
    /// # Safety
    /// The input must be an initialized live oq_alloc buffer of `length` bytes.
    /// It stays owned by the caller and must not be freed until this call ends.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn oq_execute(pointer: *const u8, length: usize) -> u64 {
        // SAFETY: the caller keeps the input allocation alive for this borrow.
        let input = unsafe { std::slice::from_raw_parts(pointer, length) };
        let output = super::dispatch(input).into_boxed_slice();
        let length = output.len() as u64;
        let pointer = Box::into_raw(output).cast::<u8>() as u64;
        (pointer << 32) | length
    }
}
