' Navigation, signing in and the remote's global keys. The player is in Player.brs, Connect in Connect.brs.

sub init()
    m.top.backgroundColor = "0x0B0B0FFF"
    m.top.backgroundUri = ""
    ' Roku's own dialogs and keyboards in Eco's colours instead of the system purple
    palette = CreateObject("roSGNode", "RSGPalette")
    palette.colors = {
        DialogBackgroundColor: "0x1D1D26FF",
        DialogItemColor: "0xF4F4F7FF",
        DialogTextColor: "0xF4F4F7FF",
        DialogFocusColor: "0x7CF0C0FF",
        DialogFocusItemColor: "0x05241AFF",
        DialogSecondaryTextColor: "0x9B9BA8FF",
        DialogSecondaryItemColor: "0x9B9BA8FF",
        DialogInputFieldColor: "0x272733FF",
        DialogKeyboardColor: "0x272733FF",
        DialogFootprintColor: "0x3A3A48FF"
    }
    m.top.palette = palette
    m.screens = m.top.FindNode("screens")
    m.topBar = m.top.FindNode("topBar")
    m.tabs = m.top.FindNode("tabs")
    m.toastBox = m.top.FindNode("toast")
    m.leave = m.top.FindNode("leave")
    m.capsule = m.top.FindNode("capsule")
    m.signedIn = false
    m.hasSong = false
    m.stack = []
    m.backdrop = m.top.FindNode("backdrop")
    m.logo = m.top.FindNode("logo")
    m.tabScreens = ["HomeScreen", "LibraryScreen", "SearchScreen", "SettingsScreen"]
    m.tabs.items = [{label: "Home"}, {label: "Library"}, {label: "Search"}, {label: "Settings"}]
    m.tabs.ObserveField("chosen", "onTabChosen")
    m.top.FindNode("barBg").width = 170 + m.tabs.width + 10
    m.capsule.ObserveField("chosen", "openPlayer")
    m.global.ObserveField("theme", "onThemeChanged")
    m.leave.ObserveField("chosen", "onLeaveChosen")
    m.leave.ObserveField("closed", "onMenuClosed")
    m.global.ObserveField("playerCommand", "onPlayerCommand")
    m.global.ObserveField("toast", "onToast")
    m.global.ObserveField("authFailed", "onAuthFailed")
    initTheme()
    initPlayer()
    if m.global.server = "" or m.global.token = ""
        showPairing()
    else
        signedIn()
    end if
end sub

' ---- Signing in ----

sub showPairing()
    m.signedIn = false
    stopConnect()
    clearScreens()
    m.topBar.visible = false
    screen = openScreen("PairScreen", {})
    screen.ObserveField("signedIn", "onPaired")
end sub

sub onPaired(event as Object)
    cred = event.GetData()
    saved = CreateObject("roRegistrySection", "eco")
    saved.Write("user", textOf(cred["u"]))
    saved.Write("token", textOf(cred["t"]))
    saved.Write("salt", textOf(cred["s"]))
    saved.Flush()
    m.global.user = textOf(cred["u"])
    m.global.token = textOf(cred["t"])
    m.global.salt = textOf(cred["s"])
    signedIn()
    toast("Signed in as " + m.global.user)
end sub

sub signedIn()
    m.signedIn = true
    m.topBar.visible = true
    loadLook()
    startConnect()
    showTab(0)
end sub

sub onThemeChanged()
    m.logo.blendColor = m.global.theme.accent
end sub

sub signOut()
    stopPlayback()
    saved = CreateObject("roRegistrySection", "eco")
    saved.Delete("token")
    saved.Delete("salt")
    saved.Delete("playing")
    saved.Flush()
    m.global.token = ""
    m.global.salt = ""
    showPairing()
end sub

' Navidrome said no to the saved sign-in (a changed password, a removed account).
sub onAuthFailed()
    if not m.signedIn then return
    signOut()
    toast("Sign in again: Eco did not accept this TV's sign-in")
end sub

' The address of the Eco server, typed with the remote. A new server means signing in again.
sub askForServer()
    dialog = CreateObject("roSGNode", "StandardKeyboardDialog")
    dialog.title = "Eco server"
    dialog.message = ["The address you open Eco at, such as http://192.168.1.50:8000"]
    dialog.text = m.global.server
    dialog.buttons = ["Save", "Cancel"]
    dialog.ObserveField("buttonSelected", "onServerDialog")
    m.top.dialog = dialog
end sub

