' What the screens share: cards and rows from the server's answers, opening things, and the ✱ menu on a song.
' Screens declare `navigate` (asking MainScene for another screen) and, for the song menu, a Menu with id "menu".

' A card: `art` says where its picture comes from (artUrl in lib/api.brs); the card cuts it to its own shape.
function tileNode(kind as String, ref as String, title as String, subtitle as String, art as Object) as Object
    node = CreateObject("roSGNode", "ContentNode")
    node.title = title
    node.description = subtitle
    node.AddFields({kind: kind, ref: ref, art: art, shape: ""})
    return node
end function

function coverArt(id as Dynamic) as Object
    if textOf(id) = "" then return {}
    return {id: textOf(id)}
end function

function albumTile(raw as Object) as Object
    subtitle = readableArtists(textOf(raw["artist"]))
    year = Int(numberOf(raw["year"]))
    if year > 0 then subtitle = subtitle + " · " + year.ToStr()
    return tileNode("album", textOf(raw["id"]), textOf(raw["name"]), subtitle, coverArt(firstText(raw["coverArt"], raw["cover"])))
end function

function playlistTile(raw as Object, covers as Object) as Object
    id = textOf(raw["id"])
    art = coverArt(raw["coverArt"])
    if covers.DoesExist(id) then art = {playlist: id, version: covers[id]}
    return tileNode("playlist", id, textOf(raw["name"]), plural(Int(numberOf(raw["songCount"])), "song"), art)
end function

function favoritesTile() as Object
    return tileNode("favorites", "favorites", "Favorites", "Your liked songs", {})
end function

function artistTile(raw as Object) as Object
    count = Int(numberOf(raw["albumCount"]))
    if count = 0 then count = Int(numberOf(raw["album_count"]))
    node = tileNode("artist", textOf(raw["id"]), textOf(raw["name"]), plural(count, "album"), coverArt(firstText(raw["coverArt"], raw["cover"])))
    node.shape = "circle"
    return node
end function

function songTile(song as Object) as Object
    node = tileNode("song", song.id, textOf(song["title"]), textOf(song["artist"]), songArt(song))
    node.AddFields({song: song})
    return node
end function

' A row of the library's Recent or Pinned (LibraryEntry in web/src/lib/types.ts). Entries from the catalogue are
' not in the library, and the TV cannot download: those are left out.
function entryTile(entry as Object, covers as Object) as Dynamic
    kind = textOf(entry["type"])
    id = textOf(entry["id"])
    name = textOf(entry["name"])
    subtitle = textOf(entry["subtitle"])
    if kind = "album" then return tileNode("album", id, name, subtitle, coverArt(entry["cover"]))
    if kind = "artist"
        node = tileNode("artist", id, name, "Artist", coverArt(entry["cover"]))
        node.shape = "circle"
        return node
    end if
    if kind = "playlist"
        if id = "favorites" then return favoritesTile()
        art = coverArt(entry["cover"])
        if covers.DoesExist(id) then art = {playlist: id, version: covers[id]}
        return tileNode("playlist", id, name, subtitle, art)
    end if
    if kind = "song"
        song = {}
        song["id"] = id
        song["title"] = name
        song["artist"] = firstText(entry["artist"], subtitle)
        song["album"] = textOf(entry["album"])
        if textOf(entry["album_id"]) <> "" then song["albumId"] = entry["album_id"]
        if textOf(entry["artist_id"]) <> "" then song["artistId"] = entry["artist_id"]
        if textOf(entry["cover"]) <> "" then song["cover"] = entry["cover"]
        song["duration"] = Int(numberOf(entry["duration"]))
        return songTile(song)
    end if
    return invalid
end function

' "Artist · Album" under a song's title.
function songLine(song as Object) as String
    artist = textOf(song["artist"])
    album = textOf(song["album"])
    if album = "" then return artist
    if artist = "" then return album
    return artist + " · " + album
end function

' A list row for a song. number shows instead of the cover (an album's track numbers).
function songNode(song as Object, number as String, subtitle as String) as Object
    node = CreateObject("roSGNode", "ContentNode")
    node.id = textOf(song["id"])
    node.title = textOf(song["title"])
    node.description = subtitle
    node.shortDescriptionLine1 = formatTime(song["duration"])
    node.shortDescriptionLine2 = number
    if number = "" then node.HDPosterUrl = artUrl(songArt(song), 96, m.global.theme.corners)
    return node
