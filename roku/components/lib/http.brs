' Network helpers for Task nodes only: Roku does not allow roUrlTransfer on the screen's thread.

function newTransfer(url as String, port as Object) as Object
    transfer = CreateObject("roUrlTransfer")
    transfer.SetUrl(url)
    transfer.SetMessagePort(port)
    transfer.EnableEncodings(true)
    transfer.RetainBodyOnError(true)
    if LCase(url).Left(8) = "https://"
        transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
        transfer.InitClientCertificates()
    end if
    return transfer
end function

' Start a request without waiting for it. Returns whether it started.
function startTransfer(transfer as Object, method as String, body as String) as Boolean
    method = UCase(method)
    if method = "GET" then return transfer.AsyncGetToString()
    transfer.SetRequest(method)
    transfer.AddHeader("Content-Type", "application/json")
    return transfer.AsyncPostFromString(body)
end function

' Make a request and wait for it, at most `seconds`. Returns {ok, status, data, error}, read the same way the web app
' reads answers (request and subsonic in web/src/lib/api.ts).
function requestJson(url as String, method = "GET" as String, body = "" as String, seconds = 20 as Integer) as Object
    port = CreateObject("roMessagePort")
    transfer = newTransfer(url, port)
    answer = {ok: false, status: 0, data: invalid, error: "No connection to the server"}
    if not startTransfer(transfer, method, body) then return answer
    msg = Wait(seconds * 1000, port)
    if Type(msg) <> "roUrlEvent"
        transfer.AsyncCancel()
        answer.error = "The server took too long to answer"
        return answer
    end if
    return readAnswer(url, msg)
end function

function readAnswer(url as String, msg as Object) as Object
    status = msg.GetResponseCode()
    answer = {ok: false, status: status, data: invalid, error: ""}
    text = msg.GetString()
    data = invalid
    ' Only JSON is parsed: a proxy or an older Eco may answer in plain text ("404 page not found")
    first = text.Trim().Left(1)
    if first = "{" or first = "[" then data = ParseJson(text)
    if status <= 0
        answer.error = "No connection to the server"
        return answer
    end if
    if status = 401
        answer.error = "Your session expired"
        m.global.authFailed = true
        return answer
    end if
    if Instr(1, url, "/rest/") > 0 and Type(data) = "roAssociativeArray" and data.DoesExist("subsonic-response")
        body = data["subsonic-response"]
        if textOf(body["status"]) = "ok"
            answer.ok = true
            answer.data = body
        else
            problem = objectOf(body["error"])
            code = Int(numberOf(problem["code"]))
            if code = 40 or code = 41 then m.global.authFailed = true
            answer.error = firstText(problem["message"], "Navidrome returned an error")
        end if
        return answer
    end if
    if status >= 200 and status < 300
        answer.ok = true
        answer.data = data
        return answer
    end if
    answer.data = data
    answer.error = firstText(objectOf(data)["error"], "Server error " + status.ToStr())
    return answer
end function
