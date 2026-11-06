sub init()
    m.bg = m.top.FindNode("bg")
    m.mask = m.top.FindNode("mask")
    m.cover = m.top.FindNode("cover")
    m.number = m.top.FindNode("number")
    m.playing = m.top.FindNode("playing")
    m.title = m.top.FindNode("title")
    m.subtitle = m.top.FindNode("subtitle")
    m.length = m.top.FindNode("length")
    m.global.ObserveFieldScoped("currentId", "paint")
    m.global.ObserveFieldScoped("theme", "paint")
end sub

sub layout()
    width = m.top.width
    height = m.top.height
    if width <= 0 then return
    m.bg.width = width
    m.bg.height = height
    m.title.width = width - 96 - 150
    m.subtitle.width = width - 96 - 150
    m.length.width = 120
    m.length.translation = [width - 140, (height - 32) / 2]
    m.playing.translation = [31, (height - 26) / 2]
end sub

sub show()
    content = m.top.itemContent
    if content = invalid then return
    m.title.text = content.title
    m.subtitle.text = content.description
    m.length.text = content.shortDescriptionLine1
    m.hasCover = content.HDPosterUrl <> ""
    if m.hasCover then m.cover.uri = content.HDPosterUrl
    m.number.text = content.shortDescriptionLine2
    paint()
end sub

sub paint()
    theme = m.global.theme
    m.mask.uri = "pkg:/images/mask-" + theme.corners + ".png"
    focused = m.top.focusPercent > 0.5 and (m.top.listHasFocus or m.top.gridHasFocus)
    if focused then m.bg.blendColor = "0xFFFFFF1F" else m.bg.blendColor = "0xFFFFFF00"
    content = m.top.itemContent
    current = content <> invalid and content.id <> "" and content.id = m.global.currentId
    ' The song playing: its title in the accent and, in a numbered list, a play mark instead of the number
    if current then m.title.color = theme.accent else m.title.color = "0xF4F4F7FF"
    hasCover = m.hasCover = true
    m.mask.visible = hasCover
    m.cover.visible = hasCover
    m.number.visible = not hasCover and not current
    m.playing.visible = not hasCover and current
    m.playing.blendColor = theme.accent
end sub
