import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gzipSync } from "node:zlib";

import { SOURCES } from "./sources.mjs";

const SCHEMA_VERSION = 1;
const VERSION_FIELDS = Object.freeze([
  "title",
  "byline",
  "descriptionText",
  "contentText",
  "sourcePublishedAt",
  "sourceUpdatedAt",
  "section",
  "imageUrl",
  "tags",
]);

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function computeVersionHash(item) {
  const canonical = Object.fromEntries(
    VERSION_FIELDS.map((field) => [field, item[field] ?? null]),
  );
  return sha256(JSON.stringify(canonical));
}

export function openLedger({ databasePath, readOnly = false, initialize = true }) {
  if (!databasePath) {
    throw new Error("databasePath is required");
  }
  if (databasePath !== ":memory:" && !readOnly) {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const database = new DatabaseSync(databasePath, { readOnly });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (!readOnly && initialize) {
    database.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;");
    initializeLedger(database);
  }
  return database;
}

export function initializeLedger(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS ledger_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country_code TEXT NOT NULL,
      country_name TEXT NOT NULL,
      kind TEXT NOT NULL,
      homepage_url TEXT NOT NULL,
      feed_url TEXT NOT NULL,
      terms_url TEXT NOT NULL,
      capture_policy TEXT NOT NULL,
      public_content_policy TEXT NOT NULL,
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      notes TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS feed_captures (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      fetched_at TEXT NOT NULL,
      request_url TEXT NOT NULL,
      final_url TEXT NOT NULL,
      http_status INTEGER NOT NULL,
      response_headers_json TEXT NOT NULL,
      payload_sha256 TEXT,
      payload_bytes INTEGER NOT NULL,
      stored_bytes INTEGER NOT NULL,
      payload_encoding TEXT,
      raw_payload BLOB,
      parse_status TEXT NOT NULL CHECK (parse_status IN ('parsed', 'not-modified', 'failed')),
      parse_error TEXT,
      item_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      collector_version TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS feed_captures_source_time_idx
      ON feed_captures(source_id, fetched_at DESC);

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES sources(id),
      canonical_url TEXT NOT NULL,
      external_id TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      current_version_id INTEGER,
      UNIQUE(source_id, canonical_url),
      FOREIGN KEY(current_version_id) REFERENCES article_versions(id)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS articles_source_seen_idx
      ON articles(source_id, last_seen_at DESC);

    CREATE TABLE IF NOT EXISTS article_versions (
      id INTEGER PRIMARY KEY,
      article_id INTEGER NOT NULL REFERENCES articles(id),
      capture_id INTEGER NOT NULL REFERENCES feed_captures(id),
      previous_version_id INTEGER REFERENCES article_versions(id),
      observed_at TEXT NOT NULL,
      source_published_at TEXT,
      source_updated_at TEXT,
      title TEXT NOT NULL,
      byline TEXT,
      description_text TEXT NOT NULL,
      public_excerpt TEXT NOT NULL,
      content_text TEXT NOT NULL,
      section TEXT,
      image_url TEXT,
      tags_json TEXT NOT NULL,
      version_sha256 TEXT NOT NULL,
      changed_fields_json TEXT NOT NULL,
      change_kind TEXT NOT NULL CHECK (change_kind IN ('initial', 'revision')),
      UNIQUE(article_id, version_sha256)
    ) STRICT;

    CREATE INDEX IF NOT EXISTS article_versions_article_time_idx
      ON article_versions(article_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS article_versions_published_idx
      ON article_versions(source_published_at DESC);

    CREATE TABLE IF NOT EXISTS classifications (
      id INTEGER PRIMARY KEY,
      article_version_id INTEGER NOT NULL REFERENCES article_versions(id),
      origin TEXT NOT NULL CHECK (origin IN ('publisher', 'machine', 'human')),
      method TEXT NOT NULL,
      label TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL,
      created_at TEXT NOT NULL,
      UNIQUE(article_version_id, origin, method, label, value)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS reception_snapshots (
      id INTEGER PRIMARY KEY,
      article_id INTEGER NOT NULL REFERENCES articles(id),
      observed_at TEXT NOT NULL,
      platform TEXT NOT NULL,
      source_url TEXT NOT NULL,
      comment_count INTEGER,
      reaction_count INTEGER,
      share_count INTEGER,
      sample_json TEXT NOT NULL,
      evidence_sha256 TEXT NOT NULL,
      capture_method TEXT NOT NULL,
      notes TEXT NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS reception_article_time_idx
      ON reception_snapshots(article_id, observed_at DESC);

    CREATE TRIGGER IF NOT EXISTS feed_captures_no_update
      BEFORE UPDATE ON feed_captures BEGIN
        SELECT RAISE(ABORT, 'feed captures are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS feed_captures_no_delete
      BEFORE DELETE ON feed_captures BEGIN
        SELECT RAISE(ABORT, 'feed captures are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS article_versions_no_update
      BEFORE UPDATE ON article_versions BEGIN
        SELECT RAISE(ABORT, 'article versions are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS article_versions_no_delete
      BEFORE DELETE ON article_versions BEGIN
        SELECT RAISE(ABORT, 'article versions are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS classifications_no_update
      BEFORE UPDATE ON classifications BEGIN
        SELECT RAISE(ABORT, 'classifications are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS classifications_no_delete
      BEFORE DELETE ON classifications BEGIN
        SELECT RAISE(ABORT, 'classifications are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS reception_snapshots_no_update
      BEFORE UPDATE ON reception_snapshots BEGIN
        SELECT RAISE(ABORT, 'reception snapshots are immutable');
      END;
    CREATE TRIGGER IF NOT EXISTS reception_snapshots_no_delete
      BEFORE DELETE ON reception_snapshots BEGIN
        SELECT RAISE(ABORT, 'reception snapshots are immutable');
      END;
  `);

  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO ledger_meta(key, value) VALUES ('schema_version', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SCHEMA_VERSION));

  const upsertSource = database.prepare(`
    INSERT INTO sources(
      id, name, country_code, country_name, kind, homepage_url, feed_url,
      terms_url, capture_policy, public_content_policy, active, notes,
      registered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      country_code = excluded.country_code,
      country_name = excluded.country_name,
      kind = excluded.kind,
      homepage_url = excluded.homepage_url,
      feed_url = excluded.feed_url,
      terms_url = excluded.terms_url,
      capture_policy = excluded.capture_policy,
      public_content_policy = excluded.public_content_policy,
      active = excluded.active,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `);

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const source of SOURCES) {
      upsertSource.run(
        source.id,
        source.name,
        source.countryCode,
        source.countryName,
        source.kind,
        source.homepageUrl,
        source.feedUrl,
        source.termsUrl,
        source.capturePolicy,
        source.publicContentPolicy,
        source.active ? 1 : 0,
        source.notes,
        now,
        now,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function changedFields(previous, next) {
  if (!previous) {
    return VERSION_FIELDS;
  }
  return VERSION_FIELDS.filter((field) => {
    const previousValue = field === "tags" ? parseJson(previous.tags_json, []) : previous[field];
    const nextValue = next[field] ?? (field === "tags" ? [] : null);
    return JSON.stringify(previousValue ?? null) !== JSON.stringify(nextValue ?? null);
  });
}

function insertClassifications(database, versionId, classifications, createdAt) {
  const insert = database.prepare(`
    INSERT OR IGNORE INTO classifications(
      article_version_id, origin, method, label, value, confidence, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const classification of classifications ?? []) {
    insert.run(
      versionId,
      classification.origin,
      classification.method,
      classification.label,
      classification.value,
      classification.confidence ?? null,
      createdAt,
    );
  }
}

export function recordFeedSnapshot(database, snapshot) {
  const payloadBuffer = snapshot.payload ? Buffer.from(snapshot.payload, "utf8") : Buffer.alloc(0);
  const storedPayload = payloadBuffer.length > 0 ? gzipSync(payloadBuffer, { level: 9 }) : null;
  const payloadHash = payloadBuffer.length > 0 ? sha256(payloadBuffer) : null;
  const items = snapshot.items ?? [];
  const parseStatus = snapshot.parseStatus ?? (snapshot.httpStatus === 304 ? "not-modified" : "parsed");
  const result = {
    captureId: null,
    articlesCreated: 0,
    versionsCreated: 0,
    unchanged: 0,
  };

  database.exec("BEGIN IMMEDIATE");
  try {
    const capture = database.prepare(`
      INSERT INTO feed_captures(
        source_id, fetched_at, request_url, final_url, http_status,
        response_headers_json, payload_sha256, payload_bytes, stored_bytes,
        payload_encoding, raw_payload, parse_status, parse_error, item_count,
        duration_ms, collector_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      snapshot.sourceId,
      snapshot.fetchedAt,
      snapshot.requestUrl,
      snapshot.finalUrl,
      snapshot.httpStatus,
      json(snapshot.responseHeaders ?? {}),
      payloadHash,
      payloadBuffer.length,
      storedPayload?.length ?? 0,
      storedPayload ? "gzip" : null,
      storedPayload,
      parseStatus,
      snapshot.parseError ?? null,
      items.length,
      snapshot.durationMs ?? 0,
      snapshot.collectorVersion ?? "news-ledger/0.1",
    );
    result.captureId = Number(capture.lastInsertRowid);

    if (parseStatus !== "parsed") {
      database.exec("COMMIT");
      return result;
    }

    const findArticle = database.prepare(`
      SELECT id, current_version_id FROM articles
      WHERE source_id = ? AND canonical_url = ?
    `);
    const insertArticle = database.prepare(`
      INSERT INTO articles(
        source_id, canonical_url, external_id, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    const updateSeen = database.prepare(`
      UPDATE articles SET last_seen_at = ?, external_id = COALESCE(?, external_id)
      WHERE id = ?
    `);
    const updateCurrent = database.prepare(`
      UPDATE articles SET current_version_id = ?, last_seen_at = ? WHERE id = ?
    `);
    const getVersion = database.prepare(`
      SELECT
        id, version_sha256, title, byline, description_text AS descriptionText,
        content_text AS contentText, source_published_at AS sourcePublishedAt,
        source_updated_at AS sourceUpdatedAt, section, image_url AS imageUrl,
        tags_json
      FROM article_versions WHERE id = ?
    `);
    const insertVersion = database.prepare(`
      INSERT INTO article_versions(
        article_id, capture_id, previous_version_id, observed_at,
        source_published_at, source_updated_at, title, byline,
        description_text, public_excerpt, content_text, section, image_url,
        tags_json, version_sha256, changed_fields_json, change_kind
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of items) {
      let article = findArticle.get(snapshot.sourceId, item.canonicalUrl);
      let articleId;
      if (!article) {
        const inserted = insertArticle.run(
          snapshot.sourceId,
          item.canonicalUrl,
          item.externalId ?? null,
          snapshot.fetchedAt,
          snapshot.fetchedAt,
        );
        articleId = Number(inserted.lastInsertRowid);
        article = { id: articleId, current_version_id: null };
        result.articlesCreated += 1;
      } else {
        articleId = Number(article.id);
      }

      const previous = article.current_version_id
        ? getVersion.get(article.current_version_id)
        : null;
      const versionHash = computeVersionHash(item);
      if (previous?.version_sha256 === versionHash) {
        updateSeen.run(snapshot.fetchedAt, item.externalId ?? null, articleId);
        result.unchanged += 1;
        continue;
      }

      const fields = changedFields(previous, item);
      const insertedVersion = insertVersion.run(
        articleId,
        result.captureId,
        previous?.id ?? null,
        snapshot.fetchedAt,
        item.sourcePublishedAt ?? null,
        item.sourceUpdatedAt ?? null,
        item.title,
        item.byline ?? null,
        item.descriptionText ?? "",
        item.publicExcerpt ?? "",
        item.contentText ?? "",
        item.section ?? null,
        item.imageUrl ?? null,
        json(item.tags ?? []),
        versionHash,
        json(fields),
        previous ? "revision" : "initial",
      );
      const versionId = Number(insertedVersion.lastInsertRowid);
      insertClassifications(database, versionId, item.classifications, snapshot.fetchedAt);
      updateCurrent.run(versionId, snapshot.fetchedAt, articleId);
      result.versionsCreated += 1;
    }

    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function ledgerCounts(database) {
  const row = database.prepare(`
    SELECT
      (SELECT COUNT(*) FROM sources WHERE active = 1) AS sources,
      (SELECT COUNT(*) FROM articles) AS articles,
      (SELECT COUNT(*) FROM article_versions) AS versions,
      (SELECT COUNT(*) FROM feed_captures) AS captures,
      (SELECT COUNT(*) FROM reception_snapshots) AS reception_snapshots
  `).get();
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

export function latestCaptureForSource(database, sourceId) {
  const row = database.prepare(`
    SELECT id, fetched_at, http_status, response_headers_json, payload_sha256, parse_status
    FROM feed_captures WHERE source_id = ? ORDER BY id DESC LIMIT 1
  `).get(sourceId);
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    fetchedAt: row.fetched_at,
    httpStatus: row.http_status,
    responseHeaders: parseJson(row.response_headers_json, {}),
    payloadSha256: row.payload_sha256,
    parseStatus: row.parse_status,
  };
}

function mapArticleRow(row) {
  return {
    id: Number(row.id),
    sourceId: row.source_id,
    sourceName: row.source_name,
    countryCode: row.country_code,
    countryName: row.country_name,
    canonicalUrl: row.canonical_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    title: row.title,
    byline: row.byline,
    publicExcerpt: row.public_excerpt,
    sourcePublishedAt: row.source_published_at,
    sourceUpdatedAt: row.source_updated_at,
    section: row.section,
    imageUrl: row.image_url,
    versionSha256: row.version_sha256,
    revisionCount: Number(row.revision_count),
    classifications: parseJson(row.classifications_json, []),
  };
}

export function listArticles(database, options = {}) {
  const query = String(options.query ?? "").trim().slice(0, 160);
  const country = ["GB", "IE"].includes(options.country) ? options.country : "";
  const sourceId = SOURCES.some(({ id }) => id === options.sourceId) ? options.sourceId : "";
  const signal = String(options.signal ?? "").trim().slice(0, 80);
  const revisedOnly = options.revisedOnly === true;
  const page = Math.max(1, Number.parseInt(options.page ?? "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(10, Number.parseInt(options.pageSize ?? "25", 10) || 25));
  const conditions = [];
  const parameters = [];

  if (query) {
    conditions.push("(LOWER(v.title) LIKE ? OR LOWER(COALESCE(v.byline, '')) LIKE ? OR LOWER(v.public_excerpt) LIKE ? OR LOWER(s.name) LIKE ?)");
    const pattern = `%${query.toLowerCase()}%`;
    parameters.push(pattern, pattern, pattern, pattern);
  }
  if (country) {
    conditions.push("s.country_code = ?");
    parameters.push(country);
  }
  if (sourceId) {
    conditions.push("s.id = ?");
    parameters.push(sourceId);
  }
  if (signal) {
    conditions.push("EXISTS (SELECT 1 FROM classifications filtered WHERE filtered.article_version_id = v.id AND filtered.value = ?)");
    parameters.push(signal);
  }
  if (revisedOnly) {
    conditions.push("(SELECT COUNT(*) FROM article_versions history WHERE history.article_id = a.id) > 1");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const from = `
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    JOIN article_versions v ON v.id = a.current_version_id
    ${where}
  `;
  const total = Number(database.prepare(`SELECT COUNT(*) AS count ${from}`).get(...parameters).count);
  const offset = (page - 1) * pageSize;
  const rows = database.prepare(`
    SELECT
      a.id, a.source_id, s.name AS source_name, s.country_code, s.country_name,
      a.canonical_url, a.first_seen_at, a.last_seen_at, v.title, v.byline,
      v.public_excerpt, v.source_published_at, v.source_updated_at, v.section,
      v.image_url, v.version_sha256,
      (SELECT COUNT(*) FROM article_versions history WHERE history.article_id = a.id) AS revision_count,
      COALESCE((
        SELECT json_group_array(json_object(
          'origin', c.origin,
          'method', c.method,
          'label', c.label,
          'value', c.value,
          'confidence', c.confidence
        ))
        FROM classifications c WHERE c.article_version_id = v.id
      ), '[]') AS classifications_json
    ${from}
    ORDER BY COALESCE(v.source_published_at, v.observed_at) DESC, a.id DESC
    LIMIT ? OFFSET ?
  `).all(...parameters, pageSize, offset);

  return {
    articles: rows.map(mapArticleRow),
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    filters: { query, country, sourceId, signal, revisedOnly },
  };
}

export function listSourceStats(database) {
  return database.prepare(`
    WITH article_counts AS (
      SELECT source_id, COUNT(*) AS article_count
      FROM articles
      GROUP BY source_id
    ), capture_stats AS (
      SELECT
        source_id,
        COUNT(*) AS capture_count,
        MAX(fetched_at) AS last_capture_at,
        MAX(CASE WHEN parse_status = 'parsed' THEN fetched_at END) AS last_success_at
      FROM feed_captures
      GROUP BY source_id
    )
    SELECT
      s.id, s.name, s.country_code, s.country_name, s.kind, s.homepage_url,
      s.feed_url, s.terms_url, s.capture_policy, s.public_content_policy,
      s.notes, s.active,
      COALESCE(a.article_count, 0) AS article_count,
      COALESCE(f.capture_count, 0) AS capture_count,
      f.last_capture_at,
      f.last_success_at
    FROM sources s
    LEFT JOIN article_counts a ON a.source_id = s.id
    LEFT JOIN capture_stats f ON f.source_id = s.id
    ORDER BY s.country_code, s.name
  `).all().map((row) => ({
    id: row.id,
    name: row.name,
    countryCode: row.country_code,
    countryName: row.country_name,
    kind: row.kind,
    homepageUrl: row.homepage_url,
    feedUrl: row.feed_url,
    termsUrl: row.terms_url,
    capturePolicy: row.capture_policy,
    publicContentPolicy: row.public_content_policy,
    notes: row.notes,
    active: row.active === 1,
    articleCount: Number(row.article_count),
    captureCount: Number(row.capture_count),
    lastCaptureAt: row.last_capture_at,
    lastSuccessAt: row.last_success_at,
  }));
}

export function getArticleDetail(database, articleId) {
  const row = database.prepare(`
    SELECT
      a.id, a.source_id, s.name AS source_name, s.country_code, s.country_name,
      s.kind AS source_kind, s.homepage_url, s.feed_url, s.terms_url,
      s.capture_policy, s.public_content_policy, s.notes AS source_notes,
      a.canonical_url, a.external_id, a.first_seen_at, a.last_seen_at,
      v.id AS current_version_id, v.title, v.byline, v.public_excerpt,
      v.source_published_at, v.source_updated_at, v.section, v.image_url,
      v.version_sha256,
      (SELECT COUNT(*) FROM article_versions history WHERE history.article_id = a.id) AS revision_count
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    JOIN article_versions v ON v.id = a.current_version_id
    WHERE a.id = ?
  `).get(articleId);
  if (!row) {
    return null;
  }

  const versions = database.prepare(`
    SELECT
      v.id, v.observed_at, v.source_published_at, v.source_updated_at,
      v.title, v.byline, v.public_excerpt, v.section,
      v.image_url, v.tags_json, v.version_sha256, v.changed_fields_json,
      v.change_kind, v.previous_version_id, v.capture_id,
      f.fetched_at AS capture_fetched_at, f.request_url, f.final_url,
      f.http_status, f.payload_sha256, f.payload_bytes, f.stored_bytes,
      f.parse_status, f.collector_version
    FROM article_versions v
    JOIN feed_captures f ON f.id = v.capture_id
    WHERE v.article_id = ?
    ORDER BY v.id DESC
  `).all(articleId).map((version) => ({
    id: Number(version.id),
    observedAt: version.observed_at,
    sourcePublishedAt: version.source_published_at,
    sourceUpdatedAt: version.source_updated_at,
    title: version.title,
    byline: version.byline,
    publicExcerpt: version.public_excerpt,
    section: version.section,
    imageUrl: version.image_url,
    tags: parseJson(version.tags_json, []),
    versionSha256: version.version_sha256,
    changedFields: parseJson(version.changed_fields_json, []),
    changeKind: version.change_kind,
    previousVersionId: version.previous_version_id ? Number(version.previous_version_id) : null,
    capture: {
      id: Number(version.capture_id),
      fetchedAt: version.capture_fetched_at,
      requestUrl: version.request_url,
      finalUrl: version.final_url,
      httpStatus: Number(version.http_status),
      payloadSha256: version.payload_sha256,
      payloadBytes: Number(version.payload_bytes),
      storedBytes: Number(version.stored_bytes),
      parseStatus: version.parse_status,
      collectorVersion: version.collector_version,
    },
  }));

  const classifications = database.prepare(`
    SELECT c.id, c.article_version_id, c.origin, c.method, c.label,
           c.value, c.confidence, c.created_at
    FROM classifications c
    JOIN article_versions v ON v.id = c.article_version_id
    WHERE v.article_id = ?
    ORDER BY c.article_version_id DESC, c.origin, c.label, c.value
  `).all(articleId).map((classification) => ({
    id: Number(classification.id),
    articleVersionId: Number(classification.article_version_id),
    origin: classification.origin,
    method: classification.method,
    label: classification.label,
    value: classification.value,
    confidence: classification.confidence,
    createdAt: classification.created_at,
  }));

  const reception = database.prepare(`
    SELECT id, observed_at, platform, source_url, comment_count,
           reaction_count, share_count, sample_json, evidence_sha256,
           capture_method, notes
    FROM reception_snapshots WHERE article_id = ? ORDER BY id DESC
  `).all(articleId).map((snapshot) => ({
    id: Number(snapshot.id),
    observedAt: snapshot.observed_at,
    platform: snapshot.platform,
    sourceUrl: snapshot.source_url,
    commentCount: snapshot.comment_count,
    reactionCount: snapshot.reaction_count,
    shareCount: snapshot.share_count,
    sample: parseJson(snapshot.sample_json, []),
    evidenceSha256: snapshot.evidence_sha256,
    captureMethod: snapshot.capture_method,
    notes: snapshot.notes,
  }));

  return {
    id: Number(row.id),
    sourceId: row.source_id,
    sourceName: row.source_name,
    countryCode: row.country_code,
    countryName: row.country_name,
    sourceKind: row.source_kind,
    homepageUrl: row.homepage_url,
    feedUrl: row.feed_url,
    termsUrl: row.terms_url,
    capturePolicy: row.capture_policy,
    publicContentPolicy: row.public_content_policy,
    sourceNotes: row.source_notes,
    canonicalUrl: row.canonical_url,
    externalId: row.external_id,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    currentVersionId: Number(row.current_version_id),
    title: row.title,
    byline: row.byline,
    publicExcerpt: row.public_excerpt,
    sourcePublishedAt: row.source_published_at,
    sourceUpdatedAt: row.source_updated_at,
    section: row.section,
    imageUrl: row.image_url,
    versionSha256: row.version_sha256,
    revisionCount: Number(row.revision_count),
    versions,
    classifications,
    reception,
  };
}

export function recordReceptionSnapshot(database, snapshot) {
  const evidence = {
    articleId: snapshot.articleId,
    observedAt: snapshot.observedAt,
    platform: snapshot.platform,
    sourceUrl: snapshot.sourceUrl,
    commentCount: snapshot.commentCount ?? null,
    reactionCount: snapshot.reactionCount ?? null,
    shareCount: snapshot.shareCount ?? null,
    sample: snapshot.sample ?? [],
    captureMethod: snapshot.captureMethod,
    notes: snapshot.notes ?? "",
  };
  const evidenceHash = sha256(JSON.stringify(evidence));
  const inserted = database.prepare(`
    INSERT INTO reception_snapshots(
      article_id, observed_at, platform, source_url, comment_count,
      reaction_count, share_count, sample_json, evidence_sha256,
      capture_method, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    evidence.articleId,
    evidence.observedAt,
    evidence.platform,
    evidence.sourceUrl,
    evidence.commentCount,
    evidence.reactionCount,
    evidence.shareCount,
    json(evidence.sample),
    evidenceHash,
    evidence.captureMethod,
    evidence.notes,
  );
  return { id: Number(inserted.lastInsertRowid), evidenceSha256: evidenceHash };
}