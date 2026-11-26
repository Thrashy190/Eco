// No console window next to the app on Windows, except in development builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    eco_desktop_lib::run()
}
