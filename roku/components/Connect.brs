' The TV as one of the account's devices (Connect, like Spotify Connect). The phone lists it under "Listen on", sends it
' music and controls it; it reports what it plays so the phone can show it. The rules are those of the web app
' (web/src/stores/connect.ts), seen from a device that only ever plays: it never controls another one.

sub startConnect()
    if m.connect <> invalid then return
    m.startedAt = -100000
    m.peerPlaying = {}
    m.peerPlaying.SetModeCaseSensitive()
    m.lastReported = ""
    m.forceReport = false
    m.reportTimer = m.top.FindNode("reportTimer")
    m.reportTimer.ObserveField("fire", "onReportTimer")
    m.heartbeat = m.top.FindNode("heartbeat")
    m.heartbeat.ObserveField("fire", "onHeartbeat")
    m.heartbeat.control = "start"
    m.connect = CreateObject("roSGNode", "ConnectTask")
    m.connect.ObserveField("events", "onConnectEvents")
    m.connect.active = true
    m.connect.control = "RUN"
end sub

sub stopConnect()
    if m.connect = invalid then return
    m.connect.UnobserveField("events")
    m.connect.active = false
    m.connect = invalid
    m.heartbeat.control = "stop"
end sub

sub startedHere()
    m.startedAt = m.clock.TotalMilliseconds()
end sub

sub onConnectEvents(event as Object)
    for each item in listOf(event.GetData())
        name = textOf(objectOf(item)["name"])
        data = item["data"]
        if name = "command"
            command = objectOf(data)
            onCommand(textOf(command["action"]), command["value"])
        else if name = "state"
            change = objectOf(data)
            onPeerStatus(textOf(change["device"]), objectOf(change["state"]))
        else if name = "devices"
            onDevices(listOf(data))
        end if
    end for
end sub

sub onCommand(action as String, value as Dynamic)
    if action = "transfer"
        startedHere()
        moveTo(textOf(value))
        return
    end if
    if action = "resume" then startedHere()
    applyCommand(action, value)
    ' The device that asked waits for an answer, and drops this TV if none comes (expectAnswer in stores/connect.ts)
    m.forceReport = true
    scheduleReport()
end sub

' Send what plays here to another device, and stop here.
sub moveTo(target as String)
    from = handoff()
    if from = invalid then return
    pausePlayback()
    ' Told first, so the other device does not take this one for still playing
    status = localStatus()
    status.playing = false
    sendStatus(status)
    tell("transfer", apiUrl("connect/command", {device: m.global.deviceId}), "POST", FormatJson({target: target, action: "resume", value: from}))
end sub

sub onDevices(devices as Object)
    for each device in devices
        id = textOf(objectOf(device)["id"])
        if id <> m.global.deviceId then m.peerPlaying[id] = isTrue(objectOf(device["state"])["playing"])
    end for
    report(true) ' someone new must learn what plays here
end sub

' Only one device plays at a time: when another one *starts* playing, this one stops. Two starting at the same moment
' have not heard of each other, and stopping both would leave silence, so the higher ID keeps playing; the same rule
' settles two that still both play once the news had time to arrive. Reacting to "still playing" reports instead made
' devices pause each other.
sub onPeerStatus(id as String, status as Object)
    if id = "" or id = m.global.deviceId then return
    playing = isTrue(status["playing"])
    started = playing and not isTrue(m.peerPlaying[id])
    m.peerPlaying[id] = playing
    if not isPlaying() then return
    since = m.clock.TotalMilliseconds() - m.startedAt
    theyWin = id > m.global.deviceId
    if started and (since >= 1000 or theyWin)
        pausePlayback()
    else if playing and theyWin and since >= 3000
        pausePlayback()
    end if
end sub

' ---- Reporting what plays here ----

function localStatus() as Object
    position = m.audio.position
    if m.pendingSeek > 0 and not isPlaying() then position = m.pendingSeek
    return {
        song: currentSong(),
        playing: isPlaying(),
        position: position,
        length: songLength(),
        volume: 1,
        speed: 1,
        shuffle: m.shuffle,
        repeat: m.repeat,
        index: m.order.index,
        upcoming: sliceOf(m.order.queue, m.order.index + 1, m.order.index + 31),
        source: m.source,
        autoplay: m.autoplay,
        blocked: false
    }
end function

' Everything another device needs to take over (Handoff in stores/player.ts), or invalid when nothing is loaded.
function handoff() as Dynamic
    if currentSong() = invalid then return invalid
    position = m.audio.position
    if m.pendingSeek > 0 and not isPlaying() then position = m.pendingSeek
    return {queue: m.order.queue, index: m.order.index, source: m.source, position: position, playing: isPlaying(), shuffle: m.shuffle, repeat: m.repeat}
end function

sub scheduleReport()
    if m.connect = invalid then return
    m.reportTimer.control = "stop"
    m.reportTimer.control = "start"
end sub

sub onReportTimer()
    force = m.forceReport
    m.forceReport = false
    report(force)
end sub

' The position moves all the time, so it alone changing is no news: the heartbeat covers it.
sub report(force as Boolean)
    if m.connect = invalid then return
    status = localStatus()
    ids = []
    for each song in status.upcoming
        mark = ""
        if isTrue(song["queued"]) then mark = "+"
        ids.Push(mark + textOf(song["id"]))
    end for
    songId = ""
    if status.song <> invalid then songId = textOf(status.song["id"])
    fingerprint = FormatJson({song: songId, playing: status.playing, shuffle: m.shuffle, repeat: m.repeat, index: m.order.index, source: m.source, autoplay: m.autoplay, upcoming: ids.Join(" ")})
    if not force and fingerprint = m.lastReported then return
    m.lastReported = fingerprint
    sendStatus(status)
end sub

sub sendStatus(status as Object)
    tell("report", apiUrl("connect/state", {device: m.global.deviceId}), "POST", FormatJson(status))
end sub

sub onHeartbeat()
    if isPlaying() then report(true)
end sub
