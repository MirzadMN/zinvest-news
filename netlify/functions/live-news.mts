type NewsItem = {
  title: string
  body: string
  source: string
  url?: string
  publishedAt?: string
}

const pickFirstString = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const findNewsArray = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload

  const root = toRecord(payload)
  const candidates = [
    root.articles,
    root.news,
    root.results,
    root.data,
    root.items,
    toRecord(root.response).docs,
    root.feed,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

const normalizeNews = (payload: unknown): NewsItem[] =>
  findNewsArray(payload)
    .map((row) => {
      const item = toRecord(row)
      const source = toRecord(item.source)
      const title = pickFirstString(item, ['title', 'headline', 'name'])
      const body = pickFirstString(item, [
        'description',
        'summary',
        'content',
        'body',
        'text',
        'snippet',
      ])

      if (!title || !body) return null

      return {
        title,
        body,
        source: pickFirstString(item, ['source', 'publisher']) || pickFirstString(source, ['name']) || 'Live feed',
        url: pickFirstString(item, ['url', 'link', 'web_url']),
        publishedAt: pickFirstString(item, ['publishedAt', 'pubDate', 'datetime', 'created_at', 'date']),
      }
    })
    .filter((item): item is NewsItem => Boolean(item))

const withOptionalCredentials = (urlValue: string, req: Request) => {
  const url = new URL(urlValue)
  const apiKey = Netlify.env.get('LIVE_NEWS_API_KEY') || Netlify.env.get('NEWS_API_KEY') || ''
  const apiKeyHeader = Netlify.env.get('LIVE_NEWS_API_KEY_HEADER') || Netlify.env.get('NEWS_API_KEY_HEADER') || ''
  const apiKeyQuery = Netlify.env.get('LIVE_NEWS_API_KEY_QUERY') || Netlify.env.get('NEWS_API_KEY_QUERY') || ''

  const headers = new Headers({
    accept: 'application/json',
    'user-agent': 'zinvest-live-news-proxy',
  })

  if (apiKey && apiKeyHeader) {
    headers.set(apiKeyHeader, apiKey)
  }

  if (apiKey && apiKeyQuery) {
    url.searchParams.set(apiKeyQuery, apiKey)
  }

  const forwardedAuth = req.headers.get('authorization')
  if (forwardedAuth && !headers.has('authorization')) {
    headers.set('authorization', forwardedAuth)
  }

  return { url, headers }
}

export default async (req: Request) => {
  const apiUrl = Netlify.env.get('LIVE_NEWS_API_URL') || Netlify.env.get('NEWS_API_URL')
  if (!apiUrl) {
    return Response.json({ items: [] }, { status: 503 })
  }

  try {
    const { url, headers } = withOptionalCredentials(apiUrl, req)
    const apiRes = await fetch(url.toString(), { headers })
    if (!apiRes.ok) {
      return Response.json({ items: [] }, { status: 502 })
    }

    const payload = await apiRes.json()
    const maxItems = Number(Netlify.env.get('LIVE_NEWS_MAX_ITEMS') || '12')
    const items = normalizeNews(payload).slice(0, Number.isFinite(maxItems) ? maxItems : 12)

    return Response.json(
      { items },
      {
        headers: {
          'cache-control': 'no-store',
        },
      },
    )
  } catch {
    return Response.json({ items: [] }, { status: 500 })
  }
}
