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

// fakeNavidromeUsers adds what creating an account needs to a Navidrome where the administrator's password is "right".
func fakeNavidromeUsers(t *testing.T, created *[]map[string]any) http.Handler {
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
			if r.Header.Get("x-nd-authorization") != "Bearer session" {
				w.WriteHeader(http.StatusUnauthorized)
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
		case strings.HasSuffix(r.URL.Path, "/getUsers"):
			json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok", "users": map[string]any{"user": []map[string]any{{"username": "admin", "adminRole": true}, {"username": "ana"}}}}})
		case strings.HasSuffix(r.URL.Path, "/getUser"):
			json.NewEncoder(w).Encode(map[string]any{"subsonic-response": map[string]any{"status": "ok", "user": map[string]any{"adminRole": r.URL.Query().Get("u") == "admin"}}})
		default:
			w.Write([]byte(`{"subsonic-response":{"status":"ok"}}`))
		}
	})
}

func TestAccountsAreForAdministrators(t *testing.T) {
	s, h := accountsServer(t)
	var created []map[string]any
	nd := httptest.NewServer(fakeNavidromeUsers(t, &created))
	t.Cleanup(nd.Close)
	s.nd.BaseURL = nd.URL

	if rec := as(t, h, "ana", "GET", "/api/admin/users", ""); rec.Code != http.StatusForbidden {
		t.Errorf("a regular user listed the accounts: %d", rec.Code)
	}
	body := `{"username":"new","password":"long enough","admin_password":"right"}`
	if rec := as(t, h, "ana", "POST", "/api/admin/users", body); rec.Code != http.StatusForbidden {
		t.Errorf("a regular user created an account: %d", rec.Code)
	}
	if len(created) != 0 {
		t.Fatalf("Navidrome was asked anyway: %v", created)
	}

	rec := as(t, h, "admin", "GET", "/api/admin/users", "")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"username":"ana"`) {
		t.Errorf("listing: %d %s", rec.Code, rec.Body)
	}
}

func TestCreatingAnAccount(t *testing.T) {
	s, h := accountsServer(t)
	var created []map[string]any
	nd := httptest.NewServer(fakeNavidromeUsers(t, &created))
	t.Cleanup(nd.Close)
	s.nd.BaseURL = nd.URL

	cases := []struct {
		name, body string
		want       int
	}{
		// A 401 here would sign the administrator out of the app for mistyping a password
		{"wrong own password", `{"username":"new","password":"long enough","admin_password":"wrong"}`, http.StatusForbidden},
		{"no own password", `{"username":"new","password":"long enough"}`, http.StatusBadRequest},
		{"short password", `{"username":"new","password":"short","admin_password":"right"}`, http.StatusBadRequest},
		{"odd username", `{"username":"a b/c","password":"long enough","admin_password":"right"}`, http.StatusBadRequest},
		{"taken", `{"username":"taken","password":"long enough","admin_password":"right"}`, http.StatusConflict},
	}
	for _, c := range cases {
		if rec := as(t, h, "admin", "POST", "/api/admin/users", c.body); rec.Code != c.want {
			t.Errorf("%s: got %d, want %d (%s)", c.name, rec.Code, c.want, rec.Body)
		}
	}
	if len(created) != 0 {
		t.Fatalf("an account was created by a refused request: %v", created)
	}

	rec := as(t, h, "admin", "POST", "/api/admin/users", `{"username":" María.2 ","password":"long enough","admin_password":"right"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("creating: %d %s", rec.Code, rec.Body)
	}
	if strings.Contains(rec.Body.String(), "long enough") || strings.Contains(rec.Body.String(), "right") {
		t.Errorf("a password came back: %s", rec.Body)
	}
	if len(created) != 1 || created[0]["userName"] != "María.2" || created[0]["name"] != "María.2" || created[0]["isAdmin"] != false {
		t.Errorf("created: %v", created)
	}
}
