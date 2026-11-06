sub init()
    m.bg = m.top.FindNode("bg")
    m.cover = m.top.FindNode("cover")
    m.title = m.top.FindNode("title")
    m.artist = m.top.FindNode("artist")
    m.state = m.top.FindNode("state")
    m.progress = m.top.FindNode("progress")
    m.top.visible = false
    m.top.focusable = true
    m.top.ObserveField("focusedChild", "paint")
    m.global.ObserveFieldScoped("nowPlaying", "onNowPlaying")
    m.global.ObserveFieldScoped("position", "onPosition")
    m.global.ObserveFieldScoped("theme", "paint")
end sub

sub onNowPlaying()
    now = m.global.nowPlaying
    song = now["song"]
    if song = invalid then return
    m.title.text = textOf(song["title"])
    m.artist.text = textOf(song["artist"])
    m.cover.uri = artUrl(songArt(song), 64, "circle")
    if isTrue(now["playing"]) then m.state.uri = "pkg:/images/icons/pause.png" else m.state.uri = "pkg:/images/icons/play.png"
end sub

sub paint()
    theme = m.global.theme
    focused = m.top.HasFocus()
    if focused
        m.bg.blendColor = theme.accent
        m.title.color = theme.ink
        m.artist.color = theme.ink
        m.state.blendColor = theme.ink
        m.progress.color = theme.ink
    else
        m.bg.blendColor = "0x1C1C22F2"
        m.title.color = "0xF4F4F7FF"
        m.artist.color = "0x9B9BA8FF"
        m.state.blendColor = theme.accent
        m.progress.color = theme.accent
    end if
end sub

sub onPosition()
    at = m.global.position
    length = numberOf(at["length"])
    if length <= 0
        m.progress.width = 0
        return
    end if
    share = numberOf(at["position"]) / length
    if share > 1 then share = 1
    m.progress.width = 360 * share
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if press and key = "OK"
        m.top.chosen = true
        return true
    end if
    return false
end function
