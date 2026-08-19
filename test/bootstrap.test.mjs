import assert from "node:assert/strict";
import test from "node:test";

import { verifyLedgerBootstrap } from "../src/bootstrap.mjs";
import { openLedger, recordFeedSnapshot } from "../src/database.mjs";

test("bootstrap verification proves capture payload integrity and record continuity", () => {
  const database = openLedger({ databasePath: ":memory:" });
  try {
    recordFeedSnapshot(database, {
      sourceId: "guardian-uk",
      fetchedAt: "2026-08-17T11:00:00.000Z",
      requestUrl: "https://www.theguardian.com/uk/rss",
      finalUrl: "https://www.theguardian.com/uk/rss",
      httpStatus: 200,
      responseHeaders: {},
      payload: "<rss>preserved evidence</rss>",
      parseStatus: "parsed",
      items: [{
        canonicalUrl: "https://www.theguardian.com/preserved",
        title: "Preserved record",
        descriptionText: "Source summary",
        publicExcerpt: "Source summary",
        contentText: "Private body",
        tags: [],
      }],
    });
    const capture = database.prepare(`
      SELECT source_id, fetched_at, payload_sha256, item_count
      FROM feed_captures WHERE id = 1
    `).get();
    const manifest = {
      id: "test-bootstrap",
      minimumArticles: 1,
      minimumVersions: 1,
      captures: [{
        sourceId: capture.source_id,
        fetchedAt: capture.fetched_at,
        payloadSha256: capture.payload_sha256,
        itemCount: Number(capture.item_count),
      }],
    };

    const verified = verifyLedgerBootstrap(database, manifest);
    assert.equal(verified.bootstrapId, "test-bootstrap");
    assert.equal(verified.integrity, "ok");
    assert.equal(verified.verifiedCaptures.length, 1);

    assert.throws(
      () => verifyLedgerBootstrap(database, {
        ...manifest,
        captures: [{ ...manifest.captures[0], payloadSha256: "0".repeat(64) }],
      }),
      /Missing bootstrap capture/,
    );
  } finally {
    database.close();
  }
});