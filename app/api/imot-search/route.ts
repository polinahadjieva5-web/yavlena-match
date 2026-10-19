import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm = (v:any) => String(v || '').toLowerCase().replace(/\s+/g,' ').trim()

const TYPE_SLUGS:Record<string,string>={
  '1-стаен':'ednostaen','2-стаен':'dvustaen','3-стаен':'tristaen','4-стаен':'chetiristaen',
  'Многостаен':'mnogostaen','Мезонет':'mezonet','Къща':'kashta','Вила':'vila',
  'Парцел':'partsel','Гараж':'garazh','Офис':'ofis','Магазин':'magazin'
}

function translit(value:string){
  const map:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'}
  return norm(value).split('').map(x=>map[x]??x).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}

async function get(url:string, timeout=12000){
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeout)
  try{
    return await fetch(url,{
      headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9','referer':'https://www.imot.bg/'},
      cache:'no-store',redirect:'follow',signal:controller.signal
    })
  }finally{clearTimeout(timer)}
}

async function readImot(response:Response){
  const bytes=await response.arrayBuffer()
  const utf=new TextDecoder().decode(bytes)
  if(/[А-Яа-я]/.test(utf))return utf
  try{return new TextDecoder('windows-1251').decode(bytes)}catch{return utf}
}

async function pool<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>){
  let cursor=0
  const out:R[]=[]
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const index=cursor++
      if(index>=items.length)break
      try{out[index]=await fn(items[index])}catch{}
    }
  }))
  return out.filter(Boolean)
}

function strip(html:string){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;|\u00a0/g,' ')
    .replace(/\s+/g,' ')
    .trim()
}

function numberValue(value:string|undefined|null){
  if(!value)return null
  const cleaned=value.replace(/\u00a0/g,' ').replace(/[^0-9,.]/g,'').replace(',','.')
  const n=Number(cleaned)
  return Number.isFinite(n)?n:null
}

function cardPrice(snippet:string){
  const patterns=[
    /<div class=["']price[^"']*["'][^>]*>\s*<div[^>]*>\s*([0-9][0-9\s.]*)/i,
    /([0-9][0-9\s.]*)\s*€/i,
    /([0-9][0-9\s.]*)\s*EUR/i
  ]
  for(const re of patterns){
    const m=snippet.match(re)
    if(m){
      const n=Number(m[1].replace(/[^0-9]/g,''))
      if(Number.isFinite(n)&&n>=1000&&n<=50000000)return n
    }
  }
  return null
}

function cardArea(snippet:string){
  const matches=[...strip(snippet).matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*(?:m2|m²|кв\.?\s*м)/gi)]
    .map(m=>Number(m[1].replace(',','.')))
    .filter(v=>v>=10&&v<=5000)
  return matches.length?matches[0]:null
}

function construction(text:string){
  const x=norm(text)
  if(x.includes('тухла'))return'Тухла'
  if(x.includes('панел'))return'Панел'
  if(x.includes('епк'))return'ЕПК'
  if(x.includes('гредоред'))return'Гредоред'
  return null
}

