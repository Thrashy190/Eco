//! Whether WebKitGTK paints the window on the processor, so the page draws a lighter Eco there.
//!
//! Where WebKitGTK cannot use the graphics card, its hardware acceleration policy is "never" whatever the app asks, and
//! the processor paints every frame. That is the case with NVIDIA's own driver: WebKitGTK turns its DMA-BUF renderer
//! off there, and X11 has no other accelerated path. Scrolling then repainted everything behind the page, and three of
//! Eco's effects made it crawl (8–16 frames a second at 1920×1100): the fade at the top of the scrolling page, the
//! masked washes of colour, and the blurred shadows under covers. Without them it ran at 53–62 (`data-lite` in
//! web/src/styles.css).
//!
//! Forcing the renderer back on was tried (WEBKIT_FORCE_DMABUF_RENDERER with WEBKIT_DMABUF_RENDERER_FORCE_SHM): it draws
//! on the card, but leaks a sync_file descriptor for nearly every frame (WebKitGTK 2.50.4, driver 580), and at the usual
//! limit of 1024 the web process dies with "Too many open files".

use webkit2gtk::{HardwareAccelerationPolicy, SettingsExt};

/// Whether a new web view gets no hardware acceleration. WebKitGTK decides it when GTK starts, which has happened by the
/// time `setup` runs.
pub fn paints_on_processor() -> bool {
    webkit2gtk::Settings::new().hardware_acceleration_policy() == HardwareAccelerationPolicy::Never
}
