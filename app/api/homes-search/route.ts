import {NextRequest,NextResponse} from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()
const num=(v:any)=>{const s=String(v||'').replace(/\s/g,'').replace(',','.').replace(/[^0-9.]/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null}
const priceNum=(v:any)=>{const s=String(v||'').replace(/[^0-9]/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null}
async function get(url:string,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9,en;q=0.7'},redirect:'follow',cache:'no-store',signal:c.signal})}finally{clearTimeout(t)}}
async function pool<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){let i=0;const out:R[]=[];const w=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const x=i++;if(x>=items.length)break;try{out[x]=await fn(items[x])}catch{}}});await Promise.all(w);return out.filter(Boolean)}

const typeCode=(t:string)=>({'1-стаен':'1','2-стаен':'2','3-стаен':'3','4-стаен':'4'} as Record<string,string>)[t]||''
function typeMatches(title:string,wanted:string){const t=norm(title),w=norm(wanted);if(w==='1-стаен')return t.includes('едностаен')||t.includes('1-стаен');if(w==='2-стаен')return t.includes('двустаен')||t.includes('2-стаен');if(w==='3-стаен')return t.includes('тристаен')||t.includes('3-стаен');if(w==='4-стаен')return t.includes('четиристаен')||t.includes('4-стаен');return t.includes(w)}
function extractBuild(raw:string){const m=raw.match(/"key"\s*:\s*"build_type"[\s\S]{0,300}?"value"\s*:\s*"([^"]+)"/i);return m?.[1]||null}
function seller(raw:string,text:string){
 const a=raw.match(/"agency"\s*:\s*\{[\s\S]{0,900}?"name"\s*:\s*"([^"]+)"/i)
 if(a)return{advertiser_type:'agency',advertiser_name:a[1]}
 const b=raw.match(/"broker"\s*:\s*\{[\s\S]{0,500}?"name"\s*:\s*"([^"]+)"/i)
 if(/частно лице|от собственик|собственик продава|директно от собственик/i.test(text))return{advertiser_type:'private',advertiser_name:b?.[1]||null}
 return{advertiser_type:'unknown',advertiser_name:b?.[1]||null}
}
async function neighbourhoodId(name:string){
 const r=await get('https://www.homes.bg/api/neighbourhoodsAll?locationId=1')
 if(!r.ok)return null
 const j=await r.json().catch(()=>[])
 for(const x of j||[]){if(norm(x?.[1])===norm(name))return String(x?.[0])}
 return null
}

export async function GET(req:NextRequest){
 const q=req.nextUrl.searchParams
 const deal=q.get('deal')||'purchase',propertyType=q.get('type')||'',district=q.get('district')||''
 const page=Math.max(1,Number(q.get('page')||1))
 const priceMin=q.get('price_min')?Number(q.get('price_min')):null,priceMax=q.get('price_max')?Number(q.get('price_max')):null
 const areaMin=q.get('area_min')?Number(q.get('area_min')):null,areaMax=q.get('area_max')?Number(q.get('area_max')):null
 const constructions=(q.get('construction')||'').split(',').map(norm).filter(Boolean)
 if(!propertyType||!district)return NextResponse.json({ok:false,error:'type and district are required'},{status:400})
 const nid=await neighbourhoodId(district)
 if(!nid)return NextResponse.json({ok:true,source:'Homes.bg',page,items:[],has_more:false,count:0})
 const params=new URLSearchParams()
 params.set('typeId',deal==='rent'?'ApartmentRent':'ApartmentSell')
 params.set('locationId','1');params.append('neighbourhoods[]',nid)
 const tc=typeCode(propertyType);if(tc)params.append('apartmentType[]',tc)
 if(page>1)params.set('page',String(page))
 const url='https://www.homes.bg/?'+params.toString()
 const list=await get(url)
 if(!list.ok)return NextResponse.json({ok:false,error:'Homes HTTP '+list.status,items:[],has_more:false})
 const html=await list.text()
 const links=[...new Set([...html.matchAll(/href=["'](\/offer\/[^"']+)["']/gi)].map(m=>'https://www.homes.bg'+m[1]))]
 const items=await pool(links,8,async link=>{
   const r=await get(link);if(!r.ok)return null as any
   const raw=await r.text()
   const title=raw.match(/"title"\s*:\s*"([^"]+)"/i)?.[1]||''
   if(!typeMatches(title,propertyType))return null as any
   const pm=raw.match(/"price"\s*:\s*\{[\s\S]{0,300}?"value"\s*:\s*"([0-9,.]+)"/i)
   const price=pm?priceNum(pm[1]):null
   if(priceMin!=null&&(price==null||price<priceMin))return null as any
   if(priceMax!=null&&(price==null||price>priceMax))return null as any
   const am=title.match(/([0-9]+(?:[.,][0-9]+)?)m²/i)||link.match(/-([0-9]+)m2-/i)
   const area=am?num(am[1]):null
   if(areaMin!=null&&(area==null||area<areaMin))return null as any
   if(areaMax!=null&&(area==null||area>areaMax))return null as any
   const build=extractBuild(raw)
   if(constructions.length&&build&&!constructions.includes(norm(build)))return null as any
   const text=raw.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ')
   if(/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text))return null as any
   const si=seller(raw,text)
   const id=link.match(/\/([^/]+)$/)?.[1]||link
   return{id:'homes-live:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'homes-live:'+id,title:title||propertyType+' · '+district,original_url:link,property_type:propertyType,deal_type:deal==='rent'?'rent':'sale',district,price_eur:price,area_sqm:area,construction_type:build,advertiser_type:si.advertiser_type,advertiser_name:si.advertiser_name,is_active:true,source_published_at:null,offer_sources:{name:'Homes.bg'}}}
 })
 const hasMore=new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)||new RegExp('>\\s*'+(page+1)+'\\s*<','i').test(html)&&links.length>0
 return NextResponse.json({ok:true,source:'Homes.bg',page,items,has_more:hasMore,count:items.length})
}
