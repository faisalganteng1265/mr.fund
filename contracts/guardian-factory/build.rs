//! Copies the prepared Guardian WASM into OUT_DIR. A missing artifact yields an
//! empty blob (so native `cargo test` works on a fresh clone) and every create
//! method refuses to run with it.
use std::{env, fs, path::PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let source = manifest.join("../target/near/guardian/guardian.wasm");
    println!("cargo:rerun-if-changed={}", source.display());
    let out = PathBuf::from(env::var("OUT_DIR").expect("out dir")).join("guardian.wasm");
    fs::write(out, fs::read(&source).unwrap_or_default()).expect("write guardian blob");
}
