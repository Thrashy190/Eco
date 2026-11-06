' Asking the server from a screen. Network calls are not allowed on the screen's own thread, so an ApiTask makes each
' one and the answer arrives in `handler`, a sub of the calling component taking the event:
'
'     fetch("album", restUrl("getAlbum", {id: id}), "onAlbum")
'     sub onAlbum(event as Object)
'         answer = answerOf(event)
'         if answer = invalid then return ' replaced by a newer request
'
' Only the latest request under each name counts, so a slow answer never overwrites a newer one. An answer is
' {ok, status, data, error}; for /rest, data is the inside of "subsonic-response".

function fetch(name as String, url as String, handler as String, method = "GET" as String, body = "" as String) as Object
    if m.requests = invalid then m.requests = {}
    task = CreateObject("roSGNode", "ApiTask")
    task.id = name
    task.url = url
    task.method = method
    task.body = body
    if handler <> "" then task.ObserveFieldScoped("response", handler)
    m.requests[name] = task
    task.control = "RUN"
    return task
end function

' The answer in this event, or invalid when a newer request with the same name replaced it.
function answerOf(event as Object) as Dynamic
    task = event.GetRoSGNode()
    latest = m.requests[task.id]
    if latest = invalid then return invalid
    if not latest.IsSameNode(task) then return invalid
    m.requests.Delete(task.id)
    return event.GetData()
end function

' Fire and forget: the answer does not matter (a play count, a recent entry).
sub tell(name as String, url as String, method = "GET" as String, body = "" as String)
    fetch(name, url, "", method, body)
end sub

' Ask the player (MainScene) to do something. The same actions as Connect's commands (stores/player.ts).
sub player(action as String, value = invalid as Dynamic)
    m.global.playerCommand = {action: action, value: value}
end sub

sub toast(text as String)
    m.global.toast = text
end sub
