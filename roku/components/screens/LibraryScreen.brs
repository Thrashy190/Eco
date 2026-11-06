sub init()
    m.sections = m.top.FindNode("sections")
    m.grid = m.top.FindNode("grid")
    m.status = m.top.FindNode("status")
    m.count = m.top.FindNode("count")
    m.menu = m.top.FindNode("menu")
    m.sections.items = [{label: "Albums"}, {label: "Artists"}, {label: "Playlists"}, {label: "Audio"}]
    m.sections.ObserveField("chosen", "onSection")
    m.grid.ObserveField("itemSelected", "onSelected")
    m.menu.ObserveField("chosen", "onSortChosen")
    m.menu.ObserveField("closed", "onMenuClosed")
    m.sorts = [{label: "A to Z", type: "alphabeticalByName"}, {label: "Recently added", type: "newest"}, {label: "Artist", type: "alphabeticalByArtist"}]
    m.sort = 0
    m.section = -1
end sub

sub load()
    show(0)
end sub

sub onSection(event as Object)
    show(event.GetData())
end sub

sub show(section as Integer)
    m.section = section
    m.sections.selected = section
    m.sections.focusIndex = section
    m.items = CreateObject("roSGNode", "ContentNode")
    m.grid.content = m.items
    m.count.text = ""
    m.status.text = "Loading..."
    m.status.visible = true
    if section = 0
        m.albumPage = 0
        fetchAlbums()
    else if section = 1
        fetch("list", restUrl("getArtists"), "onArtists")
    else if section = 2
        m.covers = invalid
        m.playlists = invalid
        fetch("covers", apiUrl("me/library"), "onCovers")
        fetch("list", restUrl("getPlaylists"), "onPlaylists")
    else
        fetch("list", apiUrl("media"), "onMedia")
    end if
end sub

' Navidrome hands over 500 albums at most: ask until none are left, or the grid would hold part of the library.
sub fetchAlbums()
    fetch("list", restUrl("getAlbumList2", {type: m.sorts[m.sort].type, size: 500, offset: m.albumPage * 500}), "onAlbums")
end sub

sub onAlbums(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    page = listOf(objectOf(objectOf(answer.data)["albumList2"])["album"])
    tiles = []
    for each raw in page
        tiles.Push(albumTile(raw))
    end for
    added(tiles)
    m.count.text = plural(m.items.GetChildCount(), "album") + " · " + m.sorts[m.sort].label + "   (* to sort)"
    if page.Count() = 500
        m.albumPage = m.albumPage + 1
        fetchAlbums()
    end if
end sub

sub onArtists(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    tiles = []
    for each group in listOf(objectOf(objectOf(answer.data)["artists"])["index"])
        for each raw in listOf(objectOf(group)["artist"])
            tiles.Push(artistTile(raw))
        end for
    end for
    added(tiles)
    m.count.text = plural(tiles.Count(), "artist")
end sub

sub onCovers(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    m.covers = {}
    if answer.ok then m.covers = objectOf(objectOf(answer.data)["covers"])
    if m.playlists <> invalid then showPlaylists()
end sub

sub onPlaylists(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    m.playlists = listOf(objectOf(objectOf(answer.data)["playlists"])["playlist"])
    if m.covers <> invalid then showPlaylists()
end sub

sub showPlaylists()
    tiles = [favoritesTile()]
    for each raw in m.playlists
        tiles.Push(playlistTile(raw, m.covers))
    end for
    added(tiles)
    m.count.text = plural(m.playlists.Count(), "playlist")
end sub

sub onMedia(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        failed(answer)
        return
    end if
    tiles = []
    for each item in listOf(objectOf(answer.data)["items"])
        song = mediaToSong(objectOf(item))
        tile = songTile(song)
        tile.description = song["album"] + " · " + song["artist"]
        tiles.Push(tile)
    end for
    added(tiles)
    if tiles.Count() = 0
        m.status.text = "Nothing imported yet. Podcasts and audiobooks you add in Eco show up here."
        m.status.visible = true
    end if
    m.count.text = plural(tiles.Count(), "item")
end sub

sub added(tiles as Object)
    m.items.AppendChildren(tiles)
    m.status.visible = m.items.GetChildCount() = 0
    if m.status.visible then m.status.text = "Nothing here yet."
end sub

sub failed(answer as Object)
    m.status.text = "Could not load this: " + answer.error
    m.status.visible = true
end sub

sub takeFocus()
    if m.grid.content <> invalid and m.grid.content.GetChildCount() > 0 and not m.sections.IsInFocusChain()
        m.grid.SetFocus(true)
    else
        m.sections.SetFocus(true)
    end if
end sub

sub onSelected(event as Object)
    tile = m.items.GetChild(event.GetData())
    if tile <> invalid then openTile(tile)
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "down" and m.sections.HasFocus() and m.items.GetChildCount() > 0
        m.grid.SetFocus(true)
        return true
    else if key = "up" and m.grid.HasFocus()
        m.sections.SetFocus(true)
        return true
    else if key = "options" and m.section = 0
        options = []
        for each sort in m.sorts
            options.Push(sort.label)
        end for
        m.menu.title = "Order albums by"
        m.menu.options = options
        m.menu.show = true
        return true
    end if
    return false
end function

sub onSortChosen(event as Object)
    m.sort = event.GetData()
    show(0)
end sub

sub onMenuClosed()
    if m.top.visible then m.sections.SetFocus(true)
end sub
