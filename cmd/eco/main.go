// eco: a self-hosted music app. It plays your library (Navidrome), finds songs you do not have yet,
// and downloads them with the right tags.
//
//	eco serve                 start the web app
//	eco get URL               download one YouTube link, tagged with Spotify's metadata
//	eco likes <step>          liked songs / playlists → CSV → YouTube → library, liked songs → Navidrome favourites
//	eco doctor                check that everything eco needs is installed
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

// version is set at build time: go build -ldflags "-X main.version=1.2.3".
var version = "dev"

const usage = `eco — your own music app

Usage:
  eco serve [--listen ADDR]        start the web app (default 127.0.0.1:8000)
  eco get [flags] URL              download one YouTube link with Spotify tags
  eco likes <step> [flags]         liked songs or a playlist, in steps:
                                     export   Spotify → CSV (asks you to sign in the first time)
                                     search   find the YouTube video of every song
                                     download fetch every song marked "found"
                                     favorites mark downloaded likes as Navidrome favourites
                                     playlist write the .m3u that Navidrome imports (playlists only)
                                     all      all of the above
  eco doctor                       check prerequisites and configuration
  eco version

Run "eco <command> -h" for the flags of a command. Settings come from the environment or a .env file.
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var err error
	switch cmd, args := os.Args[1], os.Args[2:]; cmd {
	case "serve":
		err = serve(ctx, args)
	case "get":
		err = get(ctx, args)
	case "likes":
		err = likes(ctx, args)
	case "doctor":
		err = doctor(ctx)
	case "version", "--version", "-v":
		fmt.Println("eco", version)
	case "help", "--help", "-h":
		fmt.Print(usage)
	default:
		fmt.Fprintf(os.Stderr, "eco: unknown command %q\n\n%s", cmd, usage)
		os.Exit(2)
	}
	if err != nil {
		if ctx.Err() != nil {
			fmt.Fprintln(os.Stderr, "\nInterrupted. Progress is saved; run the same command again to continue.")
			os.Exit(130)
		}
		fmt.Fprintln(os.Stderr, "eco:", err)
		os.Exit(1)
	}
}
