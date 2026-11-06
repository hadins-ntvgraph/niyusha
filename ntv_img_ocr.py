#!/usr/bin/env python3
"""
ntv_img_ocr.py - Ekstrak gambar dari halaman berita, jalankan OCR, keluarkan
teks terstruktur (JSON / JSONL / Markdown) yang siap dibaca AI.

Kebutuhan:
  pip install pillow pytesseract
  + program Tesseract OCR terpasang (data bahasa: ind dan eng)
      Debian/Ubuntu/Termux : apt install tesseract-ocr tesseract-ocr-ind
      macOS                : brew install tesseract tesseract-lang
      Windows              : installer UB Mannheim

Contoh:
  python ntv_img_ocr.py https://situs-berita.com/2026/10/29/artikel --format md
  python ntv_img_ocr.py --file halaman.html --base https://situs-berita.com/ --format jsonl
  python ntv_img_ocr.py --image foto.png            # satu gambar (path atau URL)
"""
import argparse
import base64
import hashlib
import io
import json
import re
import sys
from html.parser import HTMLParser
from urllib.parse import urljoin
from urllib.request import Request, urlopen

UA = "Mozilla/5.0 (compatible; ntvgraph-bot/1.0)"
MAX_BYTES = 12 * 1024 * 1024
LAZY_ATTRS = ("data-src", "data-lazy-src", "data-original", "data-lazy", "data-url", "src")
SKIP_HINT = re.compile(r"(sprite|logo|icon|avatar|pixel|tracking|blank|spacer|1x1)", re.I)
META_KEYS = {"og:image", "og:image:url", "twitter:image"}


def _int(v):
    m = re.match(r"\d+", v or "")
    return int(m.group()) if m else None


def pick_from_srcset(srcset):
    """Pilih kandidat resolusi terbesar dari atribut srcset."""
    best, best_n = None, -1.0
    for part in srcset.split(","):
        bits = part.strip().split()
        if not bits:
            continue
        n = 1.0
        if len(bits) > 1:
            try:
                n = float(bits[1].rstrip("wx"))
            except ValueError:
                pass
        if n > best_n:
            best, best_n = bits[0], n
    return best


class ImgParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.base = None
        self.images = []
        self._fig = None
        self._in_cap = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag == "base" and a.get("href") and not self.base:
            self.base = a["href"]
        elif tag == "meta":
            key = a.get("property") or a.get("name")
            if key in META_KEYS and a.get("content"):
                self.images.append({"src": a["content"], "alt": "", "caption": "",
                                    "width": None, "height": None, "origin": "meta"})
        elif tag == "figure":
            self._fig = {"idx": [], "cap": []}
        elif tag == "figcaption" and self._fig is not None:
            self._in_cap = True
        elif tag == "img":
            src = ""
            for k in LAZY_ATTRS:
                v = a.get(k, "").strip()
                if v and not v.startswith("data:image/gif"):
                    src = v
                    break
            srcset = a.get("data-srcset") or a.get("srcset")
            if srcset:
                src = pick_from_srcset(srcset) or src
            if not src:
                return
            self.images.append({"src": src, "alt": a.get("alt", "").strip(), "caption": "",
                                "width": _int(a.get("width")), "height": _int(a.get("height")),
                                "origin": "img"})
            if self._fig is not None:
                self._fig["idx"].append(len(self.images) - 1)

    def handle_endtag(self, tag):
        if tag == "figcaption":
            self._in_cap = False
        elif tag == "figure" and self._fig is not None:
            cap = " ".join(" ".join(self._fig["cap"]).split())
            for i in self._fig["idx"]:
                self.images[i]["caption"] = cap
            self._fig = None

    def handle_data(self, data):
        if self._in_cap and self._fig is not None:
            self._fig["cap"].append(data)


def collect_images(html, page_url, no_filter=False):
    p = ImgParser()
    p.feed(html)
    p.close()
    base = urljoin(page_url, p.base) if p.base else page_url
    seen, out = set(), []
    for im in p.images:
        src = im["src"]
        url = src if src.startswith("data:image/") else urljoin(base, src)
        if not url.startswith(("http://", "https://", "data:image/")):
            continue
        if url in seen:
            continue
        if not no_filter:
            if SKIP_HINT.search(url) and not url.startswith("data:"):
                continue
            if (im["width"] and im["width"] < 100) or (im["height"] and im["height"] < 100):
                continue
        seen.add(url)
        out.append({**im, "url": url})
    return out


def fetch_bytes(url, referer=None, timeout=20):
    if url.startswith("data:"):
        head, _, payload = url.partition(",")
        return base64.b64decode(payload) if ";base64" in head else payload.encode()
    headers = {"User-Agent": UA, "Accept": "image/*,*/*;q=0.8"}
    if referer:
        headers["Referer"] = referer
    with urlopen(Request(url, headers=headers), timeout=timeout) as r:
        ctype = r.headers.get("Content-Type", "")
        if ctype and not ctype.lower().startswith(("image/", "application/octet-stream")):
            raise ValueError(f"bukan gambar ({ctype})")
        return r.read(MAX_BYTES)


