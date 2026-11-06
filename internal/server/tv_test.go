package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Thrashy190/eco/internal/connect"
)

func TestTVSignsInWithACode(t *testing.T) {
	_, h := accountsServer(t)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/tv/pair", nil))
	var start struct{ Code, Secret string }
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &start) != nil || start.Code == "" || start.Secret == "" {
		t.Fatalf("start: %d %s", rec.Code, rec.Body)
	}
	collect := func(secret string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/tv/pair/"+start.Code+"?secret="+secret, nil))
		return rec
	}
	if got := collect(start.Secret); got.Code != http.StatusAccepted {
		t.Fatalf("before approval: %d %s", got.Code, got.Body)
	}
	// Approving needs a sign-in
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/tv/approve", strings.NewReader(`{"code":"`+start.Code+`"}`)))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("approving without signing in: %d", rec.Code)
	}
	if got := as(t, h, "diego", "POST", "/api/tv/approve", `{"code":"`+strings.ToLower(start.Code)+`"}`); got.Code != http.StatusOK {
		t.Fatalf("approve: %d %s", got.Code, got.Body)
	}
	if got := collect("wrong"); got.Code != http.StatusNotFound {
		t.Fatalf("collecting with the wrong secret: %d %s", got.Code, got.Body)
	}
	got := collect(start.Secret)
	if got.Code != http.StatusOK || !strings.Contains(got.Body.String(), `"u":"diego"`) || !strings.Contains(got.Body.String(), `"t":"token"`) {
		t.Fatalf("collect: %d %s", got.Code, got.Body)
	}
	if got := collect(start.Secret); got.Code != http.StatusNotFound {
		t.Fatalf("a code signed in twice: %d", got.Code)
	}
}

// Someone signed in with a plain password must not hand it to a TV.
func TestTVNeverReceivesAPassword(t *testing.T) {
	s, h := accountsServer(t)
	code, _, _ := s.pairs.Start()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("POST", "/api/tv/approve?u=diego&p=secret", strings.NewReader(`{"code":"`+code+`"}`)))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("approved with a password: %d %s", rec.Code, rec.Body)
	}
}

func poll(t *testing.T, h http.Handler, user, device string) []pollEvent {
	t.Helper()
	rec := as(t, h, user, "GET", "/api/connect/poll?name=TV&device="+device, "")
	var body struct{ Events []pollEvent }
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &body) != nil {
		t.Fatalf("poll: %d %s", rec.Code, rec.Body)
	}
	return body.Events
}

func TestTVReceivesCommandsByPolling(t *testing.T) {
	s, h := accountsServer(t)
	phone, leave, err := s.hub.Join("diego", connect.Info{ID: "phone-0001", Name: "Phone"})
	if err != nil {
		t.Fatal(err)
	}
	defer leave()
	// The first poll returns at once: joining sends the list of devices
	if events := poll(t, h, "diego", "roku-0000001"); len(events) == 0 || events[0].Name != "devices" || !strings.Contains(string(events[0].Data), "phone-0001") {
		t.Fatalf("first poll: %+v", events)
	}
	<-phone.Events // its own arrival
	if e := <-phone.Events; e.Name != "devices" || !strings.Contains(string(e.Data), "roku-0000001") {
		t.Fatalf("the phone did not see the TV: %s %s", e.Name, e.Data)
	}
	// Between polls the TV is still there, and the command waits for it
	if rec := as(t, h, "diego", "POST", "/api/connect/command?device=phone-0001", `{"target":"roku-0000001","action":"pause"}`); rec.Code != http.StatusOK {
		t.Fatalf("command: %d %s", rec.Code, rec.Body)
	}
	events := poll(t, h, "diego", "roku-0000001")
	if len(events) != 1 || events[0].Name != "command" || !strings.Contains(string(events[0].Data), `"action":"pause"`) {
		t.Fatalf("second poll: %+v", events)
	}
	// Another account cannot reach it
	if _, _, err := s.hub.Join("ana", connect.Info{ID: "ana-phone01", Name: "Phone"}); err != nil {
		t.Fatal(err)
	}
	if rec := as(t, h, "ana", "POST", "/api/connect/command?device=ana-phone01", `{"target":"roku-0000001","action":"pause"}`); rec.Code != http.StatusNotFound {
		t.Fatalf("another account reached the TV: %d", rec.Code)
	}
}
