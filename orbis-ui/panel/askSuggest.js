// What Orion offers to do with the page in front of you, by what kind of page it is, and the questions already asked on it.
// Pure: nothing here touches the page or the network, so it can be tested without a browser.

const HOST = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}
const PATH = (url) => {
  try {
    return new URL(url).pathname.toLowerCase()
  } catch {
    return ''
  }
}

const SUMMARISE_VIDEO = { name: 'Summarize this video', prompt: 'Summarise this video from what the page says about it.' }
const TAKEAWAYS = { name: 'Extract key takeaways', prompt: 'List the key takeaways from this page.' }

/** Up to three site-aware offers. Empty for a page that is not a web page; the general choices cover that. */
export function suggestionsFor(url) {
  const host = HOST(url)
  if (!host) return []
  const path = PATH(url)
  if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
    return path.startsWith('/watch') || host === 'youtu.be'
      ? [SUMMARISE_VIDEO, TAKEAWAYS, { name: 'What is the comment section saying?', prompt: 'What are people saying in the comments on this video, as far as this page shows?' }]
      : [{ name: 'What is on this page?', prompt: 'What videos does this page offer, and what are they about?' }]
  }
  if (host === 'github.com' || host.endsWith('.github.com')) {
    return [
      { name: 'Explain this code', prompt: 'Explain what this code or repository does, in plain words.' },
      { name: 'What changed here?', prompt: 'What has changed on this page, and why does it matter?' },
      { name: 'How do I use this?', prompt: 'How would someone start using this? Use only what the page says.' }
    ]
  }
  if (/(^|\.)(amazon|flipkart|ebay|walmart|etsy|aliexpress|bestbuy)\./.test(host)) {
    return [
      { name: 'Compare prices', prompt: 'What does this page say about the price, and what else does it list that I could compare with?' },
      { name: 'What do reviews say?', prompt: 'What do the reviews on this page say, good and bad?' },
      { name: 'Is it worth it?', prompt: 'From what this page shows, what are the main strengths and weaknesses of this product?' }
    ]
  }
  if (/(^|\.)(wikipedia|britannica)\./.test(host) || /(^|\.)(medium|substack)\.com$/.test(host) || /\/(news|article|blog|post)s?\//.test(path)) {
    return [{ name: 'Summarise in 3 lines', prompt: 'Summarise this page in three short lines.' }, TAKEAWAYS, { name: 'What is missing?', prompt: 'What does this page leave out or not prove?' }]
  }
  if (/(^|\.)(stackoverflow|stackexchange|reddit)\.com$/.test(host)) {
    return [{ name: 'Best answer, plainly', prompt: 'What is the best answer on this page, in plain words?' }, { name: 'Where do people disagree?', prompt: 'Where do the answers or comments on this page disagree?' }]
  }
  if (/\.pdf$/.test(path) || /(^|\.)(arxiv|doi|nature|sciencedirect)\./.test(host)) {
    return [{ name: 'Explain the main result', prompt: 'What is the main result of this paper or document, in plain words?' }, { name: 'Method and limits', prompt: 'What method does this use, and what are its limits?' }]
  }
  return []
}

/** Which page a question belongs to: the address without the fragment and the usual tracking noise. */
export function historyKey(url) {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k)
    u.hash = ''
    return `orbis-ask:${u.origin}${u.pathname}${u.search}`
  } catch {
    return ''
  }
}

const KEEP = 5

/** Newest first, no repeats, at most five. */
export function remember(list, question) {
  const q = String(question ?? '').trim().slice(0, 200)
  if (!q) return list
  return [q, ...list.filter((x) => x !== q)].slice(0, KEEP)
}

export function readHistory(storage, key) {
  if (!key) return []
  try {
    const v = JSON.parse(storage.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, KEEP) : []
  } catch {
    return []
  }
}

export function writeHistory(storage, key, list) {
  if (!key) return
  try {
    storage.setItem(key, JSON.stringify(list.slice(0, KEEP)))
  } catch {
    /* storage may be full or denied; history is a convenience */
  }
}
