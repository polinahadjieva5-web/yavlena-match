'use client'

import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {Plus,X,Search,Bell,BellOff,ExternalLink,Pencil,Trash2} from 'lucide-react'
import {supabase} from '@/lib/supabase'

const empty={
  full_name:'',phone:'',email:'',notes:'',deal_type:'purchase',districts:'',property_types:'3-стаен',
  price_min:'',price_max:'',area_min:'',area_max:'',bedrooms_min:'',floor_min:'',floor_max:'',
  construction_types:'',act16_level:'',elevator_level:'',parking_level:'',year_min:'',free_text:'',
  monitoring_interval_minutes:'15'
}

const split=(v:string)=>v.split(',').map(s=>s.trim()).filter(Boolean)
const numOrNull=(v:any)=>v===''||v===null||v===undefined?null:Number(v)
const norm=(v:any)=>String(v||'').toLowerCase().trim()

export default function Buyers(){
  const router=useRouter()
  const[buyers,setBuyers]=useState<any[]>([])
  const[open,setOpen]=useState(false)
  const[editing,setEditing]=useState<any|null>(null)
  const[f,setF]=useState<any>(empty)
  const[busy,setBusy]=useState(false)
  const[msg,setMsg]=useState('')
  const[searching,setSearching]=useState<string|null>(null)
  const[selected,setSelected]=useState<any|null>(null)
  const[results,setResults]=useState<any[]>([])
  const[searchInfo,setSearchInfo]=useState('')

  async function load(){
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){router.replace('/login');return}
    const{data}=await supabase.from('buyers').select('*,buyer_searches(*)').order('created_at',{ascending:false})
    setBuyers(data||[])
  }
  useEffect(()=>{load()},[])

  function openCreate(){setEditing(null);setF(empty);setMsg('');setOpen(true)}
  function openEdit(b:any){
    const s=b.buyer_searches?.[0]||{}
    setEditing(b)
    setF({
      full_name:b.full_name||'',phone:b.phone||'',email:b.email||'',notes:b.notes||'',deal_type:s.deal_type||'purchase',
      districts:(s.districts||[]).join(', '),property_types:(s.property_types||[]).join(', '),
      price_min:s.price_min??'',price_max:s.price_max??'',area_min:s.area_min??'',area_max:s.area_max??'',
      bedrooms_min:s.bedrooms_min??'',floor_min:s.floor_min??'',floor_max:s.floor_max??'',
      construction_types:(s.construction_types||[]).join(', '),act16_level:s.act16_level||'',
      elevator_level:s.elevator_level||'',parking_level:s.parking_level||'',year_min:s.year_min??'',
      free_text:s.free_text||'',monitoring_interval_minutes:s.monitoring_interval_minutes??15
    })
    setMsg('');setOpen(true)
  }

  function searchPayload(){
    return{
      deal_type:f.deal_type,
      property_types:split(f.property_types),districts:split(f.districts),construction_types:split(f.construction_types),
      price_min:numOrNull(f.price_min),price_max:numOrNull(f.price_max),area_min:numOrNull(f.area_min),area_max:numOrNull(f.area_max),
      bedrooms_min:numOrNull(f.bedrooms_min),floor_min:numOrNull(f.floor_min),floor_max:numOrNull(f.floor_max),
      act16_level:f.act16_level||null,elevator_level:f.elevator_level||null,parking_level:f.parking_level||null,
      year_min:numOrNull(f.year_min),free_text:f.free_text||null,
      min_match_score:0,instant_notify_score:0,
      monitoring_interval_minutes:Number(f.monitoring_interval_minutes||15),updated_at:new Date().toISOString()
    }
  }

  async function saveBuyer(e:React.FormEvent){
    e.preventDefault();setBusy(true);setMsg('')
    const{data:{user}}=await supabase.auth.getUser();if(!user){setBusy(false);return}
    if(editing){
      const{error:be}=await supabase.from('buyers').update({full_name:f.full_name,phone:f.phone||null,email:f.email||null,notes:f.notes||null,updated_at:new Date().toISOString()}).eq('id',editing.id)
      if(be){setMsg(be.message);setBusy(false);return}
      const sid=editing.buyer_searches?.[0]?.id
      const{error:se}=sid
        ?await supabase.from('buyer_searches').update(searchPayload()).eq('id',sid)
        :await supabase.from('buyer_searches').insert({...searchPayload(),buyer_id:editing.id})
      if(se){setMsg(se.message);setBusy(false);return}
    }else{
      const{data:b,error}=await supabase.from('buyers').insert({broker_id:user.id,full_name:f.full_name,phone:f.phone||null,email:f.email||null,notes:f.notes||null}).select().single()
      if(error){setMsg(error.message);setBusy(false);return}
      const{error:se}=await supabase.from('buyer_searches').insert({...searchPayload(),buyer_id:b.id})
      if(se){setMsg(se.message);setBusy(false);return}
    }
    setOpen(false);setEditing(null);setF(empty);setBusy(false);await load()
  }

  async function deleteBuyer(b:any){
    if(!window.confirm(`Да изтрия ли купувача „${b.full_name}“ и цялата му история?`))return
    const{error}=await supabase.from('buyers').delete().eq('id',b.id)
    if(error){setMsg(`Не успях да изтрия купувача: ${error.message}`);return}
    if(selected?.id===b.id){setSelected(null);setResults([])}
    await load()
  }

  function timed<T>(p:Promise<T>,ms:number,label:string){
    return Promise.race<T>([p,new Promise<T>((_,reject)=>setTimeout(()=>reject(new Error(`${label} не отговори навреме.`)),ms))])
  }

  function offerPasses(o:any,s:any){
    if(!o||!s)return false
    const txt=norm(`${o.title||''} ${o.description||''} ${o.district||''} ${o.construction_type||''}`)
    if(s.districts?.length&&!s.districts.some((d:string)=>txt.includes(norm(d))))return false
    if(s.property_types?.length&&!s.property_types.some((p:string)=>txt.includes(norm(p))||txt.includes(norm(p).replace('-стаен','стаен'))))return false
    if(s.price_min&&(o.price_eur==null||Number(o.price_eur)<Number(s.price_min)))return false
    if(s.price_max&&(o.price_eur==null||Number(o.price_eur)>Number(s.price_max)))return false
    if(s.area_min&&(o.area_sqm==null||Number(o.area_sqm)<Number(s.area_min)))return false
    if(s.area_max&&(o.area_sqm==null||Number(o.area_sqm)>Number(s.area_max)))return false
    if(s.bedrooms_min&&(o.bedrooms==null||Number(o.bedrooms)<Number(s.bedrooms_min)))return false
    if(s.floor_min&&(o.floor==null||Number(o.floor)<Number(s.floor_min)))return false
    if(s.floor_max&&(o.floor==null||Number(o.floor)>Number(s.floor_max)))return false
    if(s.construction_types?.length){
      if(!o.construction_type||!s.construction_types.some((x:string)=>norm(o.construction_type).includes(norm(x))||norm(x).includes(norm(o.construction_type))))return false
    }
    if(s.year_min&&(o.construction_year==null||Number(o.construction_year)<Number(s.year_min)))return false
    if(s.act16_level==='required'&&o.has_act16!==true)return false
    if(s.elevator_level==='required'&&o.has_elevator!==true)return false
    if(s.parking_level==='required'&&o.has_parking!==true)return false
    return true
  }

  async function searchNow(b:any){
    const s=b.buyer_searches?.[0];if(!s)return
    setSearching(b.id);setMsg('');setSelected(b);setResults([])
    setSearchInfo(`Прилагам: ${(s.property_types||[]).join(', ')||'всички типове'} · ${(s.districts||[]).join(', ')||'всички райони'}${s.price_min?` · от €${Number(s.price_min).toLocaleString('bg-BG')}`:''}${s.price_max?` · до €${Number(s.price_max).toLocaleString('bg-BG')}`:''}${s.area_min?` · от ${s.area_min} кв.м`:''}${s.area_max?` · до ${s.area_max} кв.м`:''}`)
    const startedAt=new Date().toISOString()
    try{
      const{data,error}:any=await timed(supabase.functions.invoke('portal-search',{body:{buyer_id:b.id,run_type:'manual'}}) as any,65000,'Търсенето')
      if(error)setMsg(`Търсенето не успя: ${error.message}`)
      else{
        const details=(data?.portal_stats||[]).map((x:any)=>`${x.source}: ${x.count??0}`).join(' · ')
        setMsg(`Готово: намерени ${data?.total||0} оферти${details?` · ${details}`:''}`)
      }
    }catch(e:any){setMsg(e.message||'Търсенето прекъсна.')}
    const{data:r}=await supabase.from('search_run_results').select('*,offers(*)').eq('buyer_id',b.id).gte('created_at',startedAt).order('created_at',{ascending:false}).limit(300)
    const seen=new Set<string>()
    setResults((r||[]).filter((x:any)=>offerPasses(x.offers,s)).filter((x:any)=>{const id=x.offers?.id||x.offer_id;if(seen.has(id))return false;seen.add(id);return true}))
    setSearching(null);setSearchInfo('');await load()
  }

  async function toggleMonitoring(b:any){
    const s=b.buyer_searches?.[0];if(!s)return
    const next=!s.monitoring_enabled
    await supabase.from('buyer_searches').update({monitoring_enabled:next,notifications_enabled:next,updated_at:new Date().toISOString()}).eq('id',s.id)
    await load()
  }

  async function openResults(b:any){
    const s=b.buyer_searches?.[0];setSelected(b)
    const{data:r}=await supabase.from('search_run_results').select('*,offers(*)').eq('buyer_id',b.id).order('created_at',{ascending:false}).limit(500)
    const seen=new Set<string>()
    const filtered=(r||[]).filter((x:any)=>offerPasses(x.offers,s)).filter((x:any)=>{const id=x.offers?.id||x.offer_id;if(seen.has(id))return false;seen.add(id);return true})
    setResults(filtered.slice(0,150))
  }

  return <>
    <div className="topline"><div><div className="eyebrow">Клиентски търсения</div><h1>Моите купувачи</h1><div className="subtitle">Подробни критерии, фирмени източници, история и постоянен мониторинг.</div></div><button className="btn primary" onClick={openCreate}><Plus size={17}/>Добави купувач</button></div>
    {searchInfo&&<div className="ok" style={{marginBottom:10}}>{searchInfo}</div>}
    {msg&&<div className={msg.startsWith('Готово')?'ok':'err'} style={{marginBottom:14}}>{msg}</div>}

    <div className="listCard">
      {buyers.length?buyers.map(b=>{const s=b.buyer_searches?.[0];return <div className="buyerBlock" key={b.id}>
        <div className="buyerRow"><span className="statusDot"/><div className="grow"><b>{b.full_name}</b><div className="meta">{(s?.property_types||[]).join(', ')||'Имот'} · {(s?.districts||[]).join(', ')||'Всички райони'} · {s?.price_min?`от €${Number(s.price_min).toLocaleString('bg-BG')} · `:''}{s?.price_max?`до €${Number(s.price_max).toLocaleString('bg-BG')}`:'без горен лимит'}{s?.area_min?` · от ${s.area_min} кв.м`:''}{s?.area_max?` · до ${s.area_max} кв.м`:''}</div><div className="meta">{s?.floor_min!=null?`етаж от ${s.floor_min} · `:''}{s?.floor_max!=null?`етаж до ${s.floor_max} · `:''}{(s?.construction_types||[]).length?`${s.construction_types.join(', ')} · `:''}{s?.year_min?`след ${s.year_min} г. · `:''}{s?.last_manual_search_at?`последно търсене ${new Date(s.last_manual_search_at).toLocaleString('bg-BG')}`:'няма стартирано търсене'}</div></div><span className="tag">{s?.monitoring_enabled?'Мониторинг включен':'Мониторинг изключен'}</span></div>
        <div className="buyerActions"><button className="btn primary" onClick={()=>searchNow(b)} disabled={searching===b.id}><Search size={16}/>{searching===b.id?'Търся по всички критерии...':'Потърси оферти'}</button><button className="btn" onClick={()=>openResults(b)}>Виж резултати</button><button className="btn" onClick={()=>toggleMonitoring(b)}>{s?.monitoring_enabled?<BellOff size={16}/>:<Bell size={16}/>} {s?.monitoring_enabled?'Спри известия':'Включи известия'}</button><button className="btn" onClick={()=>openEdit(b)}><Pencil size={15}/>Редактирай</button><button className="btn" onClick={()=>deleteBuyer(b)}><Trash2 size={15}/>Изтрий</button></div>
      </div>}):<div className="empty" style={{margin:'14px 0'}}>Няма добавени купувачи.</div>}
    </div>

    {selected&&<div className="card resultsCard"><div className="toolbar"><div><h2 style={{margin:0}}>Оферти за {selected.full_name}</h2><div className="meta">Показват се само оферти, които покриват всички зададени задължителни критерии. Валидната оферта е 100% съвпадение.</div></div><button className="btn" onClick={()=>setSelected(null)}>Скрий</button></div>
      {results.length?results.sort((a,b)=>new Date(b.offers?.source_published_at||b.created_at).getTime()-new Date(a.offers?.source_published_at||a.created_at).getTime()).map(r=><div className="offerResult" key={r.id}><div className="grow"><div className="offerTop"><b>{r.offers?.title||'Имотна оферта'}</b><span className={r.offers?.advertiser_type==='private'?'pill private':r.offers?.advertiser_type==='agency'?'pill agency':'pill'}>{r.offers?.advertiser_type==='private'?'Частно лице':r.offers?.advertiser_type==='agency'?'Агенция':'Неуточнен подател'}</span></div><div className="meta">{r.offers?.district||'—'} · {r.offers?.price_eur?`€${Number(r.offers.price_eur).toLocaleString('bg-BG')}`:'без цена'}{r.offers?.area_sqm?` · ${r.offers.area_sqm} кв.м`:''}{r.offers?.floor!=null?` · ет. ${r.offers.floor}`:''}{r.offers?.construction_type?` · ${r.offers.construction_type}`:''} · съвпадение 100% · {r.offers?.source_published_at?new Date(r.offers.source_published_at).toLocaleString('bg-BG'):'открита при последната проверка'}</div></div>{r.offers?.original_url&&<a className="btn" href={r.offers.original_url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Отвори</a>}</div>):<div className="empty">Няма оферти, които да покриват текущите критерии.</div>}
    </div>}

    {open&&<div className="modalBack"><form className="modal" onSubmit={saveBuyer}><div className="modalHead"><div><div className="eyebrow">{editing?'Редакция на клиент':'Нов клиент'}</div><h2 style={{margin:'4px 0'}}>Подробни критерии за търсене</h2></div><button type="button" className="x" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <div className="formGrid">
        <div className="field"><label>Име на клиента</label><input required value={f.full_name} onChange={e=>setF({...f,full_name:e.target.value})}/></div>
        <div className="field"><label>Телефон</label><input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></div>
        <div className="field"><label>Имейл</label><input type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></div>
        <div className="field"><label>Сделка</label><select value={f.deal_type} onChange={e=>setF({...f,deal_type:e.target.value})}><option value="purchase">Покупка</option><option value="rent">Наем</option></select></div>
        <div className="field full"><label>Типове имоти — раздели със запетая</label><input value={f.property_types} onChange={e=>setF({...f,property_types:e.target.value})} placeholder="3-стаен, 4-стаен"/></div>
        <div className="field full"><label>Райони — раздели със запетая</label><input required value={f.districts} onChange={e=>setF({...f,districts:e.target.value})} placeholder="Изток, Изгрев"/></div>
        <div className="field"><label>Цена от (€)</label><input type="number" value={f.price_min} onChange={e=>setF({...f,price_min:e.target.value})}/></div>
        <div className="field"><label>Цена до (€)</label><input type="number" value={f.price_max} onChange={e=>setF({...f,price_max:e.target.value})}/></div>
        <div className="field"><label>Площ от (кв.м)</label><input type="number" value={f.area_min} onChange={e=>setF({...f,area_min:e.target.value})}/></div>
        <div className="field"><label>Площ до (кв.м)</label><input type="number" value={f.area_max} onChange={e=>setF({...f,area_max:e.target.value})}/></div>
        <div className="field"><label>Минимум спални</label><input type="number" min="0" value={f.bedrooms_min} onChange={e=>setF({...f,bedrooms_min:e.target.value})}/></div>
        <div className="field"><label>Година на строителство от</label><input type="number" min="1800" max="2100" value={f.year_min} onChange={e=>setF({...f,year_min:e.target.value})}/></div>
        <div className="field"><label>Етаж от</label><input type="number" value={f.floor_min} onChange={e=>setF({...f,floor_min:e.target.value})}/></div>
        <div className="field"><label>Етаж до</label><input type="number" value={f.floor_max} onChange={e=>setF({...f,floor_max:e.target.value})}/></div>
        <div className="field full"><label>Строителство — раздели със запетая</label><input value={f.construction_types} onChange={e=>setF({...f,construction_types:e.target.value})} placeholder="Тухла, ЕПК"/></div>
        <div className="field"><label>Акт 16</label><select value={f.act16_level} onChange={e=>setF({...f,act16_level:e.target.value})}><option value="">Без значение</option><option value="required">Задължително</option><option value="preferred">Предпочитано</option></select></div>
        <div className="field"><label>Асансьор</label><select value={f.elevator_level} onChange={e=>setF({...f,elevator_level:e.target.value})}><option value="">Без значение</option><option value="required">Задължително</option><option value="preferred">Предпочитано</option></select></div>
        <div className="field"><label>Гараж / паркомясто</label><select value={f.parking_level} onChange={e=>setF({...f,parking_level:e.target.value})}><option value="">Без значение</option><option value="required">Задължително</option><option value="preferred">Предпочитано</option></select></div>
        <div className="field"><label>Проверка при мониторинг (минути)</label><input type="number" min="5" value={f.monitoring_interval_minutes} onChange={e=>setF({...f,monitoring_interval_minutes:e.target.value})}/></div>
        <div className="field full"><label>Допълнителни условия / бележки за имота</label><textarea value={f.free_text} onChange={e=>setF({...f,free_text:e.target.value})} placeholder="напр. южно изложение, тиха улица, близо до метро"/></div>
        <div className="field full"><label>Бележки за клиента</label><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></div>
      </div>
      {msg&&<div className="err">{msg}</div>}
      <div style={{display:'flex',justifyContent:'flex-end',gap:9,marginTop:20}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Отказ</button><button className="btn primary" disabled={busy}>{busy?'Записване...':editing?'Запази промените':'Създай търсене'}</button></div>
    </form></div>}
  </>
}
