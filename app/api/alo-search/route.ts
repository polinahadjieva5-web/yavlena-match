import {NextRequest,NextResponse} from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()
const translit=(s:string)=>{const m:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'};return norm(s).split('').map(x=>m[x]??x).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
const num=(v:any)=>{const s=String(v||'').replace(',','.').replace(/[^0-9.]/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null}
async function get(url:string,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9,en;q=0.7'},redirect:'follow',cache:'no-store',signal:c.signal})}finally{clearTimeout(t)}}
async function pool<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){let i=0;const out:R[]=[];const w=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const x=i++;if(x>=items.length)break;try{out[x]=await fn(items[x])}catch{}}});await Promise.all(w);return out.filter(Boolean)}
function strip(h:string){return h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function build(t:string){const x=norm(t);if(x.includes('тухла'))return'Тухла';if(x.includes('панел'))return'Панел';if(x.includes('епк'))return'ЕПК';if(x.includes('гредоред'))return'Гредоред';return null}

export async function GET(req:NextRequest){
 const q=req.nextUrl.searchParams
 const deal=q.get('deal')||'purchase',propertyType=q.get('type')||'',district=q.get('district')||''
 const page=Math.max(1,Number(q.get('page')||1))
 const priceMin=q.get('price_min')?Number(q.get('price_min')):null,priceMax=q.get('price_max')?Number(q.get('price_max')):null
 const areaMin=q.get('area_min')?Number(q.get('area_min')):null,areaMax=q.get('area_max')?Number(q.get('area_max')):null
 const constructions=(q.get('construction')||'').split(',').map(norm).filter(Boolean)
 if(!propertyType||!district)return NextResponse.json({ok:false,error:'type and district are required'},{status:400})
 const base=deal==='rent'?'https://www.alo.bg/obiavi/imoti-naemi/apartamenti-stai/':'https://www.alo.bg/obiavi/imoti-prodajbi/apartamenti-stai/'
 const params=new URLSearchParams({q:propertyType+' '+district,location_ids:'4342',region_id:'22'})
 if(page>1)params.set('page',String(page))
 const url=base+'?'+params.toString()
 const list=await get(url)
 if(!list.ok)return NextResponse.json({ok:false,error:'ALO HTTP '+list.status,items:[],has_more:false})
 const html=await list.text()
 const ts=translit(propertyType),ds=translit(district)
 const hrefs=[...html.matchAll(/href=["']([^"']+)["']/gi)].map(m=>m[1]).filter(h=>{
   const x=decodeURIComponent(h).toLowerCase()
   return x.startsWith('/'+ts+'-sofiya-'+ds+'-')&&/-\d{5,}(?:#|$)/.test(x)
 })
 const links=[...new Set(hrefs.map(h=>'https://www.alo.bg'+h.split('#')[0]))]
 const items=await pool(links,8,async link=>{
   const r=await get(link);if(!r.ok)return null as any
   const raw=await r.text(),text=strip(raw)
   if(/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text))return null as any
   const urlParts=link.match(/-([0-9]+(?:-[0-9]+)?)-kv-m-([0-9]+)-([0-9]+)$/i)
   const areaFromUrl=urlParts?Number(urlParts[1].replace('-', '.')):null
   const priceFromUrl=urlParts?Number(urlParts[2]):null
   const pm=text.match(/Цена\s*:?\s*([0-9][0-9\s.]*)\s*€/i)||text.match(/([0-9][0-9\s.]*)\s*EUR/i)
   const price=priceFromUrl||(pm?Number(pm[1].replace(/[^0-9]/g,'')):null)
   if(priceMin!=null&&(price==null||price<priceMin))return null as any
   if(priceMax!=null&&(price==null||price>priceMax))return null as any
   const am=text.match(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/i)
   const area=areaFromUrl||(am?num(am[1]):null)
   if(areaMin!=null&&(area==null||area<areaMin))return null as any
   if(areaMax!=null&&(area==null||area>areaMax))return null as any
   const cons=build(text);if(constructions.length&&cons&&!constructions.includes(norm(cons)))return null as any
   const l=norm(text)
   const advertiser_type=/(частно лице|от собственик|собственик продава|директно от собственик|без агенция|без посредник)/i.test(l)?'private':/(агенция|брокер|недвижими имоти)/i.test(l)?'agency':'unknown'
   const id=link.match(/-(\d{5,})$/)?.[1]||link
   const title=(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||propertyType+' · '+district).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
   return{id:'alo-live:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'alo-live:'+id,title,original_url:link,property_type:propertyType,deal_type:deal==='rent'?'rent':'sale',district,price_eur:price,area_sqm:area,construction_type:cons,advertiser_type,advertiser_name:null,is_active:true,source_published_at:null,offer_sources:{name:'ALO.bg'}}}
 })
 const hasMore=new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)||new RegExp('>\\s*'+(page+1)+'\\s*<','i').test(html)&&links.length>0
 return NextResponse.json({ok:true,source:'ALO.bg',page,items,has_more:hasMore,count:items.length})
}
