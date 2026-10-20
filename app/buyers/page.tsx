'use client'

import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {Plus,X,Search,Bell,BellOff,ExternalLink,Pencil,Trash2} from 'lucide-react'
import {supabase} from '@/lib/supabase'
import {saveSearchRun,appendSearchOffers,completeSearchRun,listBuyerSearches,deleteBuyerSearches} from '@/lib/search-history'
import type {SavedSearch} from '@/lib/search-history'

const empty={
  full_name:'',phone:'',email:'',notes:'',deal_type:'purchase',districts:'',property_types:'3-стаен',
  price_min:'',price_max:'',area_min:'',area_max:'',bedrooms_min:'',floor_min:'',floor_max:'',
  construction_types:'',act16_level:'',elevator_level:'',parking_level:'',year_min:'',free_text:'',
  monitoring_interval_minutes:'15'
}

const split=(v:string)=>v.split(',').map(s=>s.trim()).filter(Boolean)
const numOrNull=(v:any)=>v===''||v===null||v===undefined?null:Number(v)
const norm=(v:any)=>String(v||'').toLowerCase().trim()

function advertiserCategory(r:any):'private'|'agency'|'unknown'{
  const o=r?.offers||{}
  const source=norm(o.offer_sources?.name)
  const name=norm(o.advertiser_name)
  const description=norm(o.description)
  const declared=norm(o.advertiser_type)
  // An identified agency outranks a generic claim such as "без брокер".
  if(source.includes('yavlena')||/(?:^|[\s.,-])(агенция|недвижими имоти|имоти|естейт|estate|properties|realty|пропъртис|брокер|оод|еоод)(?:$|[\s.,-])/i.test(name))return'agency'
  if(/(?:агенция(?:та)?\s+(?:за\s+недвижими\s+имоти\s+)?(?:предлага|представя|продава|отдава)|брокер(?:ът)?\s+(?:предлага|представя)|нашата\s+агенция|оферта\s+на\s+агенция)/i.test(description))return'agency'
  if(declared==='agency')return'agency'
  if(declared==='private'){
    // Old Estate Assistant and Imot.bg data could incorrectly infer private sellers.
    if(source==='imot.bg')return'private' // This public source uses the explicit publisher contact label.
    if(source.includes('estate assistant')||source.includes('imot.bg')){
      return /(?:аз\s+съм\s+собственик|собственик\s+съм|собственик\s+(?:продава|отдава)|(?:директно|лично)\s+от\s+собственик|(?:продавам|отдавам)\s+лично|частно\s+лице\s+(?:продава|отдава))/i.test(description)?'private':'unknown'
    }
    return'private'
  }
  return'unknown'
}

function normalizeDescriptionForDedupe(value:any){
  const text=String(value||'')
    .toLowerCase()
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/\s+/g,' ')
    .trim()
  const words=text.split(' ').filter(Boolean)
  if(text.length<80||words.length<12)return''
  return text
}

function duplicateDescriptionKey(r:any){
  const o=r?.offers||{}
  const description=normalizeDescriptionForDedupe(o.description)
  if(!description)return''
  return [norm(o.offer_sources?.name),norm(o.property_type),norm(o.district),description].join('|')
}

function offerVariant(r:any){
  const o=r?.offers||{}
  return{
    id:o.id||r?.id,
    url:o.original_url||'',
    source:o.offer_sources?.name||'Източник',
    price:o.price_eur??null,
    area:o.area_sqm??null,
    advertiser_type:o.advertiser_type||'unknown',
    advertiser_name:o.advertiser_name||null
  }
}


const PROPERTY_TYPES=['1-стаен','2-стаен','3-стаен','4-стаен','Многостаен','Мезонет','Ателие / студио','Къща','Вила','Парцел','Гараж','Офис','Магазин']
const DISTRICTS=[
  '7-ми 11-ти километър','Абдовица','Банишора','Белите брези','Бенковски','Борово','Бояна','Бъкстон','Витоша','Военна рампа',
  'Враждебна','Гевгелийски','Гео Милев','Горна баня','Горубляне','Дианабад','Докторски паметник','Драгалевци','Дружба 1','Дружба 2',
  'Дървеница','Западен парк','Захарна фабрика','Зона Б-5','Зона Б-18','Зона Б-19','Иван Вазов','Изгрев','Изток','Илинден',
  'Карпузица','Княжево','Красна поляна 1','Красна поляна 2','Красна поляна 3','Красно село','Кръстова вада','Лагера','Левски','Левски В',
  'Левски Г','Лозенец','Люлин 1','Люлин 2','Люлин 3','Люлин 4','Люлин 5','Люлин 6','Люлин 7','Люлин 8','Люлин 9','Люлин 10',
  'Малинова долина','Манастирски ливади','Медицинска академия','Младост 1','Младост 1А','Младост 2','Младост 3','Младост 4','Модерно предградие',
  'Мусагеница','Надежда 1','Надежда 2','Надежда 3','Надежда 4','Обеля 1','Обеля 2','Оборище','Овча купел','Овча купел 1',
  'Овча купел 2','Орландовци','Павлово','Подуяне','Полигона','Разсадника','Редута','Република','Света Троица','Свобода',
  'Симеоново','Славия','Слатина','Стрелбище','Студентски град','Сухата река','Толстой','Триъгълника','Фондови жилища','Хаджи Димитър',
  'Хиподрума','Хладилника','Център','Яворов'
]
const CONSTRUCTION_TYPES=['Тухла','Панел','ЕПК','Гредоред','Ново строителство']
const FLOORS=Array.from({length:21},(_,i)=>i)
const YEARS=[1950,1960,1970,1980,1990,2000,2005,2010,2015,2020,2022,2023,2024,2025,2026]
const MONITORING_OPTIONS=[5,10,15,30,60,120,360,720,1440]
const PORTAL_NAMES=['Imot.bg','Imoti.net','Homes.bg','Bazar.bg','ALO.bg','Domaza','Yavlena.com','Estate Assistant','OLX']
const portalName=(r:any)=>String(r?.offers?.offer_sources?.name||'Неуточнен източник')


