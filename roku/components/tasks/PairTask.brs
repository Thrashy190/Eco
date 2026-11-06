sub init()
    m.top.functionName = "work"
end sub

sub work()
    code = ""
    secret = ""
    while not m.top.cancel
        if code = ""
            answer = requestJson(openUrl("tv/pair"), "POST", "{}", 15)
            data = objectOf(answer.data)
            if answer.ok and textOf(data["code"]) <> ""
                code = data["code"]
                secret = textOf(data["secret"])
                m.top.problem = ""
                m.top.code = code
            else
                m.top.code = ""
                m.top.problem = "Cannot reach Eco at " + m.global.server + " (" + answer.error + ")"
                if pause(5000) then return
            end if
        else
            answer = requestJson(openUrl("tv/pair/" + code + "?secret=" + secret), "GET", "", 15)
            if answer.status = 200 and Type(answer.data) = "roAssociativeArray"
                m.top.cred = answer.data
                return
            else if answer.status = 404
                code = "" ' expired: show a new one
            else if answer.status = 202
                m.top.problem = ""
            else
                m.top.problem = "Lost the connection to Eco. Trying again…"
            end if
            if pause(2000) then return
        end if
    end while
end sub

' Wait a moment. Returns true when the screen no longer needs the code.
function pause(ms as Integer) as Boolean
    clock = CreateObject("roTimespan")
    while clock.TotalMilliseconds() < ms
        if m.top.cancel then return true
        Sleep(200)
    end while
    return m.top.cancel
end function
