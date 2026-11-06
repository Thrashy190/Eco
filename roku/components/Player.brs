' The player: the queue and the Audio node, with the same rules as the web app's player (web/src/stores/player.ts),
' so a queue moved between the TV and a phone behaves the same on both. The remote (through screens) and the other
' devices (through Connect) ask for the same actions, in applyCommand. What plays is published in m.global.nowPlaying
' for the screens, and reported to the other devices.

sub initPlayer()
    m.audio = m.top.FindNode("audio")
    m.audio.notificationInterval = 1
    m.audio.ObserveField("state", "onAudioState")
    m.audio.ObserveField("position", "onAudioPosition")
    m.clock = CreateObject("roTimespan")
    m.order = makeOrder([], -1)
    m.source = ""
    m.shuffle = false
    m.repeat = "off"
    m.autoplay = CreateObject("roRegistrySection", "eco").Read("autoplay") = "1"
    m.loading = false
    m.pendingSeek = 0
    m.retried = ""
    m.failedInARow = 0
    m.scrobbled = false
    m.wasPlaying = false
    m.toppingUp = false
    m.advanceWhenToppedUp = false
end sub

function currentSong() as Dynamic
    if m.order.index < 0 or m.order.index >= m.order.queue.Count() then return invalid
    return m.order.queue[m.order.index]
end function

' Podcasts and audiobooks: Autoplay does not follow them with music.
function isSpoken(song as Dynamic) as Boolean
    if song = invalid then return false
    return textOf(song["kind"]) <> ""
end function

function isPlaying() as Boolean
    state = m.audio.state
    return state = "playing" or state = "buffering"
end function

function songLength() as Float
    if m.audio.duration > 0 then return m.audio.duration
    song = currentSong()
    if song = invalid then return 0
    return numberOf(song["duration"])
end function

' Do what the remote or another of this account's devices asked. Values are data from the same account: nothing here
' runs them.
sub applyCommand(action as String, value as Dynamic)
    if action = "load"
        request = objectOf(value)
        songs = listOf(request["songs"])
        if songs.Count() = 0 then return
        index = Int(numberOf(request["index"]))
        if index < 0 or index >= songs.Count() then index = 0
        if isTrue(request["shuffle"]) then m.shuffle = true
        playList(songs, index, textOf(request["source"]))
        openPlayer()
    else if action = "resume"
        adopt(objectOf(value))
        openPlayer()
    else if action = "toggle"
        toggle()
    else if action = "pause"
        pausePlayback()
    else if action = "next"
        skipNext(false)
    else if action = "previous"
        skipPrevious()
    else if action = "seek"
        seekTo(numberOf(value))
    else if action = "jump"
        m.order = jumpTo(m.order, Int(numberOf(value)))
        load(0, true, false)
    else if action = "shuffle"
        if not m.shuffle and currentSong() <> invalid then m.order = shuffleUpcoming(m.order)
        m.shuffle = not m.shuffle
    else if action = "repeat"
        if m.repeat = "off"
            m.repeat = "all"
        else if m.repeat = "all"
            m.repeat = "one"
        else
            m.repeat = "off"
        end if
    else if action = "autoplay"
        m.autoplay = not m.autoplay
        saved = CreateObject("roRegistrySection", "eco")
        if m.autoplay then saved.Write("autoplay", "1") else saved.Write("autoplay", "0")
        saved.Flush()
        if m.autoplay then topUpIfLast()
    else if action = "play_next" or action = "enqueue"
        addSong(objectOf(value), action = "play_next")
    else if action = "move"
        request = objectOf(value)
        m.order = moveSong(m.order, Int(numberOf(request["from"])), Int(numberOf(request["to"])))
    end if
    ' volume and speed: a Roku app cannot change the TV's volume, and music plays at its own speed
    publish()
end sub

sub onPlayerCommand(event as Object)
    command = objectOf(event.GetData())
    applyCommand(textOf(command["action"]), command["value"])
end sub

' Play a list from song i. Songs added to the queue by hand and not played yet stay, right after the first song.
sub playList(songs as Object, index as Integer, source as String)
    list = songs
    start = index
    if m.shuffle
        rest = []
        for k = 0 to songs.Count() - 1
            if k <> index then rest.Push(songs[k])
        end for
        list = joined([[songs[index]], mixed(rest)])
        start = 0
    end if
    m.order = startList(m.order, list, start)
    m.source = source
    load(0, true, false)
