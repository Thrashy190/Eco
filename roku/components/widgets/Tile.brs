sub init()
    m.art = m.top.FindNode("art")
    m.back = m.top.FindNode("back")
    m.heart = m.top.FindNode("heart")
    m.ring = m.top.FindNode("ring")
    m.cover = m.top.FindNode("cover")
    m.title = m.top.FindNode("title")
    m.subtitle = m.top.FindNode("subtitle")
    m.side = 0
    m.global.ObserveFieldScoped("theme", "restyle")
end sub

sub layout()
    side = m.top.width
    if side <= 0 then return
    m.side = side
    for each picture in [m.back, m.heart, m.cover]
        picture.width = side
        picture.height = side
    end for
    ' The ring sits on the cover's edge, inside the card: a Roku list cuts whatever a card draws outside itself
    m.ring.translation = [0, 0]
    m.ring.width = side
    m.ring.height = side
    m.title.width = side
    m.title.translation = [0, side + 16]
    m.subtitle.width = side
    m.subtitle.translation = [0, side + 52]
    m.subtitle.visible = side >= 180
    restyle()
end sub

sub show()
    content = m.top.itemContent
    if content = invalid then return
    m.title.text = content.title
    m.subtitle.text = content.description
    restyle()
end sub

' The shape and the Favorites picture follow the account's look.
sub restyle()
    content = m.top.itemContent
    if content = invalid or m.side <= 0 then return
    theme = m.global.theme
    shape = theme.corners
    if content.HasField("shape") and content.shape <> "" then shape = content.shape
    m.back.uri = "pkg:/images/mask-" + shape + ".png"
    m.ring.uri = "pkg:/images/ring-" + shape + ".png"
    m.ring.blendColor = theme.accent
    favorites = content.HasField("kind") and content.kind = "favorites"
    m.heart.visible = favorites
    if favorites
        m.cover.uri = ""
        if theme.favorites = "accent"
            m.back.blendColor = theme.accent
            m.heart.blendColor = theme.ink
        else
            m.back.blendColor = "0x8C6CFFFF" ' Eco's own violet
            m.heart.blendColor = "0xFFFFFFFF"
        end if
    else
        m.back.blendColor = "0x1D1D26FF"
        art = invalid
        if content.HasField("art") then art = content.art
        m.cover.uri = artUrl(art, Int(m.side), shape)
    end if
    paint()
end sub

sub paint()
    ' In a RowList the row can be the focused one while the list itself is not: both must hold
    inRow = m.top.rowHasFocus and m.top.rowListHasFocus
    focused = m.top.focusPercent > 0.5 and (inRow or m.top.gridHasFocus)
    m.ring.visible = focused
    if focused then m.title.color = "0xFFFFFFFF" else m.title.color = "0xE4E4EAFF"
end sub
