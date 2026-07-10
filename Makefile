.PHONY: build up down restart clean seed seed-reset seed-local logs backup

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
