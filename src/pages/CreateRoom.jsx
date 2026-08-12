import { Link, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useAnonymousAuth } from '../hooks/useAnonymousAuth'
import { db } from '../firebase/config'

function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString()
}

export default function CreateRoom() {
  const navigate = useNavigate()
  const { user, loading, error: authError } = useAnonymousAuth()

  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)

  const createRoom = async () => {
    if (!user || creating) return

    setCreating(true)
    setCreateError(null)

    try {
      let roomId = null

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const candidate = generateRoomCode()
        const roomRef = doc(db, 'rooms', candidate)
        const existingRoom = await getDoc(roomRef)

        if (!existingRoom.exists()) {
          roomId = candidate
          break
        }
      }

      if (!roomId) {
        throw new Error(
          'No se pudo generar un código de sala. Intentá nuevamente.',
        )
      }

      await setDoc(doc(db, 'rooms', roomId), {
        hostUid: user.uid,
        status: 'lobby',
        createdAt: serverTimestamp(),

        settings: {
          totalRounds: 5,
        },

        currentRound: 0,
      })

      navigate(`/sala/anfitrion/${roomId}`)
    } catch (err) {
      console.error(err)
      setCreateError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <Link to="/" className="text-sm text-muted hover:text-white">
          ← Volver
        </Link>

        <h1 className="mt-4 text-3xl font-black">
          Crear sala
        </h1>

        <p className="mt-2 text-muted">
          Creá una nueva partida y compartí el código con tus amigos.
        </p>
      </header>

      <button
        type="button"
        onClick={createRoom}
        disabled={loading || !user || creating}
        className="w-full rounded-2xl bg-gradient-to-br from-pink to-purple-600 px-4 py-4 text-center font-extrabold disabled:opacity-50"
      >
        {loading
          ? 'Preparando…'
          : creating
            ? 'Creando sala…'
            : 'Crear sala'}
      </button>

      {authError && (
        <p className="text-center text-sm text-red-400">
          No se pudo conectar. Recargá la página.
        </p>
      )}

      {createError && (
        <p className="text-center text-sm text-red-400">
          {createError}
        </p>
      )}
    </div>
  )
}