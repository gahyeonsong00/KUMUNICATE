import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Carbon 내부 Sass 문법 경고는 우리가 고칠 수 없어서 숨긴다
  css: { preprocessorOptions: { scss: { quietDeps: true, silenceDeprecations: ['if-function'] } } },
})
