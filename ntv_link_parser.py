#!/usr/bin/env python3
"""
ntv_link_parser.py - Pengekstrak link URL dari halaman berita (untuk ntvgraph).

Hanya memakai library standar Python (tanpa pip install).

Contoh:
  python ntv_link_parser.py https://contoh-berita.com/
  python ntv_link_parser.py https://contoh-berita.com/ --articles-only --same-domain
  python ntv_link_parser.py --file halaman.html --base https://contoh-berita.com/ --format edges
"""
import argparse
import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse, urlunparse, parse_qsl, urlencode
from urllib.request import Request, urlopen

UA = "Mozilla/5.0 (compatible; ntvgraph-bot/1.0)"
MAX_BYTES = 5 * 1024 * 1024

TRACKING = re.compile(r"^(utm_|fbclid$|gclid$|mc_|ref$|source$|campaign$)", re.I)
SKIP_PREFIX = ("mailto:", "tel:", "javascript:", "data:", "sms:", "whatsapp:", "#")
SKIP_EXT = re.compile(r"\.(jpe?g|png|gif|webp|svg|css|js|pdf|zip|mp4|mp3|ico|xml|rss)$", re.I)
NON_ARTICLE = re.compile(
    r"/(?:tag|tags|topik|topic|category|kategori|author|penulis|search|cari|"
    r"login|register|about|contact|privacy|redaksi|indeks|index|page|feed)(?:/|$)",
    re.I,
)
DATE_IN_PATH = re.compile(r"/(?:19|20)\d{2}[/-]\d{1,2}(?:[/-]\d{1,2})?(?:/|$)")
LONG_ID = re.compile(r"\d{5,}")
REGIONS = {"nav", "header", "footer", "aside", "article", "main"}


class LinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.base = None
        self.canonical = None
        self.og_url = None
        self.title = ""
        self._in_title = False
        self._regions = []
        self._cur = None
        self.raw_links = []

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag in REGIONS:
            self._regions.append(tag)
        elif tag == "title":
            self._in_title = True
        elif tag == "base" and a.get("href") and not self.base:
            self.base = a["href"]
        elif tag == "link" and "canonical" in a.get("rel", "").lower() and a.get("href"):
            self.canonical = a["href"]
        elif tag == "meta" and a.get("property") == "og:url" and a.get("content"):
            self.og_url = a["content"]
        elif tag == "a" and a.get("href"):
            self._finish()
            self._cur = {
                "href": a["href"].strip(),
                "text": [a.get("title", "")],
                "rel": a.get("rel", ""),
                "regions": list(self._regions),
            }
        elif tag == "img" and self._cur is not None:
            self._cur["text"].append(a.get("alt", ""))

    def handle_endtag(self, tag):
        if tag in REGIONS and tag in self._regions:
            idx = len(self._regions) - 1 - self._regions[::-1].index(tag)
            del self._regions[idx]
        elif tag == "title":
            self._in_title = False
        elif tag == "a":
            self._finish()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._cur is not None:
            self._cur["text"].append(data)

    def _finish(self):
        if self._cur is not None:
            self._cur["text"] = " ".join(" ".join(self._cur["text"]).split())
            self.raw_links.append(self._cur)
            self._cur = None

    def close(self):
        super().close()
        self._finish()


