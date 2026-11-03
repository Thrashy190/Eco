// Package web holds the single-page app, compiled into the eco binary.
package web

import (
	"embed"
	"io/fs"
)

//go:embed static
var files embed.FS

// Static returns the web app's files, rooted so that index.html is at "index.html".
func Static() fs.FS {
	sub, err := fs.Sub(files, "static")
	if err != nil {
		panic(err) // the directory is embedded at build time
	}
	return sub
}
