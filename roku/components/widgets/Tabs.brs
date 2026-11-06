sub init()
    m.row = m.top.FindNode("row")
    m.cells = []
    m.top.ObserveField("focusedChild", "paint")
    m.global.ObserveFieldScoped("theme", "paint")
end sub

function makeFont(bold as Boolean, size as Integer) as Object
    font = CreateObject("roSGNode", "Font")
    if bold then font.uri = "pkg:/fonts/BricolageGrotesque-Bold.ttf" else font.uri = "pkg:/fonts/BricolageGrotesque-Regular.ttf"
    font.size = size
    return font
end function

sub build()
    m.row.RemoveChildrenIndex(m.row.GetChildCount(), 0)
    m.cells = []
    look = m.top.look
    items = m.top.items
    if items = invalid then items = [] ' the look can arrive first (it is set in XML)
    x = 0
    for each item in items
        primary = isTrue(item["primary"])
        height = 60
        size = 28
        iconSize = 34
        pad = 28
        if look = "buttons"
            height = 72
            size = 30
            iconSize = 34
        else if look = "icons"
            height = 84
            iconSize = 40
            if primary
                height = 112
                iconSize = 52
            end if
        end if
        cell = m.row.CreateChild("Group")
        bg = cell.CreateChild("Poster")
        bg.uri = "pkg:/images/pill.9.png"
        bg.height = height
        icon = invalid
        label = invalid
        width = 0
        if textOf(item["icon"]) <> ""
            icon = cell.CreateChild("Poster")
            icon.uri = "pkg:/images/icons/" + item["icon"] + ".png"
            icon.width = iconSize
            icon.height = iconSize
            icon.translation = [pad, (height - iconSize) / 2]
            width = pad + iconSize
        end if
        if textOf(item["label"]) <> "" and look <> "icons"
            label = cell.CreateChild("Label")
            label.font = makeFont(true, size)
            label.text = item["label"]
            gap = 0
            if icon <> invalid then gap = 12
            if width = 0 then width = pad
            label.translation = [width + gap, (height - size * 1.3) / 2]
            width = width + gap + label.BoundingRect().width
        end if
        width = width + pad
        if look = "icons"
            width = height
            if icon <> invalid then icon.translation = [(height - iconSize) / 2, (height - iconSize) / 2]
        end if
        bg.width = width
        cell.scaleRotateCenter = [width / 2, height / 2]
        m.cells.Push({cell: cell, bg: bg, icon: icon, label: label, on: isTrue(item["on"]), primary: primary, height: height})
        x = x + width + 14
    end for
    ' Line the cells up on their centres, so a bigger Play sits level with the rest
    tallest = 0
    for each c in m.cells
        if c.height > tallest then tallest = c.height
    end for
    x = 0
    for each c in m.cells
        c.cell.translation = [x, (tallest - c.height) / 2]
        x = x + c.bg.width + 14
    end for
    m.top.width = x - 14
    if m.top.focusIndex >= m.cells.Count() then m.top.focusIndex = 0
    paint()
end sub

sub paint()
    theme = m.global.theme
    focused = m.top.HasFocus() or m.top.lit
    look = m.top.look
    for i = 0 to m.cells.Count() - 1
        c = m.cells[i]
        bg = "0xFFFFFF00"
        ink = "0xA3A3AEFF"
        if look <> "tabs"
            bg = "0xFFFFFF1A"
            ink = "0xF4F4F7FF"
            if look = "icons" and not c.primary then bg = "0xFFFFFF00"
        end if
        if c.primary
            bg = theme.accentSoft
            ink = "0xFFFFFFFF"
        end if
        if c.on then ink = theme.accent
        if i = m.top.selected
            bg = "0xF4F4F7FF"
            ink = "0x0B0B0FFF"
        end if
        scale = 1.0
        if focused and i = m.top.focusIndex
            bg = theme.accent
            ink = theme.ink
            scale = 1.08
        end if
        c.bg.blendColor = bg
        c.cell.scale = [scale, scale]
        if c.icon <> invalid then c.icon.blendColor = ink
        if c.label <> invalid then c.label.color = ink
    end for
end sub

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    if key = "left" and m.top.focusIndex > 0
        m.top.focusIndex = m.top.focusIndex - 1
        return true
    else if key = "right" and m.top.focusIndex < m.cells.Count() - 1
        m.top.focusIndex = m.top.focusIndex + 1
        return true
    else if key = "OK" and m.cells.Count() > 0
        m.top.chosen = m.top.focusIndex
        return true
    end if
    return false
end function
