import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export const INITIAL_BOOTSTRAP = Object.freeze({
  id: "news-ledger-bootstrap-20260817T212626Z",
  databaseSha256: "c8097ccfa821278bf56c115dc5574a4245394b66f4ccd302b7845c0087180d62",
  minimumArticles: 324,
  minimumVersions: 324,
  captures: Object.freeze([
    Object.freeze({
      sourceId: "guardian-uk",
      fetchedAt: "2026-08-17T21:26:26.053Z",
      payloadSha256: "2bce3d4df01cb3ef52427fe84c1c25ab0233783d5ed1fc618356673c91722802",
      itemCount: 136,
    }),
    Object.freeze({
      sourceId: "bbc-england",
      fetchedAt: "2026-08-17T21:26:26.350Z",
      payloadSha256: "58f87246b3dbc4939aae7328de84998a96d1b1733067a9c7ff317ef2993d75a2",
      itemCount: 28,
    }),
    Object.freeze({
      sourceId: "irish-times",
      fetchedAt: "2026-08-17T21:26:26.526Z",
      payloadSha256: "ee9e7fd520ee2b65ec6cab37160caf1e85330dfef662233ed788bba693a09b45",
      itemCount: 100,
    }),
    Object.freeze({
      sourceId: "rte-news",
      fetchedAt: "2026-08-17T21:26:26.750Z",
      payloadSha256: "7964ad2befc22edf88526008a0da9e4c3a2ad1af0a3b010645a13283aec7b227",
      itemCount: 60,
    }),
  ]),
});

function payloadHash(capture) {
  if (!capture.raw_payload) {
    throw new Error(`Bootstrap capture ${capture.id} has no stored payload`);
  }
  const payload = capture.payload_encoding === "gzip"
    ? gunzipSync(capture.raw_payload)
    : capture.raw_payload;
  return createHash("sha256").update(payload).digest("hex");
}

export function verifyLedgerBootstrap(database, manifest = INITIAL_BOOTSTRAP) {
  const integrity = database
    .prepare("PRAGMA integrity_check")
    .all()
    .map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== "ok") {
    throw new Error(`Ledger integrity check failed: ${integrity.join(", ")}`);
  }

  const counts = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM articles) AS articles,
      (SELECT COUNT(*) FROM article_versions) AS versions,
      (SELECT COUNT(*) FROM feed_captures) AS captures,
      (
        SELECT COUNT(*)
        FROM articles a
        LEFT JOIN article_versions v ON v.id = a.current_version_id
        WHERE v.id IS NULL
      ) AS broken_current_versions
  `).get();
  if (Number(counts.articles) < manifest.minimumArticles) {
    throw new Error(`Bootstrap requires at least ${manifest.minimumArticles} articles`);
  }
  if (Number(counts.versions) < manifest.minimumVersions) {
    throw new Error(`Bootstrap requires at least ${manifest.minimumVersions} versions`);
  }
  if (Number(counts.broken_current_versions) !== 0) {
    throw new Error("Bootstrap contains articles without a current version");
  }

  const findCapture = database.prepare(`
    SELECT id, source_id, fetched_at, payload_sha256, payload_encoding,
           raw_payload, item_count
    FROM feed_captures
    WHERE source_id = ? AND fetched_at = ? AND payload_sha256 = ?
    ORDER BY id
    LIMIT 1
  `);
  const verifiedCaptures = [];
  for (const expected of manifest.captures) {
    const capture = findCapture.get(
      expected.sourceId,
      expected.fetchedAt,
      expected.payloadSha256,
    );
    if (!capture) {
      throw new Error(`Missing bootstrap capture for ${expected.sourceId}`);
    }
    if (Number(capture.item_count) !== expected.itemCount) {
      throw new Error(`Bootstrap item count changed for ${expected.sourceId}`);
    }
    if (payloadHash(capture) !== expected.payloadSha256) {
      throw new Error(`Bootstrap payload hash mismatch for ${expected.sourceId}`);
    }
    verifiedCaptures.push({
      id: Number(capture.id),
      sourceId: expected.sourceId,
      fetchedAt: expected.fetchedAt,
      payloadSha256: expected.payloadSha256,
      itemCount: expected.itemCount,
    });
  }

  return {
    bootstrapId: manifest.id,
    integrity: "ok",
    articles: Number(counts.articles),
    versions: Number(counts.versions),
    captures: Number(counts.captures),
    verifiedCaptures,
  };
}