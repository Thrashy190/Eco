' Podcasts and audiobooks: their chapters, and stepping by chapter, as web/src/lib/spoken.ts does (change both together;
' tests/spoken_test.brs and web/src/lib/spoken.test.ts check the same cases). Pure: no SceneGraph, no network.

' Chapters from the server's answer ({start, title}), as numbers and text, in order. Anything else is left out.
function chaptersFrom(list as Dynamic) as Object
    out = []
    for each raw in listOf(list)
        ' A chapter with no start is not one: numberOf would make it start at 0
        if Type(raw) = "roAssociativeArray" and raw.DoesExist("start")
            start = numberOf(raw["start"])
            if start >= 0 then out.Push({start: start, title: textOf(raw["title"])})
        end if
    end for
    out.SortBy("start")
    return out
end function

' The chapter playing at a moment (its index), or -1 before the first one or with none. A quarter second early still
' counts: a jump lands at the start.
function chapterAt(chapters as Object, t as Float) as Integer
    found = -1
    for i = 0 to chapters.Count() - 1
        if chapters[i].start <= t + 0.25
            found = i
        else
            exit for
        end if
    end for
    return found
end function

' Where a chapter ends: where the one after starts, or the end of the file.
function chapterEnd(chapters as Object, i as Integer, length as Float) as Float
    if i + 1 < chapters.Count() then return chapters[i + 1].start
    return length
end function

' Where "previous chapter" goes: this chapter's start if it has played a moment, else the one before. -1 means there is
' nothing before in this file: go to the previous item.
function previousChapterStart(chapters as Object, t as Float) as Float
    i = chapterAt(chapters, t)
    if i < 0
        if t > 3 then return 0
        return -1
    end if
    if t - chapters[i].start > 3 then return chapters[i].start
    if i > 0 then return chapters[i - 1].start
    if chapters[0].start > 0 then return 0
    return -1
end function

' Where "next chapter" goes, or -1 after the last one: go to the next item.
function nextChapterStart(chapters as Object, t as Float) as Float
    i = chapterAt(chapters, t) + 1
    if i < chapters.Count() then return chapters[i].start
    return -1
end function

' Seconds until the chapter playing ends: the sleep timer's "end of this chapter".
function chapterLeft(chapters as Object, t as Float, length as Float) as Float
    i = chapterAt(chapters, t)
    ending = length
    if i < 0 and chapters.Count() > 0
        ending = chapters[0].start
    else if i >= 0
        ending = chapterEnd(chapters, i, length)
    end if
    left = ending - t
    if left < 0 then return 0
    return left
end function
