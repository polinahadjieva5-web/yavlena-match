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
  let lastError: any = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      return await fetch(url, {
        headers: { 'user-agent': UA, 'accept-language': 'bg-BG,bg;q=0.9' },
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal
      })
    } catch (e:any) {
      lastError = e
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * attempt))
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('ALO fetch failed')
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

  const cards = links.map(link => {
    const urlParts = link.match(/-([0-9]+(?:-[0-9]+)?)-kv-m-([0-9]+)-([0-9]+)$/i)
    const area = urlParts ? Number(urlParts[1].replace('-', '.')) : null
    const price = urlParts ? Number(urlParts[2]) : null
    const id = urlParts?.[3] || link.match(/-(\d{5,})$/)?.[1] || link
    return { link, area, price, id }
  }).filter(card => {
    if (priceMin != null && card.price != null && card.price < priceMin) return false
    if (priceMax != null && card.price != null && card.price > priceMax) return false
    if (areaMin != null && card.area != null && card.area < areaMin) return false
    if (areaMax != null && card.area != null && card.area > areaMax) return false
    return true
  })

  let detailSuccess = 0
  let listFallback = 0

  const items = await pool(cards, 8, async card => {
    let raw = ''
    let text = ''
    let detailOk = false

    try {
      const detail = await get(card.link)
      if (detail.status === 404 || detail.status === 410) return null as any
      if (detail.ok) {
        raw = await detail.text()
        text = strip(raw)
        if (/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text)) return null as any
        detailOk = true
        detailSuccess++
      }
    } catch {}

    const areaMatch = detailOk ? text.match(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/i) : null
    const priceMatch = detailOk ? text.match(/([0-9][0-9\s.]*)\s*(?:EUR|€)/i) : null
    const area = card.area ?? (areaMatch ? Number(areaMatch[1].replace(',', '.')) : null)
    const price = card.price ?? (priceMatch ? Number(priceMatch[1].replace(/[^0-9]/g, '')) : null)

    if (priceMin != null && (price == null || price < priceMin)) return null as any
    if (priceMax != null && (price == null || price > priceMax)) return null as any
    if (areaMin != null && (area == null || area < areaMin)) return null as any
    if (areaMax != null && (area == null || area > areaMax)) return null as any

    const build = detailOk ? construction(text) : null
    if (wantedConstruction.length && build && !wantedConstruction.includes(norm(build))) return null as any

    let advertiserType = 'unknown'
    if (detailOk) {
      const lower = norm(text)
      advertiserType = /(?:агенция(?:та)?\s+(?:за\s+недвижими\s+имоти\s+)?(?:предлага|представя|продава|отдава)|брокер(?:ът)?\s+(?:предлага|представя)|нашата\s+агенция|оферта\s+на\s+агенция)/i.test(lower) ? 'agency' : /(?:аз\s+съм\s+собственик|собственик\s+съм|собственик\s+(?:продава|отдава)|(?:директно|лично)\s+от\s+собственик|(?:продавам|отдавам)\s+лично|частно\s+лице\s+(?:продава|отдава))/i.test(lower) ? 'private' : 'unknown'
    } else {
      listFallback++
    }

    const title = detailOk
      ? (raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || propertyType + ' · ' + district)
          .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      : propertyType + ' · ' + district

    return {
      id: 'alo:' + card.id,
      score: 100,
      status: 'new',
      created_at: new Date().toISOString(),
      offers: {
        id: 'alo:' + card.id,
        title,
        description: detailOk ? text.slice(0,6000) : null,
        original_url: card.link,
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

  return NextResponse.json({ ok: true, source: 'ALO.bg', page, items, has_more: hasMore, raw_count: links.length, candidate_count: cards.length, detail_success: detailSuccess, list_fallback: listFallback, page_signature: links.slice(0,12).join('|') })
}