end sub

' Carry on from where another device stopped (Handoff in stores/player.ts).
sub adopt(from as Object)
    queue = listOf(from["queue"])
    index = Int(numberOf(from["index"]))
    if index < 0 or index >= queue.Count() then return
    m.order = makeOrder(queue, index)
    m.source = textOf(from["source"])
    m.shuffle = isTrue(from["shuffle"])
    m.repeat = textOf(from["repeat"])
    if m.repeat <> "all" and m.repeat <> "one" then m.repeat = "off"
    load(numberOf(from["position"]), isTrue(from["playing"]), false)
end sub

' Start the current song. convert asks Navidrome for an MP3: for formats Roku cannot play, and as the second try.
sub load(startAt as Float, play as Boolean, convert as Boolean)
    song = currentSong()
    if song = invalid then return
    m.scrobbled = false
    suffix = textOf(song["suffix"])
    if not playsAsIs(suffix) then convert = true
    content = CreateObject("roSGNode", "ContentNode")
    content.url = streamUrl(song, convert)
    format = streamFormatFor(suffix)
    if textOf(song["mediaId"]) <> "" then format = "mp4" ' imported audio is always M4A (internal/media)
    if convert then format = "mp3"
    if format <> "" then content.streamFormat = format
    content.title = textOf(song["title"])
    m.pendingSeek = 0
    if startAt > 1 then m.pendingSeek = startAt
    m.loading = play
    m.global.position = {position: startAt, length: numberOf(song["duration"])}
    m.audio.content = content
    if play then m.audio.control = "play" else m.audio.control = "stop"
    rememberForScreensaver(song)
    themeForSong()
    publish()
end sub

sub toggle()
    state = m.audio.state
    if state = "playing" or state = "buffering"
        m.audio.control = "pause"
    else if state = "paused"
        m.audio.control = "resume"
    else if currentSong() <> invalid
        m.audio.control = "play"
    end if
end sub

sub pausePlayback()
    if isPlaying() then m.audio.control = "pause"
end sub

sub stopPlayback()
    m.audio.control = "stop"
    m.order = makeOrder([], -1)
    m.source = ""
    themeForSong()
    publish()
end sub

sub skipNext(auto as Boolean)
    if m.repeat = "one" and auto
        load(0, true, false)
        return
    end if
    if m.order.index + 1 < m.order.queue.Count()
        m.order.index = m.order.index + 1
        load(0, true, false)
    else if m.repeat = "all" and m.order.queue.Count() > 0
        m.order.index = 0
        load(0, true, false)
    else if wantsAutoplay()
        m.advanceWhenToppedUp = true
        topUp()
    else
        m.audio.control = "stop"
    end if
end sub

sub skipPrevious()
    if m.audio.position > 3 or m.order.index <= 0
        seekTo(0)
        return
    end if
    m.order.index = m.order.index - 1
    load(0, true, false)
end sub

sub seekTo(seconds as Float)
    if seconds < 0 then seconds = 0
    state = m.audio.state
    if state = "playing" or state = "buffering" or state = "paused"
        m.audio.seek = seconds
    else
        m.pendingSeek = seconds ' loaded but not started: it starts there
    end if
    m.forceReport = true
    scheduleReport()
end sub

sub seekBy(seconds as Float)
    if currentSong() = invalid then return
    seekTo(m.audio.position + seconds)
end sub

sub addSong(song as Object, nextUp as Boolean)
    if textOf(song["id"]) = "" then return
    if currentSong() = invalid
        playList([song], 0, "")
        return
    end if
    if nextUp
        m.order = addNext(m.order, song)
        toast("Playing next")
    else
        m.order = addToQueue(m.order, song)
        toast("Added to the queue")
    end if
end sub

' ---- Autoplay: when the queue runs out, random songs from the library follow (off unless chosen) ----

function wantsAutoplay() as Boolean
    return m.autoplay and m.repeat = "off" and currentSong() <> invalid and not isSpoken(currentSong())
end function

