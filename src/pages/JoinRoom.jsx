import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useAnonymousAuth } from '../hooks/useAnonymousAuth'
import { db } from '../firebase/config'

export default function JoinRoom() {
  const [roomCode, setRoomCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  const navigate = useNavigate()
  const { user, loading, error: authError } = useAnonymousAuth()

  const handleSubmit = async (event) => {
    event.preventDefault()

    const code = roomCode.trim().toUpperCase()
    const name = playerName.trim()

    if (!code || !name || !user || joining) return

    setJoining(true)
    setJoinError(null)

    try {
      const roomRef = doc(db, 'rooms', code)
      const roomSnapshot = await getDoc(roomRef)

      if (!roomSnapshot.exists()) {
        throw new Error('La sala no existe.')
      }

      const roomData = roomSnapshot.data()

      if (roomData.status !== 'lobby' && roomData.status !== 'playing') {
        throw new Error('No se puede entrar a esta partida.')
      }

      const currentRound = roomData.currentRound ?? 0
      const joiningLate = roomData.status === 'playing'

      await setDoc(doc(db, 'rooms', code, 'players', user.uid), {
        uid: user.uid,
        name,
        score: 0,
        joinedAt: serverTimestamp(),
        connected: true,
        joinedRound: currentRound,
        canPlayFromRound: joiningLate ? currentRound + 1 : 1,
      })

      navigate(`/sala/jugador/${code}`)
    } catch (err) {
      console.error(err)
      setJoinError(err.message)
    } finally {
      setJoining(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link to="/" className="text-sm text-muted hover:text-white">
          ← Volver
        </Link>

        <h1 className="mt-4 text-3xl font-black">Unirse a sala</h1>

        <p className="mt-2 text-muted">
          Ingresá tu nombre y el código que te compartió el anfitrión.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="space-y-4 rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10"
      >
        <label htmlFor="playerName" className="block text-sm text-muted">
          Tu nombre
        </label>

        <input
          id="playerName"
          value={playerName}
          onChange={(event) => setPlayerName(event.target.value)}
          placeholder="Nico"
          maxLength={20}
          autoComplete="off"
          className="w-full rounded-2xl border border-white/15 bg-bg px-4 py-3 text-lg outline-none focus:border-cyan"
        />

        <label htmlFor="roomCode" className="block text-sm text-muted">
          Código de sala
        </label>

        <input
          id="roomCode"
          value={roomCode}
          onChange={(event) => setRoomCode(event.target.value)}
          placeholder="ABCD"
          maxLength={4}
          autoComplete="off"
          className="w-full rounded-2xl border border-white/15 bg-bg px-4 py-3 text-lg uppercase tracking-widest outline-none focus:border-cyan"
        />

        <button
          type="submit"
          disabled={
            loading ||
            !user ||
            !playerName.trim() ||
            !roomCode.trim() ||
            joining
          }
          className="w-full rounded-2xl bg-gradient-to-br from-pink to-purple-600 px-4 py-3 font-bold disabled:opacity-50"
        >
          {loading ? 'Preparando…' : joining ? 'Entrando…' : 'Entrar'}
        </button>

        {authError && (
          <p className="text-center text-sm text-red-400">
            No se pudo conectar. Recargá la página.
          </p>
        )}

        {joinError && (
          <p className="text-center text-sm text-red-400">
            {joinError}
          </p>
        )}
      </form>
    </div>
  )
}
