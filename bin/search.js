/**
 * @fileoverview Web search integration
 *
 * @module search
 */
'use strict';

// Provider pencarian web. Yang tanpa API key bisa langsung dipakai (publik);
// yang ber-API-key butuh konfigurasi.

const KNOWN = {
  duckduckgo: { label: 'DuckDuckGo', key: false },
  wikipedia: { label: 'Wikipedia', key: false },
  tavily: { label: 'Tavily', key: true },
  firecrawl: { label: 'Firecrawl', key: true },
};

function websearchDefaults() {
  return { enabled: false, provider: 'duckduckgo', apiKeys: {}, maxPerRun: 5, custom: [] };
}

function knownProviders() {
  return Object.keys(KNOWN);
}

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } finally {
    clearTimeout(t);
  }
}

function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, '\'')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function duckduckgo(query, limit) {
  // 1) HTML scraping (header browser penuh; DDG sensitif terhadap bot)
  try {
    const res = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query) + '&kl=us-en', {
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (res.ok) {
      const html = await res.text();
      const aRe = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
      const sRe = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/g;
      const titles = [...html.matchAll(aRe)];
      const snippets = [...html.matchAll(sRe)];
      const results = [];
      for (let i = 0; i < titles.length && results.length < limit; i++) {
        const title = stripHtml(titles[i][2]);
        const urlRaw = titles[i][1];
        const m = /uddg=([^&]+)/.exec(urlRaw);
        results.push({ title, url: m ? decodeURIComponent(m[1]) : urlRaw, snippet: stripHtml((snippets[i] || ['', ''])[1]) });
      }
      if (results.length) return results;
    }
  } catch {}
  // 2) DuckDuckGo Instant Answer API (publik, tanpa scraping)
  try {
    const data = await fetchJson(
      'https://api.duckduckgo.com/?q=' + encodeURIComponent(query) + '&format=json&no_html=1&skip_disambig=1'
    );
    const out = [];
    if (data && data.Heading) out.push({ title: String(data.Heading), url: data.AbstractURL || '', snippet: data.Abstract || data.Answer || '' });
    const pushTopic = (t) => {
      if (!t || typeof t === 'string') return;
      if (Array.isArray(t.Topics)) {
        for (const s of t.Topics) {
          if (pushTopic(s)) return;
        }
        return;
      }
      if (t.Text) {
        out.push({ title: String(t.Text).slice(0, 64), url: t.FirstURL || '', snippet: String(t.Text) });
        return true;
      }
    };
    for (const t of (data && data.RelatedTopics) || []) pushTopic(t);
    if (out.length) return out.slice(0, limit);
  } catch {}
  return [];
}

async function wikipedia(query, limit) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' +
    encodeURIComponent(query) +
    '&srlimit=' +
    Math.min(limit, 10) +
    '&utf8=1&format=json';
  const data = await fetchJson(url);
  const items = (data && data.query && data.query.search) || [];
  return items.slice(0, limit).map((s) => ({
    title: s.title,
    url: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(s.title.replace(/\s+/g, '_')),
    snippet: stripHtml(s.snippet),
  }));
}

async function tavily(query, limit, apiKey) {
  const data = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, search_depth: 'basic', max_results: Math.min(limit, 10), include_answer: false }),
  });
  const items = (data && data.results) || [];
  return items.slice(0, limit).map((r) => ({ title: r.title || '', url: r.url || '', snippet: r.content || r.raw_content || '' }));
}

async function firecrawl(query, limit, apiKey) {
  const data = await fetchJson('https://api.firecrawl.dev/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({ query, limit: Math.min(limit, 10) }),
  });
  const items = (data && data.data) || [];
  return items.slice(0, limit).map((r) => ({ title: r.title || '', url: r.url || '', snippet: stripHtml(r.description || '') }));
}

// mencari melalui provider known/custom; custom didefinisikan di config.websearch.custom
// [{ name, baseUrl, key:bool(action API), headers, url(query) method, jsonPath?, items... }]
async function searchWebOne(provider, query, opts = {}) {
  const limit = Math.max(1, Math.min(opts.limit || 5, 10));
  const apiKeys = opts.apiKeys || {};
  const custom = opts.custom || [];
  const name = String(provider || 'duckduckgo');
  if (name === 'duckduckgo') return duckduckgo(query, limit);
  if (name === 'wikipedia') return wikipedia(query, limit);
  if (name === 'tavily') return tavily(query, limit, apiKeys.tavily || '');
  if (name === 'firecrawl') return firecrawl(query, limit, apiKeys.firecrawl || '');
  const c = custom.find((p) => p && p.name === name);
  if (!c) throw new Error(`Provider pencarian tidak dikenal: ${name}`);
  if (!c.endpoint) throw new Error(`Provider custom '${name}' tidak punya endpoint.`);
  const url = typeof c.url === 'function' ? c.url(query) : String(c.endpoint).replace('{query}', encodeURIComponent(query));
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    Array.isArray(c.headers) ? c.headers.reduce((a, h) => Object.assign(a, h), {}) : c.headers || {}
  );
  const body = c.body && typeof c.body === 'function' ? c.body(query, limit) : c.body;
  const method = (c.method || 'GET').toUpperCase();
  const data = await fetchJson(url, method === 'GET' ? { headers } : { method, headers, body: body ? JSON.stringify(body) : undefined });
  const jp = (o, path) => {
    if (!path) return o;
    let v = o;
    for (const k of String(path).split('.')) v = v && v[k];
    return v;
  };
  const arr = Array.isArray(data) ? data : jp(data, c.jsonPath) || [];
  return (Array.isArray(arr) ? arr : []).slice(0, limit).map((r) => ({
    title: String((c.title != null ? jp(r, c.title) : r.title) || ''),
    url: String((c.urlField != null ? jp(r, c.urlField) : r.url) || ''),
    snippet: String((c.snippet != null ? jp(r, c.snippet) : r.content || r.snippet || r.description || '') || ''),
  }));
}

function isNetErr(e) {
  return /fetch failed|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|timed out/i.test(String((e && e.message) || ''));
}

async function searchWeb(provider, query, opts = {}) {
  try {
    return await searchWebOne(provider, query, opts);
  } catch (e) {
    if (!isNetErr(e)) throw e;
    // retry sekali untuk error jaringan yang kadang sementara
    await new Promise((r) => setTimeout(r, 600));
    return await searchWebOne(provider, query, opts);
  }
}

function publicProviders() {
  return Object.keys(KNOWN).filter((k) => !KNOWN[k].key);
}

module.exports = { KNOWN, websearchDefaults, knownProviders, publicProviders, searchWeb };
