.PHONY: build up down restart clean seed seed-reset seed-local logs backup mcp mcp-install mcp-uninstall

# Origin of the running app the MCP server reads/writes (override: make mcp-install HEADROOM_URL=...)
HEADROOM_URL ?= http://localhost:8080

# Build images and bring everything up (rebuilds if already running)
build:
	docker-compose up --build -d
	@echo ""
	@echo "  App: http://localhost:8080"
	@echo ""

# Seed the SQLite DB with realistic demo data (idempotent).
# Runs INSIDE a transient container so it writes to the same /data volume
# the running app reads from. Image must already be built (`make build`).
seed:
	@docker-compose run --rm --no-deps headroom node seed.js
	@docker-compose restart headroom 2>/dev/null || true
	@echo ""
	@echo "  Seeded. App: http://localhost:8080"
	@echo ""

# Wipe the DB inside the volume and re-seed from scratch. Copies the existing DB
# to a timestamped .bak inside the volume first, so a mis-run on real data is
# recoverable (docker cp it out with `make backup` or the shell).
seed-reset:
	@docker-compose run --rm --no-deps headroom sh -c 'if [ -f /data/database.sqlite ]; then cp /data/database.sqlite "/data/database.sqlite.bak-$$(date +%Y%m%d-%H%M%S)"; echo "  Backed up existing DB before reset."; fi && rm -f /data/database.sqlite && node seed.js'
	@docker-compose restart headroom 2>/dev/null || true
	@echo ""
	@echo "  Reset + seeded. App: http://localhost:8080"
	@echo ""

# Seed the local data/ dir for npm-run-dev workflow (not Docker).
seed-local:
	@node server/seed.js

# Start without rebuilding
up:
	docker-compose up -d
	@echo ""
	@echo "  App: http://localhost:8080"
	@echo ""

# Stop all containers
down:
	docker-compose down

# Restart without rebuilding
restart:
	docker-compose restart

# Back up the SQLite database out of the volume to ./backups/ (timestamped).
# The only automatic safety net besides the manual JSON export in the UI.
backup:
	@mkdir -p backups
	@docker cp headroom:/data/database.sqlite backups/headroom-$$(date +%Y%m%d-%H%M%S).sqlite
	@echo ""
	@echo "  Backed up to backups/headroom-$$(date +%Y%m%d-%H%M%S).sqlite"
	@echo ""

# Tail container logs
logs:
	docker-compose logs -f --tail=100

# Remove build artifacts
clean:
	rm -rf dist

# Run the MCP server in the foreground (for manual testing over stdio).
mcp:
	@HEADROOM_URL=$(HEADROOM_URL) npm run mcp

# Register the MCP server with Claude Code (local scope, this project only).
# Requires the `claude` CLI (Claude Code). Start the app first (`make up`).
# For Claude Desktop, add the JSON snippet in mcp/README.md instead.
mcp-install:
	@command -v claude >/dev/null 2>&1 || { \
	  echo "  'claude' CLI not found. Install Claude Code, or wire it up manually — see mcp/README.md."; \
	  exit 1; }
	@command -v npx >/dev/null 2>&1 || { echo "  npm/npx not found. Run 'npm install' first."; exit 1; }
	claude mcp add headroom --scope local --env HEADROOM_URL=$(HEADROOM_URL) -- npx tsx $(CURDIR)/mcp/server.ts
	@echo ""
	@echo "  Registered 'headroom' MCP server (HEADROOM_URL=$(HEADROOM_URL))."
	@echo "  Restart Claude Code, then ask it for a financial overview. Details: mcp/README.md"
	@echo ""

# Remove the MCP server registration.
mcp-uninstall:
	@claude mcp remove headroom --scope local 2>/dev/null || claude mcp remove headroom 2>/dev/null || true
	@echo "  Removed 'headroom' MCP server."
