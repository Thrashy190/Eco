' The play order, with the same rules as the web app (web/src/lib/queue.ts), so a queue handed between a phone and the
' TV keeps its shape. Songs someone adds ("Play next", "Add to queue") wait in front of the album or playlist playing,
' marked `queued`; Autoplay's songs come last, marked `auto`. An order is {queue: [songs], index: the song playing}.
' Everything here is pure and tested (roku/tests/queue_test.brs). Needs format.brs.

' Where a song in the queue comes from: "queued" (added by hand), "list" (the album or playlist) or "auto".
function kindOf(song as Object) as String
    if isTrue(song["queued"]) then return "queued"
    if isTrue(song["auto"]) then return "auto"
    return "list"
end function

function withKind(song as Object, kind as String) as Object
    if kindOf(song) = kind then return song
    out = {}
    for each key in song
        lower = LCase(key)
        if lower <> "queued" and lower <> "auto" then out[key] = song[key]
    end for
    if kind <> "list" then out[kind] = true
    return out
end function

function sliceOf(list as Object, first as Integer, last = -1 as Integer) as Object
    out = []
    if last < 0 or last > list.Count() then last = list.Count()
    if first < 0 then first = 0
    for i = first to last - 1
        out.Push(list[i])
    end for
    return out
end function

function joined(parts as Object) as Object
    out = []
    for each part in parts
        out.Append(part)
    end for
    return out
end function

function makeOrder(queue as Object, index as Integer) as Object
    return {queue: queue, index: index}
end function

' Where the next added song goes: after the current song and everything added before it.
function queueEnd(order as Object) as Integer
    at = order.index + 1
    while at < order.queue.Count() and isTrue(order.queue[at]["queued"])
        at = at + 1
    end while
    return at
end function

function insertAt(queue as Object, at as Integer, song as Object) as Object
    return joined([sliceOf(queue, 0, at), [song], sliceOf(queue, at)])
end function

' "Add to queue": after the songs already waiting, before the rest of the album or playlist.
function addToQueue(order as Object, song as Object) as Object
    return makeOrder(insertAt(order.queue, queueEnd(order), withKind(song, "queued")), order.index)
end function

' "Play next": straight after the current song, ahead of anything waiting.
function addNext(order as Object, song as Object) as Object
    return makeOrder(insertAt(order.queue, order.index + 1, withKind(song, "queued")), order.index)
end function

' The songs added by hand that have not played yet.
function waitingSongs(order as Object) as Object
    out = []
    for each song in sliceOf(order.queue, order.index + 1)
        if isTrue(song["queued"]) then out.Push(song)
    end for
    return out
end function

' Start a list (already in play order) at song i. What was waiting in the queue comes right after that song.
function startList(order as Object, songs as Object, i as Integer) as Object
    list = []
    for each song in songs
        list.Push(withKind(song, "list"))
    end for
    return makeOrder(joined([sliceOf(list, 0, i + 1), waitingSongs(order), sliceOf(list, i + 1)]), i)
end function

' Jump to a song further down. Added songs it skips over stay waiting, right after it; skipped songs of the album or
' playlist count as passed. Going back changes nothing but the position.
function jumpTo(order as Object, target as Integer) as Object
    queue = order.queue
    index = order.index
    if target <= index + 1 or target >= queue.Count()
        last = queue.Count() - 1
        if target > last then target = last
        if target < 0 then target = 0
        return makeOrder(queue, target)
    end if
    skipped = sliceOf(queue, index + 1, target)
    kept = []
    passed = []
    for each song in skipped
        if isTrue(song["queued"]) then kept.Push(song) else passed.Push(song)
    end for
    if kept.Count() = 0 then return makeOrder(queue, target)
    before = joined([sliceOf(queue, 0, index + 1), passed])
    return makeOrder(joined([before, [queue[target]], kept, sliceOf(queue, target + 1)]), before.Count())
end function

' A copy of the list in random order.
function mixed(list as Object) as Object
    out = sliceOf(list, 0)
    k = out.Count() - 1
    while k > 0
        j = Rnd(k + 1) - 1
        swap = out[k]
        out[k] = out[j]
        out[j] = swap
        k = k - 1
    end while
    return out
end function

' Shuffle what comes next. Added songs keep their order at the front: they were chosen to play next.
function shuffleUpcoming(order as Object) as Object
    queued = []
    list = []
    auto = []
    for each song in sliceOf(order.queue, order.index + 1)
        kind = kindOf(song)
        if kind = "queued"
            queued.Push(song)
        else if kind = "auto"
            auto.Push(song)
        else
            list.Push(song)
        end if
    end for
    return makeOrder(joined([sliceOf(order.queue, 0, order.index + 1), queued, mixed(list), auto]), order.index)
end function

' Move a song that has not played yet from one position to another (both counted in the whole queue, the second as
' it reads after the move). It joins whatever it lands among, which keeps the added songs together at the front.
function moveSong(order as Object, source as Integer, target as Integer) as Object
    queue = order.queue
    index = order.index
    count = queue.Count()
    if source = target or source <= index or target <= index or source >= count or target >= count then return order
    out = sliceOf(queue, 0)
    song = out[source]
    out.Delete(source)
    out = insertAt(out, target, song)
    above = invalid
    if target - 1 > index then above = out[target - 1]
    below = invalid
    if target + 1 < out.Count() then below = out[target + 1]
    if above <> invalid
        kind = kindOf(above)
    else if isTrue(song["queued"]) or (below <> invalid and isTrue(below["queued"]))
        kind = "queued"
    else if below <> invalid
        kind = kindOf(below)
    else
        kind = kindOf(song)
    end if
    out[target] = withKind(song, kind)
    return makeOrder(out, index)
end function

' What Autoplay adds when the queue runs out: candidates (already in random order) not in the queue yet, at most count.
function autoplayPick(candidates as Object, queue as Object, count as Integer) as Object
    seen = {}
    seen.SetModeCaseSensitive() ' Navidrome's IDs mix capitals
    for each song in queue
        seen[song.id] = true
    end for
    out = []
    for each song in candidates
        if out.Count() >= count then exit for
        spoken = song["kind"] <> invalid and song["kind"] <> ""
        if not seen.DoesExist(song.id) and not spoken
            seen[song.id] = true
            out.Push(withKind(song, "auto"))
        end if
    end for
    return out
end function

' Turning Autoplay off: the random songs it lined up that have not played go. The song playing stays, and so does one
' dragged among the added songs, since that made it chosen.
function withoutAutoplay(order as Object) as Object
    out = []
    for i = 0 to order.queue.Count() - 1
        s = order.queue[i]
        if i <= order.index or kindOf(s) <> "auto" then out.Push(s)
    end for
    return makeOrder(out, order.index)
end function
