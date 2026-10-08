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

  async function load(){
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){router.replace('/login');return}
    const{data,error}=await supabase
      .from('offer_matches')
      .select('*,buyers(full_name,buyer_searches(districts)),offers!inner(*,offer_sources(name))')
      .eq('is_current',true)
      .eq('offers.is_active',true)
      .order('created_at',{ascending:false})
    if(error){setMsg(error.message);return}
    setRows((data||[]).filter(districtMatches))
  }

  useEffect(()=>{load()},[])

  async function mark(id:string,status:string){
    const{error}=await supabase.from('offer_matches').update({status,reviewed_at:new Date().toISOString(),score:100}).eq('id',id)
    if(error){setMsg(error.message);return}
    setRows(r=>r.map(x=>x.id===id?{...x,status,score:100}:x))
  }

  async function removeMatch(r:any){
    if(!window.confirm(`Да изтрия ли съвпадението за „${r.buyers?.full_name||'купувача'}“?`))return
    const{error}=await supabase.from('offer_matches').delete().eq('id',r.id)
    if(error){setMsg(`Не успях да изтрия съвпадението: ${error.message}`);return}
    setRows(x=>x.filter(v=>v.id!==r.id))
    setMsg('Съвпадението е изтрито.')
  }

  return <>
    <div className="topline"><div><div className="eyebrow">Купувач ↔ Нова оферта</div><h1>Нови съвпадения</h1><div className="subtitle">Всички оферти по критериите на купувача — частни лица, агенции и неуточнени податели. Районът трябва да съвпада точно.</div></div></div>
    {msg&&<div className={msg.startsWith('Съвпадението')?'ok':'err'} style={{marginBottom:14}}>{msg}</div>}
    <div className="listCard">{rows.length?rows.map(r=><div className="matchRow" key={r.id}>
      <div className="score">100%</div><span className="pill private">Активна</span>
      <div className="grow"><b>{r.buyers?.full_name} — {r.offers?.title||r.offers?.property_type||'Оферта'}</b><div className="meta">{r.offers?.offer_sources?.name||'Източник'}{r.offers?.advertiser_name?` · Подател: ${r.offers.advertiser_name}`:''} · Район: {r.offers?.district||'—'} · {r.offers?.price_eur?`€${Number(r.offers.price_eur).toLocaleString('bg-BG')}`:'без цена'} · {r.offers?.area_sqm?`${r.offers.area_sqm} кв.м`:'без площ'}</div><div className="meta" style={{marginTop:7}}>{r.offers?.advertiser_type==='private'?'Частно лице':r.offers?.advertiser_type==='agency'?'Агенция':'Неуточнен подател'} · Районът е точно съвпаднал.</div></div>
      <div style={{display:'flex',gap:7,flexWrap:'wrap',justifyContent:'flex-end'}}>
        {r.offers?.original_url&&<a className="btn" target="_blank" rel="noreferrer" href={r.offers.original_url}><ExternalLink size={15}/>Линк</a>}
        <button className="btn" onClick={()=>mark(r.id,'unsuitable')}>Не</button>
        <button className="btn primary" onClick={()=>mark(r.id,'suitable')}>Подходяща</button>
        <button className="btn" onClick={()=>removeMatch(r)}><Trash2 size={15}/>Изтрий</button>
      </div>
    </div>):<div className="empty" style={{margin:'14px 0'}}>Няма нови съвпадения по задължителния район.</div>}</div>
  </>
}
