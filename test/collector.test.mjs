import assert from "node:assert/strict";
import test from "node:test";

import { collectSource } from "../src/collector.mjs";
import { ledgerCounts, openLedger } from "../src/database.mjs";
import { sourceById } from "../src/sources.mjs";

const xml = `<rss><channel><item><title>Recorded</title><link>https://www.theguardian.com/test</link><description>Summary</description></item></channel></rss>`;

test("collector records a bounded feed and reuses conditional validators", async () => {
  const database = openLedger({ databasePath: ":memory:" });
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), headers: options.headers });
    if (requests.length === 1) {
      return new Response(xml, {
        status: 200,
        headers: { "content-type": "application/rss+xml", etag: '"capture-one"' },
      });
    }
    return new Response(null, { status: 304, headers: { etag: '"capture-one"' } });
  };

  try {
    const source = sourceById("guardian-uk");
    await collectSource(database, source, {
      fetchImpl,
      now: () => new Date("2026-08-17T10:00:00.000Z"),
    });
    await collectSource(database, source, {
      fetchImpl,
      now: () => new Date("2026-08-17T10:15:00.000Z"),
    });

    assert.equal(requests[1].headers["if-none-match"], '"capture-one"');
    assert.deepEqual(ledgerCounts(database), {
      sources: 4,
      articles: 1,
      versions: 1,
      captures: 2,
      reception_snapshots: 0,
    });
  } finally {
    database.close();
  }
});

test("collector rejects cross-host redirects before parsing", async () => {
  const database = openLedger({ databasePath: ":memory:" });
  try {
    await assert.rejects(
      collectSource(database, sourceById("guardian-uk"), {
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location: "https://unapproved.example/feed" },
        }),
      }),
      /outside its approved HTTPS host/,
    );
  } finally {
    database.close();
  }
});