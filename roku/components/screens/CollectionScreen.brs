sub init()
    m.cover = m.top.FindNode("cover")
    m.kindLabel = m.top.FindNode("kindLabel")
    m.title = m.top.FindNode("title")
    m.subtitle = m.top.FindNode("subtitle")
    m.actions = m.top.FindNode("actions")
    m.status = m.top.FindNode("status")
    m.list = m.top.FindNode("list")
    m.menu = m.top.FindNode("menu")
    m.actions.items = [{label: "Play", icon: "play", primary: true}, {label: "Shuffle", icon: "shuffle"}]
    m.actions.ObserveField("chosen", "onAction")
    m.list.ObserveField("itemSelected", "onSongSelected")
    m.menu.ObserveField("chosen", "onSongMenuChosen")
    m.menu.ObserveField("closed", "onSongMenuClosed")
    m.songs = []
    m.name = ""
    m.shape = m.global.theme.corners
    m.top.FindNode("back").uri = "pkg:/images/mask-" + m.shape + ".png"
end sub

sub load()
    args = m.top.args
    m.kind = textOf(args["kind"])
    m.id = textOf(args["id"])
    if m.kind = "album"
        m.kindLabel.text = "ALBUM"
        fetch("songs", restUrl("getAlbum", {id: m.id}), "onAlbum")
    else if m.kind = "favorites"
        m.kindLabel.text = "YOUR FAVORITES"
        theme = m.global.theme
        heart = m.top.FindNode("heart")
        heart.visible = true
        if theme.favorites = "accent"
            m.top.FindNode("back").blendColor = theme.accent
            heart.blendColor = theme.ink
        else
            m.top.FindNode("back").blendColor = "0x8C6CFFFF"
        end if
        showHeader("Favorites", "")
        fetch("songs", restUrl("getStarred2"), "onFavorites")
    else
        m.kindLabel.text = "PLAYLIST"
        m.covers = invalid
        m.playlist = invalid
        fetch("covers", apiUrl("me/library"), "onCovers")
        fetch("songs", restUrl("getPlaylist", {id: m.id}), "onPlaylist")
    end if
end sub

sub showHeader(name as String, line as String)
    m.name = name
    m.title.text = name
    m.subtitle.text = line
    y = 700 + m.title.BoundingRect().height + 12
    m.subtitle.translation = [96, y]
    if line <> "" then y = y + m.subtitle.BoundingRect().height
    m.actions.translation = [96, y + 30]
end sub

sub showSongs(songs as Object, numbered as Boolean)
    m.songs = songs
    m.list.content = songsContent(songs, numbered)
    m.status.visible = songs.Count() = 0
    if songs.Count() = 0 then m.status.text = "No songs here yet."
end sub

sub onAlbum(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    album = objectOf(objectOf(answer.data)["album"])
    songs = []
    for each raw in listOf(album["song"])
        song = toSong(objectOf(raw))
        song["track"] = Int(numberOf(raw["track"]))
        songs.Push(song)
    end for
    m.coverId = textOf(album["coverArt"])
    m.cover.uri = artUrl(coverArt(m.coverId), 480, m.shape)
    line = readableArtists(textOf(album["artist"]))
    year = Int(numberOf(album["year"]))
    if year > 0 then line = line + " · " + year.ToStr()
    m.artistLine = readableArtists(textOf(album["artist"]))
    showHeader(textOf(album["name"]), line + chr(10) + collectionSummary(songs))
    showSongs(songs, true)
end sub

sub onFavorites(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    songs = toSongs(objectOf(objectOf(answer.data)["starred2"])["song"])
    ' The most recently liked first, as on every other device
    songs.SortBy("starred", "r")
    showHeader("Favorites", collectionSummary(songs))
    showSongs(songs, false)
end sub

sub onCovers(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    m.covers = {}
    if answer.ok then m.covers = objectOf(objectOf(answer.data)["covers"])
    if m.playlist <> invalid then showPlaylist()
end sub

sub onPlaylist(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    m.playlist = objectOf(objectOf(answer.data)["playlist"])
    if m.covers <> invalid then showPlaylist()
end sub

sub showPlaylist()
    playlist = m.playlist
    m.coverId = textOf(playlist["coverArt"])
    if m.covers.DoesExist(m.id)
        m.cover.uri = artUrl({playlist: m.id, version: m.covers[m.id]}, 480, m.shape)
    else
        m.cover.uri = artUrl(coverArt(m.coverId), 480, m.shape)
    end if
    songs = toSongs(playlist["entry"])
    line = collectionSummary(songs)
    owner = textOf(playlist["owner"])
    if owner <> "" and owner <> m.global.user then line = "By " + owner + chr(10) + line
    showHeader(textOf(playlist["name"]), line)
    showSongs(songs, false)
end sub

sub failed(answer as Object)
    m.status.text = "Could not load this: " + answer.error
    m.status.visible = true
end sub

sub takeFocus()
    if m.lastFocus <> invalid and m.lastFocus.IsSameNode(m.list) and m.songs.Count() > 0
        m.list.SetFocus(true)
    else
        m.actions.SetFocus(true)
    end if
end sub

' Play from song `index`, shuffled or in order, and remember the album or playlist in Recent.
sub playFrom(index as Integer, shuffled as Boolean)
    if m.songs.Count() = 0 then return
    player("load", {songs: m.songs, index: index, shuffle: shuffled, source: m.name})
    if m.kind = "favorites"
        touchRecent("playlist", "favorites", "Favorites", "Playlist", "")
    else if m.kind = "album"
        touchRecent("album", m.id, m.name, m.artistLine, m.coverId)
    else
        touchRecent("playlist", m.id, m.name, "Playlist", m.coverId)
    end if
end sub

sub onAction(event as Object)
    if m.songs.Count() = 0 then return
    if event.GetData() = 0
        playFrom(0, false)
    else
        playFrom(Rnd(m.songs.Count()) - 1, true)
    end if
end sub

sub onSongSelected(event as Object)
    playFrom(event.GetData(), false)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "right" and m.actions.HasFocus() and m.songs.Count() > 0
        m.list.SetFocus(true)
        m.lastFocus = m.list
        return true
    else if key = "left" and m.list.HasFocus()
        m.actions.SetFocus(true)
        m.lastFocus = m.actions
        return true
    else if key = "options" and m.list.HasFocus()
        song = m.songs[m.list.itemFocused]
        if song <> invalid then openSongMenu(song, m.list, m.kind = "album")
        return true
    end if
    return false
end function
