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
  const t=text.toLowerCase().replace(/\s+/g,' ').trim()
  const patterns=[
    /обявата.{0,100}вече\s+не\s+е\s+активна/i,
    /обявата.{0,100}не\s+е\s+активна/i,
    /тази\s+обява.{0,100}не\s+е\s+активна/i,
    /обявата.{0,100}е\s+изтрита/i,
    /обявата.{0,100}е\s+свалена/i,
    /обявата.{0,100}не\s+е\s+налична/i,
    /офертата.{0,100}не\s+е\s+активна/i,
    /офертата.{0,100}е\s+изтекла/i,
    /неактивна\s+обява/i,
    /неактивна\s+оферта/i,
    /изтекла\s+обява/i,
    /изтекла\s+оферта/i,
    /listing\s+is\s+no\s+longer\s+available/i,
    /ad\s+is\s+no\s+longer\s+available/i,
    /listing\s+has\s+expired/i,
    /offer\s+expired/i
  ]
  return patterns.some(re=>re.test(t))
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
