sub init()
    m.wash = m.top.FindNode("wash")
    m.cover = m.top.FindNode("cover")
    m.title = m.top.FindNode("title")
    m.artist = m.top.FindNode("artist")
    m.card = m.top.FindNode("card")
    m.path = m.top.FindNode("path")
    m.move = m.top.FindNode("move")
    m.card.translation = [740, 220]
    m.shown = ""
    m.top.FindNode("check").ObserveField("fire", "refresh")
    m.top.FindNode("drift").ObserveField("fire", "drift")
    m.top.FindNode("check").control = "start"
    m.top.FindNode("drift").control = "start"
    refresh()
end sub

sub refresh()
    saved = CreateObject("roRegistrySection", "eco").Read("playing")
    if saved = m.shown then return
    m.shown = saved
    playing = objectOf(ParseJson(saved))
    cover = textOf(playing["cover"])
    if cover = ""
        m.cover.uri = "pkg:/images/logo.png"
        m.wash.uri = ""
        m.title.text = "Eco"
        m.artist.text = ""
        return
    end if
    m.cover.uri = cover
    ' The same cover a few pixels wide, stretched: only its colours remain (see widgets/Backdrop.xml)
    m.wash.uri = textOf(playing["wash"])
    m.title.text = textOf(playing["title"])
    m.artist.text = textOf(playing["artist"])
end sub

sub drift()
    x = 96 + Rnd(1920 - 192 - 700) - 1
    y = 54 + Rnd(1080 - 108 - 600) - 1
    m.path.keyValue = [m.card.translation, [x, y]]
    m.move.control = "start"
end sub
