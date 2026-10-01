import './styles.css'
import AppShell from '@/components/AppShell'
export const metadata={title:'Yavlena Match',description:'Buyer matching and operations assistant'}
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="bg"><body><AppShell>{children}</AppShell></body></html>}