def preprocess(img):
    """Grayscale, buang transparansi, perbesar gambar kecil, naikkan kontras."""
    from PIL import Image, ImageOps
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
        img = Image.alpha_composite(bg, img)
    img = img.convert("L")
    if max(img.size) < 1600:
        img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    return ImageOps.autocontrast(img)


def run_ocr(img, lang="ind+eng", psm=3, min_conf=40):
    """Kembalikan (teks per baris, rata-rata keyakinan). Kata ber-konfiden rendah dibuang."""
    import pytesseract
    data = pytesseract.image_to_data(
        preprocess(img), lang=lang, config=f"--psm {psm}",
        output_type=pytesseract.Output.DICT)
    lines, confs = {}, []
    for i, word in enumerate(data["text"]):
        word = word.strip()
        if not word:
            continue
        try:
            conf = float(data["conf"][i])
        except ValueError:
            continue
        if conf < min_conf:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        lines.setdefault(key, []).append(word)
        confs.append(conf)
    text = "\n".join(" ".join(v) for _, v in sorted(lines.items()))
    return text, (round(sum(confs) / len(confs), 1) if confs else 0.0)


def ocr_one(item, referer, args, hashes):
    from PIL import Image
    res = {"url": item["url"], "alt": item.get("alt", ""), "caption": item.get("caption", ""),
           "origin": item.get("origin", "img")}
    try:
        raw = fetch_bytes(item["url"], referer) if not item.get("local") else \
            open(item["url"], "rb").read()
        digest = hashlib.md5(raw).hexdigest()
        if digest in hashes:
            res["skipped"] = "duplikat"
            return res
        hashes.add(digest)
        img = Image.open(io.BytesIO(raw))
        res["size"] = [img.width, img.height]
        if not args.no_filter and min(img.size) < args.min_size:
            res["skipped"] = "terlalu kecil"
            return res
        text, conf = run_ocr(img, args.lang, args.psm, args.min_conf)
        res.update({"text": text, "confidence": conf, "has_text": len(text) >= args.min_chars})
    except Exception as e:  # satu gambar gagal tidak boleh menghentikan yang lain
        res["error"] = f"{type(e).__name__}: {e}"
    return res


def to_markdown(page, results):
    out = [f"# Hasil OCR gambar", f"Halaman: {page}", ""]
    n = 0
    for r in results:
        if not r.get("has_text"):
            continue
        n += 1
        out.append(f"## Gambar {n}")
        out.append(f"- URL: {r['url'][:300]}")
        if r.get("alt"):
            out.append(f"- Alt: {r['alt']}")
        if r.get("caption"):
            out.append(f"- Keterangan: {r['caption']}")
        out.append(f"- Keyakinan OCR: {r['confidence']}%")
        out += ["", "```text", r["text"], "```", ""]
    if n == 0:
        out.append("(tidak ada gambar yang memuat teks terbaca)")
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description="Ekstrak gambar halaman berita + OCR untuk AI.")
    ap.add_argument("url", nargs="?", help="URL halaman berita")
    ap.add_argument("--file", help="HTML lokal (butuh --base)")
    ap.add_argument("--base", help="URL dasar untuk --file")
    ap.add_argument("--image", help="OCR satu gambar saja (path lokal atau URL)")
    ap.add_argument("--lang", default="ind+eng", help="bahasa Tesseract (default ind+eng)")
    ap.add_argument("--psm", type=int, default=3, help="page segmentation mode Tesseract")
    ap.add_argument("--min-conf", type=float, default=40, help="buang kata dengan keyakinan < ini")
    ap.add_argument("--min-chars", type=int, default=15, help="minimal karakter agar dianggap berteks")
    ap.add_argument("--min-size", type=int, default=120, help="sisi terpendek gambar (px)")
    ap.add_argument("--max-images", type=int, default=20)
    ap.add_argument("--no-filter", action="store_true", help="jangan saring ikon/logo/gambar kecil")
    ap.add_argument("--all", action="store_true", help="sertakan juga gambar tanpa teks")
    ap.add_argument("--format", choices=["json", "jsonl", "md"], default="json")
    args = ap.parse_args()

    if args.image:
        local = not args.image.startswith(("http://", "https://", "data:"))
        items = [{"url": args.image, "local": local}]
        page = args.image
    else:
        if args.file:
            if not args.base:
                ap.error("--file membutuhkan --base")
            html, page = open(args.file, encoding="utf-8", errors="replace").read(), args.base
        elif args.url:
            req = Request(args.url, headers={"User-Agent": UA})
            with urlopen(req, timeout=20) as r:
                charset = r.headers.get_content_charset() or "utf-8"
                html, page = r.read(MAX_BYTES).decode(charset, errors="replace"), r.geturl()
        else:
            ap.error("beri URL, --file, atau --image")
        items = collect_images(html, page, args.no_filter)[: args.max_images]

    hashes, results = set(), []
    for it in items:
        r = ocr_one(it, page, args, hashes)
        if args.all or r.get("has_text") or r.get("error"):
            results.append(r)

    if args.format == "md":
        print(to_markdown(page, results))
    elif args.format == "jsonl":
        for r in results:
            print(json.dumps(r, ensure_ascii=False))
    else:
        print(json.dumps({"page": page, "images_found": len(items),
                          "images_with_text": sum(1 for r in results if r.get("has_text")),
                          "results": results}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
