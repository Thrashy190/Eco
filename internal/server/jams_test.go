package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/jam"
)

func jamOf(t *testing.T, rec *httptest.ResponseRecorder) jam.View {
	t.Helper()
	var v jam.View
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &v) != nil {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
	return v
}

// A private Jam is only there for the people its host invites. Members add songs of the library (their details come
// from the library, whatever the app sends), only the host controls unless they allow it, the people around see where
// a member is only if they may see that Jam, and the host ending it tells every device following it.
func TestJamsOverHTTP(t *testing.T) {
	_, s := libraryServerOf(t, song("a", "Alpha", "X", "One"), song("b", "Beta", "X", "One"))
	h := s.Handler()
	for _, user := range []string{"ana", "luis", "pedro"} {
		as(t, h, user, "GET", "/api/me/library", "")
	}
	call := func(user, method, path, body string) *httptest.ResponseRecorder {
		return as(t, h, user, method, path, body)
	}
	created := call("ana", "POST", "/api/jams", `{"name":"Night"}`)
	if !strings.Contains(created.Body.String(), `"queue":[]`) {
		t.Errorf("an empty queue must be a list for the app: %s", created.Body)
	}
	night := jamOf(t, created)
	base := "/api/jams/" + night.ID

	if body := call("luis", "GET", "/api/jams", "").Body.String(); strings.Contains(body, night.ID) {
		t.Errorf("luis sees a private jam he was not invited to: %s", body)
	}
	for _, path := range []string{base, base + "/events"} {
		if code := call("luis", "GET", path, "").Code; code != http.StatusNotFound {
			t.Errorf("luis GET %s: %d", path, code)
		}
	}
	if code := call("luis", "POST", base+"/join", "").Code; code != http.StatusNotFound {
		t.Errorf("luis joining uninvited: %d", code)
	}
	if code := call("luis", "POST", "/api/jams/../join", "").Code; code == http.StatusOK {
		t.Error("an impossible id was accepted")
	}

	jamOf(t, call("ana", "POST", base+"/invite", `{"users":["Luis"]}`))
	if body := call("luis", "GET", "/api/jams", "").Body.String(); !strings.Contains(body, `"invited":true`) {
		t.Errorf("the invitation does not show: %s", body)
	}
	v := jamOf(t, call("luis", "POST", base+"/join", ""))
	if !v.Member || v.CanControl || len(v.Invited) != 0 {
		t.Errorf("luis after joining: %+v", v)
	}

	// Luis adds a song of the library and one that is not: only the first goes in, with the library's details
	v = jamOf(t, call("luis", "POST", base+"/queue", `{"songs":["a","made-up"]}`))
	if len(v.Queue) != 1 || v.Queue[0].Song.Title != "Alpha" || v.Queue[0].AddedBy != "luis" || v.Playback.Entry != v.Queue[0].ID {
		t.Fatalf("queue: %+v", v)
	}
	if code := call("luis", "POST", base+"/queue", `{"songs":["made-up"]}`).Code; code != http.StatusBadRequest {
		t.Errorf("only made-up songs: %d", code)
	}
	if code := call("luis", "POST", base+"/control", `{"action":"pause"}`).Code; code != http.StatusForbidden {
		t.Errorf("a guest pausing: %d", code)
	}
	if code := call("pedro", "POST", base+"/queue", `{"songs":["b"]}`).Code; code != http.StatusNotFound {
		t.Errorf("an outsider adding: %d", code)
	}

	// The people around: Luis sees Ana is in Night, Pedro does not
	if body := call("luis", "GET", "/api/listening", "").Body.String(); !strings.Contains(body, `"name":"Night"`) {
		t.Errorf("luis does not see ana's jam: %s", body)
	}
	if body := call("pedro", "GET", "/api/listening", "").Body.String(); strings.Contains(body, night.ID) {
		t.Errorf("pedro sees a private jam: %s", body)
	}

	// Luis's device follows the Jam: a change arrives whole, and so does its end
	stream := openStream(t, h, "luis", base+"/events")
	if name, data := stream.next(); name != "jam" || !strings.Contains(data, `"Alpha"`) {
		t.Fatalf("first event: %s %s", name, data)
	}
	jamOf(t, call("ana", "POST", base+"/queue", `{"songs":["b"],"next":true}`))
	if name, data := stream.next(); name != "jam" || !strings.Contains(data, `"Beta"`) {
		t.Errorf("after ana added: %s %s", name, data)
	}
	jamOf(t, call("ana", "POST", base+"/control", `{"action":"pause"}`))
	if _, data := stream.next(); !strings.Contains(data, `"paused":true`) {
		t.Errorf("after ana paused: %s", data)
	}
	if code := call("luis", "DELETE", base, "").Code; code != http.StatusForbidden {
		t.Errorf("a guest ending the jam: %d", code)
	}
	if code := call("ana", "DELETE", base, "").Code; code != http.StatusOK {
		t.Fatalf("ending: %d", code)
	}
	if name, _ := stream.next(); name != "ended" {
		t.Errorf("after the end: %s", name)
	}
	if code := call("luis", "GET", base, "").Code; code != http.StatusNotFound {
		t.Errorf("an ended jam: %d", code)
	}
}

// A public Jam is there for everyone; whoever leaves stops following it.
func TestPublicJamsAndLeaving(t *testing.T) {
	_, h, _ := libraryServer(t, song("a", "Alpha", "X", "One"))
	party := jamOf(t, as(t, h, "ana", "POST", "/api/jams", `{"name":"Party","public":true,"guest_control":true}`))
	base := "/api/jams/" + party.ID
	if rec := as(t, h, "pedro", "GET", "/api/jams", ""); !strings.Contains(rec.Body.String(), "Party") {
		t.Errorf("a public jam is not listed: %s", rec.Body)
	}
	if rec := as(t, h, "pedro", "POST", base+"/join", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"can_control":true`) {
		t.Fatalf("joining: %d %s", rec.Code, rec.Body)
	}
	stream := openStream(t, h, "pedro", base+"/events")
	stream.next()
	if rec := as(t, h, "pedro", "POST", base+"/leave", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ended":false`) {
		t.Fatalf("leaving: %d %s", rec.Code, rec.Body)
	}
	if name, _ := stream.next(); name != "left" {
		t.Errorf("pedro's device after leaving: %s", name)
	}
	if rec := as(t, h, "pedro", "POST", base+"/queue", `{"songs":["a"]}`); rec.Code != http.StatusForbidden {
		t.Errorf("adding after leaving: %d", rec.Code)
	}
}
