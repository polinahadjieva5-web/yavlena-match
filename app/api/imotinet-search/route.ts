import { NextRequest, NextResponse } from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()
const TYPE_SLUGS:Record<string,string>={'1-стаен':'ednostaen','2-стаен':'dvustaen','3-стаен':'tristaen','4-стаен':'chetiristaen','Многостаен':'mnogostaen','Мезонет':'mezonet','Къща':'kashta','Вила':'vila','Парцел':'partsel','Гараж':'garazh','Офис':'ofis','Магазин':'magazin'}

function translit(s:string){
  const m:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'}
  return norm(s).split('').map(x=>m[x]??x).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}
function strip(h:string){return h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function priceValue(v:any){const s=String(v||'').replace(/[^0-9]/g,'');return s?Number(s):null}
function numberValue(v:any){const s=String(v||'').replace(',','.').replace(/[^0-9.]/g,'');return s?Number(s):null}
async function get(url:string,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9'},cache:'no-store',redirect:'follow',signal:c.signal})}finally{clearTimeout(t)}}
async function pool<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>){let i=0;const out:R[]=[];await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const k=i++;if(k>=items.length)break;try{out[k]=await fn(items[k])}catch{}}}));return out.filter(Boolean)}
function listPrice(s:string){const m=s.match(/<strong class=["']price["']>\s*([0-9 ]+)\s*<small>€<\/small>/i)||strip(s).match(/([0-9][0-9 ]{3,})\s*€/i);return m?priceValue(m[1]):null}
function listArea(s:string){const ms=[...strip(s).matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/gi)].map(m=>numberValue(m[1])).filter((x:any)=>x&&x>=10&&x<=5000);return ms.length?ms[0]:null}

export async function GET(req:NextRequest){
  const q=req.nextUrl.searchParams
  const deal=q.get('deal')||'purchase',type=q.get('type')||'',district=q.get('district')||'',page=Math.max(1,Number(q.get('page')||1))
  const pmin=q.get('price_min')?Number(q.get('price_min')):null,pmax=q.get('price_max')?Number(q.get('price_max')):null
  const amin=q.get('area_min')?Number(q.get('area_min')):null,amax=q.get('area_max')?Number(q.get('area_max')):null
  if(!type||!district)return NextResponse.json({ok:false,error:'missing criteria'},{status:400})

  const action=deal==='rent'?'dava-pod-naem':'prodava'
  const listUrl='https://www.imoti.net/bg/obiavi/r/'+action+'/sofia'+(page>1?'?page='+page:'')
  const r=await get(listUrl)
  if(!r.ok)return NextResponse.json({ok:false,error:'Imoti.net HTTP '+r.status,items:[],has_more:false})

  const html=await r.text()
  const districtSlug=translit(district),typeSlug=TYPE_SLUGS[type]||translit(type)
  const allLinks=[...new Set([...html.matchAll(/href=["']([^"']*\/bg\/obiava\/[^"']+)["']/gi)].map(m=>m[1]).map(h=>h.startsWith('http')?h:'https://www.imoti.net'+h.replace(/&amp;/g,'&')))]
  const links=allLinks.filter(link=>{
    const x=decodeURIComponent(link).toLowerCase()
    return x.includes('/sofia/'+districtSlug+'/'+typeSlug+'/')
  })

  const cards=links.map(link=>{
    const relative=link.replace('https://www.imoti.net','').replace(/&/g,'&amp;')
    let pos=html.indexOf(relative);if(pos<0)pos=html.indexOf(link.replace(/&/g,'&amp;'));if(pos<0)pos=html.indexOf(link)
    const snippet=pos>=0?html.slice(Math.max(0,pos-1000),pos+3600):''
    return{link,snippet,price:listPrice(snippet),area:listArea(snippet)}
  }).filter(c=>{
    if(pmin!=null&&c.price!=null&&c.price<pmin)return false
    if(pmax!=null&&c.price!=null&&c.price>pmax)return false
    if(amin!=null&&c.area!=null&&c.area<amin)return false
    if(amax!=null&&c.area!=null&&c.area>amax)return false
    return true
  })

  let detailSuccess=0,listFallback=0
  const items=await pool(cards,6,async card=>{
    let raw='',text='',detailOk=false
    try{
      const rr=await get(card.link,10000)
      if(rr.status===404||rr.status===410)return null as any
      if(rr.ok){raw=await rr.text();text=strip(raw);detailOk=true;detailSuccess++}
    }catch{}

    const jm=detailOk?raw.match(/"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/i):null
    const vm=detailOk?text.match(/([0-9][0-9\s.]*)\s*€/i):null
    const pr=(jm?Number(jm[1]):vm?priceValue(vm[1]):null)??card.price
    const am=detailOk?text.match(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/i):null
    const ar=(am?numberValue(am[1]):null)??card.area

    if(pmin!=null&&(pr==null||pr<pmin))return null as any
    if(pmax!=null&&(pr==null||pr>pmax))return null as any
    if(amin!=null&&(ar==null||ar<amin))return null as any
    if(amax!=null&&(ar==null||ar>amax))return null as any

    let advertiserType='unknown'
    if(detailOk){
      const l=norm(text)
      advertiserType=/частно лице|собственик/i.test(l)?'private':/(агенция|брокер|недвижими имоти)/i.test(l)?'agency':'unknown'
    }else listFallback++

    const id=card.link.match(/\/([0-9]{5,})(?:\?|$)/)?.[1]||card.link
    const title=detailOk?(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||type+' · '+district).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():type+' · '+district

    return{id:'imotinet:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'imotinet:'+id,title,description:detailOk?text.slice(0,6000):null,original_url:card.link,property_type:type,deal_type:deal==='rent'?'rent':'sale',district,price_eur:pr,area_sqm:ar,advertiser_type:advertiserType,advertiser_name:null,is_active:true,offer_sources:{name:'Imoti.net'}}}
  })

  const hasMore=allLinks.length>0&&(new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)||new RegExp('>\\s*'+(page+1)+'\\s*<','i').test(html))
  return NextResponse.json({ok:true,source:'Imoti.net',page,items,has_more:hasMore,raw_count:allLinks.length,exact_count:links.length,candidate_count:cards.length,detail_success:detailSuccess,list_fallback:listFallback,page_signature:allLinks.slice(0,12).join('|')})
}
