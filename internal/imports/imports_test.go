package imports

import "testing"

func TestExportifyCSV(t *testing.T) {
	file := "\xef\xbb\xbf\"Track URI\",\"Track Name\",\"Album Name\",\"Artist Name(s)\",\"Duration (ms)\",\"ISRC\"\n" +
		"\"spotify:track:1\",\"Tití Me Preguntó\",\"Un Verano Sin Ti\",\"Bad Bunny\",\"243716\",\"QM1\"\n" +
		"\"spotify:track:2\",\"AMG, Part 2\",\"Nata Montana\",\"Natanael Cano;Peso Pluma\",\"174000\",\"\"\n"
	lists, err := Parse("Road trip.csv", []byte(file))
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 1 || lists[0].Name != "Road trip" || len(lists[0].Rows) != 2 {
		t.Fatalf("lists = %+v", lists)
	}
	first, second := lists[0].Rows[0], lists[0].Rows[1]
	if first.Title != "Tití Me Preguntó" || first.Artist != "Bad Bunny" || first.Album != "Un Verano Sin Ti" || first.DurationMs != 243716 || first.ISRC != "QM1" {
		t.Errorf("first = %+v", first)
	}
	if second.Title != "AMG, Part 2" || second.Artist != "Natanael Cano, Peso Pluma" {
		t.Errorf("second = %+v", second)
	}
}

func TestOneFileCanHoldSeveralPlaylists(t *testing.T) {
	file := "Track name;Artist name;Album;Playlist name\nOne;Metallica;...And Justice for All;Metal\nWalk;Pantera;;Metal\nEspresso;Sabrina Carpenter;;Pop\n"
	lists, err := Parse("export.csv", []byte(file))
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 2 || lists[0].Name != "Metal" || len(lists[0].Rows) != 2 || lists[1].Name != "Pop" {
		t.Fatalf("lists = %+v", lists)
	}
}

func TestEcoLikesCSV(t *testing.T) {
	file := "spotify_id,title,artist,album_artist,album,date,track,tracks,disc,isrc,duration_ms\nabc,Walk,Pantera,Pantera,Vulgar Display of Power,1992,3,11,1,X,315000\n"
	lists, err := Parse("likes.csv", []byte(file))
	if err != nil {
		t.Fatal(err)
	}
	if got := lists[0].Rows[0]; got.Title != "Walk" || got.Artist != "Pantera" || got.Album != "Vulgar Display of Power" || got.DurationMs != 315000 {
		t.Errorf("row = %+v", got)
	}
}

func TestSpotifyAccountData(t *testing.T) {
	playlists := `{"playlists":[{"name":"Gym","items":[
		{"track":{"trackName":"Walk","artistName":"Pantera","albumName":"Vulgar Display of Power","trackUri":"spotify:track:x"},"episode":null,"addedDate":"2024-01-01"},
		{"track":null,"episode":{"episodeName":"A podcast"}}
	]},{"name":"Empty","items":[]}]}`
	lists, err := Parse("Playlist1.json", []byte(playlists))
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 1 || lists[0].Name != "Gym" || len(lists[0].Rows) != 1 || lists[0].Rows[0].Title != "Walk" {
		t.Fatalf("lists = %+v", lists)
	}
	liked := `{"tracks":[{"artist":"Bad Bunny","album":"Un Verano Sin Ti","track":"Tití Me Preguntó","uri":"spotify:track:y"}],"albums":[]}`
	lists, err = Parse("YourLibrary.json", []byte(liked))
	if err != nil {
		t.Fatal(err)
	}
	if len(lists) != 1 || lists[0].Name != "Liked songs" || lists[0].Rows[0].Artist != "Bad Bunny" {
		t.Fatalf("lists = %+v", lists)
	}
}

func TestFilesThatAreNotLists(t *testing.T) {
	for name, file := range map[string]string{
		"holiday.csv": "date,amount\n2024-01-01,3\n",
		"empty.csv":   "",
		"other.json":  `{"something":"else"}`,
		"broken.json": `{"playlists":[`,
		"headers.csv": "Track Name,Artist Name\n",
	} {
		if lists, err := Parse(name, []byte(file)); err == nil {
			t.Errorf("%s: got %+v, want an error", name, lists)
		}
	}
}