function MultiSelect({label,value,options,onChange,full=false,placeholder='Избери'}:any){
  const selected=split(value)
  function toggle(option:string){
    const next=selected.includes(option)?selected.filter((x:string)=>x!==option):[...selected,option]
    onChange(next.join(', '))
  }
  return <div className={full?'field full':'field'}>
    <label>{label}</label>
    <details className="multiSelect">
      <summary>{selected.length?selected.join(', '):placeholder}<span className="multiCount">{selected.length||''}</span></summary>
      <div className="multiMenu">
        {options.map((option:string)=><label className="multiOption" key={option}>
          <input type="checkbox" checked={selected.includes(option)} onChange={()=>toggle(option)}/>
          <span>{option}</span>
        </label>)}
      </div>
    </details>
  </div>
}

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
  const[resultsHidden,setResultsHidden]=useState(false)
  const[resultsLoading,setResultsLoading]=useState(false)
  const[resultFilter,setResultFilter]=useState<'all'|'private'|'agency'|'unknown'>('all')
  const[results,setResults]=useState<any[]>([])
  const[searchInfo,setSearchInfo]=useState('')
  const[searchProgress,setSearchProgress]=useState({done:0,total:7,label:''})
  const[deepScanning,setDeepScanning]=useState(false)
  const[sourceStatus,setSourceStatus]=useState('')
  const[history,setHistory]=useState<SavedSearch[]>([])
  const[activeRun,setActiveRun]=useState<SavedSearch|null>(null)
  const[historyWarning,setHistoryWarning]=useState('')
  const[portalErrors,setPortalErrors]=useState<Record<string,string>>({})
  const[portalProgress,setPortalProgress]=useState<Record<string,{pages:number;found:number;private:number;details:number;raw:number;status:string}>>({})
  const[supabaseIssues,setSupabaseIssues]=useState<string[]>([])
  const[exporting,setExporting]=useState(false)
  const[showPrivateCatalog,setShowPrivateCatalog]=useState(false)
  const[privateCatalog,setPrivateCatalog]=useState<any[]>([])
  const[loadingPrivateCatalog,setLoadingPrivateCatalog]=useState(false)
  const[privateCatalogError,setPrivateCatalogError]=useState('')
  const[privateCatalogTab,setPrivateCatalogTab]=useState<'private'|'unverified'>('private')

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
    if(!split(f.districts).length){setMsg('Избери поне един район.');setBusy(false);return}
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
    if(selected?.id===b.id){setSelected(null);setResults([]);setHistory([]);setActiveRun(null)}
    try{const{data:{user}}=await supabase.auth.getUser();if(user)await deleteBuyerSearches(user.id,b.id)}catch{}
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

  function mergeResults(...groups:any[][]){
    const out:any[]=[]
    const byUrl=new Map<string,any>()
    const byDescription=new Map<string,any>()

    const addVariant=(target:any,variant:any)=>{
      const current=Array.isArray(target._variants)?target._variants:[offerVariant(target)]
      if(!current.some((v:any)=>v.url&&variant.url&&v.url===variant.url)){
        target._variants=[...current,variant]
      }else target._variants=current
      target._duplicateCount=target._variants.length
      if((target.offers?.advertiser_type==='unknown'&&variant.advertiser_type!=='unknown')||(variant.advertiser_type==='agency'&&target.offers?.advertiser_type==='private')){
        target.offers={...target.offers,advertiser_type:variant.advertiser_type,advertiser_name:variant.advertiser_name||target.offers?.advertiser_name}
      }
    }

    for(const group of groups)for(const r of group||[]){
      const url=String(r?.offers?.original_url||'').split('#')[0].replace(/[?&](utm_[^=]+|fbclid)=[^&]+/g,'')
      const urlKey=url||String(r?.offers?.id||r?.id||'')
      const descKey=duplicateDescriptionKey(r)
      const existing=(descKey&&byDescription.get(descKey))||(urlKey&&byUrl.get(urlKey))

      if(existing){
        const incomingVariants=Array.isArray(r._variants)&&r._variants.length?r._variants:[offerVariant(r)]
        for(const variant of incomingVariants)addVariant(existing,variant)
        if(urlKey)byUrl.set(urlKey,existing)
        if(descKey)byDescription.set(descKey,existing)
        continue
      }

      const item={...r,_variants:Array.isArray(r._variants)&&r._variants.length?r._variants:[offerVariant(r)],_duplicateCount:Array.isArray(r._variants)&&r._variants.length?r._variants.length:1}
      out.push(item)
      if(urlKey)byUrl.set(urlKey,item)
      if(descKey)byDescription.set(descKey,item)
    }
    return out
  }

  async function fetchPortalPage(url:string,label:string){
    let lastError:any=null
    for(let attempt=1;attempt<=3;attempt++){
      try{
        const r:any=await timed(fetch(url,{cache:'no-store'}),55000,`${label} · опит ${attempt}`)
        if(r.ok)return r
        lastError=new Error(`${label} HTTP ${r.status}`)
      }catch(e:any){lastError=e}
    }
    throw lastError||new Error(`${label} не отговори.`)
  }

  async function loadFallbackResults(s:any,onFound?:(items:any[])=>Promise<void>){
    const endpoints=[
      {path:'/api/bazar-search',name:'Bazar.bg'},
      {path:'/api/homes-search',name:'Homes.bg'},
      {path:'/api/imot-search',name:'Imot.bg'},
      {path:'/api/alo-search',name:'ALO.bg'},
      {path:'/api/yavlena-search',name:'Yavlena.com'},
      {path:'/api/imotinet-search',name:'Imoti.net'},
      {path:'/api/domaza-search',name:'Domaza'}
    ]
    const districts=s?.districts||[],types=s?.property_types||[]
    const total=endpoints.length
    let done=0
    const all:any[]=[]
    const seen=new Set<string>()
    const errorBySource:Record<string,string>={}
    setPortalErrors({});setPortalProgress({})
    for(const ep of endpoints)setPortalProgress(prev=>({...prev,[ep.name]:{pages:0,found:0,private:0,details:0,raw:0,status:'Търси се'}}))
    setSearchProgress({done:0,total,label:'Стартирам публичните източници...'})
    await Promise.all(endpoints.map(async ep=>{
      for(const district of districts){
        for(const propertyType of types){
          let page=1,lastFingerprint=''
          while(true){
            setSearchProgress({done,total,label:`${ep.name} · ${district} · ${propertyType} · стр. ${page}`})
            const p=new URLSearchParams({deal:s.deal_type||'purchase',type:propertyType,district,page:String(page)})
            if(s.price_min!=null)p.set('price_min',String(s.price_min))
            if(s.price_max!=null)p.set('price_max',String(s.price_max))
            if(s.area_min!=null)p.set('area_min',String(s.area_min))
            if(s.area_max!=null)p.set('area_max',String(s.area_max))
            if(s.floor_min!=null)p.set('floor_min',String(s.floor_min))
            if(s.floor_max!=null)p.set('floor_max',String(s.floor_max))
            if((s.construction_types||[]).length)p.set('construction',(s.construction_types||[]).join(','))
            let data:any=null
            try{
              const r:any=await fetchPortalPage(ep.path+'?'+p.toString(),ep.name)
              data=await r.json().catch(()=>null)
            }catch(e:any){errorBySource[ep.name]='Неуспешно зареждане: '+String(e?.message||e);setPortalErrors({...errorBySource});setPortalProgress(prev=>({...prev,[ep.name]:{...(prev[ep.name]||{pages:0,found:0,private:0,details:0,raw:0}),status:'Грешка'}}));break}
            if(!data?.ok){errorBySource[ep.name]=String(data?.error||'Източникът не отговори');setPortalErrors({...errorBySource});setPortalProgress(prev=>({...prev,[ep.name]:{...(prev[ep.name]||{pages:0,found:0,private:0,details:0,raw:0}),status:'Грешка'}}));break}
            const items=data.items||[]
            setPortalProgress(prev=>{
              const old=prev[ep.name]||{pages:0,found:0,private:0,details:0,raw:0,status:'Търси се'}
              return {...prev,[ep.name]:{
                pages:old.pages+1,found:old.found+items.length,
                private:old.private+items.filter((item:any)=>advertiserCategory(item)==='private').length,
                details:old.details+Number(data.detail_success||0),
                raw:old.raw+Number(data.raw_count||0),status:data.has_more?'Проверяват се следващите страници':'Последна страница'
              }}
            })
            const newItems:any[]=[]
            for(const item of items){
              const key=String(item?.offers?.original_url||item?.offers?.id||item?.id||'').split('#')[0]
              if(!key||seen.has(key))continue
              seen.add(key);all.push(item);newItems.push(item)
            }
            if(newItems.length){
              setResults(prev=>mergeResults(prev,newItems))
              if(onFound)try{await onFound(newItems)}catch(e:any){setHistoryWarning('Историята не можа да запази всички оферти: '+String(e?.message||e))}
            }
            const fingerprint=String(data.page_signature||items.slice(0,5).map((x:any)=>x?.offers?.original_url||x?.offers?.id).join('|'))
            if(!data.has_more)break
            if(data.page!=null&&Number(data.page)!==page)break
            if(fingerprint&&fingerprint===lastFingerprint)break
            if(fingerprint)lastFingerprint=fingerprint
            page++
          }
        }
      }
      done++
      setPortalProgress(prev=>({...prev,[ep.name]:{...(prev[ep.name]||{pages:0,found:0,private:0,details:0,raw:0}),status:errorBySource[ep.name]?'Непълно':'Приключи'}}))
      setSearchProgress({done,total,label:`${ep.name} приключи`})
    }))
    return all
  }

  async function searchNow(b:any){
    const criteria=b.buyer_searches?.[0];if(!criteria)return
    const {data:{user}}=await supabase.auth.getUser()
    if(!user){setMsg('Трябва да влезеш в профила си, за да запазиш търсенето.');return}
    const started=Date.now()
    const archiveId=crypto.randomUUID()
    setSearching(b.id);setDeepScanning(true);setMsg('');setSourceStatus('')
    setSelected(b);setResultsHidden(false);setResultFilter('all');setResults([])
    setHistoryWarning('');setPortalErrors({});setPortalProgress({});setSupabaseIssues([]);setActiveRun(null)
    setSearchProgress({done:0,total:7,label:'Стартирам всички източници...'})
    setSearchInfo('Прилагам: '+(criteria.property_types||[]).join(', ')+' · '+(criteria.districts||[]).join(', '))
    try{
      await saveSearchRun({id:archiveId,user_id:user.id,buyer_id:b.id,started_at:new Date().toISOString(),status:'running',
        buyer:{id:b.id,full_name:b.full_name,phone:b.phone,email:b.email,notes:b.notes},
        criteria:{...criteria},offers:[]})
    }catch(e:any){setHistoryWarning('Внимание: търсенето работи, но историята в този браузър не може да се запише: '+String(e?.message||e))}

    let supError:any=null
    let supData:any=null
    let serverRunId:string|null=null
    try{
      const {data,error}:any=await timed(supabase.functions.invoke('buyer-search-archive',{
        body:{action:'start',buyer_id:b.id}
      }) as any,15000,'Запазване на сървърната история')
      if(error||!data?.ok)throw error||new Error(data?.error||'Невъзможен запис')
      serverRunId=data.run_id
    }catch(e:any){setHistoryWarning('Не може да се запише търсенето в Supabase: '+String(e?.message||e)+'. Локалната история остава достъпна.')}
    const persistOffers=async(rows:any[])=>{
      await appendSearchOffers(archiveId,rows)
      if(!serverRunId)return
      for(let pos=0;pos<rows.length;pos+=60){
        const chunk=rows.slice(pos,pos+60)
        const {data,error}:any=await supabase.functions.invoke('buyer-search-archive',{
          body:{action:'append',buyer_id:b.id,run_id:serverRunId,items:chunk}
        })
        if(error||!data?.ok)throw error||new Error(data?.error||'Неуспешно съхранение')
      }
    }
    const supTask=(async()=>{
      const endpoints=[
        {slug:'public-portal-search',name:'Публични портали',timeout:125000},
        {slug:'estate-assistant-search',name:'Estate Assistant',timeout:145000},
        {slug:'imot-firm-search',name:'Imot.bg firm',timeout:125000},
        {slug:'yavlena-search',name:'Yavlena.com',timeout:60000}
      ]
      const stats:any[]=await Promise.all(endpoints.map(async ep=>{
        try{
          const {data,error}:any=await timed(supabase.functions.invoke(ep.slug,{
            body:{buyer_id:b.id,run_type:'manual'}
          }) as any,ep.timeout,ep.name)
          if(error||!data?.ok)throw error||new Error(data?.error||'Върнат е неуспешен резултат')
          const stored=await getStoredMatches(b)
          setResults(prev=>mergeResults(prev,stored))
          try{await appendSearchOffers(archiveId,stored)}catch{}
          if(ep.slug==='public-portal-search')return data?.portal_stats||[]
          return [{source:ep.name,status:'ok',count:Number(data?.total||0),pages_scanned:data?.pages_scanned}]
        }catch(e:any){
          return [{source:ep.name,status:'error',count:0,error:String(e?.message||e)}]
        }
      }))
      supData={portal_stats:stats.flat()}
      const fails=supData.portal_stats.filter((x:any)=>x.status&&x.status!=='ok')
      if(fails.length)supError=new Error(fails.map((x:any)=>x.source+': '+(x.error||x.status)).join(' · '))
    })()
    const fallbackTask=(async()=>{
      try{
        const found=await loadFallbackResults(criteria,persistOffers)
        setResults(prev=>mergeResults(prev,found))
      }catch(e:any){setHistoryWarning('Част от публичните източници не се заредиха: '+String(e?.message||e))}
      finally{setDeepScanning(false)}
    })()
    const allDone=Promise.allSettled([supTask,fallbackTask]).then(async()=>{
      try{
        if(serverRunId){
          const {data,error}:any=await supabase.functions.invoke('buyer-search-archive',{
            body:{action:'finish',buyer_id:b.id,run_id:serverRunId,partial:!!supError}
          })
          if(error||!data?.ok)setHistoryWarning('Supabase не успя да финализира историята: '+String(error?.message||data?.error||''))
        }
        await completeSearchRun(archiveId,supError?'partial':'completed')
        const runs=await searchHistory(b,user.id)
        setHistory(runs)
        setActiveRun(prev=>prev?.id===archiveId?runs.find(x=>x.id===archiveId)||prev:prev)
      }catch(e:any){setHistoryWarning('Историята не може да се обнови: '+String(e?.message||e))}
    })
    const finished=await Promise.race([
      allDone.then(()=>true),
      new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),160000))
    ])
    const stats=supData?.portal_stats||supData?.sources||supData?.stats||null
    if(stats&&typeof stats==='object'){
      const entries:any[]=Array.isArray(stats)?stats:Object.entries(stats).map(([source,info]:any)=>({source,...(info&&typeof info==='object'?info:{count:info})}))
      const issues=entries.filter(e=>e?.status&&e.status!=='ok').map(e=>(e.source||e.name||'Източник')+' — '+(e.status==='timeout'?'изтекло време':e.error||e.status))
      setSupabaseIssues(issues)
      setSourceStatus(entries.map(e=>(e.source||e.name||'Източник')+': '+(e.count??e.total??e.found??0)+(e.status&&e.status!=='ok'?' ('+e.status+')':'')).join(' · '))
    }else if(supError)setSourceStatus('Supabase: '+String(supError?.message||supError))
    const secs=Math.max(1,Math.floor((Date.now()-started)/1000))
    setMsg(finished?'Търсенето приключи за '+secs+' сек. Резултатите са подредени по сайтове.':'Първите резултати са готови за '+secs+' сек. Останалите източници продължават да добавят оферти.')
    if(supError)setMsg(prev=>prev+' Supabase: '+String(supError?.message||supError))
    else if(stats&&Array.isArray(stats)&&stats.some((x:any)=>x?.status&&x.status!=='ok'))setMsg(prev=>prev+' Някои фирмени източници са върнали грешка — виж подробностите по-долу.')
    setSearching(null);setSearchInfo('')
  }

  async function toggleMonitoring(b:any){
    const s=b.buyer_searches?.[0];if(!s)return
    const next=!s.monitoring_enabled
    await supabase.from('buyer_searches').update({monitoring_enabled:next,notifications_enabled:next,updated_at:new Date().toISOString()}).eq('id',s.id)
    await load()
  }

  async function validateStoredFirmResults(rows:any[]){
    const ids=[...new Set(rows.map((r:any)=>r?.offers?.id).filter(Boolean))]
    if(!ids.length)return rows
    const activeIds=new Set<string>(),inactiveIds=new Set<string>()
    // A blocked link or timeout is "not verified", NOT evidence that an offer is inactive.
    for(let i=0;i<ids.length;i+=100){
      try{
        const {data,error}:any=await supabase.functions.invoke('validate-offer-links',{body:{offer_ids:ids.slice(i,i+100)}})
        if(error)continue
        for(const x of data?.results||[]){
          if(x?.status==='active')activeIds.add(String(x.id))
          if(x?.status==='inactive')inactiveIds.add(String(x.id))
        }
      }catch{}
    }
    return rows.filter(r=>!inactiveIds.has(String(r?.offers?.id||'')))
      .map(r=>({...r,_active_validation:activeIds.has(String(r?.offers?.id||''))?'active':'unknown'}))
  }

  async function getStoredMatches(b:any){
    const all:any[]=[]
    const pageSize=1000
    for(let from=0;;from+=pageSize){
      const{data,error}=await supabase
        .from('offer_matches')
        .select('id,score,status,created_at,is_current,offers!inner(*,offer_sources(name))')
        .eq('buyer_id',b.id)
        .eq('is_current',true)
        .eq('offers.is_active',true)
        .order('created_at',{ascending:false})
        .range(from,from+pageSize-1)
      if(error){setSourceStatus('Запазените съвпадения не се заредиха: '+error.message);return []}
      all.push(...(data||[]))
      if((data||[]).length<pageSize)break
    }
    const merged=mergeResults(all)
    return await validateStoredFirmResults(merged)
  }

  async function serverSearchHistory(b:any,userId:string):Promise<SavedSearch[]>{
    try{
      const {data,error}:any=await supabase.functions.invoke('buyer-search-archive',{body:{action:'history',buyer_id:b.id}})
      if(error||!data?.ok)throw error||new Error(data?.error||'Няма достъп до историята')
      return (data.runs||[]).map((r:any)=>({
        id:r.id,user_id:userId,buyer_id:b.id,started_at:r.started_at,completed_at:r.completed_at||undefined,
        status:r.status==='completed'?'completed':r.status==='running'?'running':'partial',
        buyer:r.buyer_search_snapshots?.buyer_snapshot||b,
        criteria:r.buyer_search_snapshots?.criteria_snapshot||b.buyer_searches?.[0]||{},
        offers:[],_server:true,_offer_count:Number(r.results_count||0)
      } as SavedSearch))
    }catch(e:any){
      setHistoryWarning('Сървърната история не се зареди: '+String(e?.message||e))
      return []
    }
  }
  async function searchHistory(b:any,userId:string){
    const local=await listBuyerSearches(userId,b.id).catch(()=>[] as SavedSearch[])
    const remote=await serverSearchHistory(b,userId)
    const combined=[...local,...remote.filter((r:any)=>!local.some(l=>Math.abs(new Date(l.started_at).getTime()-new Date(r.started_at).getTime())<5000))]
    return combined.sort((a,b)=>b.started_at.localeCompare(a.started_at))
  }
  async function restoreRun(b:any,run:SavedSearch){
    setSelected(b);setResultsHidden(false);setResultFilter('all')
    setActiveRun(run);setPortalErrors(run.source_errors||{})
    if(!(run as any)._server){setResults(run.offers||[]);return}
    setResultsLoading(true);setResults([])
    try{
      const all:any[]=[]
      for(let offset=0;;offset+=500){
        const{data,error}:any=await supabase.functions.invoke('buyer-search-archive',{
          body:{action:'results',buyer_id:b.id,run_id:run.id,offset}
        })
        if(error||!data?.ok)throw error||new Error(data?.error||'Неуспешно зареждане')
        all.push(...(data.items||[]))
        if(!data.has_more)break
      }
      setResults(mergeResults(all))
    }catch(e:any){setHistoryWarning('Не можах да заредя архивираните оферти от Supabase: '+String(e?.message||e))}
    finally{setResultsLoading(false)}
  }

  async function loadMatches(b:any){
    setSelected(b);setResultsHidden(false);setResultFilter('all')
    setResultsLoading(true);setActiveRun(null);setHistoryWarning('')
    try{
      const {data:{user}}=await supabase.auth.getUser()
      const runs=user?await searchHistory(b,user.id):[]
      setHistory(runs)
      if(runs.length){await restoreRun(b,runs[0]);return}
      const stored=await getStoredMatches(b)
      setResults(stored)
    }catch(e:any){
      setHistoryWarning('Не мога да заредя историята от браузъра: '+String(e?.message||e))
      setResults(await getStoredMatches(b))
    }finally{setResultsLoading(false)}
  }
  async function openResults(b:any){
    if(selected?.id===b.id){setResultsHidden(false);return}
    await loadMatches(b)
  }
  async function exportPdf(b:any,rows:any[],run?:SavedSearch|null){
    setExporting(true)
    try{
      const{downloadBuyerPdf}=await import('@/lib/search-report')
      await downloadBuyerPdf(run?.buyer||b,run?.criteria||b?.buyer_searches?.[0]||{},rows,run?.started_at)
    }catch(e:any){setMsg('PDF справката не можа да се изтегли: '+String(e?.message||e))}
    finally{setExporting(false)}
  }

  const filteredResults=results.filter(r=>resultFilter==='all'||advertiserCategory(r)===resultFilter)
  const portalNames=[...new Set([...PORTAL_NAMES,...results.map(portalName)])]
  const advertiserCounts={
    private:results.filter(r=>advertiserCategory(r)==='private').length,
    agency:results.filter(r=>advertiserCategory(r)==='agency').length,
    unknown:results.filter(r=>advertiserCategory(r)==='unknown').length
  }


  async function openPrivateCatalog(){
    if(showPrivateCatalog){setShowPrivateCatalog(false);return}
    setShowPrivateCatalog(true)
    setLoadingPrivateCatalog(true)
    setPrivateCatalogError('')
    try{
      const data:any[]=[]
      // Supabase caps individual responses. Page through the entire authorized catalog,
      // never restrict to a fixed number of records.
      for(let from=0;;from+=800){
        const {data:page,error}:any=await supabase.from('offers')
          .select('*,offer_sources(name)')
          .in('advertiser_type',['private','unknown'])
          .eq('is_active',true)
          .order('last_seen_at',{ascending:false})
          .range(from,from+799)
        if(error)throw error
        data.push(...(page||[]).map((o:any)=>({id:o.id,offers:o,created_at:o.last_seen_at})))
        if((page||[]).length<800)break
      }
      setPrivateCatalog(data)
    }catch(e:any){setPrivateCatalogError('Неуспешно зареждане на каталога: '+String(e?.message||e))}
    finally{setLoadingPrivateCatalog(false)}
  }
  function offerCard(r:any){
    const o=r.offers||{}
    const category=advertiserCategory(r)
    const seller=category==='private'?'Частно лице':category==='agency'?'Агенция':'Неуточнен подател'
    const url=String(o.original_url||'')
    const variants=Array.isArray(r._variants)?r._variants:[]
    return <div className="offerResult" key={String(r.id)+'|'+url}>
      <div className="grow">
        <div className="offerTop">
          <b>{o.title||o.property_type||'Имотна оферта'}</b>
          <span className={category==='private'?'pill private':category==='agency'?'pill agency':'pill'}>{seller}</span>
          <span className="tag">{r._active_validation==='active'?'Проверена оферта':'Статусът не е потвърден'}</span>
        </div>
        <div className="meta">{o.district||'Район не е посочен'} · {o.price_eur!=null?Number(o.price_eur).toLocaleString('bg-BG')+' €':'Без цена'} · {o.area_sqm!=null?o.area_sqm+' кв.м':'Без площ'}</div>
        <div className="meta">Тип: {o.property_type||'—'} · Строителство: {o.construction_type||'—'} · Етаж: {o.floor??'—'} · Година: {o.construction_year??'—'}</div>
        {(selected?.buyer_searches?.[0]?.floor_min!=null||selected?.buyer_searches?.[0]?.floor_max!=null)&&o.floor==null&&<div className="meta" style={{color:'#9b6208'}}>Етажът не е потвърден от източника — провери преди презентация.</div>}
        <div className="meta">Подател: {o.advertiser_name||seller}{o.contact_phone?' · Телефон: '+o.contact_phone:''}{o.source_published_at?' · Публикувана: '+new Date(o.source_published_at).toLocaleDateString('bg-BG'):''}</div>
        {variants.length>1&&<div className="meta">Публикации в същия източник: {variants.length}</div>}
      </div>
      {/^https?:\/\//i.test(url)&&<a className="btn" href={url} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Отвори офертата</a>}
    </div>
  }

  return <>
    <div className="topline"><div><div className="eyebrow">Клиентски търсения</div><h1>Моите купувачи</h1><div className="subtitle">Подробни критерии, фирмени източници, история и постоянен мониторинг. · Търсене v4</div></div><button className="btn primary" onClick={openCreate}><Plus size={17}/>Добави купувач</button></div>
    {searchInfo&&<div className="ok" style={{marginBottom:10}}>{searchInfo}</div>}
    {(searching||deepScanning)&&<div className="card" style={{marginBottom:14,padding:14}}>
      <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',alignItems:'center'}}>
        <b>{searching?'Търся оферти...':'Допълвам още оферти...'}</b>
        <span className="tag">Търсене v4 · без лимит на офертите</span>
      </div>
      <div className="meta" style={{marginTop:8}}>Приключили публични източници: {searchProgress.done} от 7</div>
      <div className="meta" style={{marginTop:4}}>В момента: {searchProgress.label||'Supabase и публичните източници работят паралелно'}</div>
      <div className="meta" style={{marginTop:4}}>Намерени досега: {results.length} оферти</div>
      {deepScanning&&!searching&&<div className="meta" style={{marginTop:4}}>Можеш да работиш със сайта — допълнителните страници се проверяват без да блокират екрана.</div>}
    </div>}
    {msg&&<div className={msg.startsWith('Готово')?'ok':'err'} style={{marginBottom:14}}>{msg}</div>}
    {sourceStatus&&<div className="meta" style={{margin:'-4px 0 14px'}}>Фирмени източници: {sourceStatus}</div>}

    <div className="card" style={{marginBottom:15}}>
      <div className="toolbar" style={{marginBottom:0}}>
        <div><h2 style={{margin:'0 0 5px'}}>Частни обяви — общ каталог</h2>
        <div className="meta">Всички налични активни частни обяви от свързаните източници — без ограничения от критериите на конкретен купувач. Съмнителните податели са отделно за проверка.</div></div>
        <button className="btn primary" type="button" onClick={openPrivateCatalog}>{showPrivateCatalog?'Затвори каталога':'Виж всички частни обяви'}</button>
      </div>
      {showPrivateCatalog&&<>
        {loadingPrivateCatalog&&<div className="meta" style={{marginTop:14}}>Зареждам всички записи от базата, страница по страница...</div>}
        {privateCatalogError&&<div className="err">{privateCatalogError}</div>}
        {!loadingPrivateCatalog&&!privateCatalogError&&<>
          <div className="filterBar" style={{marginBottom:12}}>
            <button className={privateCatalogTab==='private'?'btn primary':'btn'} onClick={()=>setPrivateCatalogTab('private')}>Частни лица ({privateCatalog.filter(r=>advertiserCategory(r)==='private').length})</button>
            <button className={privateCatalogTab==='unverified'?'btn primary':'btn'} onClick={()=>setPrivateCatalogTab('unverified')}>Неуточнени податели ({privateCatalog.filter(r=>advertiserCategory(r)==='unknown').length})</button>
          </div>
          <div className="meta" style={{margin:'0 0 12px'}}>Това е каталог, не списък със съвпадения за избрания купувач. Подателите и активността се определят според наличните данни.</div>
          <div className="portalList">{[...new Set(privateCatalog.map(portalName))].map(source=>{
            const subset=privateCatalog.filter(r=>portalName(r)===source&&advertiserCategory(r)===(privateCatalogTab==='private'?'private':'unknown'))
            if(!subset.length)return null
            return <details className="portalDetails" key={source}><summary className="portalSummary">
              <span className="portalName">{source}</span><span className="portalCount">{subset.length} обяви</span><span className="portalArrow">⌄</span>
            </summary><div className="portalOffers">{subset.map(offerCard)}</div></details>
          })}</div>
          {!privateCatalog.filter(r=>advertiserCategory(r)===(privateCatalogTab==='private'?'private':'unknown')).length&&<div className="empty">Няма запазени активни оферти в тази категория. Това не означава, че няма оферти онлайн.</div>}
        </>}
      </>}
    </div>
    {supabaseIssues.length>0&&<div className="err" style={{marginBottom:14}}>Непълни Supabase източници: {supabaseIssues.join(' · ')}</div>}

    <div className="listCard">
      {buyers.length?buyers.map(b=>{const s=b.buyer_searches?.[0];return <div className="buyerBlock" key={b.id}>
        <div className="buyerRow"><span className="statusDot"/><div className="grow"><b>{b.full_name}</b><div className="meta">{(s?.property_types||[]).join(', ')||'Имот'} · {(s?.districts||[]).join(', ')||'Всички райони'} · {s?.price_min?`от €${Number(s.price_min).toLocaleString('bg-BG')} · `:''}{s?.price_max?`до €${Number(s.price_max).toLocaleString('bg-BG')}`:'без горен лимит'}{s?.area_min?` · от ${s.area_min} кв.м`:''}{s?.area_max?` · до ${s.area_max} кв.м`:''}</div><div className="meta">{s?.floor_min!=null?`етаж от ${s.floor_min} · `:''}{s?.floor_max!=null?`етаж до ${s.floor_max} · `:''}{(s?.construction_types||[]).length?`${s.construction_types.join(', ')} · `:''}{s?.year_min?`след ${s.year_min} г. · `:''}{s?.last_manual_search_at?`последно търсене ${new Date(s.last_manual_search_at).toLocaleString('bg-BG')}`:'няма стартирано търсене'}</div></div><span className="tag">{s?.monitoring_enabled?'Мониторинг включен':'Мониторинг изключен'}</span></div>
        <div className="buyerActions"><button className="btn primary" onClick={()=>searchNow(b)} disabled={searching===b.id}><Search size={16}/>{searching===b.id?'Търся по всички критерии...':'Потърси оферти'}</button><button className="btn" onClick={()=>openResults(b)}>{selected?.id===b.id&&resultsHidden?'Покажи резултатите':'Виж резултати'}</button><button className="btn" onClick={()=>loadMatches(b)}>История на търсенията</button><button className="btn" onClick={()=>toggleMonitoring(b)}>{s?.monitoring_enabled?<BellOff size={16}/>:<Bell size={16}/>} {s?.monitoring_enabled?'Спри известия':'Включи известия'}</button><button className="btn" onClick={()=>openEdit(b)}><Pencil size={15}/>Редактирай</button><button className="btn" onClick={()=>deleteBuyer(b)}><Trash2 size={15}/>Изтрий</button></div>
      </div>}):<div className="empty" style={{margin:'14px 0'}}>Няма добавени купувачи.</div>}
    </div>

    {selected&&!resultsHidden&&<div className="card resultsCard" id="buyer-results">
      <div className="toolbar" style={{alignItems:'flex-start'}}>
        <div>
          <h2 style={{margin:0}}>Оферти за {selected.full_name}</h2>
          <div className="meta">По сайтове, с директен достъп до всяка обява. Частните лица се маркират само при достатъчни доказателства.</div>
          <div className="meta" style={{marginTop:7}}>Общо: <b>{results.length}</b> · Частни: <b>{advertiserCounts.private}</b> · Агенции: <b>{advertiserCounts.agency}</b> · Неуточнени: <b>{advertiserCounts.unknown}</b></div>
          {activeRun&&<div className="meta">Архивирано търсене от {new Date(activeRun.started_at).toLocaleString('bg-BG')}</div>}
        </div>
        <div className="buyerActions" style={{padding:0}}>
          <button type="button" className="btn primary" onClick={()=>exportPdf(selected,results,activeRun)} disabled={exporting}>{exporting?'Създавам PDF...':'Изтегли справка (PDF)'}</button>
          <button type="button" className="btn" onClick={()=>setResultsHidden(true)}>Скрий резултатите</button>
        </div>
      </div>
      <div className="historyPanel">
        <div className="historyTop">
          <div><strong>История на търсенията</strong><div className="meta">Запазва се на това устройство и в този браузър, включително след презареждане. Не се синхронизира между устройства.</div></div>
          <span className="tag">{history.length} записа</span>
        </div>
        {history.length>0&&<div className="historyEntries">
          {history.map(run=><button type="button" key={run.id} className={'historyButton '+(activeRun?.id===run.id?'active':'')} onClick={()=>restoreRun(selected,run)}>
            {new Date(run.started_at).toLocaleString('bg-BG')} · {(run as any)._offer_count??run.offers.length} оферти {(run as any)._server?'· Supabase':''} {run.status==='running'?'· В процес':run.status==='partial'?'· Частично':''}
          </button>)}
        </div>}
      </div>
      {historyWarning&&<div className="err" role="alert">{historyWarning}</div>}
      <div className="filterBar">{([{id:'all',label:'Всички',count:results.length},{id:'private',label:'Частни лица',count:advertiserCounts.private},{id:'agency',label:'Агенции',count:advertiserCounts.agency},{id:'unknown',label:'Неуточнени',count:advertiserCounts.unknown}] as const).map(x=><button key={x.id} className={resultFilter===x.id?'btn primary':'btn'} type="button" onClick={()=>setResultFilter(x.id)}>{x.label} ({x.count})</button>)}</div>
      {resultsLoading?<div className="empty">Зареждам запазените търсения...</div>:
      <div className="portalList">
        {portalNames.map(name=>{
          const found=filteredResults.filter(r=>portalName(r)===name).slice().sort((a,b)=>new Date(b.offers?.source_published_at||b.created_at).getTime()-new Date(a.offers?.source_published_at||a.created_at).getTime())
          const allFromPortal=results.filter(r=>portalName(r)===name)
          const privateCount=allFromPortal.filter(r=>advertiserCategory(r)==='private').length
          return <details className="portalDetails" key={name}>
            <summary className="portalSummary">
              <span className="portalName">{name}</span>
              <span className="portalCount">{found.length} оферти</span>
              {portalProgress[name]&&<span className="meta" style={{margin:0}}>{portalProgress[name].pages} стр. · {portalProgress[name].status}</span>}
              <span className="portalPrivate">{privateCount} частни</span>
              {portalErrors[name]&&<span className="portalError">Проблем с източника</span>}
              <span className="portalArrow">⌄</span>
            </summary>
            <div className="portalOffers">
              {portalErrors[name]&&<div className="err">{portalErrors[name]}</div>}
              {portalProgress[name]&&<div className="meta" style={{marginBottom:10}}>Проверени страници: {portalProgress[name].pages} · Обяви след първичното филтриране: {portalProgress[name].found} · Разпознати частни: {portalProgress[name].private} · Заредени подробности: {portalProgress[name].details}</div>}
              {found.length?found.map(offerCard):<div className="empty">{resultFilter==='all'?'При това търсене няма намерени оферти от този сайт.':'Няма оферти от избраната категория за този сайт.'}</div>}
            </div>
          </details>
        })}
      </div>}
    </div>}

    {open&&<div className="modalBack"><form className="modal" onSubmit={saveBuyer}><div className="modalHead"><div><div className="eyebrow">{editing?'Редакция на клиент':'Нов клиент'}</div><h2 style={{margin:'4px 0'}}>Подробни критерии за търсене</h2></div><button type="button" className="x" onClick={()=>setOpen(false)}><X size={18}/></button></div>
      <div className="formGrid">
        <div className="field"><label>Име на клиента</label><input required value={f.full_name} onChange={e=>setF({...f,full_name:e.target.value})}/></div>
        <div className="field"><label>Телефон</label><input value={f.phone} onChange={e=>setF({...f,phone:e.target.value})}/></div>
        <div className="field"><label>Имейл</label><input type="email" value={f.email} onChange={e=>setF({...f,email:e.target.value})}/></div>
        <div className="field"><label>Сделка</label><select value={f.deal_type} onChange={e=>setF({...f,deal_type:e.target.value})}><option value="purchase">Покупка</option><option value="rent">Наем</option></select></div>

        <MultiSelect label="Тип имот" value={f.property_types} options={PROPERTY_TYPES} onChange={(v:string)=>setF({...f,property_types:v})} placeholder="Избери тип имот"/>
        <MultiSelect label="Райони *" value={f.districts} options={DISTRICTS} onChange={(v:string)=>setF({...f,districts:v})} full placeholder="Избери един или няколко района"/>

        <div className="field"><label>Цена от (€)</label><input type="number" value={f.price_min} onChange={e=>setF({...f,price_min:e.target.value})}/></div>
        <div className="field"><label>Цена до (€)</label><input type="number" value={f.price_max} onChange={e=>setF({...f,price_max:e.target.value})}/></div>
        <div className="field"><label>Площ от (кв.м)</label><input type="number" value={f.area_min} onChange={e=>setF({...f,area_min:e.target.value})}/></div>
        <div className="field"><label>Площ до (кв.м)</label><input type="number" value={f.area_max} onChange={e=>setF({...f,area_max:e.target.value})}/></div>

        <div className="field"><label>Минимум спални</label><select value={f.bedrooms_min} onChange={e=>setF({...f,bedrooms_min:e.target.value})}><option value="">Без значение</option>{[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n===0?'Без минимум':`${n}+`}</option>)}</select></div>
        <div className="field"><label>Година на строителство от</label><select value={f.year_min} onChange={e=>setF({...f,year_min:e.target.value})}><option value="">Без значение</option>{YEARS.map(y=><option key={y} value={y}>{y} г.</option>)}</select></div>
        <div className="field"><label>Етаж от</label><select value={f.floor_min} onChange={e=>setF({...f,floor_min:e.target.value})}><option value="">Без значение</option>{FLOORS.map(n=><option key={n} value={n}>{n===0?'Партер':n}</option>)}</select></div>
        <div className="field"><label>Етаж до</label><select value={f.floor_max} onChange={e=>setF({...f,floor_max:e.target.value})}><option value="">Без значение</option>{FLOORS.map(n=><option key={n} value={n}>{n===0?'Партер':n}</option>)}</select></div>

        <MultiSelect label="Строителство" value={f.construction_types} options={CONSTRUCTION_TYPES} onChange={(v:string)=>setF({...f,construction_types:v})} full placeholder="Избери един или няколко вида"/>

        <div className="field"><label>Акт 16</label><select value={f.act16_level} onChange={e=>setF({...f,act16_level:e.target.value})}><option value="">Без значение</option><option value="required">Задължително</option><option value="preferred">Предпочитано</option></select></div>
        <div className="field"><label>Асансьор</label><select value={f.elevator_level} onChange={e=>setF({...f,elevator_level:e.target.value})}><option value="">Без значение</option><option value="required">Задължително</option><option value="preferred">Предпочитано</option></select></div>
        <div className="field"><label>Гараж / паркомясто</label><select value={f.parking_level} onChange={e=>setF({...f,parking_level:e.target.value})}><option value="">Без значение</option><option value="required">Задължително</option><option value="preferred">Предпочитано</option></select></div>
        <div className="field"><label>Проверка при мониторинг</label><select value={f.monitoring_interval_minutes} onChange={e=>setF({...f,monitoring_interval_minutes:e.target.value})}>{MONITORING_OPTIONS.map(n=><option key={n} value={n}>{n<60?`${n} мин.`:n===60?'1 час':n<1440?`${n/60} часа`:'24 часа'}</option>)}</select></div>

        <div className="field full"><label>Допълнителни условия / бележки за имота</label><textarea value={f.free_text} onChange={e=>setF({...f,free_text:e.target.value})} placeholder="напр. южно изложение, тиха улица, близо до метро"/></div>
        <div className="field full"><label>Бележки за клиента</label><textarea value={f.notes} onChange={e=>setF({...f,notes:e.target.value})}/></div>
      </div>
      {msg&&<div className="err">{msg}</div>}
      <div style={{display:'flex',justifyContent:'flex-end',gap:9,marginTop:20}}><button type="button" className="btn" onClick={()=>setOpen(false)}>Отказ</button><button className="btn primary" disabled={busy}>{busy?'Записване...':editing?'Запази промените':'Създай търсене'}</button></div>
    </form></div>}
  </>
}
