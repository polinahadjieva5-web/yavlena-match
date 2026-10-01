'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, Building2, Home, LogOut, Search, Users, CalendarRange, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Role='broker'|'manager'|'admin'

const baseNav = [
  {href:'/',label:'Начало',icon:Home},
  {href:'/buyers',label:'Моите купувачи',icon:Users},
  {href:'/new-matches',label:'Нови съвпадения',icon:Search},
  {href:'/notifications',label:'Известия',icon:Bell},
]

export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(); const router=useRouter(); const[role,setRole]=useState<Role|null>(null)
  useEffect(()=>{if(path==='/login')return;(async()=>{const{data:{user}}=await supabase.auth.getUser();if(!user){router.replace('/login');return}const{data}=await supabase.from('profiles').select('role').eq('id',user.id).single();setRole((data?.role||'broker') as Role)})()},[path,router])
  const nav=useMemo(()=>{const items=[...baseNav];if(role==='manager'||role==='admin')items.splice(3,0,{href:'/operations',label:'Моята оперативка',icon:CalendarRange});if(role==='admin')items.push({href:'/admin',label:'Администрация',icon:Settings});return items},[role])
  async function logout(){ await supabase.auth.signOut(); router.replace('/login') }
  if(path==='/login') return <>{children}</>
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark"><Building2 size={19}/></div><div><b>Yavlena Match</b><span>Buyer intelligence</span></div></div>
      <nav>{nav.map(i=>{const I=i.icon; const active=path===i.href||path.startsWith(i.href+'/'); return <Link className={active?'navItem active':'navItem'} key={i.href} href={i.href}><I size={18}/>{i.label}</Link>})}</nav>
      <div className="sideFoot"><div className="sourceNote">Самостоятелна система<br/><b>Без данни от Premium / Million+ / Team 4</b>{role&&<><br/><span>Роля: {role==='admin'?'Администратор':role==='manager'?'Мениджър':'Брокер'}</span></>}</div><button className="logout" onClick={logout}><LogOut size={17}/>Изход</button></div>
    </aside>
    <main className="content">{children}</main>
  </div>
}
