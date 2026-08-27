import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getArticleDetail,
  latestCaptureForSource,
  ledgerCounts,
  listArticles,
  listSourceStats,
  openLedger,
  recordReceptionSnapshot,
  recordFeedSnapshot,
} from "../src/database.mjs";

function article(overrides = {}) {
  return {
    canonicalUrl: "https://example.test/news/accountability",
    externalId: "article-1",
    title: "A recorded title",
    byline: "Reporter One",
    descriptionText: "Publisher summary.",
    publicExcerpt: "Publisher summary.",
    contentText: "Private evidence body.",
    sourcePublishedAt: "2026-08-17T10:00:00.000Z",
    sourceUpdatedAt: null,
    section: "News",
    imageUrl: null,
    tags: ["Accountability"],
    classifications: [
      {
        origin: "machine",
        method: "rules-v1",
        label: "format",
        value: "news",
        confidence: 0.8,
      },
    ],
    ...overrides,
  };
}

function snapshot(item, overrides = {}) {
  return {
    sourceId: "guardian-uk",
    fetchedAt: "2026-08-17T11:00:00.000Z",
    requestUrl: "https://www.theguardian.com/uk/rss",
    finalUrl: "https://www.theguardian.com/uk/rss",
    httpStatus: 200,
    responseHeaders: { etag: '"one"' },
    payload: "<rss>private source capture</rss>",
    parseStatus: "parsed",
    items: [item],
    durationMs: 42,
    ...overrides,
  };
}

test("ledger stores immutable captures and creates only meaningful article versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "news-ledger-db-"));
  const database = openLedger({ databasePath: join(directory, "ledger.db") });

  try {
    const first = recordFeedSnapshot(database, snapshot(article()));
    assert.deepEqual(first, {
      captureId: 1,
      articlesCreated: 1,
      versionsCreated: 1,
      unchanged: 0,
    });

    const second = recordFeedSnapshot(
      database,
      snapshot(article(), { fetchedAt: "2026-08-17T12:00:00.000Z" }),
    );
    assert.equal(second.versionsCreated, 0);
    assert.equal(second.unchanged, 1);

    const third = recordFeedSnapshot(
      database,
      snapshot(article({ title: "A corrected title" }), {
        fetchedAt: "2026-08-17T13:00:00.000Z",
        payload: "<rss>revised private source capture</rss>",
      }),
    );
    assert.equal(third.versionsCreated, 1);

    assert.deepEqual(ledgerCounts(database), {
      sources: 4,
      articles: 1,
      versions: 2,
      captures: 3,
      reception_snapshots: 0,
    });

    const versions = database.prepare(`
      SELECT title, previous_version_id, changed_fields_json, content_text
      FROM article_versions ORDER BY id
    `).all();
    assert.equal(versions[0].title, "A recorded title");
    assert.equal(versions[1].title, "A corrected title");
    assert.equal(Number(versions[1].previous_version_id), 1);
    assert.deepEqual(JSON.parse(versions[1].changed_fields_json), ["title"]);
    assert.equal(versions[1].content_text, "Private evidence body.");

    assert.throws(
      () => database.prepare("UPDATE article_versions SET title = 'rewritten' WHERE id = 1").run(),
      /article versions are immutable/,
    );
    assert.throws(
      () => database.prepare("DELETE FROM feed_captures WHERE id = 1").run(),
      /feed captures are immutable/,
    );

    const latest = latestCaptureForSource(database, "guardian-uk");
    assert.equal(latest.id, 3);
    assert.equal(latest.parseStatus, "parsed");

    const filtered = listArticles(database, {
      country: "GB",
      sourceId: "guardian-uk",
      revisedOnly: true,
    });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.articles[0].title, "A corrected title");
    assert.equal(filtered.articles[0].revisionCount, 2);
    assert.equal("contentText" in filtered.articles[0], false);

    const reception = recordReceptionSnapshot(database, {
      articleId: 1,
      observedAt: "2026-08-17T14:00:00.000Z",
      platform: "publisher-comments",
      sourceUrl: "https://example.test/news/accountability#comments",
      commentCount: 12,
      sample: [],
      captureMethod: "manual-reviewed-v1",
      notes: "Count only; no commenter data retained.",
    });
    assert.match(reception.evidenceSha256, /^[a-f0-9]{64}$/);

    const detail = getArticleDetail(database, 1);
    assert.equal(detail.versions.length, 2);
    assert.equal(detail.reception[0].commentCount, 12);
    assert.equal("contentText" in detail.versions[0], false);
    assert.equal("rawPayload" in detail.versions[0].capture, false);
    assert.equal(listSourceStats(database).find(({ id }) => id === "guardian-uk").articleCount, 1);

    assert.throws(
      () => database.prepare("UPDATE reception_snapshots SET comment_count = 99 WHERE id = 1").run(),
      /reception snapshots are immutable/,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("source statistics aggregate articles and captures without a cross product", () => {
  const database = openLedger({ databasePath: ":memory:" });
  try {
    database.exec(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 1500
      )
      INSERT INTO articles(source_id, canonical_url, first_seen_at, last_seen_at)
      SELECT
        'guardian-uk',
        'https://example.test/article/' || value,
        '2026-08-27T00:00:00.000Z',
        '2026-08-27T00:00:00.000Z'
      FROM sequence;

      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 1500
      )
      INSERT INTO feed_captures(
        source_id, fetched_at, request_url, final_url, http_status,
        response_headers_json, payload_bytes, stored_bytes, parse_status,
        item_count, duration_ms, collector_version
      )
      SELECT
        'guardian-uk',
        printf('2026-08-27T00:%02d:00.000Z', value % 60),
        'https://www.theguardian.com/uk/rss',
        'https://www.theguardian.com/uk/rss',
        304,
        '{}',
        0,
        0,
        'not-modified',
        0,
        1,
        'test'
      FROM sequence;
    `);

    const startedAt = performance.now();
    const sources = listSourceStats(database);
    const elapsedMs = performance.now() - startedAt;
    const guardian = sources.find(({ id }) => id === "guardian-uk");

    assert.equal(guardian.articleCount, 1500);
    assert.equal(guardian.captureCount, 1500);
    assert.ok(elapsedMs < 1000, `source statistics took ${elapsedMs.toFixed(1)} ms`);
  } finally {
    database.close();
  }
});