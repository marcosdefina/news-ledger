import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  getArticleDetail,
  ledgerCounts,
  listArticles,
  listSourceStats,
  openLedger,
} from "./database.mjs";
import {
  renderArticle,
  renderIndex,
  renderMethodology,
  renderNotFound,
  renderSources,
} from "./views.mjs";

const ASSETS = Object.freeze({
  "/assets/styles.css": {
    file: new URL("./public/styles.css", import.meta.url),
    type: "text/css; charset=utf-8",
  },
  "/assets/app.js": {
    file: new URL("./public/app.js", import.meta.url),
    type: "text/javascript; charset=utf-8",
  },
});

function setSecurityHeaders(response) {
  response.setHeader(
    "content-security-policy",
    "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
  );
  response.setHeader("cross-origin-opener-policy", "same-origin");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function send(response, status, body, contentType = "text/html; charset=utf-8", method = "GET") {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.setHeader("content-length", String(payload.byteLength));
  response.end(method === "HEAD" ? undefined : payload);
}

function sendJson(response, status, value, method = "GET") {
  response.setHeader("cache-control", "no-store");
  send(response, status, `${JSON.stringify(value)}\n`, "application/json; charset=utf-8", method);
}

async function sendAsset(response, asset, method) {
  const payload = await readFile(asset.file);
  response.setHeader("cache-control", "public, max-age=3600");
  send(response, 200, payload, asset.type, method);
}

export function createApp(options = {}) {
  const ownsDatabase = !options.database;
  const database = options.database ?? openLedger({ databasePath: ":memory:" });
  const server = createServer(async (request, response) => {
    setSecurityHeaders(response);
    const method = request.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      response.setHeader("allow", "GET, HEAD");
      send(response, 405, "Method Not Allowed\n", "text/plain; charset=utf-8", method);
      return;
    }

    try {
      const url = new URL(request.url ?? "/", "http://news-ledger.local");
      if (ASSETS[url.pathname]) {
        await sendAsset(response, ASSETS[url.pathname], method);
        return;
      }
      if (url.pathname === "/health") {
        sendJson(response, 200, {
          status: "ok",
          service: "news-ledger",
          dataSource: "production",
          counts: ledgerCounts(database),
        }, method);
        return;
      }
      if (url.pathname === "/") {
        const result = listArticles(database, {
          query: url.searchParams.get("q"),
          country: url.searchParams.get("country"),
          sourceId: url.searchParams.get("source"),
          signal: url.searchParams.get("signal"),
          revisedOnly: url.searchParams.get("revised") === "1",
          page: url.searchParams.get("page"),
        });
        send(response, 200, renderIndex({
          result,
          counts: ledgerCounts(database),
          sourceStats: listSourceStats(database),
        }), undefined, method);
        return;
      }
      if (url.pathname === "/sources") {
        send(response, 200, renderSources(listSourceStats(database)), undefined, method);
        return;
      }
      if (url.pathname === "/methodology") {
        send(response, 200, renderMethodology(), undefined, method);
        return;
      }
      const match = url.pathname.match(/^\/article\/(\d+)$/);
      if (match) {
        const article = getArticleDetail(database, Number.parseInt(match[1], 10));
        send(response, article ? 200 : 404, article ? renderArticle(article) : renderNotFound(), undefined, method);
        return;
      }
      send(response, 404, renderNotFound(), undefined, method);
    } catch (error) {
      console.error("request_failed", error);
      sendJson(response, 500, { status: "error", service: "news-ledger" }, method);
    }
  });
  if (ownsDatabase) {
    server.once("close", () => database.close());
  }
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number.parseInt(process.env.PORT ?? "8080", 10);
  const databasePath = process.env.LEDGER_DB_PATH ?? "./data/news-ledger.db";
  const readOnly = process.env.LEDGER_READ_ONLY === "true";
  const database = openLedger({ databasePath, readOnly, initialize: !readOnly });
  const server = createApp({ database });
  const close = () => server.close(() => database.close());
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  server.listen(port, "0.0.0.0", () => {
    console.log(`news-ledger listening on ${port} (${readOnly ? "read-only" : "read-write"} ledger)`);
  });
}
