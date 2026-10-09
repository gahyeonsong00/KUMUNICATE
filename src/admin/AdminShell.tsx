import type { ReactNode } from 'react'
import { Header, HeaderGlobalBar, HeaderName, Link } from '@carbon/react'
import { useNavigate } from 'react-router-dom'
import emblem from '../../assets/khu_emblem.png'
import wordmark from '../../assets/khu_wordmark.png'
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import './admin.scss'
import { useOptionalAdminStore } from './store'

// 직원 화면 공통 틀: 상단 바, 워드마크
export default function AdminShell({ children }: { children: ReactNode }) {
  const store = useOptionalAdminStore()
  const navigate = useNavigate()
  return (
    <>
      <Header aria-label="경희대학교 민원관리">
        <HeaderName href="/admin" prefix="">
          <img className="admin-emblem" src={emblem} alt="경희대학교 휘장" />
          경희대학교 민원관리
        </HeaderName>
        {store && (
          <HeaderGlobalBar>
            <div className="admin-user">
              <span>
                {store.me.department} {store.me.name}
              </span>
              <Link href="/">민원인 화면</Link>
              <Link
                href="/admin/login"
                onClick={async (e) => {
                  e.preventDefault()
                  await store.signOut()
                  navigate('/admin/login')
                }}
              >
                로그아웃
              </Link>
            </div>
          </HeaderGlobalBar>
        )}
      </Header>
      <main className="admin-main">
        {children}
        <img className="admin-wordmark" src={wordmark} alt="" aria-hidden />
      </main>
    </>
  )
}
