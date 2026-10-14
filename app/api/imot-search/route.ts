import {NextRequest,NextResponse} from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()
const typeSlug=(t:string)=>({'1-стаен':'ednostaen','2-стаен':'dvustaen','3-стаен':'tristaen','4-стаен':'chetiristaen','Многостаен':'mnogostaen','Мезонет':'mezonet','Ателие / студио':'atelie-tavan','Къща':'kashta','Вила':'vila','Парцел':'partsel','Гараж':'garazh','Офис':'ofis','Магазин':'magazin'} as Record<string,string>)[t]||''
const translit=(s:string)=>{const m:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'};return norm(s).split('').map(x=>m[x]??x).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}
const num=(v:any)=>{const s=String(v||'').replace(',','.').replace(/[^0-9.]/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null}
async function fetchRaw(url:string,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9,en;q=0.7','referer':'https://www.imot.bg/'},redirect:'follow',cache:'no-store',signal:c.signal})}finally{clearTimeout(t)}}
async function textImot(r:Response){const b=await r.arrayBuffer();const utf=new TextDecoder().decode(b);if(/[А-Яа-я]/.test(utf))return utf;try{return new TextDecoder('windows-1251').decode(b)}catch{return utf}}
async function pool<T,R>(items:T[],limit:number,fn:(x:T)=>Promise<R>){let i=0;const out:R[]=[];const w=Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const x=i++;if(x>=items.length)break;try{out[x]=await fn(items[x])}catch{}}});await Promise.all(w);return out.filter(Boolean)}
function build(text:string){const t=norm(text);if(t.includes('тухла'))return'Тухла';if(t.includes('панел'))return'Панел';if(t.includes('епк'))return'ЕПК';if(t.includes('гредоред'))return'Гредоред';return null}
function strip(html:string){return html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/\s+/g,' ').trim()}

export async function GET(req:NextRequest){
 const q=req.nextUrl.searchParams
 const deal=q.get('deal')||'purchase',propertyType=q.get('type')||'',district=q.get('district')||''
 const page=Math.max(1,Number(q.get('page')||1))
 const priceMin=q.get('price_min')?Number(q.get('price_min')):null,priceMax=q.get('price_max')?Number(q.get('price_max')):null
 const areaMin=q.get('area_min')?Number(q.get('area_min')):null,areaMax=q.get('area_max')?Number(q.get('area_max')):null
 const constructions=(q.get('construction')||'').split(',').map(norm).filter(Boolean)
 if(!propertyType||!district)return NextResponse.json({ok:false,error:'type and district are required'},{status:400})
 const ts=typeSlug(propertyType);if(!ts)return NextResponse.json({ok:true,source:'Imot.bg',page,items:[],has_more:false,count:0})
 const ds=translit(district)
 const root='https://www.imot.bg/obiavi/'+(deal==='rent'?'naemi':'prodazhbi')+'/grad-sofiya/'+ds+'/'+ts
 const url=root+(page>1?'/p-'+page:'')
 const list=await fetchRaw(url)
 if(!list.ok)return NextResponse.json({ok:false,error:'Imot HTTP '+list.status,items:[],has_more:false})
 const html=await textImot(list)
 const links=[...new Set([...html.matchAll(/href=["'](\/\/www\.imot\.bg\/obiava-[^"']+)["']/gi)].map(m=>'https:'+m[1].split('#')[0]))]
 const items=await pool(links,8,async link=>{
   const r=await fetchRaw(link);if(!r.ok)return null as any
   const raw=await textImot(r),text=strip(raw)
   if(/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text))return null as any
   const pm=raw.match(/showpricechange\([^)]*?'([0-9]{4,})','EUR'/i)
   const price=pm?Number(pm[1]):null
   if(priceMin!=null&&(price==null||price<priceMin))return null as any
   if(priceMax!=null&&(price==null||price>priceMax))return null as any
   const am=text.match(/Площ\s*:?\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:m2|m²|кв\.?\s*м)/i)||text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:m2|m²|кв\.?\s*м)/i)
   const area=am?num(am[1]):null
   if(areaMin!=null&&(area==null||area<areaMin))return null as any
   if(areaMax!=null&&(area==null||area>areaMax))return null as any
   const cons=build(text)
   if(constructions.length&&cons&&!constructions.includes(norm(cons)))return null as any
   const dealerBlock=raw.match(/<div class=["']dealer["'][\s\S]*?<\/div>\s*<\/div>/i)?.[0]||''
   const dealerName=dealerBlock.match(/<div class=["']name["']>([^<]+)<\/div>/i)?.[1]?.trim()||dealerBlock.match(/href=["']https?:\/\/([^."]+)\.imot\.bg/i)?.[1]||null
   const advertiser_type=dealerBlock?'agency':'private'
   const id=link.match(/obiava-([^-]+)/)?.[1]||link
   const title=(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||propertyType+' · '+district).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
   return{id:'imot-live:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'imot-live:'+id,title,original_url:link,property_type:propertyType,deal_type:deal==='rent'?'rent':'sale',district,price_eur:price,area_sqm:area,construction_type:cons,advertiser_type,advertiser_name:dealerName,is_active:true,source_published_at:null,offer_sources:{name:'Imot.bg'}}}
 })
 const hasMore=html.includes('/p-'+(page+1))||new RegExp('Страница\\s+'+(page+1)+'\\b','i').test(html)
 return NextResponse.json({ok:true,source:'Imot.bg',page,items,has_more:hasMore,count:items.length})
}