export async function GET(req:NextRequest){
  const q=req.nextUrl.searchParams
  const deal=q.get('deal')||'purchase'
  const propertyType=q.get('type')||''
  const district=q.get('district')||''
  const page=Math.max(1,Number(q.get('page')||1))
  const priceMin=q.get('price_min')?Number(q.get('price_min')):null
  const priceMax=q.get('price_max')?Number(q.get('price_max')):null
  const areaMin=q.get('area_min')?Number(q.get('area_min')):null
  const areaMax=q.get('area_max')?Number(q.get('area_max')):null
  const wantedConstruction=(q.get('construction')||'').split(',').map(norm).filter(Boolean)

  const typeSlug=TYPE_SLUGS[propertyType]||''
  if(!propertyType||!district||!typeSlug){
    return NextResponse.json({ok:true,source:'Imot.bg',page,items:[],has_more:false,raw_count:0})
  }

  const root='https://www.imot.bg/obiavi/'+(deal==='rent'?'naemi':'prodazhbi')+'/grad-sofiya/'+translit(district)+'/'+typeSlug
  const listUrl=root+(page>1?'/p-'+page:'')
  const listResponse=await get(listUrl)
  if(!listResponse.ok){
    return NextResponse.json({ok:false,error:'Imot HTTP '+listResponse.status,items:[],has_more:false,raw_count:0})
  }

  const html=await readImot(listResponse)
  const rawLinks=[...html.matchAll(/href=["']((?:https?:)?\/\/(?:www\.)?imot\.bg\/obiava-[^"']+|\/obiava-[^"']+)["']/gi)]
    .map(m=>new URL(m[1].split('#')[0],'https://www.imot.bg').toString())
  const links=[...new Set(rawLinks)]

  const cards=links.map(link=>{
    const protocolRelative=link.replace(/^https:/,'')
    let pos=html.indexOf(protocolRelative)
    if(pos<0)pos=html.indexOf(link)
    if(pos<0)pos=html.indexOf(link.replace(/^https?:\/\/(?:www\.)?imot\.bg/i,''))
    const snippet=pos>=0?html.slice(Math.max(0,pos-1800),pos+5200):''
    return {link,snippet,price:cardPrice(snippet),area:cardArea(snippet)}
  })
  // Do not prefilter by an adjacent card's price/area. A broad HTML snippet
  // can contain the previous listing, hiding valid private listings.

  let detailSuccess=0
  let listFallback=0

  const items=await pool(cards,8,async card=>{
    let raw=''
    let text=''
    let detailOk=false

    try{
      const detail=await get(card.link,10000)
      if(detail.status===404||detail.status===410)return null as any
      if(detail.ok){
        raw=await readImot(detail)
        text=strip(raw)
        if(/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text))return null as any
        detailOk=true
        detailSuccess++
      }
    }catch{
      detailOk=false
    }

    const detailPriceMatch=raw.match(/showpricechange\([^)]*?'([0-9]{4,})','EUR'/i)
    const detailPrice=detailPriceMatch?Number(detailPriceMatch[1]):null
    const effectivePrice=detailPrice??card.price

    const detailAreas=text
      ? [...text.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*(?:m2|m²|кв\.?\s*м)/gi)]
          .map(m=>Number(m[1].replace(',','.')))
          .filter(v=>v>=10&&v<=5000)
      : []
    // Imot.bg prints the current listing's structured floor area after "Площ:".
    // Generic matches over the entire page may refer to advertised similar properties.
    const labeledArea=text.match(/(?:^|\s)Площ\s*:\s*([0-9]{1,4}(?:[.,][0-9]+)?)\s*(?:m\s*(?:2|²)|кв\.?\s*м)/i)
    const effectiveArea=labeledArea?Number(labeledArea[1].replace(',','.')):(detailAreas.length?detailAreas[0]:card.area)

    if(priceMin!=null&&(effectivePrice==null||effectivePrice<priceMin))return null as any
    if(priceMax!=null&&(effectivePrice==null||effectivePrice>priceMax))return null as any
    if(areaMin!=null&&(effectiveArea==null||effectiveArea<areaMin))return null as any
    if(areaMax!=null&&(effectiveArea==null||effectiveArea>areaMax))return null as any

    const build=detailOk?construction(text):null
    if(wantedConstruction.length&&build&&!wantedConstruction.includes(norm(build)))return null as any

    let advertiserType='unknown'
    let advertiserName:string|null=null
    if(detailOk){
      // Only the listing's seller/contact section can establish the publisher type.
      // Do not use generic site navigation or unrelated "agency" descriptions.
      const header=text.slice(0,1800)
      const contactAt=text.search(/За\s+контакт\s*:/i)
      const contactSection=contactAt>=0?text.slice(contactAt,contactAt+1650):''
      const publishedAsPrivate=/\/\s*Частно\s+лице\s*\//i.test(contactSection) ||
        /Площ\s*:\s*[0-9,.]+\s*(?:кв\.?\s*м|m[²2])\s*,?\s*Частно\s+лице/i.test(header)
      const publishedAsAgency=/\bАгенция\s*:/i.test(contactSection) ||
        /\bБрокер\s*:/i.test(contactSection) ||
        /Площ\s*:\s*[0-9,.]+\s*(?:кв\.?\s*м|m[²2])\s*,?\s*Агенция/i.test(header) ||
        /Имотът\s+се\s+предлага\s+от\s*:\s*Агенция/i.test(header)
      const dealer=raw.match(/<div class=["']dealer["'][\s\S]*?<\/div>\s*<\/div>/i)?.[0]||''
      advertiserName=dealer.match(/<div class=["']name["']>([^<]+)<\/div>/i)?.[1]?.trim()||
        contactSection.match(/Агенция\s*:\s*([^\n]{3,90})/i)?.[1]?.trim()||null
      // Prioritize the site's explicit "Частно лице" marker over unrelated dealer widgets.
      advertiserType=publishedAsPrivate?'private':publishedAsAgency||dealer?'agency':'unknown'
    }else{
      listFallback++
    }

    const id=card.link.match(/obiava-([^-]+)/)?.[1]||card.link
    const title=detailOk
      ? (raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||propertyType+' · '+district)
          .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
      : propertyType+' · '+district

    return {
      id:'imot:'+id,
      score:100,
      status:'new',
      created_at:new Date().toISOString(),
      offers:{
        id:'imot:'+id,
        title,
        description:detailOk?text.slice(0,6000):null,
        original_url:card.link,
        property_type:propertyType,
        deal_type:deal==='rent'?'rent':'sale',
        district,
        price_eur:effectivePrice,
        area_sqm:effectiveArea,
        construction_type:build,
        advertiser_type:advertiserType,
        advertiser_name:advertiserName,
        is_active:true,
        offer_sources:{name:'Imot.bg'}
      }
    }
  })

  const hasMore=
    html.includes('/p-'+(page+1)) ||
    new RegExp('Страница\\s+'+(page+1)+'\\b','i').test(html)

  return NextResponse.json({
    ok:true,
    source:'Imot.bg',
    page,
    items,
    has_more:hasMore,
    raw_count:links.length,
    candidate_count:cards.length,
    detail_success:detailSuccess,
    list_fallback:listFallback,
    page_signature:links.slice(0,12).join('|')
  })
}
