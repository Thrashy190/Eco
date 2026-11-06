sub init()
    m.code = m.top.FindNode("code")
    m.steps = m.top.FindNode("steps")
    m.problem = m.top.FindNode("problem")
    m.actions = m.top.FindNode("actions")
    m.actions.items = [{label: "Change server"}]
    m.actions.ObserveField("chosen", "onChangeServer")
end sub

sub load()
    m.actions.translation = [(1920 - m.actions.width) / 2, 880]
    if m.global.server = ""
        m.code.text = ""
        m.steps.text = "First, tell this TV where Eco is: the address you open it at, such as http://192.168.1.50:8000"
        m.top.navigate = {action: "changeServer"}
        return
    end if
    m.steps.text = "On your phone or computer, open Eco, go to Settings and choose Connect a TV. Type this code there." + chr(10) + "Eco at " + m.global.server
    m.code.text = "..."
    m.task = CreateObject("roSGNode", "PairTask")
    m.task.ObserveField("code", "onCode")
    m.task.ObserveField("problem", "onProblem")
    m.task.ObserveField("cred", "onCred")
    m.task.control = "RUN"
end sub

sub onCode(event as Object)
    m.code.text = spacedCode(event.GetData())
    print "Eco: pairing code "; event.GetData()
end sub

sub onProblem(event as Object)
    m.problem.text = event.GetData()
end sub

sub onCred(event as Object)
    m.task.cancel = true
    m.top.signedIn = event.GetData()
end sub

sub takeFocus()
    m.actions.SetFocus(true)
end sub

sub onClosing()
    if m.task <> invalid then m.task.cancel = true
end sub

sub onChangeServer()
    if m.task <> invalid then m.task.cancel = true
    m.top.navigate = {action: "changeServer"}
end sub
