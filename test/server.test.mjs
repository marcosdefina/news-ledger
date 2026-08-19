import assert from "node:assert/strict";
import test from "node:test";

import { openLedger, recordFeedSnapshot } from "../src/database.mjs";
import { createApp } from "../src/server.mjs";

function seed(database) {
  recordFeedSnapshot(database, {
    sourceId: "guardian-uk",
    fetchedAt: "2026-08-17T11:00:00.000Z",
    requestUrl: "https://www.theguardian.com/uk/rss",
    finalUrl: "https://www.theguardian.com/uk/rss",
    httpStatus: 200,
    responseHeaders: { etag: '"one"' },
    payload: "<rss>PRIVATE CAPTURE BODY</rss>",
    parseStatus: "parsed",
    items: [{
      canonicalUrl: "https://www.theguardian.com/test-record",
      externalId: "record-1",
      title: "A public evidence record",
      byline: "Jane Reporter",
      descriptionText: "Public source description.",
      publicExcerpt: "Public source description.",
      contentText: "PRIVATE ARTICLE BODY",
      sourcePublishedAt: "2026-08-17T10:00:00.000Z",
      sourceUpdatedAt: null,
      section: "News",
      imageUrl: "https://images.example.test/record.jpg",
      tags: ["News"],
      classifications: [{
        origin: "machine",
        method: "rules-v1",
        label: "content-type",
        value: "reported-news",
        confidence: 0.7,
      }],
    }],
    durationMs: 10,
  });
}

async function withServer(context) {
  const database = openLedger({ databasePath: ":memory:" });
  seed(database);
  const server = createApp({ database });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(() => {
    database.close();
    resolve();
  })));
  return `http://127.0.0.1:${server.address().port}`;
}

test("health endpoint identifies production-backed ledger state", async (context) => {
  const origin = await withServer(context);
  const response = await fetch(`${origin}/health`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "news-ledger");
  assert.equal(body.dataSource, "production");
  assert.equal(body.counts.articles, 1);
});

test("public ledger and detail never render private captured content", async (context) => {
  const origin = await withServer(context);
  const indexResponse = await fetch(`${origin}/?country=GB`);
  const index = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.match(index, /A public evidence record/);
  assert.match(index, /Public source description/);
  assert.doesNotMatch(index, /PRIVATE ARTICLE BODY|PRIVATE CAPTURE BODY/);

  const detailResponse = await fetch(`${origin}/article/1`);
  const detail = await detailResponse.text();
  assert.equal(detailResponse.status, 200);
  assert.match(detail, /Observed version timeline/);
  assert.match(detail, /Not an adjudication/);
  assert.match(detail, /Capture SHA-256/);
  assert.doesNotMatch(detail, /PRIVATE ARTICLE BODY|PRIVATE CAPTURE BODY/);
});

test("assets and missing records have explicit response contracts", async (context) => {
  const origin = await withServer(context);
  const css = await fetch(`${origin}/assets/styles.css`);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /^text\/css/);
  assert.match(css.headers.get("content-security-policy"), /default-src 'self'/);

  const missing = await fetch(`${origin}/article/999`);
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Record not found/);
});
