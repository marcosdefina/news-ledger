import { performance } from "node:perf_hooks";

import { latestCaptureForSource, recordFeedSnapshot } from "./database.mjs";
import { parseFeed } from "./feed.mjs";
import { SOURCES } from "./sources.mjs";

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

function responseHeaders(response) {
  return Object.fromEntries(response.headers.entries());
}

async function boundedBody(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
  if (declaredLength > maxBytes) {
    throw new Error(`Feed exceeds ${maxBytes} byte limit`);
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("feed byte limit exceeded");
      throw new Error(`Feed exceeds ${maxBytes} byte limit`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

async function fetchSameHost(url, options, fetchImpl, redirectCount = 0) {
  const response = await fetchImpl(url, { ...options, redirect: "manual" });
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    return response;
  }
  if (redirectCount >= MAX_REDIRECTS) {
    throw new Error("Feed redirect limit exceeded");
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Feed redirect omitted Location header");
  }
  const current = new URL(url);
  const next = new URL(location, current);
  if (next.protocol !== "https:" || next.hostname !== current.hostname) {
    throw new Error(`Feed redirected outside its approved HTTPS host: ${next.href}`);
  }
  return fetchSameHost(next, options, fetchImpl, redirectCount + 1);
}

export async function collectSource(database, source, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const startedAt = performance.now();
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const previous = latestCaptureForSource(database, source.id);
  const headers = {
    accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9",
    "user-agent": "NewsLedger/0.1 (+https://staging.news.stillwaters.cz/about)",
  };
  const etag = previous?.responseHeaders.etag;
  const lastModified = previous?.responseHeaders["last-modified"];
  if (etag) {
    headers["if-none-match"] = etag;
  }
  if (lastModified) {
    headers["if-modified-since"] = lastModified;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let payload = "";
  try {
    response = await fetchSameHost(
      source.feedUrl,
      { headers, signal: controller.signal },
      fetchImpl,
    );
    if (response.status !== 304) {
      payload = await boundedBody(response, maxBytes);
    }
  } finally {
    clearTimeout(timeout);
  }

  const baseSnapshot = {
    sourceId: source.id,
    fetchedAt,
    requestUrl: source.feedUrl,
    finalUrl: response.url || source.feedUrl,
    httpStatus: response.status,
    responseHeaders: responseHeaders(response),
    payload,
    durationMs: Math.round(performance.now() - startedAt),
    collectorVersion: "news-ledger/0.1",
  };

  if (response.status === 304) {
    return recordFeedSnapshot(database, {
      ...baseSnapshot,
      parseStatus: "not-modified",
      items: [],
    });
  }

  if (!response.ok) {
    const result = recordFeedSnapshot(database, {
      ...baseSnapshot,
      parseStatus: "failed",
      parseError: `HTTP ${response.status}`,
      items: [],
    });
    throw Object.assign(new Error(`${source.name} returned HTTP ${response.status}`), { result });
  }

  try {
    const items = parseFeed(payload);
    return recordFeedSnapshot(database, {
      ...baseSnapshot,
      parseStatus: "parsed",
      items,
    });
  } catch (error) {
    const result = recordFeedSnapshot(database, {
      ...baseSnapshot,
      parseStatus: "failed",
      parseError: String(error.message ?? error).slice(0, 2_000),
      items: [],
    });
    throw Object.assign(new Error(`${source.name} feed parse failed: ${error.message}`), { result });
  }
}

export async function collectAll(database, options = {}) {
  const results = [];
  for (const source of SOURCES.filter(({ active }) => active)) {
    try {
      results.push({ sourceId: source.id, ok: true, result: await collectSource(database, source, options) });
    } catch (error) {
      results.push({ sourceId: source.id, ok: false, error: error.message, result: error.result ?? null });
    }
  }
  return results;
}