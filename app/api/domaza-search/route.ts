import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'

function norm(value:any){
  return String(value || '').toLowerCase().replace(/\s+/g,' ').trim()
}

async function get(url:string){
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try{
    return await fetch(url,{
      headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9'},
      cache:'no-store',
      redirect:'follow',
      signal:controller.signal
    })
  }finally{
    clearTimeout(timer)
  }
}

async function pool<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>){
  let cursor=0
  const out:R[]=[]
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const index=cursor++
      if(index>=items.length)break
      try{out[index]=await fn(items[index])}catch{}
    }
  })
  await Promise.all(workers)
  return out.filter(Boolean)
}

function strip(html:string){
  return html
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;|\u00a0/g,' ')
    .replace(/&amp;/g,'&')
    .replace(/\s+/g,' ')
    .trim()
}

function typeMatches(text:string,wanted:string){
  const value=norm(text)
  if(wanted==='1-стаен')return value.includes('едностаен')||value.includes('1-стаен')
  if(wanted==='2-стаен')return value.includes('двустаен')||value.includes('2-стаен')
  if(wanted==='3-стаен')return value.includes('тристаен')||value.includes('3-стаен')
  if(wanted==='4-стаен')return value.includes('четиристаен')||value.includes('4-стаен')
  return value.includes(norm(wanted))
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

  if(!propertyType||!district){
    return NextResponse.json({ok:false,error:'missing criteria'},{status:400})
  }

  const params=new URLSearchParams({q:propertyType+' '+district+' София'})
  if(page>1)params.set('page',String(page))
  const response=await get('https://www.domaza.bg/имоти_в_софия/?'+params.toString())

  if(!response.ok){
    return NextResponse.json({ok:false,error:'Domaza HTTP '+response.status,items:[],has_more:false})
  }

  const html=await response.text()
  const links=[...new Set(
    [...html.matchAll(/href=["']([^"']+-16-[0-9]+-p[^"']*)["']/gi)]
      .map(m=>m[1])
      .map(h=>h.startsWith('http')?h:'https://www.domaza.bg'+h)
  )]

  const items=await pool(links,6,async link=>{
    const detail=await get(link)
    if(!detail.ok)return null as any

    const raw=await detail.text()
    const text=strip(raw)
    const lower=norm(text)
    const pageTitle=(
      raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      ''
    ).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()

    if(!norm(pageTitle).includes(norm(district)))return null as any
    if(!typeMatches(text,propertyType))return null as any
    if(deal==='rent'&&!/(наем|rent)/i.test(lower))return null as any
    if(deal!=='rent'&&!/(продажба|продава|sale)/i.test(lower))return null as any

    const priceMatch=text.match(/([0-9][0-9\s.]*)\s*€/i)
    const price=priceMatch?Number(priceMatch[1].replace(/[^0-9]/g,'')):null
    if(priceMin!=null&&(price==null||price<priceMin))return null as any
    if(priceMax!=null&&(price==null||price>priceMax))return null as any

    const areas=[...text.matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*(?:m(?:2|²)|кв\.?\s*м)/gi)]
      .map(m=>Number(m[1].replace(',','.')))
      .filter(v=>v>=15&&v<=3000)
    const area=areas.length?areas[areas.length-1]:null

    if(areaMin!=null&&(area==null||area<areaMin))return null as any
    if(areaMax!=null&&(area==null||area>areaMax))return null as any

    const advertiserType=/частно лице/i.test(lower)
      ? 'private'
      : /(агенция за недвижими имоти|брокер|недвижими имоти)/i.test(lower)
        ? 'agency'
        : 'unknown'

    const id=link.match(/-16-([0-9]+)-p/)?.[1]||link
    const title=pageTitle||propertyType+' · '+district

    return {
      id:'domaza:'+id,
      score:100,
      status:'new',
      created_at:new Date().toISOString(),
      offers:{
        id:'domaza:'+id,
        title,
        description:text.slice(0,6000),
        original_url:link,
        property_type:propertyType,
        deal_type:deal==='rent'?'rent':'sale',
        district,
        price_eur:price,
        area_sqm:area,
        advertiser_type:advertiserType,
        advertiser_name:null,
        is_active:true,
        offer_sources:{name:'Domaza'}
      }
    }
  })

  const hasMore=
    new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html) ||
    (new RegExp('>\\s*'+(page+1)+'\\s*<','i').test(html)&&links.length>0)

  return NextResponse.json({ok:true,source:'Domaza',page,items,has_more:hasMore,page_signature:links.slice(0,8).join('|')})
}
