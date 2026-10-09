import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Outlet, Route, Routes } from 'react-router-dom'
import AdminDashboard from './admin/AdminDashboard'
import AdminLogin from './admin/AdminLogin'
import ComplaintDetail from './admin/ComplaintDetail'
import { AdminStoreProvider } from './admin/store'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* 민원인 화면은 다른 팀원 담당. 이 자리에 붙인다 */}
        <Route path="/" element={<p style={{ padding: 24 }}>민원인 화면 자리</p>} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <AdminStoreProvider>
              <Outlet />
            </AdminStoreProvider>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="complaints/:no" element={<ComplaintDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
