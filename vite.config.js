import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
const require = createRequire(import.meta.url);
const sdkRoot = resolve(dirname(require.resolve("privacycash-evm")), "..");
const polyfills = () =>
  nodePolyfills({
    include: ["buffer", "crypto", "stream", "events", "util", "process"],
    globals: { Buffer: true, global: true, process: true },
  });
export default defineConfig(({ mode }) => ({
  optimizeDeps: { include: ["privacycash-evm"] },
  worker: { format: "es", plugins: () => [polyfills()] },
  plugins: [
    react(),
    polyfills(),
    {
      name: "local-api",
      generateBundle() {
        for (const ext of ["wasm", "zkey"])
          this.emitFile({
            type: "asset",
            fileName: `circuits/transaction2.${ext}`,
            source: readFileSync(
              resolve(sdkRoot, `circuits/transaction2.${ext}`),
            ),
          });
      },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = new URL(req.url, "http://localhost").pathname;
          if (/^\/circuits\/transaction2\.(wasm|zkey)$/.test(path)) {
            res.setHeader(
              "Content-Type",
              path.endsWith("wasm")
                ? "application/wasm"
                : "application/octet-stream",
            );
            res.end(readFileSync(resolve(sdkRoot, path.slice(1))));
            return;
          }
          const name = new URL(req.url, "http://localhost").pathname.match(
            /^\/api\/(privacy|terminal)$/,
          )?.[1];
          if (!name) return next();
          try {
            const mod = await import(`./api/${name}.js`);
            await mod.default(req, res);
          } catch {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(
              JSON.stringify({
                error: "The service could not complete this request",
              }),
            );
          }
        });
      },
    },
  ],
  build: { chunkSizeWarningLimit: 800 },
}));
