sub init()
    m.keyboard = m.top.FindNode("keyboard")
    m.status = m.top.FindNode("status")
    m.results = m.top.FindNode("results")
    m.debounce = m.top.FindNode("debounce")
    m.menu = m.top.FindNode("menu")
    m.keyboard.ObserveField("text", "onTyped")
    m.debounce.ObserveField("fire", "search")
    m.results.ObserveField("itemSelected", "onSelected")
    m.menu.ObserveField("chosen", "onSongMenuChosen")
    m.menu.ObserveField("closed", "onSongMenuClosed")
    m.found = []
    m.songs = []
end sub

sub takeFocus()
    if m.lastFocus <> invalid and m.lastFocus.IsSameNode(m.results) and m.found.Count() > 0
        m.results.SetFocus(true)
    else
        m.keyboard.SetFocus(true)
    end if
end sub

' Wait for a pause in the typing before asking.
sub onTyped()
    m.debounce.control = "stop"
    m.debounce.control = "start"
end sub

sub search()
    query = m.keyboard.text.Trim()
    if Len(query) < 2
        m.found = []
        m.results.content = invalid
        m.status.text = ""
        return
    end if
    m.status.text = "Searching..."
    m.status.visible = true
    fetch("search", apiUrl("search", {q: query}), "onFound")
end sub

sub onFound(event as Object)
    answer = answerOf(event)
    if answer = invalid then return
    if not answer.ok
        m.status.text = "Could not search: " + answer.error
        return
    end if
    data = objectOf(answer.data)
    m.found = []
    m.songs = toSongs(data["songs"])
    root = CreateObject("roSGNode", "ContentNode")
    for each raw in listOf(data["artists"])
        artist = objectOf(raw)
        node = CreateObject("roSGNode", "ContentNode")
        node.title = textOf(artist["name"])
        node.description = "Artist · " + plural(Int(numberOf(artist["album_count"])), "album")
        node.HDPosterUrl = artUrl(coverArt(artist["cover"]), 96, "circle")
        root.AppendChild(node)
        m.found.Push({kind: "artist", id: textOf(artist["id"]), name: node.title})
    end for
    for each raw in listOf(data["albums"])
        album = objectOf(raw)
        node = CreateObject("roSGNode", "ContentNode")
        node.title = textOf(album["name"])
        node.description = "Album · " + readableArtists(textOf(album["artist"]))
        node.HDPosterUrl = artUrl(coverArt(album["cover"]), 96, m.global.theme.corners)
        root.AppendChild(node)
        m.found.Push({kind: "album", id: textOf(album["id"])})
    end for
    for i = 0 to m.songs.Count() - 1
        root.AppendChild(songNode(m.songs[i], "", songLine(m.songs[i])))
        m.found.Push({kind: "song", index: i})
    end for
    m.results.content = root
    m.status.visible = m.found.Count() = 0
    m.status.text = "Nothing in your library matches """ + m.keyboard.text.Trim() + """."
end sub

sub onSelected(event as Object)
    hit = m.found[event.GetData()]
    if hit = invalid then return
    if hit.kind = "artist"
        m.top.navigate = {screen: "ArtistScreen", args: {id: hit.id, name: hit.name}}
    else if hit.kind = "album"
        m.top.navigate = {screen: "CollectionScreen", args: {kind: "album", id: hit.id}}
    else
        player("load", {songs: m.songs, index: hit.index, source: ""})
    end if
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "right" and m.keyboard.IsInFocusChain() and m.found.Count() > 0
        m.results.SetFocus(true)
        m.lastFocus = m.results
        return true
    else if key = "left" and m.results.HasFocus()
        m.keyboard.SetFocus(true)
        m.lastFocus = m.keyboard
        return true
    else if key = "options" and m.results.HasFocus()
        hit = m.found[m.results.itemFocused]
        if hit <> invalid and hit.kind = "song" then openSongMenu(m.songs[hit.index], m.results, false)
        return true
    end if
    return false
end function
