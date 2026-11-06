' The look, taken from the account like every other device (stores/look.ts, GET /api/me/look): the accent the person
' chose, or with dynamic colour on, the colour of the cover playing, which Eco works out on the server
' (/api/covers/accent) with the web app's maths. The glow behind everything always takes the cover's colour.
' Everything on screen reads m.global.theme.

sub initTheme()
    m.look = {accent: "#7cf0c0", dynamic: false, page: "black", corners: "soft", favorites: "classic"}
    m.coverColors = {}
    m.coverColors.SetModeCaseSensitive()
    m.themeCover = ""
end sub

sub loadLook()
    fetch("look", apiUrl("me/look"), "onLook")
end sub

sub onLook(event as Object)
    answer = answerOf(event)
    if answer = invalid or not answer.ok then return
    look = objectOf(objectOf(answer.data)["look"])
    if isHexColor(look["accent"]) then m.look.accent = LCase(look["accent"])
    m.look.dynamic = isTrue(look["dynamicAccent"])
    ' The TV is always dark: "black" is the black theme, anything else Eco's dark grey
    if textOf(look["theme"]) = "black" then m.look.page = "black" else m.look.page = "dark"
    if textOf(look["corners"]) = "sharp" then m.look.corners = "sharp" else m.look.corners = "soft"
    if textOf(look["favoritesColor"]) = "accent" then m.look.favorites = "accent" else m.look.favorites = "classic"
    m.coverColors.Clear() ' the page colour changes the accent
    applyTheme()
    themeForSong()
end sub

' A new song: learn its cover's colours, once per cover.
sub themeForSong()
    song = currentSong()
    cover = ""
    if song <> invalid then cover = textOf(song["cover"])
    m.themeCover = cover
    if cover <> "" and not m.coverColors.DoesExist(cover)
        fetch("coverAccent", apiUrl("covers/accent", {id: cover, theme: m.look.page}), "onCoverAccent")
        m.pendingCover = cover
    end if
    applyTheme()
end sub

sub onCoverAccent(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    colors = {}
    if answer.ok then colors = objectOf(answer.data)
    m.coverColors[m.pendingCover] = colors
    applyTheme()
end sub

sub applyTheme()
    accent = m.look.accent
    glow = accent
    colors = invalid
    if m.themeCover <> "" then colors = m.coverColors[m.themeCover]
    if colors <> invalid
        if isHexColor(colors["color"]) then glow = colors["color"]
        if m.look.dynamic and isHexColor(colors["accent"]) then accent = colors["accent"]
    end if
    page = "0x0B0B0FFF"
    if m.look.page = "black" then page = "0x000000FF"
    m.global.theme = {
        accent: rokuColor(accent),
        accentSoft: rokuColor(accent, "4D"),
        ink: rokuColor(inkFor(accent)),
        glow: rokuColor(glow),
        page: page,
        corners: m.look.corners,
        favorites: m.look.favorites,
        hasSong: currentSong() <> invalid
    }
    m.top.backgroundColor = page
end sub
