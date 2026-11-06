sub init()
    m.box = m.top.FindNode("box")
    m.panel = m.top.FindNode("panel")
    m.heading = m.top.FindNode("heading")
    m.list = m.top.FindNode("list")
    m.list.ObserveField("itemSelected", "onSelected")
end sub

sub open()
    if not m.top.show then return
    theme = m.global.theme
    m.list.focusBitmapBlendColor = theme.accent
    m.list.focusedColor = theme.ink
    content = CreateObject("roSGNode", "ContentNode")
    for each option in m.top.options
        item = content.CreateChild("ContentNode")
        item.title = "   " + option
    end for
    m.list.content = content
    count = m.top.options.Count()
    listHeight = count * 78
    headingHeight = 0
    m.heading.text = m.top.title
    if m.top.title <> "" then headingHeight = m.heading.BoundingRect().height + 28
    height = 40 + headingHeight + listHeight + 34
    top = (1080 - height) / 2
    m.panel.height = height
    m.panel.translation = [580, top]
    m.heading.translation = [620, top + 40]
    m.list.translation = [620, top + 40 + headingHeight]
    m.list.numRows = count
    m.list.jumpToItem = 0
    m.box.visible = true
    m.list.SetFocus(true)
end sub

sub close()
    m.box.visible = false
    m.top.closed = true
end sub

sub onSelected(event as Object)
    choice = event.GetData()
    m.box.visible = false
    m.top.chosen = choice
    m.top.closed = true
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press or not m.box.visible then return false
    if key = "back" or key = "options"
        close()
        return true
    end if
    return true ' nothing behind the menu moves while it is open
end function
