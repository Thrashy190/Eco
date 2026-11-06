' Tests for components/lib/format.brs. Run with `npm test`.

sub Main()
    m.failures = 0
    check("time", formatTime(185), "3:05")
    check("time with hours", formatTime(3725), "1:02:05")
    check("time from text", formatTime("61"), "1:01")
    check("missing time", formatTime(invalid), "0:00")
    check("artists", readableArtists("Bad Bunny; Chuwi"), "Bad Bunny, Chuwi")
    check("plural one", plural(1, "song"), "1 song")
    check("plural many", plural(12, "song"), "12 songs")
    check("code", spacedCode("K7QM2X"), "K7Q-M2X")
    check("server without scheme", cleanServer(" 192.168.1.50:8000/ "), "http://192.168.1.50:8000")
    check("server with https", cleanServer("https://eco.example.com//"), "https://eco.example.com")
    check("m4a plays as mp4", streamFormatFor("m4a"), "mp4")
    check("unknown format", streamFormatFor("xyz"), "")
    check("ogg is converted", textOf(playsAsIs("ogg")), "false")
    check("flac plays", textOf(playsAsIs("flac")), "true")

    ' Navidrome's song, with what a phone needs to read it back
    raw = ParseJson("{""id"":""s1"",""title"":""Song"",""artist"":""A; B"",""artistId"":""ar1"",""album"":""Al"",""albumId"":""al1"",""duration"":200,""coverArt"":""al-1"",""suffix"":""FLAC""}")
    song = toSong(raw)
    json = FormatJson(song)
    check("song keeps albumId", textOf(Instr(1, json, """albumId"":""al1""") > 0), "true")
    check("song keeps artistId", textOf(Instr(1, json, """artistId"":""ar1""") > 0), "true")
    check("song cover", song["cover"], "al-1")
    check("song artists", song["artist"], "A, B")
    check("song suffix", song["suffix"], "flac")
    ' Eco's own JSON uses other names
    eco = toSong(ParseJson("{""id"":""s2"",""title"":""T"",""artist"":""A"",""album_id"":""x"",""cover"":""c""}"))
    check("eco album id", eco["albumId"], "x")
    check("eco cover", eco["cover"], "c")
    ' Missing fields must not stop the app
    empty = toSong({})
    check("empty song", empty["title"] + textOf(empty["duration"]), "0")

    item = mediaToSong({id: "dQw4w9WgXcQ", kind: "podcast", title: "Ep", channel: "Show", duration: 60})
    check("media id", item["id"], "m-dQw4w9WgXcQ")
    check("media label", item["album"], "Podcast")
    check("media keeps mediaId", textOf(Instr(1, FormatJson(item), """mediaId""") > 0), "true")

    ' Colours: the same ink as the web app picks
    check("roku colour", rokuColor("#7cf0c0"), "0x7CF0C0FF")
    check("roku colour alpha", rokuColor("#e65656", "40"), "0xE6565640")
    check("ink on mint", inkFor("#7cf0c0"), "#0b0b0f")
    check("ink on red", inkFor("#e65656"), "#ffffff")
    check("hex ok", textOf(isHexColor("#A1b2C3")), "true")
    check("hex bad", textOf(isHexColor("red")), "false")
    check("hex missing", textOf(isHexColor(invalid)), "false")

    if m.failures = 0 then print "PASS format" else print "FAIL format: " + m.failures.ToStr() + " failed"
end sub

sub check(name as String, got as String, want as String)
    if got <> want
        m.failures = m.failures + 1
        print "FAIL " + name + ": got '" + got + "', want '" + want + "'"
    end if
end sub
