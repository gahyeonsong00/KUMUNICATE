import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import AdminDashboard from './admin/AdminDashboard'
import ComplaintDetail from './admin/ComplaintDetail'
import { AdminStoreProvider } from './admin/store'
import CitizenApp from './citizen/CitizenApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CitizenApp />} />
        {/* 로그인은 민원인 화면(/)의 로그인 화면 하나로 한다. 직원 탭에서 로그인하면 /admin으로 간다 */}
        <Route path="/admin/login" element={<Navigate to="/" replace />} />
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
