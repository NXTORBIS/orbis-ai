# Orbis UI inventory (where each Orbis surface lives in the browser)

| Surface | Lives in | Status |
| --- | --- | --- |
| Panel: Ask, Search, Blocking, Notes, Tasks, Workflows, Galaxy, Secrets | `chrome://orbis` (WebUI, `chrome/browser/ui/webui/orbis`, sources `orbis-ui/panel`), shown in the native side panel | Built in; live data from the helper |
| Ad blocking engine (network rules, page filtering, popups, statistics) | Component extension `resources/orbis_extension` (id gcaebck...), hidden from chrome://extensions | Built in as a component |
| New tab page | Component extension page `newtab.html` | Extension page until phase 2 (built-in chrome:// page) |
| Orbis Search results | Component extension page `results.html` | Extension page until phase 2 |
| Default search URL and its migration | Chromium patch `chromium-orbis-default-search.patch` | Updated in phase 2 with the results page |
| Sidebar / orb, Views restyle | not started | Phases 2 and 3 |
