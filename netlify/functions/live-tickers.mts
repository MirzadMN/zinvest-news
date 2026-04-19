type TickerItem = {
  symbol: string
  price: string
  change: string
}

const toRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const pickFirst = (obj: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = obj[key]
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value
    }
  }
  return ''
}

const formatPrice = (value: unknown) => {
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    return numeric.toLocaleString('en-US', {
      maximumFractionDigits: 2,
    })
  }
  return String(value || '').trim()
}

const formatChange = (value: unknown) => {
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return ''
    if (text.includes('%')) return text.startsWith('+') || text.startsWith('-') ? text : `+${text}`
    const numericText = Number(text)
    if (Number.isFinite(numericText)) return `${numericText >= 0 ? '+' : ''}${numericText.toFixed(2)}%`
    return text
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''

  const percent = Math.abs(numeric) <= 1 ? numeric * 100 : numeric
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`
}

const findTickerArray = (payload: unknown): unknown[] => {
  if (Array.isArray(payload)) return payload

  const root = toRecord(payload)
  const candidates = [
    root.tickers,
    root.quotes,
    root.data,
    root.items,
    root.results,
    toRecord(root.quoteResponse).result,
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }

  return []
}

const normalizeTickers = (payload: unknown): TickerItem[] =>
  findTickerArray(payload)
    .map((row) => {
      const item = toRecord(row)
      const symbol = String(pickFirst(item, ['symbol', 'ticker', 'code', 'id'])).trim()
      const priceRaw = pickFirst(item, ['price', 'regularMarketPrice', 'last', 'lastPrice', 'current', 'close', 'c'])
      const changeRaw = pickFirst(item, [
        'changePercent',
        'regularMarketChangePercent',
        'percent_change',
        'change_percentage',
        'change',
        'd',
      ])

      const price = formatPrice(priceRaw)
      const change = formatChange(changeRaw)

      if (!symbol || !price || !change) return null
      return { symbol, price, change }
    })
    .filter((item): item is TickerItem => Boolean(item))

const withOptionalCredentials = (urlValue: string, req: Request) => {
  const url = new URL(urlValue)
  const apiKey = Netlify.env.get('LIVE_TICKER_API_KEY') || Netlify.env.get('TICKER_API_KEY') || ''
  const apiKeyHeader =
    Netlify.env.get('LIVE_TICKER_API_KEY_HEADER') || Netlify.env.get('TICKER_API_KEY_HEADER') || ''
  const apiKeyQuery = Netlify.env.get('LIVE_TICKER_API_KEY_QUERY') || Netlify.env.get('TICKER_API_KEY_QUERY') || ''

  const headers = new Headers({
    accept: 'application/json',
    'user-agent': 'zinvest-live-ticker-proxy',
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
  const apiUrl = Netlify.env.get('LIVE_TICKER_API_URL') || Netlify.env.get('TICKER_API_URL')
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
    const maxItems = Number(Netlify.env.get('LIVE_TICKER_MAX_ITEMS') || '20')
    const items = normalizeTickers(payload).slice(0, Number.isFinite(maxItems) ? maxItems : 20)

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
