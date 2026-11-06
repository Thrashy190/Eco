sub init()
    m.top.functionName = "work"
end sub

sub work()
    m.top.response = requestJson(m.top.url, m.top.method, m.top.body, m.top.timeout)
end sub
