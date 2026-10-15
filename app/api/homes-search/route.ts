import { NextRequest, NextResponse } from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()
const TYPE_CODES:Record<string,string>={'1-стаен':'1','2-стаен':'2','3-стаен':'3','4-стаен':'4'}

function typeSlug(t:string){
  const map:Record<string,string>={'1-стаен':'ednostaen','2-стаен':'dvustaen','3-стаен':'tristaen','4-стаен':'chetiristaen','Многостаен':'mnogostaen','Мезонет':'mezonet','Ателие / студио':'atelie','Къща':'kashta','Вила':'vila','Парцел':'partsel','Гараж':'garazh','Офис':'ofis','Магазин':'magazin'}
  return map[t]||''
}
function typeOk(title:string,wanted:string){
  const x=norm(title)
  if(wanted==='1-стаен')return x.includes('едностаен')||x.includes('1-стаен')
  if(wanted==='2-стаен')return x.includes('двустаен')||x.includes('2-стаен')
  if(wanted==='3-стаен')return x.includes('тристаен')||x.includes('3-стаен')
  if(wanted==='4-стаен')return x.includes('четиристаен')||x.includes('4-стаен')
  return x.includes(norm(wanted))
}
function priceValue(v:any){
  const s=String(v||'').replace(/\u00a0/g,' ').trim()
  if(!s)return null
  if(/^\d{1,3}(?:[ ,.]\d{3})+$/.test(s)){
    const n=Number(s.replace(/[ ,.]/g,''))
    return Number.isFinite(n)?n:null
  }
  const n=Number(s.replace(/\s/g,'').replace(',','.'))
  return Number.isFinite(n)?n:null
}
function listPrice(snippet:string){
  const patterns=[/€\s*([0-9][0-9\s.,]*)/i,/([0-9][0-9\s.,]*)\s*€/i,/"price"\s*:\s*\{[^}]*"value"\s*:\s*"([0-9,.]+)"/i]
  for(const re of patterns){
    const m=snippet.match(re)
    if(m){
      const n=priceValue(m[1])
      if(n&&n>=1000&&n<=50000000)return Math.round(n)
    }
  }
  return null
}
async function get(url:string,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9'},cache:'no-store',redirect:'follow',signal:c.signal})}finally{clearTimeout(t)}}
async function pool<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>){let i=0;const out:R[]=[];await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const k=i++;if(k>=items.length)break;try{out[k]=await fn(items[k])}catch{}}}));return out.filter(Boolean)}

async function neighbourhoodId(district:string){
  const r=await get('https://www.homes.bg/api/neighbourhoodsAll?locationId=1')
  if(!r.ok)return null
  const j=await r.json().catch(()=>[])
  for(const x of j||[])if(norm(x?.[1])===norm(district))return String(x?.[0])
  return null
}

