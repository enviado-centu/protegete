// Known malicious/aggressive ad-network hostnames (Feature C, page signal
// `malvertising`). Pure lookup, no network access, no page content read.

const NETWORK_HOSTS = [
  'popads.net',
  'popcash.net',
  'propellerads.com',
  'adsterra.com',
  'monetag.com',
  'hilltopads.net',
  'exoclick.com',
  'juicyads.com',
  'onclickads.net',
  'clickadu.com',
  'adcash.com',
  'trafficjunky.net',
  'a-ads.com',
  'richpartners.co',
  'galaksion.com',
  'admaven.com',
  'pushground.com',
  'evadav.com',
  'rollerads.com',
  'zeropark.com',
  'highperformanceformat.com',
  'profitablegatecpm.com',
]

const POPUNDER_SUBSTRING = 'popunder'

/**
 * Returns the matched network name when `hostname` is (or is a subdomain
 * of) a known malvertising network host, or contains the `popunder`
 * substring (returned as `"popunder"`). Case-insensitive. Returns `null`
 * when nothing matches.
 */
export function matchMalvertisingHost(hostname: string): string | null {
  const host = hostname.toLowerCase()

  for (const network of NETWORK_HOSTS) {
    if (host === network || host.endsWith(`.${network}`)) {
      return network
    }
  }

  if (host.includes(POPUNDER_SUBSTRING)) {
    return POPUNDER_SUBSTRING
  }

  return null
}
