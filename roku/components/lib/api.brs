' Addresses on the Eco server, built like the web app's (web/src/lib/api.ts): Subsonic through /rest, Eco's own API
' under /api, with the signed-in user's token and salt on every request (never a password). Reads m.global, which
' MainScene fills from the registry.

function authQuery() as String
    g = m.global
    return "u=" + g.user.EncodeUriComponent() + "&t=" + g.token + "&s=" + g.salt + "&v=1.16.1&c=eco-roku&f=json"
end function

' Adds params to a query. Keys with capitals must be written in quotes ({"maxBitRate": 320}): BrightScript keeps the
' case of quoted keys only, and Navidrome reads them exactly.
function withParams(query as String, params as Dynamic) as String
    if Type(params) <> "roAssociativeArray" then return query
    for each key in params
        value = params[key]
        if Type(value) = "roArray"
            for each one in value
                query = query + "&" + key + "=" + textOf(one).EncodeUriComponent()
            end for
        else
            query = query + "&" + key + "=" + textOf(value).EncodeUriComponent()
        end if
    end for
    return query
end function

function restUrl(endpoint as String, params = invalid as Dynamic) as String
    return m.global.server + "/rest/" + endpoint + "?" + withParams(authQuery(), params)
end function

function apiUrl(path as String, params = invalid as Dynamic) as String
    return m.global.server + "/api/" + path + "?" + withParams(authQuery(), params)
end function

' An address that needs no sign-in (pairing a TV).
function openUrl(path as String) as String
    return m.global.server + "/api/" + path
end function

function coverUrl(id as Dynamic, size as Integer) as String
    cover = textOf(id)
    if cover = "" then return ""
    return restUrl("getCoverArt", {id: cover, size: size})
end function

' The picture for a song: Navidrome's cover art, or the thumbnail of an imported episode.
function songCoverUrl(song as Dynamic, size as Integer) as String
    if Type(song) <> "roAssociativeArray" then return ""
    mediaId = textOf(song["mediaId"])
    if mediaId <> "" then return apiUrl("media/" + mediaId.EncodeUriComponent() + "/thumb")
    return coverUrl(song["cover"], size)
end function

' A picture someone chose for a playlist in Eco (Navidrome cannot store one).
function playlistCoverUrl(id as String, version as Dynamic) as String
    return apiUrl("covers/playlists/" + id.EncodeUriComponent(), {cover: version})
end function

' Where a song's audio comes from. format=raw plays the file as it is; convert asks Navidrome for an MP3, for formats
' Roku cannot play and as the second try when the file would not play.
function streamUrl(song as Object, convert as Boolean) as String
    mediaId = textOf(song["mediaId"])
    if mediaId <> "" then return apiUrl("media/" + mediaId.EncodeUriComponent() + "/file")
    if convert then return restUrl("stream", {id: song.id, format: "mp3", "maxBitRate": 320})
    return restUrl("stream", {id: song.id, format: "raw"})
end function

' ---- Covers cut to the account's shape ----
' A Roku cannot reliably round a picture inside a list, so Eco cuts covers on the server (/api/covers/shaped) as PNGs
' with transparent corners. A cover is described by `art`: {id} for Navidrome's cover art, {playlist, version} for a
' picture chosen in Eco, or {url} for anything else (shown as it is).

function artUrl(art as Dynamic, size as Integer, shape as String) as String
    if Type(art) <> "roAssociativeArray" then return ""
    if textOf(art["id"]) <> "" then return apiUrl("covers/shaped", {id: art["id"], size: size, shape: shape})
    if textOf(art["playlist"]) <> "" then return apiUrl("covers/shaped", {playlist: art["playlist"], cover: art["version"], size: size, shape: shape})
    return textOf(art["url"])
end function

' What a song's picture is, as art.
function songArt(song as Dynamic) as Object
    if Type(song) <> "roAssociativeArray" then return {}
    mediaId = textOf(song["mediaId"])
    if mediaId <> "" then return {url: apiUrl("media/" + mediaId.EncodeUriComponent() + "/thumb")}
    cover = textOf(song["cover"])
    if cover <> "" then return {id: cover}
    return {}
end function
