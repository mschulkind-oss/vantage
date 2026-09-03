# The backend runs under air, so a Go edit rebuilds and restarts it — the watch
# rules are in .air.toml. -build.entrypoint is repeated once per argument
# because air quotes each value as a single path: one string with spaces in it
# is looked up as a filename and fails with "No such file or directory". The
# -build.full_bin form does take one string, and warns that it is deprecated on
# every startup.
backend: air -build.entrypoint ./tmp/vantage-dev -build.entrypoint serve -build.entrypoint --port -build.entrypoint ${DEV_BACKEND_PORT:-8200} -build.entrypoint ${TARGET_REPO:-.}
frontend: VITE_API_TARGET=http://localhost:${DEV_BACKEND_PORT:-8200} VITE_WS_TARGET=ws://localhost:${DEV_BACKEND_PORT:-8200} cd frontend && npm run dev -- --port ${DEV_FRONTEND_PORT:-8201}
