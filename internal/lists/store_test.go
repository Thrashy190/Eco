package lists

import (
	"os"
	"path/filepath"
	"testing"
)

// A CSV written by the previous Spanish version must load, keep its state and be upgraded on write.
func TestReadMigratesSpanishFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "likes.csv")
	spanish := "spotify_id,title,artist,youtube_url,youtube_dif_s,estado,archivo,nota\n" +
		"a,Song A,X,https://y/a,1,descargada,YouTube/a.m4a,\n" +
		"b,Song B,Y,https://y/b,5,encontrada,,\n" +
		"c,Song C,Z,,,revisar,,sin resultados en YouTube\n" +
		"d,Song D,W,,,,,\n" +
		"e,Song E,V,https://y/e,2,error,,boom\n"
	if err := os.WriteFile(path, []byte(spanish), 0o644); err != nil {
		t.Fatal(err)
	}
	rows, err := Read(path)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{Downloaded, Found, Review, Pending, Failed}
	for i, w := range want {
		if rows[i].Status != w {
			t.Errorf("row %d status = %q, want %q", i, rows[i].Status, w)
		}
	}
	if rows[0].File != "YouTube/a.m4a" || rows[1].YoutubeDiffS != "5" || rows[4].Note != "boom" {
		t.Errorf("fields lost in migration: %+v", rows)
	}

	if err := Write(path, rows); err != nil {
		t.Fatal(err)
	}
	again, _ := Read(path)
	if len(again) != 5 || again[1].Status != Found || again[0].File != "YouTube/a.m4a" {
		t.Errorf("round trip changed the data: %+v", again)
	}
	raw, _ := os.ReadFile(path)
	if !contains(string(raw), "status") || contains(string(raw), "estado") {
		t.Errorf("header was not upgraded to English:\n%s", raw)
	}
}

func TestMissingFileIsEmpty(t *testing.T) {
	rows, err := Read(filepath.Join(t.TempDir(), "nope.csv"))
	if err != nil || len(rows) != 0 {
		t.Fatalf("got %v, %v", rows, err)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
