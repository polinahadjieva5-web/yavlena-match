'use client'
import {useEffect,useState} from 'react'
import {useRouter} from 'next/navigation'
import {ShieldCheck,KeyRound,Building2} from 'lucide-react'
import {supabase} from '@/lib/supabase'

type Role='broker'|'manager'|'admin'

export default function AdminPage(){
  const router=useRouter()
  const[loading,setLoading]=useState(true)
  const[role,setRole]=useState<Role|null>(null)
  useEffect(()=>{(async()=>{
    const{data:{user}}=await supabase.auth.getUser()
    if(!user){router.replace('/login');return}
    const{data}=await supabase.from('profiles').select('role').eq('id',user.id).single()
    const r=(data?.role||'broker') as Role
    setRole(r)
    if(r!=='admin'){router.replace('/');return}
    setLoading(false)
  })()},[router])

  if(loading)return <div className="card"><div className="meta">Зареждане...</div></div>
  if(role!=='admin')return null

  return <>
    <div className="topline"><div><div className="eyebrow">Само за администратори</div><h1>Администрация</h1><div className="subtitle">Управление на системните настройки и фирмените профили за порталите.</div></div></div>
    <div className="grid4">
      <div className="stat"><ShieldCheck size={22}/><span className="label">Достъп</span><strong>Admin</strong><span className="delta">защитена секция</span></div>
      <div className="stat"><Building2 size={22}/><span className="label">Портали</span><strong>5</strong><span className="delta">конфигурирани източника</span></div>
      <div className="stat"><KeyRound size={22}/><span className="label">Фирмени профили</span><strong>0</strong><span className="delta">предстои свързване</span></div>
    </div>
    <div className="card" style={{marginTop:18}}>
      <h2>Фирмени профили / портали</h2>
      <div className="empty">Тук ще добавим защитеното свързване към фирмените профили за частните обяви. Брокерите няма да виждат тази секция.</div>
    </div>
  </>
}
