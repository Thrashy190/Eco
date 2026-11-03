# eco — common tasks. `make help` lists them.
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: help build run doctor tools test check fmt vet js docker up down clean

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

build: ## Build bin/eco (the web app is embedded in it)
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/eco ./cmd/eco

run: build ## Build and start the web app on http://127.0.0.1:8000
	./bin/eco serve

doctor: build ## Check that yt-dlp, ffmpeg, Navidrome and Spotify are set up
	./bin/eco doctor

tools: ## Download yt-dlp into bin/ (Linux x86_64; see README for other systems)
	mkdir -p bin
	curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o bin/yt-dlp
	chmod +x bin/yt-dlp

test: ## Run the Go tests
	go test ./...

fmt: ## Format the Go code
	gofmt -w cmd internal web

vet: ## Static checks
	go vet ./...

js: ## Syntax-check the web app's JavaScript
	@for f in web/static/js/*.js web/static/sw.js; do node --check $$f || exit 1; done

check: vet test js ## Everything CI runs
	@test -z "$$(gofmt -l cmd internal web)" || { echo "gofmt needed:"; gofmt -l cmd internal web; exit 1; }

docker: ## Build the Docker image
	docker build -t eco:local --build-arg VERSION=$(VERSION) .

up: ## Start the stack (docker compose up -d --build)
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

clean: ## Remove build output
	rm -rf bin/eco
