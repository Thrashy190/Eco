sub init()
    m.info = m.top.FindNode("info")
    m.keys = m.top.FindNode("keys")
    m.actions = m.top.FindNode("actions")
    content = CreateObject("roSGNode", "ContentNode")
    for each label in ["Change server", "Sign out of this TV"]
        content.CreateChild("ContentNode").title = label
    end for
    m.actions.content = content
    m.actions.ObserveField("itemSelected", "onAction")
    nl = chr(10)
    m.keys.text = "Play/Pause: play or pause, on any screen" + nl + "Rewind, Fast forward: 15 seconds back or ahead" + nl + "Instant replay: the song before" + nl + "Options (*) on a song: play next, add to the queue, go to its album or artist, favourite it" + nl + "Options (*) anywhere else: the player" + nl + "Back: the screen before, then the top bar"
end sub

sub load()
    version = CreateObject("roAppInfo").GetVersion()
    nl = chr(10)
    m.info.text = "Signed in as " + m.global.user + nl + "Eco server: " + m.global.server + nl + "This TV is " + Chr(34) + m.global.deviceName + Chr(34) + " on your other devices: choose it under Listen on to play music here." + nl + "Eco for Roku " + version
end sub

sub takeFocus()
    m.actions.SetFocus(true)
end sub

sub onAction(event as Object)
    if event.GetData() = 0
        m.top.navigate = {action: "changeServer"}
    else
        m.top.navigate = {action: "signOut"}
    end if
end sub
