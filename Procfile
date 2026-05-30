backend: go run ./cmd/vantage serve --port ${DEV_BACKEND_PORT:-8200} ${TARGET_REPO:-.}
frontend: VITE_API_TARGET=http://localhost:${DEV_BACKEND_PORT:-8200} VITE_WS_TARGET=ws://localhost:${DEV_BACKEND_PORT:-8200} cd frontend && npm run dev -- --port ${DEV_FRONTEND_PORT:-8201}
