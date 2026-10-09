import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, InlineNotification, PasswordInput, TextInput } from '@carbon/react'
import { Login } from '@carbon/icons-react'
import { supabase } from '../lib/supabase'
import AdminShell from './AdminShell'

// 직원 로그인: 학교 Google 계정, 또는 심사·시연용 데모 계정(이메일·비밀번호)
export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 이미 로그인돼 있으면 바로 직원 화면으로. Google 로그인에서 돌아왔을 때 오류도 여기서 보여 준다
  useEffect(() => {
    const hashError = new URLSearchParams(window.location.hash.slice(1)).get('error_description')
    if (hashError) setError(/database error/i.test(hashError) ? '경희대학교(@khu.ac.kr) 계정으로 로그인해 주세요.' : hashError)
    supabase.auth.getSession().then(({ data }) => data.session && navigate('/admin', { replace: true }))
  }, [navigate])

  const google = async () => {
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/admin`, queryParams: { hd: 'khu.ac.kr' } },
    })
    if (error) setError(error.message)
  }

  const demo = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? '이메일 또는 비밀번호가 맞지 않습니다.' : error.message)
    else navigate('/admin', { replace: true })
  }

  return (
    <AdminShell>
      <div className="login">
        <h1>직원 로그인</h1>
        <p className="muted">부서 직원으로 지정된 계정만 민원을 받을 수 있습니다.</p>
        {error && <InlineNotification kind="error" title={error} lowContrast onClose={() => setError(null)} />}
        <Button size="lg" renderIcon={Login} onClick={google} className="login-google">
          경희대학교 Google 계정으로 로그인
        </Button>
        <form className="login-demo" onSubmit={demo}>
          <h2>심사·시연용 계정</h2>
          <TextInput id="email" labelText="이메일" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
          <PasswordInput
            id="password"
            labelText="비밀번호"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" kind="tertiary" disabled={busy || !email || !password}>
            {busy ? '로그인 중' : '로그인'}
          </Button>
        </form>
      </div>
    </AdminShell>
  )
}
