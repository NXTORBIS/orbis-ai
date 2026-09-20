// The Orbis new-tab page. It is the real first page of a real Chromium tab (Chromium's own chrome_url_overrides mechanism),
// loads entirely from the extension, and asks nothing of any website. Everything shown comes from the browser itself:
// the search goes through Chromium's default search provider, and the tiles are Chromium's own most-visited list.

const $ = (id) => document.getElementById(id)

function greet() {
  const h = new Date().getHours()
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}
function tick() {
  const now = new Date()
  $('greeting').textContent = greet()
  $('clock').textContent = now.toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit', month: 'long', day: 'numeric' })
}
tick()
setInterval(tick, 30_000)

// Enter searches or navigates the way the address bar does: something that is clearly an address goes there, anything else
// is a search with the person's own default search engine (chrome.search).
function looksLikeUrl(text) {
  if (/\s/.test(text)) return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return text
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/.*)?$/i.test(text)) return `http://${text}`
  if (/^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text)) return `https://${text}`
  return null
}
$('search').addEventListener('submit', (e) => {
  e.preventDefault()
  const text = $('q').value.trim()
  if (!text) return
  const url = looksLikeUrl(text)
  if (url) location.href = url
  else chrome.search.query({ text, disposition: 'CURRENT_TAB' })
})

async function sites() {
  try {
    const top = await chrome.topSites.get()
    const nav = $('sites')
    // Chromium seeds the list with a Chrome Web Store tile before anything has been visited; that is Google's, not the person's.
    for (const s of top.filter((t) => !/^https:\/\/chrome(web)?store\.google\.com\//.test(t.url)).slice(0, 8)) {
      let host = s.url
      try { host = new URL(s.url).hostname.replace(/^www\./, '') } catch { /* keep the raw address */ }
      const a = document.createElement('a')
      a.className = 'site'
      a.href = s.url
      const ico = document.createElement('div')
      ico.className = 'ico'
      const img = document.createElement('img')
      img.alt = ''
      img.src = `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(s.url)}&size=32`
      ico.append(img)
      const label = document.createElement('span')
      label.textContent = s.title || host
      a.append(ico, label)
      nav.append(a)
    }
  } catch { /* no history yet: the page is simply the logo and the search box */ }
}
void sites()
