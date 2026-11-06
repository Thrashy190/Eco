package server

import (
	"bytes"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func aJPEG(t *testing.T) string {
	t.Helper()
	var out bytes.Buffer
	if err := jpeg.Encode(&out, image.NewRGBA(image.Rect(0, 0, 4, 4)), nil); err != nil {
		t.Fatal(err)
	}
	return out.String()
}

// A picture belongs to its account: another user asking for "my avatar" gets their own, and only an administrator can
// look at someone else's.
func TestAvatarsStayWithTheirAccount(t *testing.T) {
	_, h := accountsServer(t)
	if rec := as(t, h, "ana", "PUT", "/api/me/avatar", aJPEG(t)); rec.Code != http.StatusOK {
		t.Fatalf("setting a picture: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "ana", "GET", "/api/me/avatar", ""); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("own picture: %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec := as(t, h, "ben", "GET", "/api/me/avatar", ""); rec.Code != http.StatusNotFound {
		t.Errorf("another user got a picture: %d", rec.Code)
	}
	if rec := as(t, h, "ben", "GET", "/api/admin/users/ana/avatar", ""); rec.Code != http.StatusForbidden {
		t.Errorf("a regular user looked at another account: %d", rec.Code)
	}
	if rec := as(t, h, "admin", "GET", "/api/admin/users/ana/avatar", ""); rec.Code != http.StatusOK {
		t.Errorf("an administrator could not see it: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "DELETE", "/api/me/avatar", ""); rec.Code != http.StatusOK {
		t.Errorf("removing it: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "GET", "/api/me/avatar", ""); rec.Code != http.StatusNotFound {
		t.Errorf("still there after removing: %d", rec.Code)
	}
}

func TestAvatarMustBeAJPEG(t *testing.T) {
	_, h := accountsServer(t)
	if rec := as(t, h, "ana", "PUT", "/api/me/avatar", "<svg onload=alert(1)>"); rec.Code != http.StatusBadRequest {
		t.Errorf("kept something that is not a picture: %d", rec.Code)
	}
}

// fakeNavidromeUsers adds what managing accounts needs to a Navidrome where the administrator's password is "right".
func fakeNavidromeUsers(t *testing.T, created *[]map[string]any, sessionOver *bool) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/auth/login":
			var login map[string]string
			json.NewDecoder(r.Body).Decode(&login)
			if login["username"] != "admin" || login["password"] != "right" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]string{"token": "session"})
		case r.URL.Path == "/api/user":
			if r.Header.Get("x-nd-authorization") != "Bearer session" || *sessionOver {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if r.Method == http.MethodGet {
				w.Write([]byte(`[{"userName":"admin","name":"Admin","isAdmin":true},{"userName":"ana","name":"Ana","isAdmin":false}]`))
				return
			}
			var user map[string]any
			json.NewDecoder(r.Body).Decode(&user)
			if user["userName"] == "taken" {
				w.WriteHeader(http.StatusBadRequest)
				w.Write([]byte(`{"errors":{"userName":"ra.validation.unique"}}`))
				return
			}
			*created = append(*created, user)
			w.Write([]byte(`{"id":"new"}`))
		case strings.HasSuffix(r.URL.Path, "/getUser"):
			json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok", "user": map[string]any{"adminRole": r.URL.Query().Get("u") == "admin"}}})
		default:
			w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
		}
	})
}

func usersServer(t *testing.T) (http.Handler, *[]map[string]any, *bool) {
	t.Helper()
	s, h := accountsServer(t)
	created := &[]map[string]any{}
	over := new(bool)
	nd := httptest.NewServer(fakeNavidromeUsers(t, created, over))
	t.Cleanup(nd.Close)
	s.nd.BaseURL = nd.URL
	return h, created, over
}

const newAccount = `{"username":"new","password":"long enough"}`

func TestAccountsAreForAdministrators(t *testing.T) {
	h, created, _ := usersServer(t)
	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/admin/users", ""},
		{"POST", "/api/admin/users", newAccount},
		{"POST", "/api/admin/unlock", `{"password":"right"}`},
	} {
		if rec := as(t, h, "ana", c.method, c.path, c.body); rec.Code != http.StatusForbidden {
			t.Errorf("a regular user got through %s %s: %d", c.method, c.path, rec.Code)
		}
	}
	if len(*created) != 0 {
		t.Fatalf("Navidrome was asked anyway: %v", *created)
	}
}

// Navidrome's Subsonic getUsers answers with only yourself, so the list has to come from its own API
func TestAccountListNeedsThePassword(t *testing.T) {
	h, _, _ := usersServer(t)
	if rec := as(t, h, "admin", "GET", "/api/admin/users", ""); !strings.Contains(rec.Body.String(), `"locked":true`) || strings.Contains(rec.Body.String(), "ana") {
		t.Errorf("listed before confirming: %s", rec.Body)
	}
	// A 401 here would sign the administrator out of the app for mistyping a password
	if rec := as(t, h, "admin", "POST", "/api/admin/unlock", `{"password":"wrong"}`); rec.Code != http.StatusForbidden {
		t.Errorf("wrong password: %d", rec.Code)
	}
	if rec := as(t, h, "admin", "GET", "/api/admin/users", ""); !strings.Contains(rec.Body.String(), `"locked":true`) {
		t.Errorf("a wrong password unlocked it: %s", rec.Body)
	}
	rec := as(t, h, "admin", "POST", "/api/admin/unlock", `{"password":"right"}`)
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), "session") {
		t.Errorf("unlocking: %d %s", rec.Code, rec.Body)
	}
	rec = as(t, h, "admin", "GET", "/api/admin/users", "")
	if !strings.Contains(rec.Body.String(), `"username":"ana"`) {
		t.Errorf("listing: %s", rec.Body)
	}
}

