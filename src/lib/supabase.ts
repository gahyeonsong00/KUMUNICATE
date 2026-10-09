import { createClient } from '@supabase/supabase-js'

// anon(공개) 키만 쓴다. 권한은 서버 RLS·함수가 막는다
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
