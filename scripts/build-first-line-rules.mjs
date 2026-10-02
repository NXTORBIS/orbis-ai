/**
 * Builds the first-line ruleset: the few hundred rules that have to be live before anything is fetched.
 *
 * Measured cause of the unprotected window: Chromium indexes ~114,000 static rules before any of them bite, and that
 * takes seconds on every launch, warm profile or not. A ruleset of a few hundred rules indexes in milliseconds, and
 * Chromium indexes rulesets independently -- so a small one is enforcing while the big ones are still being read.
 *
 * It is deliberately a *subset*, not a different opinion. Every rule here blocks a domain the full lists already
 * block, so nothing is blocked earlier that would not have been blocked a second later. The only thing that changes
 * is when.
 *
 * The domains are the ones that actually carry advertising and tracking at scale -- the ones a page reaches for in its
 * first few requests. Chosen by hand rather than by frequency in the lists, because the lists are full of long-tail
 * domains that will never be hit in the first second of a page load.
 */
import { readFileSync, writeFileSync } from 'node:fs'

// Run from the project root: node scripts/build-first-line-rules.mjs

/**
 * The domains worth stopping in the first millisecond.
 *
 * Every one is a third-party advertising, analytics or tracking endpoint. None is a CDN that also serves content, and
 * none is a first-party domain -- a mistake there would break a site rather than merely fail to block an ad, and this
 * ruleset is the one that runs before anything can be checked.
 */
const DOMAINS = [
  // Google's advertising and measurement
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com', 'google-analytics.com', 'googletagmanager.com',
  'googletagservices.com', 'adservice.google.com', 'pagead2.googlesyndication.com', 'securepubads.g.doubleclick.net',
  '2mdn.net', 'app-measurement.com',
  // The large exchanges and supply-side platforms
  'adnxs.com', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'criteo.com', 'criteo.net',
  'casalemedia.com', 'smartadserver.com', 'sharethrough.com', 'districtm.io', 'bidswitch.net', '33across.com',
  'media.net', 'indexww.com', 'sovrn.com', 'lijit.com', 'gumgum.com', 'triplelift.com', 'spotxchange.com',
  'teads.tv', 'improvedigital.com', 'adform.net', 'yieldmo.com', 'onetag-sys.com', 'rfihub.com', 'adkernel.com',
  // Content recommendation widgets
  'taboola.com', 'outbrain.com', 'zemanta.com', 'revcontent.com', 'mgid.com', 'adblade.com',
  // Analytics and session recording
  'scorecardresearch.com', 'quantserve.com', 'quantcast.com', 'hotjar.com', 'hotjar.io', 'mouseflow.com',
  'fullstory.com', 'crazyegg.com', 'luckyorange.com', 'inspectlet.com', 'clicktale.net', 'mixpanel.com',
  'segment.io', 'segment.com', 'amplitude.com', 'heap.io', 'heapanalytics.com', 'kissmetrics.com',
  'chartbeat.com', 'chartbeat.net', 'parsely.com', 'newrelic.com', 'nr-data.net', 'bugsnag.com',
  'branch.io', 'appsflyer.com', 'adjust.com', 'kochava.com', 'singular.net',
  // Social tracking pixels
  'connect.facebook.net', 'facebook.com/tr', 'ads-twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com',
  'ads.linkedin.com', 'px.ads.linkedin.com', 'snap.licdn.com', 'analytics.tiktok.com', 'ads.tiktok.com',
  'bat.bing.com', 'ads.pinterest.com', 'ct.pinterest.com', 'analytics.snapchat.com', 'sc-static.net',
  // Consent and anti-adblock walls, and the remaining common ad servers
  'adsafeprotected.com', 'moatads.com', 'doubleverify.com', 'ias.net', 'eyeota.net', 'crwdcntrl.net',
  'bluekai.com', 'demdex.net', 'everesttech.net', 'omtrdc.net', 'adobedtm.com', 'rlcdn.com', 'agkn.com',
  'tapad.com', 'addthis.com', 'sharethis.com', 'optimizely.com', 'onesignal.com', 'pushengage.com',
  'propellerads.com', 'popads.net', 'adcash.com', 'exoclick.com', 'juicyads.com', 'trafficjunky.com',
  'zedo.com', 'adroll.com', 'yieldlab.net', 'stroeerdigitalgroup.de', 'ad-delivery.net', 'adsco.re',
  'servenobid.com', 'contextweb.com', 'gammaplatform.com', 'themoneytizer.com', 'videoo.tv'
]

/** Paths that are advertising wherever they appear, for the scripts a page inlines rather than fetches by domain. */
const PATHS = [
  '/ads.js', '/adsbygoogle.js', '/analytics.js', '/gtag/js', '/gtm.js', '/fbevents.js', '/beacon.js',
  '/pixel.js', '/track.js', '/tracking.js', '/prebid.js', '/outbrain.js', '/taboola.js'
]

const rules = []
let id = 1

/*
 * Third-party only, matching the full lists' own habit.
 *
 * A site serving its own analytics from its own domain is a different decision from a third party tracking somebody
 * across sites, and blocking the first breaks pages. The big lists make the same distinction; this subset keeps it.
 */
for (const domain of DOMAINS) {
  rules.push({
    id: id++,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: `||${domain}`, isUrlFilterCaseSensitive: false, domainType: 'thirdParty' }
  })
}

for (const path of PATHS) {
  rules.push({
    id: id++,
    priority: 1,
    action: { type: 'block' },
    condition: { urlFilter: `${path}|`, isUrlFilterCaseSensitive: false, domainType: 'thirdParty', resourceTypes: ['script'] }
  })
}

const out = 'extension/adblock/rules/first-line.json'
writeFileSync(out, `${JSON.stringify(rules, null, 0)}\n`, 'utf8')

// Every rule here must already be covered by the full lists, or this is blocking something new rather than earlier.
const full = [
  ...JSON.parse(readFileSync('extension/adblock/rules/ads.json', 'utf8')),
  ...JSON.parse(readFileSync('extension/adblock/rules/trackers.json', 'utf8'))
]
const covered = new Set(full.map((r) => String(r.condition?.urlFilter ?? '').toLowerCase()))
const novel = DOMAINS.filter((d) => !covered.has(`||${d}`.toLowerCase()))

console.log(`wrote ${rules.length} rules to ${out}`)
console.log(`domains: ${DOMAINS.length}, paths: ${PATHS.length}`)
console.log(`not already in the full lists by exact filter: ${novel.length}`)
if (novel.length) console.log(`  ${novel.slice(0, 12).join(', ')}${novel.length > 12 ? ' …' : ''}`)