func TestSessionThatEndsLocksAgain(t *testing.T) {
	h, created, over := usersServer(t)
	as(t, h, "admin", "POST", "/api/admin/unlock", `{"password":"right"}`)
	*over = true
	if rec := as(t, h, "admin", "POST", "/api/admin/users", newAccount); rec.Code != http.StatusLocked {
		t.Errorf("creating with an old session: %d", rec.Code)
	}
	*over = false
	if rec := as(t, h, "admin", "GET", "/api/admin/users", ""); !strings.Contains(rec.Body.String(), `"locked":true`) {
		t.Errorf("still unlocked: %s", rec.Body)
	}
	if len(*created) != 0 {
		t.Errorf("created anyway: %v", *created)
	}
}

func TestCreatingAnAccount(t *testing.T) {
	h, created, _ := usersServer(t)
	if rec := as(t, h, "admin", "POST", "/api/admin/users", newAccount); rec.Code != http.StatusLocked {
		t.Errorf("creating before confirming: %d", rec.Code)
	}
	as(t, h, "admin", "POST", "/api/admin/unlock", `{"password":"right"}`)
	cases := []struct {
		name, body string
		want       int
	}{
		{"short password", `{"username":"new","password":"short"}`, http.StatusBadRequest},
		{"odd username", `{"username":"a b/c","password":"long enough"}`, http.StatusBadRequest},
		{"taken", `{"username":"taken","password":"long enough"}`, http.StatusConflict},
	}
	for _, c := range cases {
		if rec := as(t, h, "admin", "POST", "/api/admin/users", c.body); rec.Code != c.want {
			t.Errorf("%s: got %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body)
		}
	}
	if len(*created) != 0 {
		t.Fatalf("an account was created by a refused request: %v", *created)
	}
	rec := as(t, h, "admin", "POST", "/api/admin/users", `{"username":" María.2 ","password":"long enough"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("creating: %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "long enough") {
		t.Errorf("a password came back: %s", rec.Body)
	}
	if len(*created) != 1 || (*created)[0]["userName"] != "María.2" || (*created)[0]["name"] != "María.2" || (*created)[0]["isAdmin"] != false {
		t.Errorf("created: %v", *created)
	}
}

// How the app looks travels between one person's devices, and never to someone else's.
func TestLookAndWallpaperStayWithTheirAccount(t *testing.T) {
	_, h := accountsServer(t)
	if rec := as(t, h, "ana", "GET", "/api/me/look", ""); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"look":null`) {
		t.Fatalf("before saving one: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "ana", "PUT", "/api/me/look", `{"theme":"dark","background":"photo"}`); rec.Code != http.StatusOK {
		t.Fatalf("saving: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "ana", "GET", "/api/me/look", ""); !strings.Contains(rec.Body.String(), `"background":"photo"`) {
		t.Errorf("not kept: %s", rec.Body)
	}
	if rec := as(t, h, "ben", "GET", "/api/me/look", ""); !strings.Contains(rec.Body.String(), `"look":null`) {
		t.Errorf("another account sees it: %s", rec.Body)
	}
	for _, bad := range []string{`[1,2]`, `"dark"`, `null`, `{broken`, `{"x":"` + strings.Repeat("a", 40<<10) + `"}`} {
		if rec := as(t, h, "ana", "PUT", "/api/me/look", bad); rec.Code != http.StatusBadRequest {
			t.Errorf("kept %.20q: %d", bad, rec.Code)
		}
	}
	// It has its own address: lists of recents and pins do not carry it around
	if rec := as(t, h, "ana", "GET", "/api/me/library", ""); strings.Contains(rec.Body.String(), "look") {
		t.Errorf("the library state carries the look: %s", rec.Body)
	}

	if rec := as(t, h, "ana", "PUT", "/api/me/wallpaper", "<svg onload=alert(1)>"); rec.Code != http.StatusBadRequest {
		t.Errorf("kept something that is not a picture: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "PUT", "/api/me/wallpaper", aJPEG(t)); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"wallpaper":1`) {
		t.Fatalf("setting a background: %d %s", rec.Code, rec.Body)
	}
	if rec := as(t, h, "ana", "GET", "/api/me/wallpaper", ""); rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Errorf("own background: %d", rec.Code)
	}
	if rec := as(t, h, "ben", "GET", "/api/me/wallpaper", ""); rec.Code != http.StatusNotFound {
		t.Errorf("another account got a background: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "DELETE", "/api/me/wallpaper", ""); rec.Code != http.StatusOK {
		t.Errorf("removing it: %d", rec.Code)
	}
	if rec := as(t, h, "ana", "GET", "/api/me/wallpaper", ""); rec.Code != http.StatusNotFound {
		t.Errorf("still there after removing: %d", rec.Code)
	}
}
