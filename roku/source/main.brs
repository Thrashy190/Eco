' Eco for Roku: a remote-friendly player for an Eco server, and a device the phone can send music to (Connect).
' See roku/README.md. Everything on screen lives in components/; this only starts it.

sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    ' Shared state goes in place before any component starts, since they read it when they are created
    setUpGlobal(screen.GetGlobalNode())
    scene = screen.CreateScene("MainScene")
    screen.Show()
    scene.ObserveField("exit", port)
    while true
        msg = Wait(0, port)
        kind = Type(msg)
        if kind = "roSGScreenEvent"
            if msg.IsScreenClosed() then return
        else if kind = "roSGNodeEvent"
            if msg.GetField() = "exit" then return
        end if
    end while
end sub

sub setUpGlobal(g as Object)
    saved = CreateObject("roRegistrySection", "eco")
    server = saved.Read("server")
    if server = "" then server = CreateObject("roAppInfo").GetValue("eco_server") ' set by `make roku`
    deviceId = saved.Read("device")
    if deviceId = ""
        deviceId = "roku-" + CreateObject("roDeviceInfo").GetRandomUUID()
        saved.Write("device", deviceId)
        saved.Flush()
    end if
    info = CreateObject("roDeviceInfo")
    name = info.GetFriendlyName()
    if name = invalid or name = "" then name = info.GetModelDisplayName()
    if name = invalid or name = "" then name = "Roku"
    g.AddFields({
        server: server,
        user: saved.Read("user"),
        token: saved.Read("token"),
        salt: saved.Read("salt"),
        deviceId: deviceId,
        deviceName: name,
        nowPlaying: {},
        position: {position: 0, length: 0},
        currentId: "",
        theme: {accent: "0x7CF0C0FF", ink: "0x0B0B0FFF", glow: "0x7CF0C0FF", page: "0x000000FF", corners: "soft", favorites: "classic", hasSong: false}
    })
    ' alwaysNotify: the same value twice in a row still means "do it again"
    g.AddField("playerCommand", "assocarray", true)
    g.AddField("toast", "string", true)
    g.AddField("authFailed", "boolean", true)
end sub
