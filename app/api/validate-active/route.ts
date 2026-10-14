import { NextRequest, NextResponse } from 'next/server'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36'
const ALLOWED=[
  'imot.bg','www.imot.bg','homes.bg','www.homes.bg','bazar.bg','www.bazar.bg',
  'alo.bg','www.alo.bg','imoti.net','www.imoti.net','domaza.bg','www.domaza.bg',
  'yavlena.com','www.yavlena.com','olx.bg','www.olx.bg','estateassistant.eu','app.estateassistant.eu'
]

function inactiveText(text:string){
  const t=text.toLowerCase().replace(/\s+/g,' ')
  return [
    'обявата вече не е активна','обявата не е активна','обявата е изтрита','обявата не е налична',
    'тази обява вече не е активна','тази обява е изтрита','офертата е неактивна',
    'inactive listing','listing is no longer available','listing has expired','offer expired',
    'неактивна оферта','изтекла обява','изтекла оферта'
  ].some(x=>t.includes(x))
}

async function check(url:string){
  let u:URL
  try{u=new URL(url)}catch{return {url,status:'unknown',reason:'bad_url'}}
  if(!ALLOWED.includes(u.hostname))return {url,status:'unknown',reason:'unsupported_host'}
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),9000)
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept-language':'bg-BG,bg;q=0.9'},redirect:'follow',cache:'no-store',signal:controller.signal})
    if(r.status===404||r.status===410)return {url,status:'inactive',reason:'http_'+r.status}
    if(r.status===401||r.status===403||r.status===429)return {url,status:'unknown',reason:'http_'+r.status}
    if(!r.ok)return {url,status:'unknown',reason:'http_'+r.status}
    const text=await r.text()
    if(inactiveText(text))return {url,status:'inactive',reason:'inactive_text'}
    return {url,status:'active',reason:'ok'}
  }catch(e:any){
    return {url,status:'unknown',reason:e?.name||'fetch_error'}
  }finally{clearTimeout(timer)}
}

export async function POST(req:NextRequest){
  const body=await req.json().catch(()=>null)
  const urls=Array.isArray(body?.urls)?body.urls.filter((x:any)=>typeof x==='string').slice(0,50):[]
  const results=await Promise.all(urls.map(check))
  return NextResponse.json({ok:true,results})
}