end function

function songsContent(songs as Object, numbered as Boolean) as Object
    root = CreateObject("roSGNode", "ContentNode")
    for i = 0 to songs.Count() - 1
        song = songs[i]
        if numbered
            track = Int(numberOf(song["track"]))
            if track <= 0 then track = i + 1
            root.AppendChild(songNode(song, track.ToStr(), textOf(song["artist"])))
        else
            root.AppendChild(songNode(song, "", songLine(song)))
        end if
    end for
    return root
end function

' "12 songs · 48 min"
function collectionSummary(songs as Object) as String
    total = 0
    for each song in songs
        total = total + numberOf(song["duration"])
    end for
    minutes = Int(total / 60 + 0.5)
    text = plural(songs.Count(), "song")
    if minutes >= 60
        text = text + " · " + Int(minutes / 60).ToStr() + " h " + (minutes mod 60).ToStr() + " min"
    else if minutes > 0
        text = text + " · " + minutes.ToStr() + " min"
    end if
    return text
end function

' Open what a card stands for.
sub openTile(node as Object)
    kind = node.kind
    if kind = "album"
        m.top.navigate = {screen: "CollectionScreen", args: {kind: "album", id: node.ref}}
    else if kind = "playlist"
        m.top.navigate = {screen: "CollectionScreen", args: {kind: "playlist", id: node.ref}}
    else if kind = "favorites"
        m.top.navigate = {screen: "CollectionScreen", args: {kind: "favorites", id: "favorites"}}
    else if kind = "artist"
        m.top.navigate = {screen: "ArtistScreen", args: {id: node.ref, name: node.title}}
    else if kind = "song"
        player("load", {songs: [node.song], index: 0, source: ""})
    end if
end sub

' Remember what was opened for the library's Recent (touch in web/src/stores/library.ts).
sub touchRecent(kind as String, id as String, name as String, subtitle as String, cover as String)
    entry = {type: kind, id: id, name: name, subtitle: subtitle}
    if cover <> "" then entry.cover = cover
    tell("recent", apiUrl("me/recents"), "POST", FormatJson(entry))
end sub

' ---- The ✱ menu on a song ----

sub openSongMenu(song as Object, back as Object, inAlbum as Boolean)
    m.menuSong = song
    m.menuBack = back
    m.menuActions = ["next", "queue"]
    options = ["Play next", "Add to queue"]
    if not inAlbum and textOf(song["albumId"]) <> ""
        m.menuActions.Push("album")
        options.Push("Go to album")
    end if
    if textOf(song["artistId"]) <> "" or textOf(song["artist"]) <> ""
        m.menuActions.Push("artist")
        options.Push("Go to artist")
    end if
    if textOf(song["mediaId"]) = ""
        if textOf(song["starred"]) <> ""
            m.menuActions.Push("unstar")
            options.Push("Remove from Favorites")
        else
            m.menuActions.Push("star")
            options.Push("Add to Favorites")
        end if
    end if
    m.menu.title = textOf(song["title"]) + " · " + textOf(song["artist"])
    m.menu.options = options
    m.menu.show = true
end sub

sub onSongMenuChosen(event as Object)
    action = m.menuActions[event.GetData()]
    song = m.menuSong
    if action = "next"
        player("play_next", song)
    else if action = "queue"
        player("enqueue", song)
    else if action = "album"
        m.top.navigate = {screen: "CollectionScreen", args: {kind: "album", id: song["albumId"]}}
    else if action = "artist"
        m.top.navigate = {screen: "ArtistScreen", args: {id: textOf(song["artistId"]), name: textOf(song["artist"])}}
    else if action = "star"
        tell("star", restUrl("star", {id: song.id}))
        song["starred"] = "now"
        toast("Added to Favorites")
    else if action = "unstar"
        tell("star", restUrl("unstar", {id: song.id}))
        song["starred"] = ""
        toast("Removed from Favorites")
    end if
end sub

sub onSongMenuClosed()
    if m.top.visible and m.menuBack <> invalid then m.menuBack.SetFocus(true)
end sub
