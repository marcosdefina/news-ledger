import assert from "node:assert/strict";
import test from "node:test";

import { canonicalizeUrl, htmlToText, parseFeed } from "../src/feed.mjs";

const feed = `<?xml version="1.0"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Example</title>
    <item>
      <title><![CDATA[Professor denies <b>allegation</b>]]></title>
      <link>https://example.test/story?utm_source=feed&amp;at_medium=RSS</link>
      <guid>story-1</guid>
      <dc:creator><![CDATA[Jane Reporter]]></dc:creator>
      <description><![CDATA[<p>A short <strong>publisher summary</strong>.</p>]]></description>
      <content:encoded><![CDATA[<p>Longer private evidence.</p><script>ignored()</script>]]></content:encoded>
      <pubDate>Mon, 17 Aug 2026 10:00:00 GMT</pubDate>
      <category>Investigations</category>
      <media:content url="https://images.example.test/story.jpg" />
    </item>
  </channel>
</rss>`;

test("parseFeed normalizes RSS metadata without exposing markup", () => {
  const [item] = parseFeed(feed);
  assert.equal(item.canonicalUrl, "https://example.test/story");
  assert.equal(item.title, "Professor denies allegation");
  assert.equal(item.byline, "Jane Reporter");
  assert.equal(item.descriptionText, "A short publisher summary.");
  assert.equal(item.publicExcerpt, "A short publisher summary.");
  assert.equal(item.contentText, "Longer private evidence.");
  assert.equal(item.sourcePublishedAt, "2026-08-17T10:00:00.000Z");
  assert.deepEqual(item.tags, ["Investigations"]);
  assert.equal(item.imageUrl, "https://images.example.test/story.jpg");
  assert.ok(item.classifications.some(({ value }) => value === "allegation-language"));
  assert.ok(item.classifications.every(({ origin }) => origin === "publisher" || origin === "machine"));
});

test("safe text and URL helpers reject executable markup and non-HTTPS links", () => {
  assert.equal(htmlToText("<style>bad</style><p>Hello &amp; goodbye</p>"), "Hello & goodbye");
  assert.equal(htmlToText("&lt;p&gt;Encoded &lt;strong&gt;publisher&lt;/strong&gt; markup.&lt;/p&gt;"), "Encoded publisher markup.");
  assert.equal(canonicalizeUrl("https://example.test/a?fbclid=1&q=kept#fragment"), "https://example.test/a?q=kept");
  assert.throws(() => canonicalizeUrl("http://example.test/a"), /must use HTTPS/);
});

test("parseFeed rejects non-feed documents", () => {
  assert.throws(() => parseFeed("<html><body>not a feed</body></html>"), /supported RSS or Atom feed/);
});