import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm = (v:any) => String(v || '').toLowerCase().replace(/\s+/g,' ').trim()

function translit(value:string){
  const map:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'}
  return norm(value).split('').map(x=>map[x]??x).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}
function typeNorm(s:string){
  const n=norm(s)
  if(n.includes('едностаен'))return'1-стаен'
  if(n.includes('двустаен'))return'2-стаен'
  if(n.includes('тристаен'))return'3-стаен'
  if(n.includes('четиристаен'))return'4-стаен'
  if(n.includes('многостаен')||n.includes('петстаен'))return'Многостаен'
  if(n.includes('мезонет'))return'Мезонет'
  if(n.includes('ателие')||n.includes('студио'))return'Ателие / студио'
  if(n.includes('къща'))return'Къща'
  if(n.includes('гараж')||n.includes('паркомясто'))return'Гараж'
  if(n.includes('офис'))return'Офис'
  if(n.includes('магазин'))return'Магазин'
  if(n.includes('парцел')||n.includes('земя'))return'Парцел'
  return s.trim()
}
function euro(s:string){
  const m=s.replace(/\u00a0/g,' ').match(/€\s*([0-9][0-9\s.]*)/)
  return m?Number(m[1].replace(/[\s.]/g,'')):null
}
async function get(url:string,ms=15000){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),ms)
  try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9'},cache:'no-store',redirect:'follow',signal:c.signal})}
  finally{clearTimeout(t)}
}
function escapeRegex(s:string){return s.replace(/[.*+?^$()|[\]\\]/g,'\\$&')}

export async function GET(req:NextRequest){
  const q=req.nextUrl.searchParams
  const deal=q.get('deal')||'purchase',propertyType=q.get('type')||'',district=q.get('district')||''
  const page=Math.max(1,Number(q.get('page')||1))
  const pmin=q.get('price_min')?Number(q.get('price_min')):null,pmax=q.get('price_max')?Number(q.get('price_max')):null
  const amin=q.get('area_min')?Number(q.get('area_min')):null,amax=q.get('area_max')?Number(q.get('area_max')):null
  if(!propertyType||!district)return NextResponse.json({ok:false,error:'missing criteria'},{status:400})

  const root=deal==='rent'?'rentals':'sales'
  const sitemapKind=deal==='rent'?'rents':'sales'
  const slug=translit(district)
  const sm=await get('https://www.yavlena.com/sitemap/'+sitemapKind+'10.xml')
  if(!sm.ok)return NextResponse.json({ok:false,error:'Yavlena sitemap HTTP '+sm.status,items:[],has_more:false})
  const xml=await sm.text()
  const re=new RegExp('<loc>https://www\\.yavlena\\.com/'+root+'/sofia-sofia-'+escapeRegex(slug)+'/d23l4396q([0-9]+)</loc>','i')
  const qid=xml.match(re)?.[1]
  if(!qid)return NextResponse.json({ok:true,source:'Yavlena.com',page,items:[],has_more:false})

  const base='https://www.yavlena.com/bg/'+root+'/sofia-sofia-'+slug+'/d23l4396q'+qid
  const response=await get(base+(page>1?'?page='+page:''))
  if(!response.ok)return NextResponse.json({ok:false,error:'Yavlena HTTP '+response.status,items:[],has_more:false})
  const html=await response.text()
  const items:any[]=[]
  const seen=new Set<string>()

  for(const tagMatch of html.matchAll(/<a\b[^>]*>/gi)){
    const tag=tagMatch[0]
    const titleMatch=tag.match(/title=["']([^"']+)["']/i)
    const hrefMatch=tag.match(/href=["']([^"']+)["']/i)
    if(!titleMatch||!hrefMatch)continue
    const id=hrefMatch[1].match(/\/(?:bg\/)?(\d{5,})(?:[?#/]|$)/)?.[1]
    if(!id||seen.has(id))continue
    const title=titleMatch[1].replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/&amp;/g,'&')
    const m=title.match(/^(.+?),\s*София,\s*(.+?),\s*([0-9.,]+)\s*кв\.?\s*м\.,\s*(.*)$/i)
    if(!m)continue
    const pt=typeNorm(m[1]),d=m[2].trim(),area=Number(m[3].replace(',','.')),price=euro(m[4])
    if(norm(pt)!==norm(propertyType)||norm(d)!==norm(district))continue
    if(pmin!=null&&(price==null||price<pmin))continue
    if(pmax!=null&&(price==null||price>pmax))continue
    if(amin!=null&&area<amin)continue
    if(amax!=null&&area>amax)continue
    seen.add(id)
    items.push({id:'yavlena:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'yavlena:'+id,title,original_url:'https://www.yavlena.com/bg/'+id,property_type:pt,deal_type:deal==='rent'?'rent':'sale',district:d,price_eur:price,area_sqm:area,advertiser_type:'agency',advertiser_name:'Явлена',is_active:true,offer_sources:{name:'Yavlena.com'}}})
  }

  const hasMore=items.length>=45||new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)
  return NextResponse.json({ok:true,source:'Yavlena.com',page,items,has_more:hasMore})
}