sub topUp()
    if m.toppingUp then return
    m.toppingUp = true
    fetch("autoplay", restUrl("getRandomSongs", {size: 30}), "onToppedUp")
end sub

sub topUpIfLast()
    if m.order.index = m.order.queue.Count() - 1 and wantsAutoplay() then topUp()
end sub

sub onToppedUp(event as Object)
    m.toppingUp = false
    answer = answerOf(event)
    if answer = invalid then return
    picked = []
    if answer.ok
        candidates = toSongs(objectOf(objectOf(answer.data)["randomSongs"])["song"])
        picked = autoplayPick(candidates, m.order.queue, 10)
        if picked.Count() > 0 and m.autoplay then m.order.queue.Append(picked)
    end if
    if m.advanceWhenToppedUp
        m.advanceWhenToppedUp = false
        if picked.Count() > 0 and m.autoplay
            m.order.index = m.order.index + 1
            load(0, true, false)
        else
            m.audio.control = "stop"
        end if
    end if
    publish()
end sub

' ---- What the Audio node says ----

sub onAudioState()
    state = m.audio.state
    if state = "playing"
        if m.pendingSeek > 0
            m.audio.seek = m.pendingSeek
            m.pendingSeek = 0
        end if
        m.loading = false
        m.failedInARow = 0
        m.retried = ""
        ' Sound starting here, whatever asked for it, means here is where the music plays now (Connect.brs)
        if not m.wasPlaying then startedHere()
        m.wasPlaying = true
        topUpIfLast()
    else if state = "buffering"
        m.loading = true
    else if state = "finished"
        m.wasPlaying = false
        skipNext(true)
    else if state = "error"
        m.wasPlaying = false
        m.loading = false
        onAudioError()
    else
        m.wasPlaying = false
        m.loading = false
    end if
    publish()
end sub

' A failure is usually the connection or a format this Roku cannot read. The second try asks for an MP3; then the
' player moves on, but a dead connection must not race through the whole queue: it stops after three in a row.
sub onAudioError()
    song = currentSong()
    if song = invalid then return
    print "Eco: could not play "; song.id; ": "; m.audio.errorMsg
    if m.retried <> song.id
        m.retried = song.id
        load(m.audio.position, true, true)
        return
    end if
    m.failedInARow = m.failedInARow + 1
    if m.failedInARow >= 3 or m.order.queue.Count() < 2
        m.failedInARow = 0
        toast("Could not play. Check the connection to Eco")
        return
    end if
    toast("Could not play that song")
    skipNext(true)
end sub

sub onAudioPosition()
    position = m.audio.position
    length = songLength()
    m.global.position = {position: position, length: length}
    song = currentSong()
    ' A play counts once half the song (or 30 s) was heard: it feeds "Recently played" and "Most played"
    if not m.scrobbled and song <> invalid and not isSpoken(song) and length > 0
        limit = length / 2
        if limit > 30 then limit = 30
        if position > limit
            m.scrobbled = true
            tell("scrobble", restUrl("scrobble", {id: song.id, submission: "true"}))
        end if
    end if
end sub

' ---- Telling the screens ----

sub publish()
    song = currentSong()
    hadSong = m.hasSong
    m.hasSong = song <> invalid
    if hadSong <> m.hasSong then updateChrome()
    m.global.nowPlaying = {
        song: song,
        playing: isPlaying(),
        loading: m.loading,
        shuffle: m.shuffle,
        repeat: m.repeat,
        autoplay: m.autoplay,
        index: m.order.index,
        upcoming: sliceOf(m.order.queue, m.order.index + 1, m.order.index + 31),
        source: m.source
    }
    id = ""
    if song <> invalid then id = song.id
    if m.global.currentId <> id then m.global.currentId = id
    scheduleReport()
end sub

' The screensaver runs apart from the app: it reads what plays from the registry.
sub rememberForScreensaver(song as Object)
    saved = CreateObject("roRegistrySection", "eco")
    saved.Write("playing", FormatJson({title: textOf(song["title"]), artist: textOf(song["artist"]), cover: artUrl(songArt(song), 440, m.global.theme.corners), wash: songCoverUrl(song, 12)}))
    saved.Flush()
end sub
