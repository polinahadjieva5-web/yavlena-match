import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'

function norm(value: any) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function translit(value: string) {
  const map: Record<string, string> = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y',
    'к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u',
    'ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'
  }
  return norm(value).split('').map(ch => map[ch] ?? ch).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function get(url: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    return await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'bg-BG,bg;q=0.9' },
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  let cursor = 0
  const out: R[] = []
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) break
      try { out[index] = await fn(items[index]) } catch {}
    }
  })
  await Promise.all(workers)
  return out.filter(Boolean)
}

function strip(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|\u00a0/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function construction(text: string) {
  const value = norm(text)
  if (value.includes('тухла')) return 'Тухла'
  if (value.includes('панел')) return 'Панел'
  if (value.includes('епк')) return 'ЕПК'
  if (value.includes('гредоред')) return 'Гредоред'
  return null
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const deal = q.get('deal') || 'purchase'
  const propertyType = q.get('type') || ''
  const district = q.get('district') || ''
  const page = Math.max(1, Number(q.get('page') || 1))
  const priceMin = q.get('price_min') ? Number(q.get('price_min')) : null
  const priceMax = q.get('price_max') ? Number(q.get('price_max')) : null
  const areaMin = q.get('area_min') ? Number(q.get('area_min')) : null
  const areaMax = q.get('area_max') ? Number(q.get('area_max')) : null
  const wantedConstruction = (q.get('construction') || '').split(',').map(norm).filter(Boolean)

  if (!propertyType || !district) {
    return NextResponse.json({ ok: false, error: 'missing criteria' }, { status: 400 })
  }

  const base = deal === 'rent'
    ? 'https://www.alo.bg/obiavi/imoti-naemi/apartamenti-stai/'
    : 'https://www.alo.bg/obiavi/imoti-prodajbi/apartamenti-stai/'

  const params = new URLSearchParams({
    q: propertyType + ' ' + district,
    location_ids: '4342',
    region_id: '22'
  })
  if (page > 1) params.set('page', String(page))

  const response = await get(base + '?' + params.toString())
  if (!response.ok) {
    return NextResponse.json({ ok: false, error: 'ALO HTTP ' + response.status, items: [], has_more: false })
  }

  const html = await response.text()
  const typeSlug = translit(propertyType)
  const districtSlug = translit(district)

  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(match => match[1])
  const links = [...new Set(hrefs.filter(href => {
    const decoded = decodeURIComponent(href).toLowerCase()
    return decoded.startsWith('/' + typeSlug + '-sofiya-' + districtSlug + '-') && /-\d{5,}(?:#|$)/.test(decoded)
  }).map(href => 'https://www.alo.bg' + href.split('#')[0]))]

  const items = await pool(links, 8, async link => {
    const detail = await get(link)
    if (!detail.ok) return null as any

    const raw = await detail.text()
    const text = strip(raw)
    if (/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text)) return null as any

    const urlParts = link.match(/-([0-9]+(?:-[0-9]+)?)-kv-m-([0-9]+)-([0-9]+)$/i)
    const areaMatch = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/i)
    const priceMatch = text.match(/([0-9][0-9\s.]*)\s*(?:EUR|€)/i)

    const area = urlParts
      ? Number(urlParts[1].replace('-', '.'))
      : areaMatch ? Number(areaMatch[1].replace(',', '.')) : null

    const price = urlParts
      ? Number(urlParts[2])
      : priceMatch ? Number(priceMatch[1].replace(/[^0-9]/g, '')) : null

    if (priceMin != null && (price == null || price < priceMin)) return null as any
    if (priceMax != null && (price == null || price > priceMax)) return null as any
    if (areaMin != null && (area == null || area < areaMin)) return null as any
    if (areaMax != null && (area == null || area > areaMax)) return null as any

    const build = construction(text)
    if (wantedConstruction.length && build && !wantedConstruction.includes(norm(build))) return null as any

    const lower = norm(text)
    const advertiserType =
      /(частно лице|от собственик|собственик продава|директно от собственик|без агенция|без посредник)/i.test(lower)
        ? 'private'
        : /(агенция|брокер|недвижими имоти)/i.test(lower) ? 'agency' : 'unknown'

    const id = link.match(/-(\d{5,})$/)?.[1] || link
    const title = (raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || propertyType + ' · ' + district)
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

    return {
      id: 'alo:' + id,
      score: 100,
      status: 'new',
      created_at: new Date().toISOString(),
      offers: {
        id: 'alo:' + id,
        title,
        original_url: link,
        property_type: propertyType,
        deal_type: deal === 'rent' ? 'rent' : 'sale',
        district,
        price_eur: price,
        area_sqm: area,
        construction_type: build,
        advertiser_type: advertiserType,
        advertiser_name: null,
        is_active: true,
        offer_sources: { name: 'ALO.bg' }
      }
    }
  })

  const hasMore =
    new RegExp('[?&]page=' + (page + 1) + '(?:["&]|$)', 'i').test(html) ||
    (new RegExp('>\\s*' + (page + 1) + '\\s*<', 'i').test(html) && links.length > 0)

  return NextResponse.json({ ok: true, source: 'ALO.bg', page, items, has_more: hasMore })
}
