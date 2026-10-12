fn main() {
    // tauri-build only registers `tauri.conf.json` and `capabilities/` as
    // re-run triggers — NOT the icon. Without this, swapping icons/icon.ico
    // leaves the previously compiled resource.lib (with the old icon) linked
    // into every subsequent build.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
