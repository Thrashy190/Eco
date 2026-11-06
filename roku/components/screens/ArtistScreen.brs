sub init()
    m.cover = m.top.FindNode("cover")
    m.nameLabel = m.top.FindNode("name")
    m.subtitle = m.top.FindNode("subtitle")
    m.actions = m.top.FindNode("actions")
    m.status = m.top.FindNode("status")
    m.albums = m.top.FindNode("albums")
    m.songsLabel = m.top.FindNode("songsLabel")
    m.list = m.top.FindNode("list")
    m.menu = m.top.FindNode("menu")
    m.actions.items = [{label: "Play", icon: "play", primary: true}, {label: "Shuffle", icon: "shuffle"}]
    m.actions.ObserveField("chosen", "onAction")
    m.albums.ObserveField("rowItemSelected", "onAlbumSelected")
    m.list.ObserveField("itemSelected", "onSongSelected")
    m.menu.ObserveField("chosen", "onSongMenuChosen")
    m.menu.ObserveField("closed", "onSongMenuClosed")
    m.songs = []
    m.albumCount = 0
end sub

sub load()
    m.id = textOf(m.top.args["id"])
    m.name = textOf(m.top.args["name"])
    showName()
    if m.id = ""
        fetch("lookup", apiUrl("artists/lookup", {name: m.name}), "onLookup")
    else
        fetchArtist()
    end if
end sub

sub showName()
    m.nameLabel.text = m.name
    y = 606 + m.nameLabel.BoundingRect().height + 8
    m.subtitle.translation = [96, y]
    m.actions.translation = [96, y + 60]
end sub

sub onLookup(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    m.id = textOf(objectOf(answer.data)["id"])
    fetchArtist()
end sub

sub fetchArtist()
    if m.id <> "" then fetch("artist", restUrl("getArtist", {id: m.id}), "onArtist")
    fetch("songs", apiUrl("artists/songs", {name: m.name}), "onSongs")
end sub

sub onArtist(event as Object)
    answer = answerOf(event)
    if answer = invalid or not answer.ok then return
    artist = objectOf(objectOf(answer.data)["artist"])
    if textOf(artist["name"]) <> ""
        m.name = textOf(artist["name"])
        showName()
    end if
    m.cover.uri = artUrl(coverArt(artist["coverArt"]), 380, "circle")
    root = CreateObject("roSGNode", "ContentNode")
    row = root.CreateChild("ContentNode")
    row.title = "Albums"
    for each raw in listOf(artist["album"])
        row.AppendChild(albumTile(objectOf(raw)))
    end for
    m.albumCount = row.GetChildCount()
    if m.albumCount > 0 then m.albums.content = root
    showSummary()
end sub

sub onSongs(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        m.status.text = "Could not load the songs: " + answer.error
        return
    end if
    m.songs = toSongs(objectOf(answer.data)["songs"])
    root = CreateObject("roSGNode", "ContentNode")
    for each song in m.songs
        root.AppendChild(songNode(song, "", songLine(song)))
    end for
    m.list.content = root
    m.songsLabel.visible = m.songs.Count() > 0
    showSummary()
end sub

sub showSummary()
    m.status.visible = m.songs.Count() = 0 and m.albumCount = 0
    parts = []
    if m.albumCount > 0 then parts.Push(plural(m.albumCount, "album"))
    if m.songs.Count() > 0 then parts.Push(plural(m.songs.Count(), "song"))
    m.subtitle.text = parts.Join(" · ")
    ' Without albums of their own, the songs move up
    if m.albumCount = 0
        m.songsLabel.translation = [560, 150]
        m.list.translation = [560, 206]
        m.list.numRows = 9
    end if
end sub

sub takeFocus()
    m.actions.SetFocus(true)
end sub

sub playFrom(index as Integer, shuffled as Boolean)
    if m.songs.Count() = 0 then return
    player("load", {songs: m.songs, index: index, shuffle: shuffled, source: m.name})
    if m.id <> "" then touchRecent("artist", m.id, m.name, "Artist", "")
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

sub onAlbumSelected(event as Object)
    tile = m.albums.content.GetChild(0).GetChild(event.GetData()[1])
    if tile <> invalid then openTile(tile)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    hasAlbums = m.albumCount > 0
    hasSongs = m.songs.Count() > 0
    if key = "right" and m.actions.HasFocus()
        if hasAlbums
            m.albums.SetFocus(true)
        else if hasSongs
            m.list.SetFocus(true)
        end if
        return true
    else if key = "left" and (m.albums.HasFocus() or m.list.HasFocus())
        m.actions.SetFocus(true)
        return true
    else if key = "down" and m.albums.HasFocus() and hasSongs
        m.list.SetFocus(true)
        return true
    else if key = "up" and m.list.HasFocus() and hasAlbums
        m.albums.SetFocus(true)
        return true
    else if key = "options" and m.list.HasFocus()
        song = m.songs[m.list.itemFocused]
        if song <> invalid then openSongMenu(song, m.list, false)
        return true
    end if
    return false
end function
