import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import { useAnonymousAuth } from '../hooks/useAnonymousAuth'
import { db } from '../firebase/config'

export default function JoinRoom() {
  const [searchParams] = useSearchParams()

  const [roomCode, setRoomCode] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState(null)

  const navigate = useNavigate()
  const { user, loading, error: authError } = useAnonymousAuth()

  useEffect(() => {
    const roomFromUrl = searchParams.get('room')

    if (roomFromUrl) {
      const cleanRoom = roomFromUrl.replace(/\D/g, '').slice(0, 4)
      setRoomCode(cleanRoom)
    }

    const savedName = localStorage.getItem('en-una-nota-player-name')

    if (savedName) {
      setPlayerName(savedName)
    }
  }, [searchParams])

  const handleRoomCodeChange = (event) => {
    const onlyNumbers = event.target.value.replace(/\D/g, '').slice(0, 4)
    setRoomCode(onlyNumbers)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()

    const code = roomCode.trim()
    const name = playerName.trim()

    if (!code || !name || !user || joining) return

    if (code.length !== 4) {
      setJoinError('El código debe tener 4 números.')
      return
    }

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

      const playerRef = doc(db, 'rooms', code, 'players', user.uid)
      const existingPlayerSnapshot = await getDoc(playerRef)

      localStorage.setItem('en-una-nota-player-name', name)

      if (existingPlayerSnapshot.exists()) {
        await setDoc(
          playerRef,
          {
            name,
            connected: true,
          },
          { merge: true },
        )
      } else {
        const currentRound = roomData.currentRound ?? 0
        const joiningLate = roomData.status === 'playing'

        await setDoc(playerRef, {
          uid: user.uid,
          name,
          score: 0,
          joinedAt: serverTimestamp(),
          connected: true,
          joinedRound: currentRound,
          canPlayFromRound: joiningLate ? currentRound + 1 : 1,
        })
      }

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
          onChange={handleRoomCodeChange}
          placeholder="1234"
          maxLength={4}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className="w-full rounded-2xl border border-white/15 bg-bg px-4 py-3 text-lg tracking-widest outline-none focus:border-cyan"
        />

        <button
          type="submit"
          disabled={
            loading ||
            !user ||
            !playerName.trim() ||
            roomCode.length !== 4 ||
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