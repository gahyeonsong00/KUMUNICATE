import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { signInWithGoogle, signInWithPassword } from './api'
import type { Toast } from './CitizenApp'
import campusMap from '../../assets/map_final.png'
import mascotPair from '../../assets/mascot_pair.png'

// 로그인 화면: 민원인(구글) / 직원(구글 또는 데모 계정 → /admin)
// 회원가입·아이디 찾기·비밀번호 찾기는 없다
export default function LoginScreen({ toast }: { toast: Toast }) {
  const navigate = useNavigate()
  const [role, setRole] = useState<'user' | 'staff'>('user')
  const [showDemo, setShowDemo] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const isUser = role === 'user'

  const google = async () => {
    try {
      await signInWithGoogle(isUser ? '/' : '/admin')
    } catch {
      toast('로그인에 실패했어요. 다시 시도해 주세요')
    }
  }

  const passwordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !password) { toast('이메일과 비밀번호를 입력해 주세요'); return }
    setBusy(true)
    try {
      await signInWithPassword(email, password)
      if (!isUser) navigate('/admin')
      // 민원인은 로그인 상태가 바뀌면 CitizenApp이 지도 화면으로 넘긴다
    } catch (err) {
      toast(err instanceof Error ? err.message : '로그인에 실패했어요')
    } finally {
      setBusy(false)
    }
  }

  const demoForm = (
    <form onSubmit={passwordLogin} className={isUser ? 'demoBox' : undefined}>
      <label className="lbl" htmlFor="loginEmail">{isUser ? '심사·시연용 계정' : '이메일'}</label>
      <input id="loginEmail" className="slot field" type="email" placeholder="이메일" autoComplete="username"
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="lbl" htmlFor="loginPw">비밀번호</label>
      <input id="loginPw" className="slot field" type="password" placeholder="비밀번호" autoComplete="current-password"
        value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="btn3 bigBtn" type="submit" disabled={busy}>{isUser ? '데모 계정으로 이용하기' : '담당자 로그인'}</button>
    </form>
  )

  return (
    <div id="loginScreen" className="screen">
      <img id="loginBg" className="crisp" src={campusMap} alt="" />
      <div id="loginShade" />
      <div className="content">
        <div id="loginTitle" className="plate">경희대 키우기</div>
        <img className="crisp bob" src={mascotPair} width={190} alt="쿠옹이와 쿠밍이" />
        <div id="loginBox" className="panel">
          <div id="roleTabs">
            <button className={isUser ? 'btn2' : 'btn3'} type="button" onClick={() => setRole('user')}>민원인</button>
            <button className={isUser ? 'btn3' : 'btn2'} type="button" onClick={() => setRole('staff')}>직원(담당자)</button>
          </div>
          {isUser ? (
            <>
              <button className="btn bigBtn" type="button" onClick={google}>구글로 이용하기</button>
              <p className="sub loginHint">학교 구글 계정(@khu.ac.kr)으로 로그인해 주세요.</p>
              {showDemo
                ? demoForm
                : <button className="linkBtn" type="button" onClick={() => setShowDemo(true)}>심사·시연용 계정으로 로그인</button>}
            </>
          ) : (
            <>
              <button className="btn bigBtn" type="button" onClick={google}>학교 구글 계정으로 로그인</button>
              <p className="sub loginHint">부서 직원으로 지정된 계정만 민원을 받을 수 있어요.</p>
              <div className="demoBox">{demoForm}</div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
