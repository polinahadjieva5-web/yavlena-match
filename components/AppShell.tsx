'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, Building2, Home, LogOut, Search, Users, CalendarRange } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const nav = [
  {href:'/',label:'Начало',icon:Home},
  {href:'/buyers',label:'Моите купувачи',icon:Users},
  {href:'/new-matches',label:'Нови съвпадения',icon:Search},
  {href:'/operations',label:'Моята оперативка',icon:CalendarRange},
  {href:'/notifications',label:'Известия',icon:Bell},
]
export default function AppShell({children}:{children:React.ReactNode}){
  const path=usePathname(); const router=useRouter()
  async function logout(){ await supabase.auth.signOut(); router.replace('/login') }
  if(path==='/login') return <>{children}</>
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brandMark"><Building2 size={19}/></div><div><b>Yavlena Match</b><span>Buyer intelligence</span></div></div>
      <nav>{nav.map(i=>{const I=i.icon; const active=path===i.href; return <Link className={active?'navItem active':'navItem'} key={i.href} href={i.href}><I size={18}/>{i.label}</Link>})}</nav>
      <div className="sideFoot"><div className="sourceNote">Самостоятелна система<br/><b>Без данни от Premium / Million+ / Team 4</b></div><button className="logout" onClick={logout}><LogOut size={17}/>Изход</button></div>
    </aside>
    <main className="content">{children}</main>
  </div>
}
