import { Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="mx-auto min-h-dvh w-full px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] lg:w-[40%] lg:max-w-[40%]">
      <Outlet />
    </div>
  )
}
