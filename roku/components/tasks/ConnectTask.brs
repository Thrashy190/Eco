sub init()
    m.top.functionName = "work"
end sub

sub work()
    failures = 0
    while m.top.active
        ' The server answers within 25 s; one that takes much longer went missing with the connection
        answer = requestJson(apiUrl("connect/poll", {device: m.global.deviceId, name: m.global.deviceName, can_volume: "0"}), "GET", "", 45)
        if not m.top.active then exit while
        if answer.ok
            failures = 0
            m.top.connected = true
            events = listOf(objectOf(answer.data)["events"])
            if events.Count() > 0 then m.top.events = events
        else if answer.status = 401
            m.top.connected = false
            exit while ' readAnswer told MainScene to sign in again
        else
            ' The server is restarting or the network is down: wait longer each time, up to half a minute
            failures = failures + 1
            m.top.connected = false
            delay = 1000 * failures * failures
            if delay > 30000 then delay = 30000
            Sleep(delay)
        end if
    end while
    m.top.connected = false
end sub
