'use client'
import {useEffect,useMemo,useState} from 'react'
import {useRouter} from 'next/navigation'
import Link from 'next/link'
import {ShieldCheck,KeyRound,Building2,CalendarRange,ArrowRight,CheckCircle2,Clock3,LockKeyhole,ExternalLink,LogIn,RefreshCw} from 'lucide-react'
import {supabase} from '@/lib/supabase'

type Role='broker'|'manager'|'admin'
type Portal={id:string;portal_name:string;base_url:string|null;connection_type:string;connection_status:string;last_success_at:string|null;last_error_message:string|null;account_label:string|null}

export default function AdminPage(){
  const router=useRouter()
  const[loading,setLoading]=useState(true)
  const[role,setRole]=useState<Role|null>(null)
  const[portals,setPortals]=useState<Portal[]>([])
  const[msg,setMsg]=useState('')
  async function load(){
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){router.replace('/login');return}
    const{data}=await supabase.from('profiles').select('role').eq('id',user.id).single()
    const r=(data?.role||'broker') as Role
    setRole(r)
    if(r!=='admin'){router.replace('/');return}
    const{data:p}=await supabase.from('portal_connections').select('id,portal_name,base_url,connection_type,connection_status,last_success_at,last_error_message,account_label').order('portal_name')
    setPortals((p||[]) as Portal[])
    setLoading(false)
  }
  useEffect(()=>{load()},[router])
  const connected=useMemo(()=>portals.filter(p=>p.connection_status==='connected').length,[portals])
  const firm=useMemo(()=>portals.filter(p=>p.connection_type==='browser_session').length,[portals])
  async function checkFirmConnection(p:Portal){
    setMsg('')
    const{data,error}=await supabase.functions.invoke('portal-connect',{body:{portal_name:p.portal_name,action:'check'}})
    if(error){setMsg('Връзката с фирмения профил още не е активна. Влез през бутона за вход и след това ще включим защитения session connector.');return}
    setMsg(data?.message||'Проверката приключи.')
    await load()
  }
  if(loading)return <div className="card"><div className="meta">Зареждане...</div></div>
  if(role!=='admin')return null

  return <>
    <div className="topline"><div><div className="eyebrow">Само за администратори</div><h1>Администрация</h1><div className="subtitle">Управление на системата, оперативката и връзките към имотните портали.</div></div></div>
    <div className="grid4">
      <div className="stat"><ShieldCheck size={22}/><span className="label">Достъп</span><strong>Admin</strong><span className="delta">защитена секция</span></div>
      <div className="stat"><Building2 size={22}/><span className="label">Портали</span><strong>{portals.length}</strong><span className="delta">активни източника</span></div>
      <div className="stat"><KeyRound size={22}/><span className="label">Фирмени профили</span><strong>{firm}</strong><span className="delta">Imot.bg + Estate Assistant</span></div>
      <div className="stat"><CalendarRange size={22}/><span className="label">Оперативка</span><strong>10</strong><span className="delta">целеви предложения</span></div>
    </div>

    <div className="card" style={{marginTop:18}}>
      <div className="toolbar"><div><h2 style={{margin:0}}>Портали и фирмени профили</h2><div className="meta">Публичните източници се проверяват автоматично. Imot.bg и Estate Assistant имат отделен фирмен вход за данните, които се виждат само след логин.</div></div></div>
      {msg&&<div className="empty" style={{marginBottom:12}}>{msg}</div>}
      {portals.length?portals.map(p=>{
        const ok=p.connection_status==='connected'
        const isFirm=p.connection_type==='browser_session'
        return <div className="noticeRow" key={p.id}>
          {ok?<CheckCircle2 size={19}/>:isFirm?<LockKeyhole size={19}/>:<Clock3 size={19}/>}
          <div className="grow"><b>{p.portal_name}</b><div className="meta">{isFirm?'Фирмен профил / защитена сесия':'Публично автоматично търсене'}{p.last_success_at?` · Последна успешна проверка: ${new Date(p.last_success_at).toLocaleString('bg-BG')}`:''}</div>{isFirm&&<div className="meta">{p.portal_name==='Estate Assistant'?'Вход: app.estateassistant.eu/Account/Login':'Вход през фирмения профил на Imot.bg'}</div>}{p.last_error_message&&<div className="err">{p.last_error_message}</div>}</div>
          <span className="tag">{ok?'Свързан':p.connection_status==='session_expired'?'Сесията е изтекла':p.connection_status==='attention_required'?'Ограничен':isFirm?'Фирменият профил не е свързан':'Активен източник'}</span>
          <div className="rowActions">
            {p.base_url&&<a className="btn" href={p.base_url} target="_blank" rel="noreferrer">{isFirm?<><LogIn size={15}/>Вход във фирмения профил</>:<><ExternalLink size={15}/>Отвори</>}</a>}
            {isFirm&&<button className="btn" onClick={()=>checkFirmConnection(p)}><RefreshCw size={15}/>Провери връзката</button>}
          </div>
        </div>
      }):<div className="empty">Няма конфигурирани портали.</div>}
    </div>

    <div className="card" style={{marginTop:18}}>
      <h2>Моята оперативка</h2>
      <div className="meta">Подбор на интересни и непрезентирани оферти, история на ID-тата и директни линкове.</div>
      <Link className="btn primary" style={{marginTop:16}} href="/operations"><CalendarRange size={16}/>Отвори оперативката<ArrowRight size={16}/></Link>
    </div>
  </>
}
