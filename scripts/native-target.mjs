/** Native archive targets; Linux is musl-static and Windows uses static CRT. */
export function nativeTarget() {
  const architecture = { x64: "x86_64", arm64: "aarch64" }[process.arch];
  if (!architecture)
    throw new Error(`Unsupported release architecture ${process.arch}`);
  if (process.platform === "linux") return `${architecture}-unknown-linux-musl`;
  if (process.platform === "win32") return `${architecture}-pc-windows-msvc`;
  if (process.platform === "darwin" && process.arch === "arm64")
    return "aarch64-apple-darwin";
  throw new Error(`Unsupported release platform ${process.platform}`);
}
