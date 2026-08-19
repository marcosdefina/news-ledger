import { parseFragment } from "parse5";
import { XMLParser } from "fast-xml-parser";

const TRACKING_PARAMETERS = new Set([
  "at_campaign",
  "at_medium",
  "cmpid",
  "fbclid",
  "gclid",
]);
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_EXCERPT_LENGTH = 420;

const parser = new XMLParser({
  allowBooleanAttributes: false,
  alwaysCreateTextNode: false,
  attributeNamePrefix: "@_",
  cdataPropName: "#cdata",
  ignoreAttributes: false,
  ignoreDeclaration: true,
  parseAttributeValue: false,
  parseTagValue: false,
  preserveOrder: false,
  processEntities: false,
  removeNSPrefix: false,
  textNodeName: "#text",
  trimValues: true,
});

function array(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function scalar(value) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return scalar(value[0]);
  }
  if (typeof value === "object") {
    return scalar(value["#cdata"] ?? value["#text"] ?? value["@_href"] ?? "");
  }
  return "";
}

function walkText(node, output) {
  if (!node || typeof node !== "object") {
    return;
  }
  if (node.nodeName === "#text" && typeof node.value === "string") {
    output.push(node.value);
    return;
  }
  if (node.nodeName === "script" || node.nodeName === "style" || node.nodeName === "template") {
    return;
  }
  for (const child of node.childNodes ?? []) {
    walkText(child, output);
  }
}

export function htmlToText(value, maxLength = MAX_TEXT_LENGTH) {
  let current = scalar(value);
  if (!current) {
    return "";
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const output = [];
    walkText(parseFragment(current), output);
    const normalized = output
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/\s+([,.;:!?%)\]])/g, "$1")
      .replace(/([(\[])\s+/g, "$1")
      .trim()
      .slice(0, maxLength);
    if (normalized === current) {
      return normalized;
    }
    current = normalized;
  }
  return current;
}

export function canonicalizeUrl(value) {
  const url = new URL(htmlToText(value, 20_000));
  if (url.protocol !== "https:") {
    throw new Error(`Article URL must use HTTPS: ${url.href}`);
  }
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("utm_") || TRACKING_PARAMETERS.has(key)) {
      url.searchParams.delete(key);
    }
  }
  return url.href;
}

function isoDate(value) {
  const input = scalar(value);
  if (!input) {
    return null;
  }
  const parsed = new Date(input);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function imageUrl(item) {
  const candidates = [
    item["media:content"]?.["@_url"],
    item["media:thumbnail"]?.["@_url"],
    item.enclosure?.["@_url"],
  ];
  for (const candidate of candidates) {
    try {
      const url = new URL(scalar(candidate));
      if (url.protocol === "https:") {
        return url.href;
      }
    } catch {
      // Image metadata is optional evidence and never blocks article capture.
    }
  }
  return null;
}

function categoryText(category) {
  return htmlToText(category, 160);
}

function classify(item) {
  const haystack = `${item.title} ${item.descriptionText} ${item.section ?? ""} ${item.tags.join(" ")}`.toLowerCase();
  const classifications = [];
  const contentType = /\b(opinion|editorial|comment|analysis|review)\b/.test(haystack)
    ? "analysis-or-opinion"
    : "reported-news";
  classifications.push({
    origin: "machine",
    method: "observable-rules-v1",
    label: "content-type",
    value: contentType,
    confidence: 0.7,
  });

  const signals = [
    ["allegation-language", /\b(alleged|allegation|accused|claims?|denies|denied)\b/],
    ["correction-language", /\b(corrected|correction|clarification|apolog(?:y|ise|ized))\b/],
    ["investigation-language", /\b(investigation|investigates|inquiry|inquest|review)\b/],
    ["death-or-self-harm", /\b(died|death|dead|suicide|self-harm|killed)\b/],
  ];
  for (const [value, pattern] of signals) {
    if (pattern.test(haystack)) {
      classifications.push({
        origin: "machine",
        method: "observable-rules-v1",
        label: "language-signal",
        value,
        confidence: 0.65,
      });
    }
  }
  return classifications;
}

function normalizeRssItem(item) {
  const link = scalar(item.link) || scalar(item.guid);
  const title = htmlToText(item.title, 1_000);
  if (!link || !title) {
    return null;
  }
  const descriptionText = htmlToText(item.description ?? item.summary);
  const contentText = htmlToText(item["content:encoded"] ?? item.content ?? item.description);
  const tags = array(item.category).map(categoryText).filter(Boolean);
  const normalized = {
    canonicalUrl: canonicalizeUrl(link),
    externalId: scalar(item.guid ?? item.id) || null,
    title,
    byline: htmlToText(item["dc:creator"] ?? item.author, 500) || null,
    descriptionText,
    publicExcerpt: (descriptionText || contentText).slice(0, MAX_EXCERPT_LENGTH),
    contentText,
    sourcePublishedAt: isoDate(item.pubDate ?? item.published ?? item["dc:date"]),
    sourceUpdatedAt: isoDate(item.updated ?? item.lastBuildDate),
    section: tags[0] ?? null,
    imageUrl: imageUrl(item),
    tags,
  };
  normalized.classifications = [
    ...tags.map((value) => ({
      origin: "publisher",
      method: "rss-category",
      label: "category",
      value,
      confidence: null,
    })),
    ...classify(normalized),
  ];
  return normalized;
}

function feedItems(document) {
  if (document?.rss?.channel?.item) {
    return array(document.rss.channel.item);
  }
  if (document?.feed?.entry) {
    return array(document.feed.entry);
  }
  throw new Error("Document is not a supported RSS or Atom feed");
}

export function parseFeed(xml) {
  if (typeof xml !== "string" || !xml.trim()) {
    throw new Error("Feed payload is empty");
  }
  const document = parser.parse(xml);
  const items = [];
  for (const candidate of feedItems(document)) {
    try {
      const normalized = normalizeRssItem(candidate);
      if (normalized) {
        items.push(normalized);
      }
    } catch {
      // A malformed item is skipped while the exact feed payload remains preserved.
    }
  }
  return items;
}