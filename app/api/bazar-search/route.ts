import {NextRequest,NextResponse} from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'

const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()
const strip=(html:string)=>html
  .replace(/<script[\s\S]*?<\/script>/gi,' ')
  .replace(/<style[\s\S]*?<\/style>/gi,' ')
  .replace(/<[^>]+>/g,' ')
  .replace(/&nbsp;|&#160;|\u00a0/g,' ')
  .replace(/&amp;/g,'&')
  .replace(/&quot;/g,'"')
  .replace(/&#39;/g,"'")
  .replace(/\s+/g,' ')
  .trim()

const translit=(s:string)=>{
  const m:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'}
  return norm(s).split('').map(ch=>m[ch]??ch).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}
const typeSlug=(s:string)=>translit(s)
const priceNum=(s:any)=>{
  const x=String(s||'').replace(/[^0-9]/g,'')
  if(!x)return null
  const n=Number(x)
  return Number.isFinite(n)?n:null
}
const num=(s:any)=>{
  const x=String(s||'').replace(',','.').replace(/[^0-9.]/g,'')
  if(!x)return null
  const n=Number(x)
  return Number.isFinite(n)?n:null
}
async function get(url:string,ms=12000){
  const ctl=new AbortController()
  const t=setTimeout(()=>ctl.abort(),ms)
  try{
    return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9,en;q=0.7'},redirect:'follow',cache:'no-store',signal:ctl.signal})
  }finally{clearTimeout(t)}
}
async function pool<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){
  let i=0
  const out:R[]=[]
  const workers=Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true){
      const idx=i++
      if(idx>=items.length)break
      try{out[idx]=await fn(items[idx])}catch{}
    }
  })
  await Promise.all(workers)
  return out.filter(Boolean)
}
function sellerInfo(raw:string,text:string){
  const seller=(raw.match(/class=["']usrName["'][^>]*>([^<]+)<\/a>/i)?.[1]||'').trim()||null
  const l=norm(text)
  const privateHit=/(от собственик|собственик продава|директно от собственик|частно лице|без агенция|без посредник|само за частни лица)/i.test(l)
  if(privateHit)return{advertiser_type:'private',advertiser_name:seller}
  const agencyName=!!seller&&/(имоти|имотен|estate|естейт|properties|пропъртис|недвижими|invest|broker|брокер|homes|хоумс|reality|realty|риъл|оод|еоод|\bад\b|груп|явлена|луксиммо|адрес|алдес|агенция)/i.test(seller)
  const agencyText=/(агенция|брокер|недвижими имоти)/i.test(l)
  if(agencyName||agencyText)return{advertiser_type:'agency',advertiser_name:seller}
  return{advertiser_type:'unknown',advertiser_name:seller}
}
function construction(text:string){
  const t=norm(text)
  if(t.includes('вид строителство тухла')||t.includes('строителство тухла'))return'Тухла'
  if(t.includes('вид строителство панел')||t.includes('строителство панел'))return'Панел'
  if(t.includes('вид строителство епк')||t.includes('строителство епк'))return'ЕПК'
  if(t.includes('гредоред'))return'Гредоред'
  return null
}
function exactBazarHref(href:string,deal:string,propertyType:string,district:string){
  const h=decodeURIComponent(href).toLowerCase()
  const ds=translit(district),ts=typeSlug(propertyType)
  const sale=deal==='rent'?'dava-pod-naem':'prodava'
  return h.includes('/obiava-')&&h.includes('/'+sale+'-')&&h.includes(ts)&&
    (h.includes('gr-sofiia-'+ds)||h.includes('gr-sofia-'+ds))
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
  const wantedConstruction=(q.get('construction')||'').split(',').map(x=>norm(x)).filter(Boolean)

  if(!propertyType||!district)return NextResponse.json({ok:false,error:'type and district are required'},{status:400})

  const phrase=(deal==='rent'?'дава под наем':'продава')+' '+propertyType+' '+district+' София'
  const url='https://bazar.bg/obiavi?q='+encodeURIComponent(phrase)+(page>1?'&page='+page:'')
  const list=await get(url)
  if(!list.ok)return NextResponse.json({ok:false,error:'Bazar HTTP '+list.status,items:[],has_more:false})
  const html=await list.text()

  const hrefs=[...html.matchAll(/href=["']([^"']*\/obiava-[^"']+)["']/gi)]
    .map(m=>m[1])
    .map(h=>h.startsWith('http')?h:'https://bazar.bg'+(h.startsWith('/')?h:'/'+h))
    .filter(h=>exactBazarHref(h,deal,propertyType,district))
  const unique=[...new Set(hrefs)]

  const cardCandidates=unique.map(link=>{
    const pos=html.indexOf(link.replace('https://bazar.bg',''))
    const pos2=pos>=0?pos:html.indexOf(link)
    const snip=pos2>=0?html.slice(Math.max(0,pos2-500),pos2+3000):''
    const pm=snip.match(/<span class=["']price["']>\s*([0-9 ]+)\s*<span class=["']currency["']>\s*€/i)
    const price=pm?priceNum(pm[1]):null
    return{link,price}
  }).filter(x=>{
    if(priceMin!=null&&(x.price==null||x.price<priceMin))return false
    if(priceMax!=null&&(x.price==null||x.price>priceMax))return false
    return true
  })

  const items=await pool(cardCandidates,8,async c=>{
    const r=await get(c.link)
    if(!r.ok)return null as any
    const raw=await r.text()
    const text=strip(raw)
    if(/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text))return null as any
    const areaMatch=text.match(/Квадратура\s*([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/i)
    const area=areaMatch?num(areaMatch[1]):null
    if(areaMin!=null&&(area==null||area<areaMin))return null as any
    if(areaMax!=null&&(area==null||area>areaMax))return null as any
    const cons=construction(text)
    if(wantedConstruction.length&&cons&&!wantedConstruction.includes(norm(cons)))return null as any
    const seller=sellerInfo(raw,text)
    const id=c.link.match(/obiava-(\d+)/)?.[1]||c.link
    const title=(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||propertyType+' · '+district).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
    return{
      id:'bazar-live:'+id,
      score:100,
      status:'new',
      created_at:new Date().toISOString(),
      offers:{
        id:'bazar-live:'+id,
        title,
        original_url:c.link,
        property_type:propertyType,
        deal_type:deal==='rent'?'rent':'sale',
        district,
        price_eur:c.price,
        area_sqm:area,
        construction_type:cons,
        advertiser_type:seller.advertiser_type,
        advertiser_name:seller.advertiser_name,
        is_active:true,
        source_published_at:null,
        offer_sources:{name:'Bazar.bg'}
      }
    }
  })

  const hasMore=
    new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)||
    new RegExp('>\s*'+(page+1)+'\s*<','i').test(html)&&unique.length>0

  return NextResponse.json({ok:true,source:'Bazar.bg',page,items,has_more:hasMore,count:items.length})
}