def normalize(url):
    """Hapus fragment & parameter pelacak, rapikan host dan trailing slash."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.netloc:
        return None
    query = sorted((k, v) for k, v in parse_qsl(p.query, keep_blank_values=True)
                   if not TRACKING.match(k))
    path = p.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((p.scheme, p.netloc.lower(), path, "", urlencode(query), ""))


def score_article(url, text, regions, same_domain):
    """Heuristik sederhana: seberapa mirip link ini dengan URL artikel berita."""
    p = urlparse(url)
    segs = [s for s in p.path.split("/") if s]
    score = 0
    if same_domain:
        score += 1
    if DATE_IN_PATH.search(p.path):
        score += 2
    if segs and segs[-1].count("-") >= 3:
        score += 2
    if LONG_ID.search(p.path):
        score += 2
    if len(text.split()) >= 4:
        score += 1
    if "article" in regions or "main" in regions:
        score += 1
    if any(r in regions for r in ("nav", "footer", "header")):
        score -= 2
    if NON_ARTICLE.search(p.path):
        score -= 3
    if len(segs) <= 1 and not (segs and segs[-1].count("-") >= 3):
        score -= 2
    return score


def extract_links(html, page_url, same_domain=False, articles_only=False, min_score=3):
    parser = LinkParser()
    parser.feed(html)
    parser.close()

    base = urljoin(page_url, parser.base) if parser.base else page_url
    page_norm = normalize(parser.canonical and urljoin(base, parser.canonical) or page_url) \
        or normalize(page_url)
    page_host = urlparse(page_url).netloc.lower()

    seen = {}
    for raw in parser.raw_links:
        href = raw["href"]
        if not href or href.lower().startswith(SKIP_PREFIX):
            continue
        url = normalize(urljoin(base, href))
        if not url or SKIP_EXT.search(urlparse(url).path):
            continue
        if url == page_norm:
            continue
        internal = urlparse(url).netloc.lower() == page_host
        if same_domain and not internal:
            continue
        score = score_article(url, raw["text"], raw["regions"], internal)
        if articles_only and score < min_score:
            continue
        item = seen.get(url)
        if item is None:
            seen[url] = {
                "url": url,
                "anchor": raw["text"],
                "internal": internal,
                "score": score,
                "is_article": score >= min_score,
                "regions": sorted(set(raw["regions"])),
                "nofollow": "nofollow" in raw["rel"].lower(),
                "count": 1,
            }
        else:
            item["count"] += 1
            if len(raw["text"]) > len(item["anchor"]):
                item["anchor"] = raw["text"]
            item["score"] = max(item["score"], score)
            item["is_article"] = item["score"] >= min_score

    links = sorted(seen.values(), key=lambda x: (-x["score"], x["url"]))
    return {
        "page": page_norm,
        "title": " ".join(parser.title.split()),
        "canonical": parser.canonical,
        "og_url": parser.og_url,
        "total": len(links),
        "links": links,
        # format edge siap dimasukkan ke graf (sumber -> target)
        "edges": [{"source": page_norm, "target": l["url"], "label": l["anchor"]}
                  for l in links],
    }


def fetch(url, timeout=15):
    req = Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*;q=0.8"})
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read(MAX_BYTES)
        charset = resp.headers.get_content_charset() or "utf-8"
        final_url = resp.geturl()
    return raw.decode(charset, errors="replace"), final_url


def main():
    ap = argparse.ArgumentParser(description="Ekstrak link URL dari halaman berita.")
    ap.add_argument("url", nargs="?", help="URL halaman yang akan diambil")
    ap.add_argument("--file", help="baca dari file HTML lokal (butuh --base)")
    ap.add_argument("--base", help="URL dasar untuk file lokal")
    ap.add_argument("--same-domain", action="store_true", help="hanya link internal")
    ap.add_argument("--articles-only", action="store_true", help="hanya yang mirip artikel")
    ap.add_argument("--min-score", type=int, default=3)
    ap.add_argument("--format", choices=["json", "txt", "edges"], default="json")
    args = ap.parse_args()

    if args.file:
        if not args.base:
            ap.error("--file membutuhkan --base")
        with open(args.file, encoding="utf-8", errors="replace") as f:
            html, page_url = f.read(), args.base
    elif args.url:
        html, page_url = fetch(args.url)
    else:
        ap.error("beri URL atau --file")

    result = extract_links(html, page_url, args.same_domain,
                           args.articles_only, args.min_score)

    if args.format == "txt":
        print("\n".join(l["url"] for l in result["links"]))
    elif args.format == "edges":
        print(json.dumps(result["edges"], ensure_ascii=False, indent=2))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
