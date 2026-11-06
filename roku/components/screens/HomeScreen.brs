sub init()
    m.rows = m.top.FindNode("rows")
    m.status = m.top.FindNode("status")
    m.rows.ObserveField("rowItemSelected", "onSelected")
    m.parts = {}
end sub

sub load()
    m.parts = {}
    fetch("library", apiUrl("me/library"), "onPart")
    fetch("newest", restUrl("getAlbumList2", {type: "newest", size: 20}), "onPart")
    fetch("recent", restUrl("getAlbumList2", {type: "recent", size: 20}), "onPart")
    fetch("frequent", restUrl("getAlbumList2", {type: "frequent", size: 20}), "onPart")
    fetch("playlists", restUrl("getPlaylists"), "onPart")
end sub

sub onPart(event as Object)
    name = event.GetRoSGNode().id
    answer = answerOf(event)
    if answer = invalid then return
    m.parts[name] = answer
    if m.parts.Count() = 5 then build()
end sub

function albumsOf(name as String) as Object
    tiles = []
    answer = m.parts[name]
    if not answer.ok then return tiles
    for each raw in listOf(objectOf(objectOf(answer.data)["albumList2"])["album"])
        tiles.Push(albumTile(raw))
    end for
    return tiles
end function

sub addRow(root as Object, title as String, tiles as Object)
    if tiles.Count() = 0 then return
    row = root.CreateChild("ContentNode")
    row.title = title
    for each tile in tiles
        row.AppendChild(tile)
    end for
end sub

sub build()
    library = objectOf(m.parts.library.data)
    covers = objectOf(library["covers"])
    pins = []
    for each entry in listOf(library["pins"])
        tile = entryTile(objectOf(entry), covers)
        if tile <> invalid then pins.Push(tile)
    end for
    recents = []
    for each entry in listOf(library["recents"])
        tile = entryTile(objectOf(entry), covers)
        if tile <> invalid and recents.Count() < 20 then recents.Push(tile)
    end for
    playlists = [favoritesTile()]
    if m.parts.playlists.ok
        for each raw in listOf(objectOf(objectOf(m.parts.playlists.data)["playlists"])["playlist"])
            playlists.Push(playlistTile(raw, covers))
        end for
    end if

    root = CreateObject("roSGNode", "ContentNode")
    addRow(root, "Pinned", pins)
    addRow(root, "Recent", recents)
    addRow(root, "Recently added", albumsOf("newest"))
    addRow(root, "Recently played", albumsOf("recent"))
    addRow(root, "Most played", albumsOf("frequent"))
    if root.GetChildCount() = 0 or not m.parts.newest.ok
        m.status.text = "Could not load your music: " + m.parts.newest.error
        m.status.visible = true
        if not m.parts.newest.ok then return
    end if
    addRow(root, "Playlists", playlists)
    m.status.visible = false
    m.rows.content = root
    if m.top.HasFocus() then m.rows.SetFocus(true)
end sub

sub takeFocus()
    if m.rows.content <> invalid and m.rows.content.GetChildCount() > 0
        m.rows.SetFocus(true)
    else
        m.top.SetFocus(true)
    end if
end sub

sub onSelected(event as Object)
    at = event.GetData()
    row = m.rows.content.GetChild(at[0])
    if row = invalid then return
    tile = row.GetChild(at[1])
    if tile <> invalid then openTile(tile)
end sub
