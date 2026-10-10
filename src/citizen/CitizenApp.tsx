import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSession, onAuthChange, signOut } from './api'
import LoginScreen from './LoginScreen'
import MainScreen from './MainScreen'
import ActivityScreen from './ActivityScreen'
import './citizen.css'

export type Toast = (msg: string) => void

// 안내 문구: 1.8초 떴다 사라짐
function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const show = useCallback<Toast>((m) => {
    setMsg(m)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 1800)
  }, [])
  return [msg, show] as const
}

// 민원인 화면 ('/'). 로그인 → 지도(메인) ↔ 나의 활동
export default function CitizenApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [screen, setScreen] = useState<'main' | 'activity'>('main')
  const [toastMsg, toast] = useToast()

  useEffect(() => {
    // 구글 로그인에서 돌아왔는데 학교 계정이 아니면 서버가 가입을 막고 오류를 붙여 보낸다
    const hashError = new URLSearchParams(window.location.hash.slice(1)).get('error_description')
    if (hashError) toast(/database error/i.test(hashError) ? '경희대학교(@khu.ac.kr) 계정으로 로그인해 주세요' : hashError)
    getSession().then(setSession)
    return onAuthChange(setSession)
  }, [toast])

  const logout = async () => {
    await signOut()
    setScreen('main')
  }

  return (
    <div className="citizen">
      <div id="app">
        {session === null && <LoginScreen toast={toast} />}
        {session && (
          <>
            {/* 나의 활동에 다녀와도 지도 상태(모드, 스크롤, 핀)가 남도록 메인은 계속 둔다 */}
            <MainScreen
              userId={session.user.id}
              hidden={screen !== 'main'}
              toast={toast}
              onOpenActivity={() => setScreen('activity')}
              onLogout={logout}
            />
            {screen === 'activity' && (
              <ActivityScreen userId={session.user.id} toast={toast} onBack={() => setScreen('main')} />
            )}
          </>
        )}
        {toastMsg && <div id="toast">{toastMsg}</div>}
      </div>
    </div>
  )
}
