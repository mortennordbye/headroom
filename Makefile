.PHONY: build up down restart clean

# Build images and bring everything up (rebuilds if already running)
build:
	docker-compose up --build -d
	@echo ""
	@echo "  App: http://localhost:8080"
	@echo ""

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

# Remove build artifacts
clean:
	rm -rf dist
