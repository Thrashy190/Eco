package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net/http"
	"time"

	"github.com/Thrashy190/eco/internal/config"
	"github.com/Thrashy190/eco/internal/engine"
	"github.com/Thrashy190/eco/internal/server"
	"github.com/Thrashy190/eco/web"
)

func serve(ctx context.Context, args []string) error {
	cfg := config.Load()
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	fs.StringVar(&cfg.Listen, "listen", cfg.Listen, "address to listen on")
	fs.Parse(args)

	srv, err := server.New(ctx, cfg, engine.New(cfg), web.Static())
	if err != nil {
		return err
	}
	httpSrv := &http.Server{Addr: cfg.Listen, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		httpSrv.Shutdown(shutdown)
	}()
	log.Printf("eco %s on http://%s (Navidrome at %s)", version, cfg.Listen, cfg.NavidromeURL)
	if err := httpSrv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
