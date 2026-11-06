' Small pure helpers: reading JSON safely and showing things on screen. Tested in roku/tests/format_test.brs.
'
' BrightScript stops the app on a comparison between invalid and a string or a number, and JSON fields are often
' missing, so every field read from the server goes through textOf/numberOf/isTrue (queue.brs) first.

function isTrue(value as Dynamic) as Boolean
    kind = Type(value)
    if kind = "Boolean" or kind = "roBoolean" then return value
    return false
end function

function textOf(value as Dynamic) as String
    if value = invalid then return ""
    kind = Type(value)
    if kind = "String" or kind = "roString" then return value
    if kind = "Integer" or kind = "roInteger" or kind = "LongInteger" or kind = "roLongInteger" then return value.ToStr()
    if kind = "Float" or kind = "roFloat" or kind = "Double" or kind = "roDouble"
        if value = Int(value) then return Int(value).ToStr()
        return Str(value).Trim()
    end if
    if kind = "Boolean" or kind = "roBoolean"
        if value then return "true"
        return "false"
    end if
    return ""
end function

function numberOf(value as Dynamic) as Float
    if value = invalid then return 0
    kind = Type(value)
    if kind = "String" or kind = "roString" then return Val(value)
    if kind = "Integer" or kind = "roInteger" or kind = "Float" or kind = "roFloat" or kind = "Double" or kind = "roDouble" or kind = "LongInteger" or kind = "roLongInteger" then return value
    return 0
end function

function firstText(a as Dynamic, b as Dynamic) as String
    text = textOf(a)
    if text <> "" then return text
    return textOf(b)
end function

function listOf(value as Dynamic) as Object
    if Type(value) = "roArray" then return value
    return []
end function

function objectOf(value as Dynamic) as Object
    if Type(value) = "roAssociativeArray" then return value
    return {}
end function

' Several artists are stored as "A; B" (see tag.Separator on the server); on screen they read "A, B".
function readableArtists(name as String) as String
    return name.Replace("; ", ", ")
end function

' A song in the shape the web app uses (toSong in web/src/lib/api.ts), from Navidrome's JSON or Eco's. Keys with
' capitals are set in brackets: written as `song.albumId = x`, BrightScript would store "albumid" and the phone would
' not find it. `suffix` is only for the TV, to tell Roku what kind of file it is.
function toSong(raw as Object) as Object
    song = {}
    song["id"] = textOf(raw["id"])
    song["title"] = textOf(raw["title"])
    song["artist"] = readableArtists(textOf(raw["artist"]))
    artistId = firstText(raw["artistId"], raw["artist_id"])
    if artistId <> "" then song["artistId"] = artistId
    song["album"] = textOf(raw["album"])
    albumId = firstText(raw["albumId"], raw["album_id"])
    if albumId <> "" then song["albumId"] = albumId
    song["duration"] = Int(numberOf(raw["duration"]))
    cover = firstText(raw["coverArt"], raw["cover"])
    if cover <> "" then song["cover"] = cover
    song["starred"] = textOf(raw["starred"])
    suffix = LCase(textOf(raw["suffix"]))
    if suffix <> "" then song["suffix"] = suffix
    return song
end function

function toSongs(list as Dynamic) as Object
    out = []
    for each raw in listOf(list)
        if Type(raw) = "roAssociativeArray" then out.Push(toSong(raw))
    end for
    return out
end function

'  An item imported into Eco (a podcast, an audiobook…) as a song, exactly like mediaSong in web/src/lib/api.ts.
function mediaToSong(item as Object) as Object
    kinds = {podcast: "Podcast", audiobook: "Audiobook"}
    kind = textOf(item["kind"])
    label = "Other"
    if kinds.DoesExist(kind) then label = kinds[kind]
    song = {}
    song["id"] = "m-" + textOf(item["id"])
    song["mediaId"] = textOf(item["id"])
    song["kind"] = textOf(item["kind"])
    song["title"] = textOf(item["title"])
    song["artist"] = textOf(item["channel"])
    song["album"] = label
    song["duration"] = Int(numberOf(item["duration"]))
    return song
end function

' 185 → "3:05", 3725 → "1:02:05".
function formatTime(seconds as Dynamic) as String
    total = Int(numberOf(seconds))
    if total < 0 then total = 0
    h = Int(total / 3600)
    mins = Int((total mod 3600) / 60)
    secs = total mod 60
    s = secs.ToStr()
    if secs < 10 then s = "0" + s
    if h > 0
        mm = mins.ToStr()
        if mins < 10 then mm = "0" + mm
        return h.ToStr() + ":" + mm + ":" + s
    end if
    return mins.ToStr() + ":" + s
end function

' "1 song", "12 songs".
function plural(count as Integer, word as String) as String
    if count = 1 then return "1 " + word
    return count.ToStr() + " " + word + "s"
end function

' How Roku should read a file, from its extension; "" when it should find out by itself.
function streamFormatFor(suffix as String) as String
    formats = {mp3: "mp3", m4a: "mp4", mp4: "mp4", aac: "mp4", m4b: "mp4", alac: "mp4", flac: "flac", wma: "wma", wav: "wav", mka: "mka", ogg: "ogg", opus: "ogg"}
    if formats.DoesExist(suffix) then return formats[suffix]
    return ""
end function

' Formats Roku plays as they are. Anything else asks Navidrome for an MP3.
function playsAsIs(suffix as String) as Boolean
    return suffix = "" or suffix = "mp3" or suffix = "m4a" or suffix = "mp4" or suffix = "aac" or suffix = "m4b" or suffix = "flac" or suffix = "wav" or suffix = "wma"
end function

' The code a TV shows, easier to read in two halves: "K7QM2X" → "K7Q-M2X".
function spacedCode(code as String) as String
    if Len(code) <> 6 then return code
    return code.Left(3) + "-" + code.Right(3)
end function

' A server address as typed: with a scheme and without the slash at the end.
function cleanServer(address as String) as String
    address = address.Trim()
    if address = "" then return ""
    lower = LCase(address)
    if lower.Left(7) <> "http://" and lower.Left(8) <> "https://" then address = "http://" + address
    while address.Right(1) = "/"
        address = address.Left(Len(address) - 1)
    end while
    return address
end function

' ---- Colours ----
' The server and the web app write colours as "#rrggbb"; SceneGraph wants "0xRRGGBBAA".

function isHexColor(hex as Dynamic) as Boolean
    text = textOf(hex)
    if Len(text) <> 7 or text.Left(1) <> "#" then return false
    for i = 2 to 7
        if Instr(1, "0123456789abcdefABCDEF", Mid(text, i, 1)) = 0 then return false
    end for
    return true
end function

function rokuColor(hex as String, alpha = "FF" as String) as String
    return "0x" + UCase(Mid(hex, 2)) + alpha
end function

function hexChannel(hex as String, index as Integer) as Float
    return Val(Mid(hex, 2 + index * 2, 2), 16)
end function

function relativeLuminance(hex as String) as Float
    total = 0.0
    weights = [0.2126, 0.7152, 0.0722]
    for i = 0 to 2
        c = hexChannel(hex, i) / 255
        if c <= 0.03928 then c = c / 12.92 else c = ((c + 0.055) / 1.055) ^ 2.4
        total = total + weights[i] * c
    end for
    return total
end function

' Text on top of the accent, as the web app picks it (--accent-ink in stores/settings.ts).
function inkFor(hex as String) as String
    if relativeLuminance(hex) > 0.4 then return "#0b0b0f"
    return "#ffffff"
end function
