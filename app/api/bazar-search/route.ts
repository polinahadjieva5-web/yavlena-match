import { NextRequest, NextResponse } from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const norm=(v:any)=>String(v||'').toLowerCase().replace(/\s+/g,' ').trim()

function translit(s:string){
  const m:Record<string,string>={'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'h','ц':'ts','ч':'ch','ш':'sh','щ':'sht','ъ':'a','ь':'y','ю':'yu','я':'ya'}
  return norm(s).split('').map(ch=>m[ch]??ch).join('').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
}
function strip(h:string){return h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;|\u00a0/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()}
function priceValue(v:any){const s=String(v||'').replace(/[^0-9]/g,'');return s?Number(s):null}
function numberValue(v:any){const s=String(v||'').replace(',','.').replace(/[^0-9.]/g,'');return s?Number(s):null}
async function get(url:string,ms=12000){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9'},cache:'no-store',redirect:'follow',signal:c.signal})}finally{clearTimeout(t)}}
async function pool<T,R>(items:T[],limit:number,fn:(item:T)=>Promise<R>){let i=0;const out:R[]=[];await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(true){const k=i++;if(k>=items.length)break;try{out[k]=await fn(items[k])}catch{}}}));return out.filter(Boolean)}
function build(t:string){const x=norm(t);if(x.includes('тухла'))return'Тухла';if(x.includes('панел'))return'Панел';if(x.includes('епк'))return'ЕПК';if(x.includes('гредоред'))return'Гредоред';return null}
function seller(raw:string,text:string){const name=raw.match(/class=["']usrName["'][^>]*>([^<]+)<\/a>/i)?.[1]?.trim()||null;const l=norm(text);if(/от собственик|собственик продава|директно от собственик|частно лице|без агенция|без посредник/i.test(l))return{type:'private',name};if((name&&/(имоти|имотен|estate|естейт|properties|пропъртис|недвижими|invest|broker|брокер|homes|хоумс|realty|риъл|оод|еоод|\bад\b|груп|явлена|луксиммо|адрес|алдес|агенция)/i.test(name))||/(агенция|брокер|недвижими имоти)/i.test(l))return{type:'agency',name};return{type:'unknown',name}}
function listPrice(s:string){const m=s.match(/<span class=["']price["']>\s*([0-9 ]+)\s*<span class=["']currency["']>\s*€/i)||strip(s).match(/([0-9][0-9 ]{3,})\s*€/i);return m?priceValue(m[1]):null}
function listArea(s:string){const ms=[...strip(s).matchAll(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/gi)].map(m=>numberValue(m[1])).filter((x:any)=>x&&x>=10&&x<=5000);return ms.length?ms[0]:null}

export async function GET(req:NextRequest){
  const q=req.nextUrl.searchParams
  const deal=q.get('deal')||'purchase',type=q.get('type')||'',district=q.get('district')||'',page=Math.max(1,Number(q.get('page')||1))
  const pmin=q.get('price_min')?Number(q.get('price_min')):null,pmax=q.get('price_max')?Number(q.get('price_max')):null
  const amin=q.get('area_min')?Number(q.get('area_min')):null,amax=q.get('area_max')?Number(q.get('area_max')):null
  const cons=(q.get('construction')||'').split(',').map(norm).filter(Boolean)
  if(!type||!district)return NextResponse.json({ok:false,error:'missing criteria'},{status:400})

  const phrase=(deal==='rent'?'дава под наем':'продава')+' '+type+' '+district+' София'
  const listUrl='https://bazar.bg/obiavi?q='+encodeURIComponent(phrase)+(page>1?'&page='+page:'')
  const r=await get(listUrl)
  if(!r.ok)return NextResponse.json({ok:false,error:'Bazar HTTP '+r.status,items:[],has_more:false})

  const html=await r.text(),ds=translit(district),ts=translit(type),action=deal==='rent'?'dava-pod-naem':'prodava'
  const rawLinks=[...html.matchAll(/href=["']([^"']*\/obiava-[^"']+)["']/gi)].map(m=>m[1]).filter(h=>{
    const x=decodeURIComponent(h).toLowerCase()
    return x.includes('/'+action+'-')&&x.includes(ts)&&(x.includes('gr-sofiia-'+ds)||x.includes('gr-sofia-'+ds))
  }).map(h=>h.startsWith('http')?h:'https://bazar.bg'+(h.startsWith('/')?h:'/'+h))
  const links=[...new Set(rawLinks)]

  const cards=links.map(link=>{
    const relative=link.replace('https://bazar.bg','')
    let pos=html.indexOf(relative);if(pos<0)pos=html.indexOf(link)
    const snippet=pos>=0?html.slice(Math.max(0,pos-1200),pos+3800):''
    return{link,snippet,price:listPrice(snippet),area:listArea(snippet)}
  }).filter(c=>{
    if(pmin!=null&&c.price!=null&&c.price<pmin)return false
    if(pmax!=null&&c.price!=null&&c.price>pmax)return false
    if(amin!=null&&c.area!=null&&c.area<amin)return false
    if(amax!=null&&c.area!=null&&c.area>amax)return false
    return true
  })

  let detailSuccess=0,listFallback=0
  const items=await pool(cards,8,async card=>{
    let raw='',text='',detailOk=false
    try{
      const rr=await get(card.link,10000)
      if(rr.status===404||rr.status===410)return null as any
      if(rr.ok){
        raw=await rr.text();text=strip(raw)
        if(/обявата\s+(?:вече\s+)?(?:не\s+е\s+активна|е\s+изтрита|не\s+е\s+налична)/i.test(text))return null as any
        detailOk=true;detailSuccess++
      }
    }catch{}

    const pm=detailOk?(raw.match(/<span class=["']price["']>\s*([0-9 ]+)\s*<span class=["']currency["']>\s*€/i)||text.match(/([0-9][0-9 ]{3,})\s*€/i)):null
    const pr=(pm?priceValue(pm[1]):null)??card.price
    const am=detailOk?text.match(/([0-9]+(?:[.,][0-9]+)?)\s*кв\.?\s*м/i):null
    const ar=(am?numberValue(am[1]):null)??card.area

    if(pmin!=null&&(pr==null||pr<pmin))return null as any
    if(pmax!=null&&(pr==null||pr>pmax))return null as any
    if(amin!=null&&(ar==null||ar<amin))return null as any
    if(amax!=null&&(ar==null||ar>amax))return null as any

    const b=detailOk?build(text):null
    if(cons.length&&b&&!cons.includes(norm(b)))return null as any
    const s=detailOk?seller(raw,text):{type:'unknown',name:null}
    if(!detailOk)listFallback++

    const id=card.link.match(/obiava-(\d+)/)?.[1]||card.link
    const title=detailOk?(raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||type+' · '+district).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim():type+' · '+district

    return{id:'bazar:'+id,score:100,status:'new',created_at:new Date().toISOString(),offers:{id:'bazar:'+id,title,original_url:card.link,property_type:type,deal_type:deal==='rent'?'rent':'sale',district,price_eur:pr,area_sqm:ar,construction_type:b,advertiser_type:s.type,advertiser_name:s.name,is_active:true,offer_sources:{name:'Bazar.bg'}}}
  })

  const hasMore=new RegExp('[?&]page='+(page+1)+'(?:["&]|$)','i').test(html)||new RegExp('>\\s*'+(page+1)+'\\s*<','i').test(html)&&links.length>0
  return NextResponse.json({ok:true,source:'Bazar.bg',page,items,has_more:hasMore,raw_count:links.length,candidate_count:cards.length,detail_success:detailSuccess,list_fallback:listFallback,page_signature:links.slice(0,12).join('|')})
}
