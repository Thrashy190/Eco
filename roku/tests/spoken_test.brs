' Tests for components/lib/spoken.brs: the same cases as web/src/lib/spoken.test.ts. Run with `npm test`.

sub Main()
    m.failures = 0
    chapters = chaptersFrom(ParseJson("[{""start"":300,""title"":""Questions""},{""start"":0,""title"":""Intro""},{""start"":90,""title"":""Interview""},{""title"":""no start""}]"))
    check("chapters in order", textOf(chapters.Count()) + " " + chapters[1].title, "3 Interview")

    check("first", textOf(chapterAt(chapters, 0)), "0")
    check("just before", textOf(chapterAt(chapters, 89.5)), "0")
    check("a hair early", textOf(chapterAt(chapters, 89.9)), "1")
    check("last", textOf(chapterAt(chapters, 1000)), "2")
    check("none", textOf(chapterAt([], 50)), "-1")
    check("before the first", textOf(chapterAt([{start: 60, title: "Late"}], 10)), "-1")

    check("ends where the next starts", textOf(chapterEnd(chapters, 0, 600)), "90")
    check("last ends at the end", textOf(chapterEnd(chapters, 2, 600)), "600")

    check("back to this one's start", textOf(previousChapterStart(chapters, 120)), "90")
    check("only just began: the one before", textOf(previousChapterStart(chapters, 91)), "0")
    check("first chapter: the previous file", textOf(previousChapterStart(chapters, 1)), "-1")
    check("no chapters, well in", textOf(previousChapterStart([], 40)), "0")
    check("no chapters, at the start", textOf(previousChapterStart([], 2)), "-1")
    check("before the first mark", textOf(previousChapterStart([{start: 60, title: "Late"}], 61)), "0")

    check("forward", textOf(nextChapterStart(chapters, 10)), "90")
    check("past the last", textOf(nextChapterStart(chapters, 400)), "-1")
    check("to the first mark", textOf(nextChapterStart([{start: 60, title: "Late"}], 10)), "60")

    check("left in the chapter", textOf(chapterLeft(chapters, 100, 600)), "200")
    check("left in a file with none", textOf(chapterLeft([], 100, 600)), "500")

    if m.failures = 0 then print "PASS spoken"
end sub

sub check(name as String, got as Dynamic, want as Dynamic)
    if got <> want
        print "FAIL " + name + ": got " + textOf(got) + ", want " + textOf(want)
        m.failures = m.failures + 1
    end if
end sub
