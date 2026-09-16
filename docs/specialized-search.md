# Orbis specialized search

Orbis searches the web one way and searches images, videos, news, maps, music, science, files and social media
another. The two are separate systems on purpose.

```
Orbis Search UI                      Orbis Search UI
      |                                    |
General/Web provider                 Specialized provider
      |                                    |
Existing web backend                 SearXNG (Orbis's own instance)
                                           |
                                     reviewed engines per category
                                           |
                                     normalized results
```

Web search does **not** go through SearXNG, and never should. Either side can be replaced, or be down, without the
other noticing: when the specialized service cannot be reached, categories say so and web search carries on.

## The pieces

| Where | What it is |
| --- | --- |
| `src/shared/searchProviders.ts` | What a category is, what a result of each kind holds, and how to read what comes back. Pure. |
| `src/main/search/specialized.ts` | `SearxngProvider`: the JSON API, timeouts, health, failure isolation. |
| `src/main/search.ts` | The general web provider. Untouched by any of this. |
| `src/main/specializedSearch.test.ts` | 16 tests, written against payloads the running service actually returned. |

The renderer asks for both through one channel, `search:run`; the main process routes `all` to web search and every
other category to the specialized provider.

## Categories

| Orbis | SearXNG category |
| --- | --- |
| Images | `images` |
| Videos | `videos` |
| News | `news` |
| Maps | `map` |
| Music | `music` |
| Science | `science` |
| Files | `files` |
| Social | `social media` |

## Running the service

SearXNG is AGPL-3.0 and is **not** vendored into this repository. It is obtained from the official repository and run
as a separate service:

```bash
git clone --depth 1 https://github.com/searxng/searxng.git
```

On Windows the checkout needs `utils/templates` excluded — four files there have `:` in their names, which Windows
cannot create. They are Apache/nginx deployment templates and are not needed to run it.

The Orbis configuration lives beside the clone, not inside it, and is pointed at with `SEARXNG_SETTINGS_PATH`:

```bash
SEARXNG_SETTINGS_PATH=/path/to/settings.yml SEARXNG_SECRET=<a real secret> python -m searx.webapp
```

Orbis finds it through `ORBIS_SEARCH_ENDPOINT`, defaulting to `http://127.0.0.1:8888` for development.

Nobody using Orbis configures any of this, and nobody using Orbis needs a search API key. The engines are configured
on the service.

## Which engines, and why those

Orbis is a commercial product, and SearXNG's own licence says nothing about the terms of the sites it queries. Every
engine was chosen on that basis: an official documented API, or an open corpus whose licence permits reuse with
attribution.

| Category | Enabled | Deliberately not |
| --- | --- | --- |
| Images | `openverse`, `wikicommons.images` | Google/Bing/DuckDuckGo/Startpage/Brave image scrapers |
| Videos | `peertube`, `wikicommons.videos` | `piped` — it reaches YouTube by a route YouTube does not sanction |
| News | `wikinews` | scrapers of other search engines' news tabs |
| Maps | `openstreetmap`, `photon` | — |
| Music | `bandcamp`, `wikicommons.audio` | — |
| Science | `arxiv`, `crossref`, `pubmed`, `openalex`, `semantic scholar`, `openairepublications`, `openairedatasets` | `google scholar` — automated querying is against Google's terms |
| Files | `wikicommons.files` | `library genesis` — it indexes pirated books |
| Social | `mastodon users`, `mastodon hashtags` | Reddit and X — their current terms do not permit this use |

Turning one of the right-hand column on is a licensing decision, not a configuration change.

Two consequences worth stating plainly:

- **News coverage is thin.** Wikinews is the only news source whose terms clearly permit this. The fix is a licensed
  news API, not switching on a scraper.
- **Maps needs self-hosting for volume.** OpenStreetMap data is ODbL and usable commercially with attribution, but the
  public Nominatim and Photon endpoints have usage policies that rule out production traffic. Point them at
  self-hosted instances before shipping.

## Licence obligations

SearXNG is **AGPL-3.0**. Orbis talks to it over HTTP as a separate service, so Orbis's own code is not a derivative
work and stays proprietary. But AGPL §13 applies to whoever *operates* the service: if the instance is modified,
its users must be offered that modified source. The engine configuration is part of what would have to be offered.

Nothing in the Orbis repository modifies SearXNG. The Windows `pwd` shim used for local development sits on
`PYTHONPATH` beside the clone rather than inside it, for the same reason.

Results are not Orbis's own content, are not presented as such, and carry the engine that found them (`via`) because
several of these sources ask to be credited.

## Security

The instance binds to `127.0.0.1` and is never exposed directly. Production puts an Orbis-controlled service layer in
front of it, which is what authenticates, rate limits and validates. SearXNG's own limiter stays on as a second door
(it needs Valkey and a Linux host; it cannot run on Windows, which is why local development turns it off).

Orbis does not store what people search for, and neither does the instance: metrics are off, and a search carries the
words and the category and nothing else — no identifier, no session, no profile.
