const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
  timeZoneName: "short",
});

const SIGNAL_LABELS = Object.freeze({
  "allegation-language": "Allegation language",
  "analysis-or-opinion": "Analysis or opinion",
  "correction-language": "Correction language",
  "death-or-self-harm": "Death or self-harm",
  "investigation-language": "Investigation language",
  "reported-news": "Reported news",
});

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function displayDate(value, fallback = "Not supplied") {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? fallback : DATE_FORMAT.format(parsed);
}

function shortHash(value) {
  return value ? `${value.slice(0, 12)}...${value.slice(-6)}` : "Not captured";
}

function active(path, expected) {
  return path === expected ? ' aria-current="page" class="is-active"' : "";
}

function layout({ title, description, path, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)} | News Ledger</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&amp;family=Newsreader:opsz,wght@6..72,500;6..72,650&amp;display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/assets/styles.css">
  <script src="/assets/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="/" aria-label="News Ledger home"><span class="brand__mark" aria-hidden="true">NL</span><span>News Ledger</span></a>
      <nav class="global-nav" aria-label="Primary navigation">
        <a href="/"${active(path, "/")}>Ledger</a>
        <a href="/sources"${active(path, "/sources")}>Sources</a>
        <a href="/methodology"${active(path, "/methodology")}>Method</a>
      </nav>
      <span class="environment-badge">Evidence preview</span>
    </div>
  </header>
  <main id="main">${body}</main>
  <footer class="site-footer">
    <p>Source records, not verdicts. Machine labels are provisional observations.</p>
    <a href="/methodology#corrections">Corrections and disputes</a>
  </footer>
