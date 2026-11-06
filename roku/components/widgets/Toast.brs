sub init()
    m.box = m.top.FindNode("box")
    m.bg = m.top.FindNode("bg")
    m.label = m.top.FindNode("label")
    m.timer = m.top.FindNode("timer")
    m.timer.ObserveField("fire", "hide")
end sub

sub show()
    m.label.text = m.top.text
    width = m.label.BoundingRect().width + 72
    m.bg.width = width
    m.box.translation = [(1920 - width) / 2, 960]
    m.box.visible = true
    m.timer.control = "stop"
    m.timer.control = "start"
end sub

sub hide()
    m.box.visible = false
end sub
