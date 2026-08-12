import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import CreateRoom from './pages/CreateRoom'
import JoinRoom from './pages/JoinRoom'
import HostRoom from './pages/HostRoom'
import PlayerRoom from './pages/PlayerRoom'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="crear" element={<CreateRoom />} />
        <Route path="unirse" element={<JoinRoom />} />
        <Route path="sala/anfitrion/:roomId" element={<HostRoom />} />
        <Route path="sala/jugador/:roomId" element={<PlayerRoom />} />
      </Route>
    </Routes>
  )
}
