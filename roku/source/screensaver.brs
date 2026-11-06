' The screensaver Roku shows while Eco is open and nobody touches the remote: the cover of what plays, moving now and
' then so nothing burns into the screen. It runs apart from the app and learns what plays from the registry.

sub RunScreenSaver()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.SetMessagePort(port)
    screen.CreateScene("Screensaver")
    screen.Show()
    while true
        msg = Wait(0, port)
        if Type(msg) = "roSGScreenEvent" and msg.IsScreenClosed() then return
    end while
end sub
