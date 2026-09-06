#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --offline --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/mandelbrot_drift.wasm web/mandelbrot_drift.wasm
cargo build --offline --release --target wasm32-unknown-unknown --no-default-features
cp target/wasm32-unknown-unknown/release/mandelbrot_drift.wasm web/mandelbrot_drift_scalar.wasm
chmod 644 web/mandelbrot_drift.wasm web/mandelbrot_drift_scalar.wasm
echo 'Built web/mandelbrot_drift.wasm. Serve with: python3 scripts/serve.py'
