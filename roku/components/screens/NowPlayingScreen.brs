' The player's controls are drawn by a Tabs row, but this screen holds the focus and handles the keys itself: any key
' must first bring back controls that faded away.

sub init()
    m.cover = m.top.FindNode("cover")
    m.back = m.top.FindNode("back")
    m.logo = m.top.FindNode("logo")
    m.device = m.top.FindNode("device")
    m.source = m.top.FindNode("source")
    m.title = m.top.FindNode("title")
    m.artist = m.top.FindNode("artist")
    m.album = m.top.FindNode("album")
    m.progress = m.top.FindNode("progress")
    m.elapsed = m.top.FindNode("elapsed")
    m.remaining = m.top.FindNode("remaining")
    m.controls = m.top.FindNode("controls")
    m.nextHint = m.top.FindNode("nextHint")
    m.queueBox = m.top.FindNode("queueBox")
    m.upNext = m.top.FindNode("upNext")
    m.idle = m.top.FindNode("idle")
    m.fade = m.top.FindNode("fade")
    m.fadeControls = m.top.FindNode("fadeControls")
    m.fadeQueue = m.top.FindNode("fadeQueue")
    m.fadeCorner = m.top.FindNode("fadeCorner")
    m.top.focusable = true
    m.controls.lit = true
    m.controls.focusIndex = 2
    m.awake = true
    m.songId = ""
    m.index = -1
    m.starred = {}
    m.starred.SetModeCaseSensitive()
    m.device.text = "Playing on " + m.global.deviceName
    m.idle.ObserveField("fire", "doze")
    m.upNext.ObserveField("rowItemSelected", "onUpNext")
    m.upNext.ObserveField("rowItemFocused", "wake")
    m.global.ObserveFieldScoped("nowPlaying", "onNowPlaying")
    m.global.ObserveFieldScoped("position", "onPosition")
    m.global.ObserveFieldScoped("theme", "onTheme")
    onTheme()
    onNowPlaying()
    onPosition()
    wake()
end sub

sub takeFocus()
    m.top.SetFocus(true)
    m.controls.lit = true
    wake()
end sub

sub onTheme()
    theme = m.global.theme
    m.logo.blendColor = theme.accent
    m.progress.blendColor = theme.accent
    m.back.uri = "pkg:/images/mask-" + theme.corners + ".png"
    song = m.global.nowPlaying["song"]
    if song <> invalid then m.cover.uri = artUrl(songArt(song), 560, theme.corners)
end sub

function isStarred(song as Object) as Boolean
    if m.starred.DoesExist(song.id) then return m.starred[song.id]
    return textOf(song["starred"]) <> ""
end function

sub onNowPlaying()
    now = m.global.nowPlaying
    song = now["song"]
    if song = invalid then return
    if song.id <> m.songId
        m.songId = song.id
        m.cover.uri = artUrl(songArt(song), 560, m.global.theme.corners)
        m.title.text = textOf(song["title"])
        m.artist.text = textOf(song["artist"])
        m.album.text = textOf(song["album"])
        y = 44 + m.title.BoundingRect().height + 10
        m.artist.translation = [0, y]
        m.album.translation = [0, y + 62]
    end if
    source = textOf(now["source"])
    if source <> "" then m.source.text = "PLAYING FROM " + UCase(source) else m.source.text = "NOW PLAYING"

    playIcon = "play"
    if isTrue(now["playing"]) then playIcon = "pause"
    repeatIcon = "repeat"
    if textOf(now["repeat"]) = "one" then repeatIcon = "repeat-one"
    heart = "heart"
    if isStarred(song) then heart = "heart-fill"
    m.controls.items = [
        {icon: "shuffle", on: isTrue(now["shuffle"])},
        {icon: "prev"},
        {icon: playIcon, primary: true},
        {icon: "next"},
        {icon: repeatIcon, on: textOf(now["repeat"]) <> "off"},
        {icon: "sparkle", on: isTrue(now["autoplay"])},
        {icon: heart, on: isStarred(song)}
    ]

    upcoming = listOf(now["upcoming"])
    m.index = Int(numberOf(now["index"]))
    if upcoming.Count() > 0
        first = upcoming[0]
        m.nextHint.text = textOf(first["title"]) + " · " + textOf(first["artist"]) + "      Down to see the queue"
    else if isTrue(now["autoplay"])
        m.nextHint.text = "Autoplay picks something when this ends"
    else
        m.nextHint.text = "Nothing after this song"
    end if
    root = CreateObject("roSGNode", "ContentNode")
    row = root.CreateChild("ContentNode")
    for each item in upcoming
        row.AppendChild(songTile(item))
    end for
    hadFocus = m.upNext.HasFocus()
    m.upNext.content = root
    m.upNext.visible = upcoming.Count() > 0
    if hadFocus and upcoming.Count() = 0 then takeFocus()
