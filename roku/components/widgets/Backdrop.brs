sub init()
    m.page = m.top.FindNode("page")
    m.wash = m.top.FindNode("wash")
    m.glow = m.top.FindNode("glow")
    m.glow2 = m.top.FindNode("glow2")
    m.veil = m.top.FindNode("veil")
    m.tint = m.top.FindNode("tint")
    m.tintGlow = m.top.FindNode("tintGlow")
    m.tintGlow2 = m.top.FindNode("tintGlow2")
    m.fade = m.top.FindNode("fade")
    m.fadeWash = m.top.FindNode("fadeWash")
    m.fadeVeil = m.top.FindNode("fadeVeil")
    m.color = ""
    m.global.ObserveFieldScoped("theme", "onTheme")
    m.global.ObserveFieldScoped("nowPlaying", "onNowPlaying")
    onTheme()
end sub

sub onTheme()
    theme = m.global.theme
    m.page.color = theme.page
    ' Without music the glow is faint, in the accent
    color = theme.glow
    if not isTrue(theme.hasSong) then color = theme.accent
    if color = m.color then return
    old = m.color
    m.color = color
    if old = ""
        m.glow.blendColor = color
        m.glow2.blendColor = color
        return
    end if
    m.tint.control = "stop"
    m.tintGlow.keyValue = [m.glow.blendColor, color]
    m.tintGlow2.keyValue = [m.glow2.blendColor, color]
    m.tint.control = "start"
    if isTrue(theme.hasSong) then m.glow.opacity = 0.5 else m.glow.opacity = 0.22
end sub

sub onNowPlaying()
    uri = songCoverUrl(m.global.nowPlaying["song"], 12)
    if uri <> m.wash.uri then m.wash.uri = uri
end sub

sub onMode()
    player = m.top.mode = "player"
    m.fade.control = "stop"
    target = 0.0
    if player then target = 1.0
    m.fadeWash.keyValue = [m.wash.opacity, target * 0.85]
    m.fadeVeil.keyValue = [m.veil.opacity, target]
    m.fade.control = "start"
end sub
