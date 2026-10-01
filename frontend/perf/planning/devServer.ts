/**
 * The Vite dev server for D4, as a process of its own: `node devServer.ts
 * <port> <cacheDir>`. The repository's own `vite.config.ts`, with the API
 * proxied where `VITE_API_TARGET` and `VITE_WS_TARGET` say, and a dependency
 * cache of its own, so it never re-optimizes the one a developer's dev server
 * is using (`servers.ts` starts it).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const [port, cacheDir] = process.argv.slice(2);

const server = await createServer({
  root: frontend,
  configFile: path.join(frontend, "vite.config.ts"),
  cacheDir,
  clearScreen: false,
  server: { host: "127.0.0.1", port: Number(port), strictPort: true },
});
await server.listen();
console.log(`vite dev server on ${port}`);

const close = () => {
  void server.close().then(() => process.exit(0));
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
