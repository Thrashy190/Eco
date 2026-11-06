' Tests for components/lib/queue.brs, the same cases as web/src/lib/queue.test.ts. Run with `npm test`.

sub Main()
    m.failures = 0
    testAddedSongsWaitInOrder()
    testPlayNextGoesFirst()
    testStartingAListKeepsWhatWasAdded()
    testJumpKeepsSkippedAddedSongs()
    testJumpBackOnlyMoves()
    testShuffleKeepsAddedSongsFirst()
    testMoveJoinsWhereItLands()
    testMoveIgnoresPlayedSongs()
    testAutoplaySkipsWhatIsQueuedAndSpokenAudio()
    testCamelCaseKeysSurvive()
    if m.failures = 0 then print "PASS queue" else print "FAIL queue: " + m.failures.ToStr() + " failed"
end sub

function song(id as String) as Object
    return {"id": id, "title": id}
end function

function songs(ids as Object) as Object
    out = []
    for each id in ids
        out.Push(song(id))
    end for
    return out
end function

' The queue as text: ids, with + for added songs and * for Autoplay's.
function shape(order as Object) as String
    parts = []
    for i = 0 to order.queue.Count() - 1
        s = order.queue[i]
        mark = ""
        if kindOf(s) = "queued" then mark = "+"
        if kindOf(s) = "auto" then mark = "*"
        text = mark + s.id
        if i = order.index then text = "[" + text + "]"
        parts.Push(text)
    end for
    return parts.Join(" ")
end function

sub expect(name as String, got as String, want as String)
    if got <> want
        m.failures = m.failures + 1
        print "FAIL " + name + chr(10) + "  got:  " + got + chr(10) + "  want: " + want
    end if
end sub

sub testAddedSongsWaitInOrder()
    o = makeOrder(songs(["a", "b", "c"]), 0)
    o = addToQueue(o, song("x"))
    o = addToQueue(o, song("y"))
    expect("added songs wait in order", shape(o), "[a] +x +y b c")
end sub

sub testPlayNextGoesFirst()
    o = addToQueue(makeOrder(songs(["a", "b"]), 0), song("x"))
    o = addNext(o, song("n"))
    expect("play next goes first", shape(o), "[a] +n +x b")
end sub

sub testStartingAListKeepsWhatWasAdded()
    o = addToQueue(makeOrder(songs(["a", "b"]), 0), song("x"))
    o = startList(o, songs(["p", "q", "r"]), 1)
    expect("a new list keeps added songs", shape(o), "p [q] +x r")
end sub

sub testJumpKeepsSkippedAddedSongs()
    o = addToQueue(makeOrder(songs(["a", "b", "c", "d"]), 0), song("x"))
    ' a +x b c d: jumping to c skips x (kept) and b (passed)
    o = jumpTo(o, 3)
    expect("jump keeps skipped added songs", shape(o), "a b [c] +x d")
end sub

sub testJumpBackOnlyMoves()
    o = makeOrder(songs(["a", "b", "c"]), 2)
    expect("jump back", shape(jumpTo(o, 0)), "[a] b c")
    expect("jump past the end", shape(jumpTo(o, 9)), "a b [c]")
end sub

sub testShuffleKeepsAddedSongsFirst()
    o = makeOrder(songs(["a", "b", "c", "d", "e"]), 0)
    o = addToQueue(o, song("x"))
    o.queue.Push(withKind(song("z"), "auto"))
    o = shuffleUpcoming(o)
    expect("shuffle keeps the current song", o.queue[0].id, "a")
    expect("shuffle keeps added songs first", shape(o).Left(7), "[a] +x ")
    expect("shuffle keeps Autoplay last", o.queue[o.queue.Count() - 1].id, "z")
    ids = []
    for each s in o.queue
        ids.Push(s.id)
    end for
    ids.Sort()
    expect("shuffle loses nothing", ids.Join(""), "abcdexz")
end sub

sub testMoveJoinsWhereItLands()
    o = addToQueue(makeOrder(songs(["a", "b", "c"]), 0), song("x"))
    ' [a] +x b c: dragging c above x makes it an added song too
    expect("moved among added songs", shape(moveSong(o, 3, 1)), "[a] +c +x b")
    ' dragging x below b makes it part of the album
    expect("moved into the album", shape(moveSong(o, 1, 2)), "[a] b x c")
end sub

sub testMoveIgnoresPlayedSongs()
    o = makeOrder(songs(["a", "b", "c"]), 1)
    expect("cannot move a played song", shape(moveSong(o, 0, 2)), "a [b] c")
    expect("cannot move the current song", shape(moveSong(o, 1, 2)), "a [b] c")
end sub

sub testAutoplaySkipsWhatIsQueuedAndSpokenAudio()
    candidates = songs(["a", "n1", "n2", "n3"])
    candidates[1]["kind"] = "podcast"
    picked = autoplayPick(candidates, songs(["a", "b"]), 1)
    expect("autoplay picks new music", shape(makeOrder(picked, -1)), "*n2")
    ' IDs differ only in capitals: two songs, not one
    picked = autoplayPick(songs(["Ab"]), songs(["ab"]), 5)
    expect("autoplay compares IDs exactly", shape(makeOrder(picked, -1)), "*Ab")
end sub

' The phone reads these keys with capitals; marking a song must not lose them.
sub testCamelCaseKeysSurvive()
    s = {"id": "1", "albumId": "al", "artistId": "ar", "mediaId": "md"}
    o = addToQueue(makeOrder([song("a")], 0), s)
    text = FormatJson(o.queue[1])
    ok = Instr(1, text, """albumId""") > 0 and Instr(1, text, """artistId""") > 0 and Instr(1, text, """mediaId""") > 0
    if ok then expect("keys keep their capitals", "ok", "ok") else expect("keys keep their capitals", text, "albumId, artistId, mediaId")
end sub
