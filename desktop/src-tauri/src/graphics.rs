//! How WebKitGTK draws the window on Linux.
//!
//! With NVIDIA's own driver, WebKitGTK turns its GPU renderer off by itself (its DMA-BUF buffers fail there: "Failed to
//! create GBM buffer … Invalid argument"), and on X11 it has no other accelerated path: its hardware acceleration policy
//! becomes "never" whatever the app asks, and the processor paints every frame. Eco's blurred glass and colour wash then
//! made the window slow, with the web process near 70% of a core (WebKitGTK 2.50.4, a GeForce GT 1030 with driver 580,
//! X11). Forcing that renderer and handing frames to the window in shared memory draws on the graphics card and shows
//! them correctly (webkit://gpu: policy "always", GL_RENDERER the NVIDIA card, no warning).
//!
//! Someone who sets any of WebKit's rendering switches keeps their own choice.

/// WebKit's switches that decide how it renders. If any is set, nothing is added.
const CHOICES: [&str; 6] = [
    "WEBKIT_DISABLE_DMABUF_RENDERER",
    "WEBKIT_FORCE_DMABUF_RENDERER",
    "WEBKIT_DMABUF_RENDERER_FORCE_SHM",
    "WEBKIT_DMABUF_RENDERER_DISABLE_GBM",
    "WEBKIT_DISABLE_COMPOSITING_MODE",
    "WEBKIT_FORCE_COMPOSITING_MODE",
];

/// The variables to set, given whether NVIDIA's driver is loaded and which variables are already set.
pub fn overrides(nvidia: bool, is_set: impl Fn(&str) -> bool) -> Vec<(&'static str, &'static str)> {
    if !nvidia || CHOICES.iter().any(|name| is_set(name)) {
        return Vec::new();
    }
    vec![
        ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
        ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1"),
    ]
}

/// Sets them for this process before any window exists, so WebKit and the processes it starts read them. It runs first
/// thing, while the program has a single thread.
pub fn prepare() {
    let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
    for (name, value) in overrides(nvidia, |name| std::env::var_os(name).is_some()) {
        std::env::set_var(name, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia_gets_the_gpu_renderer_with_shared_memory() {
        let set = overrides(true, |_| false);
        assert_eq!(
            set,
            vec![
                ("WEBKIT_FORCE_DMABUF_RENDERER", "1"),
                ("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1")
            ]
        );
    }

    #[test]
    fn other_graphics_cards_keep_webkits_own_choice() {
        assert!(overrides(false, |_| false).is_empty());
    }

    // WEBKIT_DISABLE_DMABUF_RENDERER=1 was the first thing tried: someone who set it, or any other switch, keeps it
    #[test]
    fn a_switch_set_by_hand_wins() {
        for name in CHOICES {
            assert!(overrides(true, |n| n == name).is_empty(), "{name}");
        }
    }
}