export async function GET(req:NextRequest){
  const q=req.nextUrl.searchParams
  const deal=q.get('deal')||'purchase',type=q.get('type')||'',district=q.get('district')||'',page=Math.max(1,Number(q.get('page')||1))
  const pmin=q.get('price_min')?Number(q.get('price_min')):null,pmax=q.get('price_max')?Number(q.get('price_max')):null
  const amin=q.get('area_min')?Number(q.get('area_min')):null,amax=q.get('area_max')?Number(q.get('area_max')):null
  const cons=(q.get('construction')||'').split(',').map(norm).filter(Boolean)
  if(!type||!district)return NextResponse.json({ok:false,error:'missing criteria'},{status:400})

  const nid=await neighbourhoodId(district)
  if(!nid)return NextResponse.json({ok:true,source:'Homes.bg',page,items:[],has_more:false,raw_count:0})

  const params=new URLSearchParams({typeId:deal==='rent'?'ApartmentRent':'ApartmentSell',locationId:'1'})
  params.append('neighbourhoods[]',nid)
  const code=TYPE_CODES[type];if(code)params.append('apartmentType[]',code)
  if(page>1)params.set('page',String(page))

  const r=await get('https://www.homes.bg/?'+params.toString())
  if(!r.ok)return NextResponse.json({ok:false,error:'Homes HTTP '+r.status,items:[],has_more:false})

  const html=await r.text()
  const links=[...new Set([...html.matchAll(/href=["'](\/offer\/[^"']+)["']/gi)].map(m=>'https://www.homes.bg'+m[1]))]
  const wantedSlug=typeSlug(type)

  const cards=links.map(link=>{
    const relative=link.replace('https://www.homes.bg','')
    let pos=html.indexOf(relative);if(pos<0)pos=html.indexOf(link)
    const snippet=pos>=0?html.slice(Math.max(0,pos-1400),pos+4200):''
    const areaMatch=link.match(/-([0-9]+(?:-[0-9]+)?)m2-/i)
    const area=areaMatch?Number(areaMatch[1].replace('-', '.')):null
    const price=listPrice(snippet)
    const typeKnown=!!code||(wantedSlug&&norm(link).includes(wantedSlug))
    return{link,snippet,area,price,typeKnown}
  }).filter(card=>{
    if(!card.typeKnown)return true
    if(pmin!=null&&card.price!=null&&card.price<pmin)return false
    if(pmax!=null&&card.price!=null&&card.price>pmax)return false
    if(amin!=null&&card.area!=null&&card.area<amin)return false
    if(amax!=null&&card.area!=null&&card.area>amax)return false
    return true
  })

  let detailSuccess=0,listFallback=0
  const items=await pool(cards,8,async card=>{
    let raw='',title='',detailOk=false
    try{
      const rr=await get(card.link,10000)
      if(rr.status===404||rr.status===410)return null as any
      if(rr.ok){
        raw=await rr.text()
        title=raw.match(/"title"\s*:\s*"([^"]+)"/i)?.[1]||''
        detailOk=true;detailSuccess++
      }
    }catch{}

    if(detailOk&&!typeOk(title,type))return null as any
    if(!detailOk&&!card.typeKnown)return null as any

    const pm=detailOk?raw.match(/"price"\s*:\s*\{[\s\S]{0,300}?"value"\s*:\s*"([0-9,.]+)"/i):null
    const pr=(pm?priceValue(pm[1]):null)??card.price
    const titleArea=detailOk?(title.match(/([0-9]+(?:[.,][0-9]+)?)m²/i)||card.link.match(/-([0-9]+(?:-[0-9]+)?)m2-/i)):null
    const ar=(titleArea?Number(titleArea[1].replace('-','.').replace(',','.')):null)??card.area

    if(pmin!=null&&(pr==null||pr<pmin))return null as any
    if(pmax!=null&&(pr==null||pr>pmax))return null as any
    if(amin!=null&&(ar==null||ar<amin))return null as any
    if(amax!=null&&(ar==null||ar>amax))return null as any

    const bm=detailOk?raw.match(/"key"\s*:\s*"build_type"[\s\S]{0,300}?"value"\s*:\s*"([^"]+)"/i):null
    const build=bm?.[1]||null
    if(cons.length&&build&&!cons.includes(norm(build)))return null as any

    let advertiserType='unknown',advertiserName:string|null=null
    if(detailOk){
      const agency=raw.match(/"agency"\s*:\s*\{[\s\S]{0,900}?"name"\s*:\s*"([^"]+)"/i)
      const broker=raw.match(/"broker"\s*:\s*\{[\s\S]{0,500}?"name"\s*:\s*"([^"]+)"/i)
      const text=raw.replace(/<[^>]+>/g,' ')
      const priv=/частно лице|от собственик|собственик продава/i.test(text)
      advertiserType=agency?'agency':priv?'private':'unknown'
      advertiserName=agency?.[1]||broker?.[1]||null
    }else listFallback++

    const id=card.link.match(/\/([^/]+)$/)?.[1]||card.link
    return{id:'homes:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'homes:'+id,title:title||type+' · '+district,description:detailOk?raw.replace(/<[^>]+>/g,' ').replace(/\\s+/g,' ').trim().slice(0,6000):null,original_url:card.link,property_type:type,deal_type:deal==='rent'?'rent':'sale',district,price_eur:pr,area_sqm:ar,construction_type:build,advertiser_type:advertiserType,advertiser_name:advertiserName,is_active:true,offer_sources:{name:'Homes.bg'}}}
  })

  const hasMore=new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)||new RegExp('>\\s*'+(page+1)+'\\s*<','i').test(html)&&links.length>0
  return NextResponse.json({ok:true,source:'Homes.bg',page,items,has_more:hasMore,raw_count:links.length,candidate_count:cards.length,detail_success:detailSuccess,list_fallback:listFallback,page_signature:links.slice(0,12).join('|')})
}
