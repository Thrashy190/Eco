# eco — common tasks. `make help` lists them.
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

WEB_SOURCES := $(shell find web/src web/public -type f 2>/dev/null) web/index.html web/vite.config.ts web/tsconfig.json web/package-lock.json

.PHONY: help web web-dev build run doctor tools test check fmt vet webcheck docker up down clean

help: ## Show this help
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

web/node_modules/.package-lock.json: web/package-lock.json
	cd web && npm ci

web/dist/index.html: web/node_modules/.package-lock.json $(WEB_SOURCES)
	cd web && npm run build

web: web/dist/index.html ## Build the web app (React + TypeScript) into web/dist

web-dev: web/node_modules/.package-lock.json ## Web app with hot reload on :5173, using the eco running on :8000
	cd web && npm run dev

build: web ## Build bin/eco (the web app is embedded in it)
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
	gofmt -w cmd internal web/embed.go

vet: ## Static checks
	go vet ./...

webcheck: web/node_modules/.package-lock.json ## Type-check, test and build the web app
	cd web && npm run typecheck && npm test && npm run build

check: vet test webcheck ## Everything CI runs
	@test -z "$$(gofmt -l cmd internal web/embed.go)" || { echo "gofmt needed:"; gofmt -l cmd internal web/embed.go; exit 1; }

docker: ## Build the Docker image
	docker build -t eco:local --build-arg VERSION=$(VERSION) .

up: ## Start the stack (docker compose up -d --build)
	docker compose up -d --build

down: ## Stop the stack
	docker compose down

clean: ## Remove build output
	rm -rf bin/eco
