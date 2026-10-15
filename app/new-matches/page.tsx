'use client'

import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {ExternalLink,Trash2} from 'lucide-react'
import {supabase} from '@/lib/supabase'

const norm=(v:any)=>String(v||'').toLowerCase().trim()

export default function Matches(){
  const router=useRouter()
  const[rows,setRows]=useState<any[]>([])
  const[msg,setMsg]=useState('')

  function districtMatches(r:any){
    const offerDistrict=norm(r.offers?.district)
    const districts=r.buyers?.buyer_searches?.[0]?.districts||[]
    if(!offerDistrict||!districts.length)return false
    return districts.some((d:string)=>offerDistrict===norm(d))
  }

  function variant(r:any){
    return{
      match_id:r.id,
      url:r.offers?.original_url||'',
      source:r.offers?.offer_sources?.name||'Източник',
      price:r.offers?.price_eur??null,
      area:r.offers?.area_sqm??null
    }
  }

  function dedupeRows(input:any[]){
    const out:any[]=[]
    const byKey=new Map<string,any>()
    for(const r of input){
      const o=r.offers||{}
      const fingerprint=String(o.description_fingerprint||'')
      const key=fingerprint
        ? [norm(o.property_type),norm(o.district),fingerprint].join('|')
        : 'url|'+String(o.original_url||o.id||r.id).split('#')[0]
      const existing=byKey.get(key)
      if(existing){
        const variants=existing._variants||[variant(existing)]
        const v=variant(r)
        if(!variants.some((x:any)=>x.url&&v.url&&x.url===v.url))variants.push(v)
        existing._variants=variants
        existing._matchIds=[...(existing._matchIds||[existing.id]),r.id]
      }else{
        const item={...r,_variants:[variant(r)],_matchIds:[r.id]}
        byKey.set(key,item);out.push(item)
      }
    }
    return out
  }

  async function validateActiveRows(input:any[]){
    const ids=[...new Set(input.map((r:any)=>r?.offers?.id).filter(Boolean))]
    if(!ids.length)return []
    const activeIds=new Set<string>()
    for(let i=0;i<ids.length;i+=100){
      try{
        const {data,error}:any=await supabase.functions.invoke('validate-offer-links',{
          body:{offer_ids:ids.slice(i,i+100)}
        })
        if(error)continue
        for(const item of data?.results||[])if(item?.status==='active'&&item?.id)activeIds.add(String(item.id))
      }catch{}
    }
    return input.filter((r:any)=>activeIds.has(String(r?.offers?.id||'')))
  }

  async function load(){
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){router.replace('/login');return}
    const all:any[]=[]
    const pageSize=1000
    for(let from=0;;from+=pageSize){
      const{data,error}=await supabase
        .from('offer_matches')
        .select('*,buyers(full_name,buyer_searches(districts)),offers!inner(*,offer_sources(name))')
        .eq('is_current',true)
        .eq('offers.is_active',true)
        .order('created_at',{ascending:false})
        .range(from,from+pageSize-1)
      if(error){setMsg(error.message);return}
      all.push(...(data||[]))
      if((data||[]).length<pageSize)break
    }
    const districtRows=all.filter(districtMatches)
    const activeRows=await validateActiveRows(districtRows)
    setRows(dedupeRows(activeRows))
  }

  useEffect(()=>{load()},[])

  async function mark(r:any,status:string){
    const ids=r._matchIds||[r.id]
    const{error}=await supabase.from('offer_matches').update({status,reviewed_at:new Date().toISOString(),score:100}).in('id',ids)
    if(error){setMsg(error.message);return}
    setRows(rows=>rows.map(x=>x.id===r.id?{...x,status,score:100}:x))
  }

  async function removeMatch(r:any){
    const ids=r._matchIds||[r.id]
    if(!window.confirm(`Да изтрия ли съвпадението за „${r.buyers?.full_name||'купувача'}“${ids.length>1?` и всичките му ${ids.length} дублирани публикации`:''}?`))return
    const{error}=await supabase.from('offer_matches').delete().in('id',ids)
    if(error){setMsg(`Не успях да изтрия съвпадението: ${error.message}`);return}
    setRows(x=>x.filter(v=>v.id!==r.id))
    setMsg(ids.length>1?'Дублираните съвпадения са изтрити.':'Съвпадението е изтрито.')
  }

  return <>
    <div className="topline"><div><div className="eyebrow">Купувач ↔ Нова оферта</div><h1>Нови съвпадения</h1><div className="subtitle">Всички оферти по критериите на купувача — частни лица, агенции и неуточнени податели. Районът трябва да съвпада точно.</div></div></div>
    {msg&&<div className={msg.startsWith('Съвпадението')?'ok':'err'} style={{marginBottom:14}}>{msg}</div>}
    <div className="listCard">{rows.length?rows.map(r=><div className="matchRow" key={r.id}>
      <div className="score">100%</div><span className="pill private">Активна</span>
      <div className="grow"><b>{r.buyers?.full_name} — {r.offers?.title||r.offers?.property_type||'Оферта'}</b><div className="meta">{r.offers?.offer_sources?.name||'Източник'}{r.offers?.advertiser_name?` · Подател: ${r.offers.advertiser_name}`:''} · Район: {r.offers?.district||'—'} · {r.offers?.price_eur?`€${Number(r.offers.price_eur).toLocaleString('bg-BG')}`:'без цена'} · {r.offers?.area_sqm?`${r.offers.area_sqm} кв.м`:'без площ'}</div><div className="meta" style={{marginTop:7}}>{r.offers?.advertiser_type==='private'?'Частно лице':r.offers?.advertiser_type==='agency'?'Агенция':'Неуточнен подател'} · Районът е точно съвпаднал.</div>{(r._variants||[]).length>1&&<div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}><span className="tag">{r._variants.length} публикации със същото описание</span>{r._variants.map((v:any,i:number)=>v.url?<a key={v.url||i} className="btn" target="_blank" rel="noreferrer" href={v.url}>{v.source}{v.price?` · €${Number(v.price).toLocaleString('bg-BG')}`:''}</a>:null)}</div>}</div>
      <div style={{display:'flex',gap:7,flexWrap:'wrap',justifyContent:'flex-end'}}>
        {r.offers?.original_url&&<a className="btn" target="_blank" rel="noreferrer" href={r.offers.original_url}><ExternalLink size={15}/>Линк</a>}
        <button className="btn" onClick={()=>mark(r,'unsuitable')}>Не</button>
        <button className="btn primary" onClick={()=>mark(r,'suitable')}>Подходяща</button>
        <button className="btn" onClick={()=>removeMatch(r)}><Trash2 size={15}/>Изтрий</button>
      </div>
    </div>):<div className="empty" style={{margin:'14px 0'}}>Няма нови съвпадения по задължителния район.</div>}</div>
  </>
}