end sub

sub onPosition()
    at = m.global.position
    position = numberOf(at["position"])
    length = numberOf(at["length"])
    m.elapsed.text = formatTime(position)
    if length > 0
        share = position / length
        if share > 1 then share = 1
        m.progress.width = 12 + 948 * share
        m.remaining.text = "-" + formatTime(length - position)
    else
        m.progress.width = 12
        m.remaining.text = ""
    end if
end sub

' ---- Fading the controls away ----

sub wake()
    m.idle.control = "stop"
    m.idle.control = "start"
    if m.awake then return
    m.awake = true
    fadeTo(1)
end sub

sub doze()
    if m.upNext.HasFocus() then return ' looking through the queue
    m.awake = false
    fadeTo(0)
end sub

sub fadeTo(target as Float)
    m.fade.control = "stop"
    m.fadeControls.keyValue = [m.top.FindNode("controlsBox").opacity, target]
    m.fadeQueue.keyValue = [m.queueBox.opacity, target]
    m.fadeCorner.keyValue = [m.top.FindNode("corner").opacity, target]
    m.fade.control = "start"
end sub

' ---- Keys ----

sub act(choice as Integer)
    if choice = 0
        player("shuffle")
    else if choice = 1
        player("previous")
    else if choice = 2
        player("toggle")
    else if choice = 3
        player("next")
    else if choice = 4
        player("repeat")
    else if choice = 5
        wasOn = isTrue(m.global.nowPlaying["autoplay"])
        player("autoplay")
        if wasOn then toast("Autoplay off") else toast("Autoplay on: random songs follow when the queue ends")
    else if choice = 6
        song = m.global.nowPlaying["song"]
        if song = invalid then return
        if isStarred(song)
            tell("star", restUrl("unstar", {id: song.id}))
            m.starred[song.id] = false
            toast("Removed from Favorites")
        else
            tell("star", restUrl("star", {id: song.id}))
            m.starred[song.id] = true
            toast("Added to Favorites")
        end if
        onNowPlaying()
    end if
end sub

sub onUpNext(event as Object)
    player("jump", m.index + 1 + event.GetData()[1])
    takeFocus()
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    sleeping = not m.awake
    wake()
    ' Play/Pause, Rewind and Fast forward act at once (MainScene); Back closes the player
    if key = "play" or key = "fastforward" or key = "rewind" or key = "replay" or key = "back" then return false
    if sleeping then return true ' the first key only brings the controls back
    if m.upNext.HasFocus()
        if key = "up"
            takeFocus()
            return true
        end if
        return key <> "options"
    end if
    count = m.controls.items.Count()
    if key = "left"
        if m.controls.focusIndex > 0 then m.controls.focusIndex = m.controls.focusIndex - 1
    else if key = "right"
        if m.controls.focusIndex < count - 1 then m.controls.focusIndex = m.controls.focusIndex + 1
    else if key = "OK"
        act(m.controls.focusIndex)
    else if key = "down"
        if m.upNext.visible
            m.controls.lit = false
            m.upNext.SetFocus(true)
        end if
    else if key = "options"
        return true ' already here
    end if
    return true ' up stays here: the player has no top bar
end function