</body>
</html>`;
}

function queryString(filters, page) {
  const query = new URLSearchParams();
  if (filters.query) query.set("q", filters.query);
  if (filters.country) query.set("country", filters.country);
  if (filters.sourceId) query.set("source", filters.sourceId);
  if (filters.signal) query.set("signal", filters.signal);
  if (filters.revisedOnly) query.set("revised", "1");
  if (page > 1) query.set("page", String(page));
  const rendered = query.toString();
  return rendered ? `?${rendered}` : "";
}

function machineSignals(classifications) {
  return classifications.filter(({ origin, label }) => origin === "machine" && label === "language-signal");
}

function sourceRail(sourceStats) {
  return `<aside class="source-rail" aria-label="Tracked sources">
    <div class="rail-heading"><span>Source monitor</span><a href="/sources">Full register</a></div>
    <ol class="source-monitor">
      ${sourceStats.map((source) => `<li>
        <span class="source-dot ${source.lastSuccessAt ? "is-live" : "is-waiting"}" aria-hidden="true"></span>
        <a href="/?source=${encodeURIComponent(source.id)}">${escapeHtml(source.name)}</a>
        <span>${source.articleCount}</span>
        <small>${source.lastSuccessAt ? `Checked ${displayDate(source.lastSuccessAt)}` : "Awaiting first capture"}</small>
      </li>`).join("")}
    </ol>
    <div class="rail-note">
      <strong>Coverage starts here</strong>
      <p>Four official feeds across England/UK and Ireland. More sources enter only after feed and terms review.</p>
    </div>
  </aside>`;
}

function articleRow(article) {
  const signals = machineSignals(article.classifications);
  return `<article class="ledger-row" data-reveal>
    <a class="ledger-row__image" href="/article/${article.id}" aria-label="Open evidence record for ${escapeHtml(article.title)}">
      ${article.imageUrl
        ? `<img src="${escapeHtml(article.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-source-image>`
        : `<span class="image-fallback" aria-hidden="true">${escapeHtml(article.sourceName.slice(0, 2).toUpperCase())}</span>`}
    </a>
    <div class="ledger-row__body">
      <div class="record-kicker">
        <span class="country-code">${escapeHtml(article.countryCode)}</span>
        <span>${escapeHtml(article.sourceName)}</span>
        ${article.section ? `<span>${escapeHtml(article.section)}</span>` : ""}
      </div>
      <h2><a href="/article/${article.id}">${escapeHtml(article.title)}</a></h2>
      <p class="byline">${article.byline ? `By ${escapeHtml(article.byline)}` : "Byline not supplied"}</p>
      <p class="excerpt">${escapeHtml(article.publicExcerpt || "No public excerpt supplied by the source.")}</p>
      <div class="record-footer">
        <time datetime="${escapeHtml(article.sourcePublishedAt ?? article.firstSeenAt)}">${displayDate(article.sourcePublishedAt ?? article.firstSeenAt)}</time>
        <span>Record #${article.id}</span>
        ${article.revisionCount > 1 ? `<span class="revision-flag">${article.revisionCount} versions</span>` : `<span>First capture</span>`}
      </div>
      ${signals.length > 0 ? `<ul class="signal-list" aria-label="Machine-detected language signals">
        ${signals.slice(0, 3).map(({ value }) => `<li><span>Machine signal</span>${escapeHtml(SIGNAL_LABELS[value] ?? value)}</li>`).join("")}
      </ul>` : ""}
    </div>
  </article>`;
}

export function renderIndex({ result, counts, sourceStats }) {
  const { articles, filters, page, pageCount, total } = result;
  const body = `<section class="ledger-intro">
    <div>
      <p class="eyebrow">England + Ireland / public beta</p>
      <h1>A record of what was published, when, and how it changed.</h1>
    </div>
    <dl class="ledger-metrics">
      <div><dt>Articles</dt><dd>${counts.articles}</dd></div>
      <div><dt>Versions</dt><dd>${counts.versions}</dd></div>
      <div><dt>Captures</dt><dd>${counts.captures}</dd></div>
      <div><dt>Sources</dt><dd>${counts.sources}</dd></div>
    </dl>
  </section>
  <section class="ledger-workspace">
    ${sourceRail(sourceStats)}
    <div class="ledger-main">
      <form class="filter-bar" method="get" action="/" aria-label="Filter evidence records">
        <label class="search-field"><span>Search records</span><input type="search" name="q" value="${escapeHtml(filters.query)}" placeholder="Title, byline, excerpt, source"></label>
        <label><span>Country</span><select name="country">
          <option value="">All countries</option>
          <option value="GB"${filters.country === "GB" ? " selected" : ""}>England / UK</option>
          <option value="IE"${filters.country === "IE" ? " selected" : ""}>Ireland</option>
        </select></label>
        <label><span>Source</span><select name="source">
          <option value="">All sources</option>
          ${sourceStats.map((source) => `<option value="${escapeHtml(source.id)}"${filters.sourceId === source.id ? " selected" : ""}>${escapeHtml(source.name)}</option>`).join("")}
        </select></label>
        <label><span>Signal</span><select name="signal">
          <option value="">All signals</option>
          ${["allegation-language", "correction-language", "investigation-language", "death-or-self-harm"].map((signal) => `<option value="${signal}"${filters.signal === signal ? " selected" : ""}>${escapeHtml(SIGNAL_LABELS[signal])}</option>`).join("")}
        </select></label>
        <label class="check-field"><input type="checkbox" name="revised" value="1"${filters.revisedOnly ? " checked" : ""}><span>Revised only</span></label>
        <button type="submit">Search</button>
        <a class="clear-link" href="/">Clear</a>
      </form>
      <div class="results-heading"><p><strong>${total}</strong> evidence ${total === 1 ? "record" : "records"}</p><p>Newest source publication first</p></div>
      <div class="ledger-list">
        ${articles.length > 0
          ? articles.map(articleRow).join("")
          : `<div class="empty-state"><strong>No records match this view.</strong><p>Change the selected source, country, signal, or search terms.</p></div>`}
      </div>
      ${pageCount > 1 ? `<nav class="pagination" aria-label="Pagination">
        ${page > 1 ? `<a href="/${queryString(filters, page - 1)}" rel="prev">Previous</a>` : `<span>Previous</span>`}
        <span>Page ${page} of ${pageCount}</span>
        ${page < pageCount ? `<a href="/${queryString(filters, page + 1)}" rel="next">Next</a>` : `<span>Next</span>`}
      </nav>` : ""}
    </div>
  </section>`;
  return layout({
    title: "Article ledger",
    description: "Dated, provenance-first records of news articles and their revisions.",
    path: "/",
    body,
  });
}

function versionClassificationList(classifications, versionId) {
  const rows = classifications.filter(({ articleVersionId }) => articleVersionId === versionId);
  if (rows.length === 0) {
    return `<p class="muted">No labels recorded for this version.</p>`;
  }
  return `<ul class="classification-list">${rows.map((row) => `<li>
    <span class="origin origin--${escapeHtml(row.origin)}">${escapeHtml(row.origin)}</span>
    <strong>${escapeHtml(row.label)}</strong>
    <span>${escapeHtml(SIGNAL_LABELS[row.value] ?? row.value)}</span>
    <small>${escapeHtml(row.method)}${row.confidence == null ? "" : ` / ${Math.round(row.confidence * 100)}% rule confidence`}</small>
  </li>`).join("")}</ul>`;
}

export function renderArticle(article) {
  const currentVersion = article.versions.find(({ id }) => id === article.currentVersionId) ?? article.versions[0];
  const body = `<article class="record-page">
    <header class="record-hero">
      <a class="back-link" href="/">Back to ledger</a>
      <div class="record-kicker"><span class="country-code">${escapeHtml(article.countryCode)}</span><span>${escapeHtml(article.sourceName)}</span>${article.section ? `<span>${escapeHtml(article.section)}</span>` : ""}</div>
      <h1>${escapeHtml(article.title)}</h1>
      <p class="record-deck">${escapeHtml(article.publicExcerpt || "No public excerpt supplied by the source.")}</p>
      <div class="record-byline"><span>${article.byline ? `By ${escapeHtml(article.byline)}` : "Byline not supplied"}</span><time datetime="${escapeHtml(article.sourcePublishedAt ?? article.firstSeenAt)}">${displayDate(article.sourcePublishedAt ?? article.firstSeenAt)}</time></div>
      <a class="primary-link" href="${escapeHtml(article.canonicalUrl)}" target="_blank" rel="noopener noreferrer">Open original article</a>
    </header>
    <dl class="evidence-strip">
      <div><dt>Ledger record</dt><dd>#${article.id}</dd></div>
      <div><dt>First seen</dt><dd>${displayDate(article.firstSeenAt)}</dd></div>
      <div><dt>Last checked</dt><dd>${displayDate(article.lastSeenAt)}</dd></div>
      <div><dt>Version history</dt><dd>${article.revisionCount} ${article.revisionCount === 1 ? "version" : "versions"}</dd></div>
      <div><dt>Current fingerprint</dt><dd><code title="${escapeHtml(article.versionSha256)}">${escapeHtml(shortHash(article.versionSha256))}</code></dd></div>
    </dl>
    <nav class="context-nav" aria-label="Evidence layers">
      <a href="#record">Record</a><a href="#versions">Versions</a><a href="#classification">Classification</a><a href="#reception">Reception</a><a href="#provenance">Provenance</a>
    </nav>
    <div class="context-stack">
      <section id="record" class="context-section">
        <div class="context-heading"><span>01</span><div><p>Publisher layer</p><h2>Recorded article metadata</h2></div></div>
        <div class="record-grid">
          ${article.imageUrl ? `<figure class="record-image"><img src="${escapeHtml(article.imageUrl)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-source-image><figcaption>Image URL supplied by ${escapeHtml(article.sourceName)}.</figcaption></figure>` : ""}
          <dl class="fact-list">
            <div><dt>Publisher</dt><dd>${escapeHtml(article.sourceName)}</dd></div>
            <div><dt>Country</dt><dd>${escapeHtml(article.countryName)}</dd></div>
            <div><dt>Source published</dt><dd>${displayDate(article.sourcePublishedAt)}</dd></div>
            <div><dt>Source updated</dt><dd>${displayDate(article.sourceUpdatedAt, "No update timestamp supplied")}</dd></div>
            <div><dt>Byline</dt><dd>${escapeHtml(article.byline ?? "Not supplied")}</dd></div>
            <div><dt>Section</dt><dd>${escapeHtml(article.section ?? "Not supplied")}</dd></div>
          </dl>
        </div>
        <div class="source-excerpt"><span>Source-supplied excerpt</span><blockquote>${escapeHtml(article.publicExcerpt || "No public excerpt supplied.")}</blockquote></div>
      </section>
      <section id="versions" class="context-section">
        <div class="context-heading"><span>02</span><div><p>Change layer</p><h2>Observed version timeline</h2></div></div>
        <ol class="version-timeline">
          ${article.versions.map((version, index) => `<li>
            <div class="timeline-marker"><span>${article.versions.length - index}</span></div>
            <div class="timeline-entry">
              <div class="timeline-meta"><strong>${version.changeKind === "initial" ? "Initial capture" : "Revision observed"}</strong><time datetime="${escapeHtml(version.observedAt)}">${displayDate(version.observedAt)}</time></div>
              <h3>${escapeHtml(version.title)}</h3>
              <p>${escapeHtml(version.publicExcerpt || "No public excerpt supplied.")}</p>
              <div class="change-fields"><span>Changed fields</span>${version.changedFields.map((field) => `<code>${escapeHtml(field)}</code>`).join("")}</div>
              <dl class="hash-list">
                <div><dt>Version SHA-256</dt><dd><code title="${escapeHtml(version.versionSha256)}">${escapeHtml(shortHash(version.versionSha256))}</code></dd></div>
                <div><dt>Capture SHA-256</dt><dd><code title="${escapeHtml(version.capture.payloadSha256)}">${escapeHtml(shortHash(version.capture.payloadSha256))}</code></dd></div>
              </dl>
            </div>
          </li>`).join("")}
        </ol>
      </section>
      <section id="classification" class="context-section">
        <div class="context-heading"><span>03</span><div><p>Interpretation layer</p><h2>Labels with declared origins</h2></div></div>
        <div class="notice"><strong>Not an adjudication.</strong><p>Publisher categories are copied from source metadata. Machine signals report observable wording or format and do not determine truth, intent, ethics, or wrongdoing.</p></div>
        ${versionClassificationList(article.classifications, currentVersion.id)}
      </section>
      <section id="reception" class="context-section">
        <div class="context-heading"><span>04</span><div><p>Public response layer</p><h2>Reception snapshots</h2></div></div>
        ${article.reception.length > 0 ? `<ol class="reception-list">${article.reception.map((snapshot) => `<li><strong>${escapeHtml(snapshot.platform)}</strong><time>${displayDate(snapshot.observedAt)}</time><span>${snapshot.commentCount ?? "Unknown"} comments</span><code>${escapeHtml(shortHash(snapshot.evidenceSha256))}</code></li>`).join("")}</ol>` : `<div class="empty-state"><strong>No reviewed reception capture yet.</strong><p>Comment counts and samples remain absent until a lawful, source-specific capture method is reviewed. Absence is recorded instead of estimated.</p></div>`}
      </section>
      <section id="provenance" class="context-section">
        <div class="context-heading"><span>05</span><div><p>Evidence layer</p><h2>Capture provenance</h2></div></div>
        <dl class="provenance-grid">
          <div><dt>Capture ID</dt><dd>#${currentVersion.capture.id}</dd></div>
          <div><dt>Observed</dt><dd>${displayDate(currentVersion.capture.fetchedAt)}</dd></div>
          <div><dt>HTTP result</dt><dd>${currentVersion.capture.httpStatus} / ${escapeHtml(currentVersion.capture.parseStatus)}</dd></div>
          <div><dt>Raw payload</dt><dd>${currentVersion.capture.payloadBytes.toLocaleString("en-GB")} bytes, private gzip evidence</dd></div>
          <div><dt>Collector</dt><dd>${escapeHtml(currentVersion.capture.collectorVersion)}</dd></div>
          <div><dt>Public boundary</dt><dd>${escapeHtml(article.publicContentPolicy.replaceAll("-", " "))}</dd></div>
        </dl>
        <div class="provenance-links"><a href="${escapeHtml(article.feedUrl)}" target="_blank" rel="noopener noreferrer">Official source feed</a><a href="${escapeHtml(article.termsUrl)}" target="_blank" rel="noopener noreferrer">Publisher terms</a></div>
      </section>
    </div>
  </article>`;
  return layout({
    title: article.title,
    description: `Evidence record for ${article.title} from ${article.sourceName}.`,
    path: "",
    body,
  });
}

export function renderSources(sourceStats) {
  const body = `<section class="page-heading"><p class="eyebrow">Reviewed source register</p><h1>Four feeds. Two countries. Explicit capture boundaries.</h1><p>Initial selection favors influential public-interest publishers with official, machine-readable feeds. Registration does not imply endorsement.</p></section>
  <section class="source-register">
    ${sourceStats.map((source, index) => `<article data-reveal>
      <div class="source-register__index">${String(index + 1).padStart(2, "0")}</div>
      <div class="source-register__identity"><span class="country-code">${escapeHtml(source.countryCode)}</span><h2>${escapeHtml(source.name)}</h2><p>${escapeHtml(source.kind.replaceAll("-", " "))}</p></div>
      <dl><div><dt>Articles</dt><dd>${source.articleCount}</dd></div><div><dt>Captures</dt><dd>${source.captureCount}</dd></div><div><dt>Last successful capture</dt><dd>${displayDate(source.lastSuccessAt, "Awaiting first capture")}</dd></div><div><dt>Public content</dt><dd>Metadata and excerpt</dd></div></dl>
      <p class="source-register__notes">${escapeHtml(source.notes)}</p>
      <div class="source-register__links"><a href="${escapeHtml(source.homepageUrl)}" target="_blank" rel="noopener noreferrer">Publisher</a><a href="${escapeHtml(source.feedUrl)}" target="_blank" rel="noopener noreferrer">Feed</a><a href="${escapeHtml(source.termsUrl)}" target="_blank" rel="noopener noreferrer">Terms</a></div>
    </article>`).join("")}
  </section>`;
  return layout({
    title: "Source register",
    description: "Reviewed England and Ireland news sources tracked by News Ledger.",
    path: "/sources",
    body,
  });
}

export function renderMethodology() {
  const body = `<section class="page-heading"><p class="eyebrow">Evidence method / version 0.1</p><h1>Preserve the record. Separate facts from interpretation.</h1><p>News Ledger records publisher output and observed changes. It does not publish guilt scores, infer intent, or treat automated labels as findings.</p></section>
  <section class="method-grid">
    <article><span>01</span><h2>Capture</h2><p>Official RSS feeds are fetched with byte, timeout, redirect, and host limits. The exact response is compressed, hashed with SHA-256, timestamped, and kept as private evidence.</p></article>
    <article><span>02</span><h2>Version</h2><p>Title, byline, dates, source excerpt, body evidence, section, image URL, and categories form a version fingerprint. A changed fingerprint creates a new immutable row linked to its predecessor.</p></article>
    <article><span>03</span><h2>Classify</h2><p>Publisher categories retain their source origin. Machine rules can flag observable wording such as allegation, correction, investigation, or death-related language. They cannot establish whether a claim is true.</p></article>
    <article><span>04</span><h2>Reception</h2><p>Comments, reactions, and shares are separate evidence snapshots with their own source URL, method, timestamp, and hash. A source is left blank until its collection method is lawful and reviewable.</p></article>
    <article><span>05</span><h2>Publish</h2><p>Public pages show metadata, short source-provided excerpts, timestamps, change fields, and fingerprints. Full captured bodies remain private to reduce copyright and privacy risk.</p></article>
    <article id="corrections"><span>06</span><h2>Correct and dispute</h2><p>History is not silently rewritten. Corrections create a new version; disputed classifications can receive a later human review record while the original observation remains attributable.</p></article>
  </section>
  <section class="principles-band"><strong>Accountability applies to the ledger too.</strong><p>Every assertion must retain its origin, time, method, uncertainty, and evidence path.</p></section>`;
  return layout({
    title: "Methodology",
    description: "News Ledger evidence capture, versioning, classification, and publication method.",
    path: "/methodology",
    body,
  });
}

export function renderNotFound() {
  return layout({
    title: "Record not found",
    description: "The requested News Ledger record does not exist.",
    path: "",
    body: `<section class="not-found"><span>404</span><h1>Record not found</h1><p>The requested evidence record is not present in this ledger.</p><a href="/">Return to the ledger</a></section>`,
  });
}