sub onServerDialog(event as Object)
    dialog = event.GetRoSGNode()
    if event.GetData() = 0
        server = cleanServer(dialog.text)
        if server <> ""
            saved = CreateObject("roRegistrySection", "eco")
            saved.Write("server", server)
            saved.Flush()
            m.global.server = server
            m.signedIn = true ' so signOut runs fully
            signOut()
        end if
    end if
    dialog.close = true
end sub

' ---- Screens ----

function openScreen(name as String, args as Object) as Object
    screen = CreateObject("roSGNode", name)
    screen.ObserveField("navigate", "onNavigate")
    m.screens.AppendChild(screen)
    m.stack.Push(screen)
    screen.args = args
    updateChrome()
    focusScreen()
    return screen
end function

' The player fills the screen, Spotify-like: no top bar, the cover's colours behind it.
sub updateChrome()
    top = m.stack.Peek()
    full = top <> invalid and top.HasField("fullscreen") and top.fullscreen
    m.topBar.visible = m.signedIn and not full
    m.capsule.visible = m.hasSong and not full
    if full then m.backdrop.mode = "player" else m.backdrop.mode = "browse"
end sub

' Open the player, unless it is already showing.
sub openPlayer()
    if not m.signedIn then return
    if currentSong() = invalid
        toast("Nothing is playing")
        return
    end if
    top = m.stack.Peek()
    if top <> invalid and top.HasField("fullscreen") then return
    pushScreen("NowPlayingScreen", {})
end sub

sub clearScreens()
    for each screen in m.stack
        if screen.HasField("closing") then screen.closing = true
        m.screens.RemoveChild(screen)
    end for
    m.stack = []
end sub

sub showTab(index as Integer)
    m.tabs.selected = index
    clearScreens()
    openScreen(m.tabScreens[index], {})
end sub

sub pushScreen(name as String, args as Object)
    if m.stack.Count() > 0 then m.stack.Peek().visible = false
    openScreen(name, args)
end sub

sub popScreen()
    screen = m.stack.Pop()
    m.screens.RemoveChild(screen)
    top = m.stack.Peek()
    top.visible = true
    updateChrome()
    focusScreen()
end sub

sub focusScreen()
    if m.stack.Count() = 0 then return
    m.stack.Peek().focusIn = true
end sub

sub onTabChosen(event as Object)
    showTab(event.GetData())
end sub

' What screens ask for: another screen, a tab, or something only this scene can do.
sub onNavigate(event as Object)
    request = event.GetData()
    action = textOf(request["action"])
    if action = "changeServer"
        askForServer()
    else if action = "signOut"
        signOut()
    else if action = "back"
        if m.stack.Count() > 1 then popScreen()
    else if request["tab"] <> invalid
        showTab(Int(numberOf(request["tab"])))
    else if textOf(request["screen"]) <> ""
        pushScreen(request["screen"], objectOf(request["args"]))
    end if
end sub

' ---- Keys no screen used ----

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if not m.signedIn then return key <> "back" ' only leaving works before signing in
    if key = "back"
        if m.stack.Count() > 1
            popScreen()
            return true
        end if
        if not inTopBar()
            m.tabs.SetFocus(true)
            return true
        end if
        if m.tabs.selected <> 0
            showTab(0)
            m.tabs.SetFocus(true)
            return true
        end if
        if isPlaying()
            m.leave.title = "Leave Eco?"
            m.leave.options = ["Keep listening", "Leave (the music stops)"]
            m.leave.show = true
            return true
        end if
        return false
    else if key = "up"
        if not inTopBar() and m.topBar.visible
            m.tabs.SetFocus(true)
            return true
        end if
    else if key = "down"
        if inTopBar()
            focusScreen()
            return true
        end if
    else if key = "right"
        if m.tabs.HasFocus() and m.capsule.visible
            m.capsule.SetFocus(true)
            return true
        end if
    else if key = "left"
        if m.capsule.HasFocus()
            m.tabs.SetFocus(true)
            return true
        end if
    else if key = "play"
        applyCommand("toggle", invalid)
        return true
    else if key = "fastforward"
        seekBy(15)
        return true
    else if key = "rewind"
        seekBy(-15)
        return true
    else if key = "replay"
        applyCommand("previous", invalid)
        return true
    else if key = "options"
        openPlayer()
        return true
    end if
    return false
end function

function inTopBar() as Boolean
    return m.tabs.IsInFocusChain() or m.capsule.HasFocus()
end function

sub onLeaveChosen(event as Object)
    if event.GetData() = 1
        stopPlayback()
        m.top.exit = true
    end if
end sub

sub onMenuClosed()
    m.tabs.SetFocus(true)
end sub

sub onToast(event as Object)
    m.toastBox.text = event.GetData()
end sub
