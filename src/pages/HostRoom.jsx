import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import {
  onValue,
  ref as realtimeRef,
} from 'firebase/database'
import { useAnonymousAuth } from '../hooks/useAnonymousAuth'
import { db, realtimeDb } from '../firebase/config'
import { songs } from '../songs'

const ROUND_OPTIONS = [5, 10, 15, 20]

function getRandomUnusedSong(usedSongs = []) {
  const currentSongNames = new Set(songs)
  const validUsedSongs = usedSongs.filter((song) => currentSongNames.has(song))

  let availableSongs = songs.filter(
    (song) => !validUsedSongs.includes(song),
  )

  // Si realmente ya salieron todas las canciones, habilitamos nuevamente
  // la lista completa para que una ronda extra nunca quede bloqueada.
  if (availableSongs.length === 0) {
    availableSongs = [...songs]
  }

  if (availableSongs.length === 0) return null

  return availableSongs[
    Math.floor(Math.random() * availableSongs.length)
  ]
}

export default function HostRoom() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const { user, loading } = useAnonymousAuth()

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [roomError, setRoomError] = useState(null)
  const [updating, setUpdating] = useState(false)

  const [isAudioPlaying, setIsAudioPlaying] = useState(false)
  const [songStarted, setSongStarted] = useState(false)
  const [showFinishConfirm, setShowFinishConfirm] = useState(false)

  const audioRef = useRef(null)
  const previousQueueLengthRef = useRef(0)
  const buzzSettleTimerRef = useRef(null)
  const pendingBuzzesRef = useRef({})

  const normalizedRoomId = roomId?.toUpperCase()

  useEffect(() => {
    if (!normalizedRoomId) return

    const roomRef = doc(db, 'rooms', normalizedRoomId)

    return onSnapshot(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setRoomError('La sala no existe.')
          setRoom(null)
          return
        }

        setRoom(snapshot.data())
        setRoomError(null)
      },
      (error) => {
        console.error(error)
        setRoomError('No se pudo cargar la sala.')
      },
    )
  }, [normalizedRoomId])

  useEffect(() => {
    if (!normalizedRoomId) return

    const playersRef = collection(
      db,
      'rooms',
      normalizedRoomId,
      'players',
    )

    return onSnapshot(
      playersRef,
      (snapshot) => {
        const playerList = snapshot.docs.map((playerDoc) => ({
          id: playerDoc.id,
          ...playerDoc.data(),
        }))

        playerList.sort((a, b) => {
          const aTime = a.joinedAt?.seconds ?? 0
          const bTime = b.joinedAt?.seconds ?? 0
          return aTime - bTime
        })

        setPlayers(playerList)
      },
      (error) => {
        console.error(error)
      },
    )
  }, [normalizedRoomId])

  useEffect(() => {
    if (
      !normalizedRoomId ||
      room?.status !== 'playing' ||
      !room?.currentRound ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    const buzzesRef = realtimeRef(
      realtimeDb,
      `buzzerRooms/${normalizedRoomId}/${room.currentRound}/buzzes`,
    )

    const roomRef = doc(db, 'rooms', normalizedRoomId)

    const commitBuzzes = async () => {
      const buzzes = Object.values(pendingBuzzesRef.current)
        .filter((buzz) => buzz?.uid && Number.isFinite(buzz?.pressedAt))
        .sort((a, b) => a.pressedAt - b.pressedAt)

      if (buzzes.length === 0) return

      const currentQueue = room?.buzzQueue ?? []
      const existing = new Set(currentQueue)

      const newBuzzes = buzzes.filter(
        (buzz) => !existing.has(buzz.uid),
      )

      if (newBuzzes.length === 0) return

      // Una vez mostrado un jugador, nunca reordenamos a los que ya
      // estaban en la cola. Las pulsaciones nuevas solo se agregan detrás.
      const nextQueue = [
        ...currentQueue,
        ...newBuzzes.map((buzz) => buzz.uid),
      ]

      const nextBuzzTimes = {
        ...(room?.buzzTimes ?? {}),
      }

      newBuzzes.forEach((buzz) => {
        nextBuzzTimes[buzz.uid] = buzz.pressedAt
      })

      try {
        await updateDoc(roomRef, {
          buzzQueue: nextQueue,
          buzzTimes: nextBuzzTimes,
        })
      } catch (error) {
        console.error('No se pudo sincronizar el orden del pulsador.', error)
      }
    }

    const unsubscribe = onValue(buzzesRef, (snapshot) => {
      const value = snapshot.val() ?? {}
      pendingBuzzesRef.current = value

      const buzzCount = Object.keys(value).length

      if (buzzCount === 0) return

      // La música se pausa apenas llega cualquier pulsación a RTDB.
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause()
        setIsAudioPlaying(false)
      }

      const currentQueue = room?.buzzQueue ?? []

      if (currentQueue.length === 0) {
        // Damos una ventana muy corta para que lleguen pulsaciones casi
        // simultáneas y recién entonces fijamos el primer orden.
        if (!buzzSettleTimerRef.current) {
          buzzSettleTimerRef.current = window.setTimeout(() => {
            buzzSettleTimerRef.current = null
            commitBuzzes()
          }, 450)
        }

        return
      }

      // Si el primer orden ya quedó fijado, las pulsaciones posteriores
      // se agregan sin cambiar jamás quién estaba antes.
      commitBuzzes()
    })

    return () => {
      unsubscribe()

      if (buzzSettleTimerRef.current) {
        window.clearTimeout(buzzSettleTimerRef.current)
        buzzSettleTimerRef.current = null
      }

      pendingBuzzesRef.current = {}
    }
  }, [
    normalizedRoomId,
    room?.status,
    room?.currentRound,
    room?.roundStatus,
    room?.buzzQueue,
    room?.buzzTimes,
  ])

  useEffect(() => {
    const currentQueueLength = room?.buzzQueue?.length ?? 0

    if (
      currentQueueLength > previousQueueLengthRef.current &&
      isAudioPlaying
    ) {
      audioRef.current?.pause()
      setIsAudioPlaying(false)
    }

    previousQueueLengthRef.current = currentQueueLength
  }, [room?.buzzQueue?.length, isAudioPlaying])

  useEffect(() => {
    if (!audioRef.current || !room?.currentSong) return

    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current.load()

    setIsAudioPlaying(false)
    setSongStarted(false)
  }, [room?.currentSong])

  const setTotalRounds = async (totalRounds) => {
    if (
      !normalizedRoomId ||
      updating ||
      room?.status !== 'lobby'
    ) {
      return
    }

    setUpdating(true)

    try {
      await updateDoc(doc(db, 'rooms', normalizedRoomId), {
        'settings.totalRounds': totalRounds,
      })
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo cambiar la cantidad de rondas.')
    } finally {
      setUpdating(false)
    }
  }

  const resetLocalAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }

    setIsAudioPlaying(false)
    setSongStarted(false)
    setShowFinishConfirm(false)
    previousQueueLengthRef.current = 0
  }

  const startGame = async () => {
    if (
      !normalizedRoomId ||
      updating ||
      room?.status !== 'lobby' ||
      players.length === 0
    ) {
      return
    }

    const firstSong = getRandomUnusedSong([])

    if (!firstSong) {
      setRoomError('No hay canciones disponibles.')
      return
    }

    setUpdating(true)

    try {
      resetLocalAudio()

      await updateDoc(doc(db, 'rooms', normalizedRoomId), {
        status: 'playing',
        currentRound: 1,

        currentSong: firstSong,
        usedSongs: [firstSong],

        buzzerEnabled: false,
        buzzQueue: [],
        currentResponderIndex: 0,

        roundStatus: 'waiting',
        roundResult: null,
        winnerUid: null,
      })
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo iniciar la partida.')
    } finally {
      setUpdating(false)
    }
  }

  const startSong = async () => {
    if (
      !audioRef.current ||
      !room?.currentSong ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    try {
      audioRef.current.currentTime = 0
      await audioRef.current.play()

      setSongStarted(true)
      setIsAudioPlaying(true)

      await updateDoc(doc(db, 'rooms', normalizedRoomId), {
        buzzerEnabled: true,
      })
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo reproducir la canción.')
      setIsAudioPlaying(false)
    }
  }

  const togglePauseResume = async () => {
    if (
      !audioRef.current ||
      !songStarted ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    try {
      if (isAudioPlaying) {
        audioRef.current.pause()
        setIsAudioPlaying(false)
      } else {
        await audioRef.current.play()
        setIsAudioPlaying(true)
      }
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo controlar la reproducción.')
    }
  }

  const restartSong = async () => {
    if (
      !audioRef.current ||
      !songStarted ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    try {
      audioRef.current.currentTime = 0

      if (isAudioPlaying) {
        await audioRef.current.play()
      }
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo reiniciar la canción.')
    }
  }

  const playSound = (src) => {
    const sound = new Audio(src)
    sound.currentTime = 0
    sound.play().catch((error) => {
      console.error('No se pudo reproducir el sonido.', error)
    })
  }

  const resumeSongForReveal = async () => {
    if (!audioRef.current || !songStarted) return

    try {
      await audioRef.current.play()
      setIsAudioPlaying(true)
    } catch (error) {
      console.error('No se pudo reanudar la canción al finalizar la ronda.', error)
    }
  }

  const getPlayerName = (uid) => {
    return players.find((player) => player.id === uid)?.name ?? 'Jugador'
  }

  const queue = room?.buzzQueue ?? []
  const responderIndex = room?.currentResponderIndex ?? 0
  const currentResponderUid = queue[responderIndex] ?? null

  const eligiblePlayers = players.filter(
    (player) =>
      (player.canPlayFromRound ?? 1) <=
      (room?.currentRound ?? 0),
  )

  const markIncorrect = async () => {
    if (
      !normalizedRoomId ||
      !currentResponderUid ||
      updating ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    setUpdating(true)

    try {
      const roomRef = doc(db, 'rooms', normalizedRoomId)

      const playerRef = doc(
        db,
        'rooms',
        normalizedRoomId,
        'players',
        currentResponderUid,
      )

      await runTransaction(db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef)
        const playerSnapshot = await transaction.get(playerRef)

        if (!roomSnapshot.exists() || !playerSnapshot.exists()) {
          throw new Error('No se encontró la partida o el jugador.')
        }

        const roomData = roomSnapshot.data()
        const playerData = playerSnapshot.data()

        const currentQueue = roomData.buzzQueue ?? []
        const currentIndex = roomData.currentResponderIndex ?? 0
        const uid = currentQueue[currentIndex]

        if (!uid || uid !== currentResponderUid) return

        const nextIndex = currentIndex + 1

        const everyoneBuzzed =
          currentQueue.length >= eligiblePlayers.length

        transaction.update(playerRef, {
          score: (playerData.score ?? 0) - 1,
        })

        if (nextIndex < currentQueue.length) {
          transaction.update(roomRef, {
            currentResponderIndex: nextIndex,
          })

          return
        }

        if (everyoneBuzzed) {
          transaction.update(roomRef, {
            currentResponderIndex: nextIndex,
            buzzerEnabled: false,
            roundStatus: 'finished',
            roundResult: 'all_wrong',
            winnerUid: null,
          })

          return
        }

        transaction.update(roomRef, {
          currentResponderIndex: nextIndex,
        })
      })

      playSound('/sounds/answer-wrong.mp3')

      const nextIndex = responderIndex + 1
      const everyoneBuzzed =
        queue.length >= eligiblePlayers.length

      if (
        nextIndex >= queue.length &&
        everyoneBuzzed
      ) {
        await resumeSongForReveal()
      }
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo registrar el error.')
    } finally {
      setUpdating(false)
    }
  }

  const markCorrect = async () => {
    if (
      !normalizedRoomId ||
      !currentResponderUid ||
      updating ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    setUpdating(true)

    try {
      const roomRef = doc(db, 'rooms', normalizedRoomId)

      const playerRef = doc(
        db,
        'rooms',
        normalizedRoomId,
        'players',
        currentResponderUid,
      )

      await runTransaction(db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef)
        const playerSnapshot = await transaction.get(playerRef)

        if (!roomSnapshot.exists() || !playerSnapshot.exists()) {
          throw new Error('No se encontró la partida o el jugador.')
        }

        const roomData = roomSnapshot.data()
        const playerData = playerSnapshot.data()

        const currentQueue = roomData.buzzQueue ?? []
        const currentIndex = roomData.currentResponderIndex ?? 0
        const uid = currentQueue[currentIndex]

        if (!uid || uid !== currentResponderUid) return

        transaction.update(playerRef, {
          score: (playerData.score ?? 0) + 1,
        })

        transaction.update(roomRef, {
          buzzerEnabled: false,
          roundStatus: 'finished',
          roundResult: 'correct',
          winnerUid: uid,
        })
      })

      playSound('/sounds/correct.mp3')
      await resumeSongForReveal()
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo registrar el acierto.')
    } finally {
      setUpdating(false)
    }
  }

  const finishRound = async () => {
    if (
      !normalizedRoomId ||
      updating ||
      room?.roundStatus === 'finished'
    ) {
      return
    }

    setUpdating(true)

    try {
      await updateDoc(doc(db, 'rooms', normalizedRoomId), {
        buzzerEnabled: false,
        roundStatus: 'finished',
        roundResult: 'host_finished',
        winnerUid: null,
      })

      setShowFinishConfirm(false)
      await resumeSongForReveal()
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo finalizar la ronda.')
    } finally {
      setUpdating(false)
    }
  }

  const prepareNewRound = async ({
    nextRound,
    nextTotalRounds,
  }) => {
    const usedSongs = room?.usedSongs ?? []
    const nextSong = getRandomUnusedSong(usedSongs)

    if (!nextSong) {
      setRoomError(
        'No quedan canciones sin repetir. Agregá más canciones para continuar.',
      )
      return
    }

    setUpdating(true)
    setRoomError(null)

    try {
      resetLocalAudio()

      await updateDoc(doc(db, 'rooms', normalizedRoomId), {
        currentRound: nextRound,

        'settings.totalRounds': nextTotalRounds,

        currentSong: nextSong,
        usedSongs: [...usedSongs, nextSong],

        buzzerEnabled: false,
        buzzQueue: [],
        currentResponderIndex: 0,

        roundStatus: 'waiting',
        roundResult: null,
        winnerUid: null,
      })
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo comenzar la siguiente ronda.')
    } finally {
      setUpdating(false)
    }
  }

  const startNextRound = async () => {
    if (
      !normalizedRoomId ||
      updating ||
      room?.roundStatus !== 'finished'
    ) {
      return
    }

    const currentRound = room?.currentRound ?? 1
    const totalRounds = room?.settings?.totalRounds ?? 5

    if (currentRound >= totalRounds) return

    await prepareNewRound({
      nextRound: currentRound + 1,
      nextTotalRounds: totalRounds,
    })
  }

  const playExtraRound = async () => {
    if (
      !normalizedRoomId ||
      updating ||
      room?.roundStatus !== 'finished'
    ) {
      return
    }

    const currentRound = room?.currentRound ?? 1
    const totalRounds = room?.settings?.totalRounds ?? 5

    await prepareNewRound({
      nextRound: currentRound + 1,
      nextTotalRounds: totalRounds + 1,
    })
  }

  const createNewGame = async () => {
    if (
      !normalizedRoomId ||
      !user ||
      updating ||
      room?.roundStatus !== 'finished'
    ) {
      return
    }

    setUpdating(true)
    setRoomError(null)

    try {
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
      let newRoomCode = null
      let newRoomRef = null

      for (let attempt = 0; attempt < 20; attempt += 1) {
        const candidate = Array.from(
          { length: 4 },
          () => alphabet[Math.floor(Math.random() * alphabet.length)],
        ).join('')

        const candidateRef = doc(db, 'rooms', candidate)
        const candidateSnapshot = await getDoc(candidateRef)

        if (!candidateSnapshot.exists()) {
          newRoomCode = candidate
          newRoomRef = candidateRef
          break
        }
      }

      if (!newRoomCode || !newRoomRef) {
        throw new Error('No se pudo generar un código de sala nuevo.')
      }

      const batch = writeBatch(db)

      batch.set(newRoomRef, {
        hostUid: user.uid,
        createdAt: serverTimestamp(),

        status: 'lobby',
        currentRound: 0,

        settings: {
          totalRounds: 5,
        },

        currentSong: null,
        usedSongs: [],

        buzzerEnabled: false,
        buzzQueue: [],
        currentResponderIndex: 0,

        roundStatus: 'waiting',
        roundResult: null,
        winnerUid: null,

        nextRoomCode: null,
      })

      players.forEach((player) => {
        const newPlayerRef = doc(
          db,
          'rooms',
          newRoomCode,
          'players',
          player.id,
        )

        batch.set(newPlayerRef, {
          uid: player.id,
          name: player.name ?? 'Jugador',
          score: 0,
          joinedAt: serverTimestamp(),
          connected: true,
          canPlayFromRound: 1,
        })
      })

      batch.update(doc(db, 'rooms', normalizedRoomId), {
        nextRoomCode: newRoomCode,
      })

      await batch.commit()

      navigate(`/sala/anfitrion/${newRoomCode}`, {
        replace: true,
      })
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo crear la nueva partida.')
    } finally {
      setUpdating(false)
    }
  }

  const sortedPlayers = [...players].sort((a, b) => {
    const scoreDifference =
      (b.score ?? 0) - (a.score ?? 0)

    if (scoreDifference !== 0) {
      return scoreDifference
    }

    const aTime = a.joinedAt?.seconds ?? 0
    const bTime = b.joinedAt?.seconds ?? 0

    return aTime - bTime
  })

  const topScore =
    sortedPlayers.length > 0
      ? sortedPlayers[0].score ?? 0
      : 0

  const leaders = sortedPlayers.filter(
    (player) => (player.score ?? 0) === topScore,
  )

  const plannedRoundsFinished =
    room?.roundStatus === 'finished' &&
    (room?.currentRound ?? 0) >=
      (room?.settings?.totalRounds ?? 5)

  const hasFinalTie =
    plannedRoundsFinished &&
    leaders.length > 1

  const finalWinner =
    plannedRoundsFinished &&
    leaders.length === 1
      ? leaders[0]
      : null

  const audioSource =
    room?.currentSong
      ? `/songs/${room.currentSong.replace(/#/g, '%23')}`
      : ''

  return (
    <div className="space-y-6">
      {room?.currentSong && (
        <audio
          key={room.currentSong}
          ref={audioRef}
          src={audioSource}
          preload="auto"
        />
      )}

      <header>
        <Link
          to="/crear"
          className="text-sm text-muted hover:text-white"
        >
          ← Volver
        </Link>

        <h1 className="mt-4 text-3xl font-black">
          Sala del anfitrión
        </h1>

        <p className="mt-2 text-muted">
          Panel de control de la partida.
        </p>
      </header>

      <section className="rounded-3xl bg-panel/90 p-5 text-center ring-1 ring-white/10">
        <p className="text-sm text-muted">
          Código de sala
        </p>

        <p className="mt-2 text-4xl font-black tracking-[0.3em] text-yellow">
          {normalizedRoomId ?? '----'}
        </p>
      </section>

      {roomError && (
        <p className="text-center text-sm text-red-400">
          {roomError}
        </p>
      )}

      <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
        <h2 className="font-bold">
          Jugadores
        </h2>

        {players.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            Esperando jugadores…
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {players.map((player, index) => (
              <li
                key={player.id}
                className="flex items-center justify-between rounded-2xl bg-bg/60 px-4 py-3 ring-1 ring-white/10"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-white/10 text-sm font-bold">
                    {index + 1}
                  </span>

                  <span className="font-bold">
                    {player.name ?? 'Jugador'}
                  </span>
                </div>

                <span className="font-black text-yellow">
                  {player.score ?? 0} pts
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {room?.status === 'lobby' && (
        <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
          <h2 className="font-bold">
            Cantidad de rondas
          </h2>

          <p className="mt-2 text-sm text-muted">
            Elegí cuántas rondas tendrá la partida.
          </p>

          <div className="mt-4 grid grid-cols-4 gap-3">
            {ROUND_OPTIONS.map((option) => {
              const selected =
                room?.settings?.totalRounds === option

              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTotalRounds(option)}
                  disabled={updating}
                  className={`rounded-2xl px-3 py-4 font-black ring-1 ${
                    selected
                      ? 'bg-yellow text-black ring-yellow'
                      : 'bg-bg/60 ring-white/10'
                  } disabled:opacity-50`}
                >
                  {option}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={startGame}
            disabled={updating || players.length === 0}
            className="mt-5 w-full rounded-2xl bg-gradient-to-br from-pink to-purple-600 px-4 py-4 font-extrabold disabled:opacity-50"
          >
            {updating
              ? 'Procesando…'
              : 'Iniciar partida'}
          </button>
        </section>
      )}

      {room?.status === 'playing' && (
        <>
          <section className="rounded-3xl bg-panel/90 p-5 text-center ring-1 ring-white/10">
            <p className="text-sm text-muted">
              Partida en curso
            </p>

            <p className="mt-2 text-3xl font-black text-yellow">
              Ronda {room.currentRound} de{' '}
              {room.settings?.totalRounds}
            </p>
          </section>

          {room.roundStatus !== 'finished' && (
            <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
              <h2 className="font-bold">
                Canción
              </h2>

              <div className="mt-3 rounded-2xl bg-bg/60 p-4 ring-1 ring-white/10">
                <p className="text-sm text-muted">
                  Canción actual
                </p>

                <p className="mt-1 break-words font-black text-yellow">
                  {room.currentSong}
                </p>
              </div>

              {!songStarted ? (
                <button
                  type="button"
                  onClick={startSong}
                  disabled={updating}
                  className="mt-4 w-full rounded-2xl bg-green-600 px-4 py-4 font-black disabled:opacity-50"
                >
                  ▶ Reproducir canción
                </button>
              ) : (
                <>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={togglePauseResume}
                      disabled={updating}
                      className={`rounded-2xl px-4 py-4 font-black ${
                        isAudioPlaying
                          ? 'bg-yellow text-black'
                          : 'bg-green-600'
                      } disabled:opacity-50`}
                    >
                      {isAudioPlaying
                        ? '⏸ Pausar'
                        : '▶ Reanudar'}
                    </button>

                    <button
                      type="button"
                      onClick={restartSong}
                      disabled={updating}
                      className="rounded-2xl bg-panel px-4 py-4 font-black ring-1 ring-white/20 disabled:opacity-50"
                    >
                      ⏮ Reiniciar canción
                    </button>
                  </div>

                  <p className="mt-3 text-center text-sm text-muted">
                    {isAudioPlaying
                      ? '♪ Canción reproduciéndose'
                      : 'Canción pausada'}
                  </p>
                </>
              )}

              <button
                type="button"
                onClick={() => setShowFinishConfirm(true)}
                disabled={updating}
                className="mt-4 w-full rounded-2xl bg-red-800 px-4 py-4 font-black disabled:opacity-50"
              >
                ⏹ Finalizar ronda
              </button>
            </section>
          )}

          <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
            <h2 className="font-bold">
              Orden de pulsación
            </h2>

            {!queue.length ? (
              <p className="mt-3 text-sm text-muted">
                Nadie pulsó todavía.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {queue.map((uid, index) => {
                  const alreadyAnswered =
                    index < responderIndex

                  const isCurrent =
                    index === responderIndex

                  const isWinner =
                    room?.roundStatus === 'finished' &&
                    room?.roundResult === 'correct' &&
                    room?.winnerUid === uid

                  const isResponding =
                    isCurrent &&
                    room?.roundStatus !== 'finished'

                  return (
                    <li
                      key={uid}
                      className={`rounded-2xl px-4 py-3 font-bold ring-1 ${
                        isWinner
                          ? 'bg-green-600 text-white ring-green-500'
                          : isResponding
                            ? 'bg-yellow text-black ring-yellow'
                            : 'bg-bg/60 ring-white/10'
                      }`}
                    >
                      {index + 1}º —{' '}
                      {getPlayerName(uid)}

                      {isWinner &&
                        ' — ✅ ACERTÓ'}

                      {isResponding &&
                        ' — RESPONDIENDO'}

                      {alreadyAnswered &&
                        !isWinner &&
                        ' — ❌'}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {room.roundStatus !== 'finished' && (
            <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
              {currentResponderUid ? (
                <>
                  <p className="text-center text-sm text-muted">
                    Está respondiendo
                  </p>

                  <p className="mt-2 text-center text-3xl font-black text-yellow">
                    {getPlayerName(currentResponderUid)}
                  </p>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={markIncorrect}
                      disabled={updating}
                      className="rounded-2xl bg-red-700 px-4 py-4 font-black disabled:opacity-50"
                    >
                      INCORRECTO
                    </button>

                    <button
                      type="button"
                      onClick={markCorrect}
                      disabled={updating}
                      className="rounded-2xl bg-green-600 px-4 py-4 font-black disabled:opacity-50"
                    >
                      CORRECTO
                    </button>
                  </div>
                </>
              ) : (
                <p className="text-center text-muted">
                  {!songStarted
                    ? 'Reproducí la canción para comenzar.'
                    : isAudioPlaying
                      ? 'Esperando una pulsación…'
                      : 'La canción está pausada.'}
                </p>
              )}
            </section>
          )}

          {room.roundStatus === 'finished' && (
            <section className="rounded-3xl bg-panel/90 p-6 text-center ring-1 ring-white/10">
              {!plannedRoundsFinished && (
                <>
                  {room.roundResult === 'correct' ? (
                    <p className="text-3xl font-black text-ok">
                      ✅ {getPlayerName(room.winnerUid)} acertó
                    </p>
                  ) : room.roundResult === 'all_wrong' ? (
                    <p className="text-3xl font-black">
                      ❌ Todos fallaron
                    </p>
                  ) : (
                    <p className="text-3xl font-black">
                      ⏹ Finalizada por el anfitrión
                    </p>
                  )}

                  <div className="mt-5 rounded-2xl bg-bg/60 p-4 ring-1 ring-white/10">
                    <p className="text-sm text-muted">
                      Canción
                    </p>

                    <p className="mt-1 break-words font-black text-yellow">
                      {room.currentSong}
                    </p>

                    <p className="mt-4 text-sm text-muted">
                      Puntajes
                    </p>

                    <div className="mt-2 space-y-1">
                      {sortedPlayers.map((player) => (
                        <p key={player.id}>
                          {player.name}: {player.score ?? 0} pts
                        </p>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={startNextRound}
                    disabled={updating}
                    className="mt-6 w-full rounded-2xl bg-gradient-to-br from-pink to-purple-600 px-4 py-4 font-extrabold disabled:opacity-50"
                  >
                    {updating
                      ? 'Preparando…'
                      : 'Nueva ronda'}
                  </button>
                </>
              )}

              {plannedRoundsFinished && (
                <div className="rounded-3xl bg-yellow/10 p-6 ring-1 ring-yellow/30">
                  <p className="text-sm font-black tracking-[0.2em] text-yellow">
                    🏆 PARTIDA FINALIZADA
                  </p>

                  {finalWinner ? (
                    <>
                      <p className="mt-5 text-sm font-bold text-muted">
                        GANADOR
                      </p>

                      <p className="mt-2 text-5xl font-black text-yellow">
                        {finalWinner.name}
                      </p>

                      <p className="mt-2 text-xl text-muted">
                        {finalWinner.score ?? 0} puntos
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="mt-5 text-4xl font-black">
                        🤝 EMPATE
                      </p>

                      <p className="mt-3 text-muted">
                        Hay más de un jugador en el primer puesto.
                      </p>

                      <div className="mx-auto mt-4 max-w-lg space-y-2">
                        {leaders.map((player) => (
                          <div
                            key={player.id}
                            className="flex items-center justify-between rounded-2xl bg-bg/60 px-4 py-3"
                          >
                            <span className="font-bold">
                              {player.name}
                            </span>

                            <span className="font-black text-yellow">
                              {player.score ?? 0} pts
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}

                  <div className="mt-7">
                    <p className="text-sm font-bold text-muted">
                      Clasificación final
                    </p>

                    <ol className="mt-3 space-y-2">
                      {sortedPlayers.map((player, index) => (
                        <li
                          key={player.id}
                          className="flex items-center justify-between rounded-2xl bg-bg/60 px-4 py-3"
                        >
                          <span className="font-bold">
                            {index + 1}º — {player.name}
                          </span>

                          <span className="font-black text-yellow">
                            {player.score ?? 0} pts
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={playExtraRound}
                      disabled={updating}
                      className="w-full rounded-2xl bg-gradient-to-br from-pink to-purple-600 px-4 py-4 font-extrabold disabled:opacity-50"
                    >
                      {updating
                        ? 'Preparando…'
                        : '➕ Jugar una ronda más'}
                    </button>

                    <button
                      type="button"
                      onClick={createNewGame}
                      disabled={updating}
                      className="w-full rounded-2xl bg-bg px-4 py-4 font-extrabold ring-1 ring-white/15 hover:ring-white/30 disabled:opacity-50"
                    >
                      {updating
                        ? 'Creando…'
                        : '🔄 Nueva partida'}
                    </button>
                  </div>

                  <p className="mt-4 text-xs text-muted">
                    La ronda extra mantiene los puntajes actuales.
                  </p>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {showFinishConfirm &&
        room?.roundStatus !== 'finished' && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-5">
            <div className="w-full max-w-md rounded-3xl bg-panel p-6 text-center ring-1 ring-white/15">
              <h2 className="text-2xl font-black">
                ¿Finalizar esta ronda?
              </h2>

              <p className="mt-3 text-muted">
                Se revelará la canción y se mostrarán los puntajes actuales.
              </p>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setShowFinishConfirm(false)
                  }
                  className="rounded-2xl bg-bg px-4 py-3 font-bold ring-1 ring-white/15"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={finishRound}
                  disabled={updating}
                  className="rounded-2xl bg-red-700 px-4 py-3 font-black disabled:opacity-50"
                >
                  Finalizar
                </button>
              </div>
            </div>
          </div>
        )}

      <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
        <h2 className="font-bold">
          Estado
        </h2>

        <ul className="mt-3 space-y-2 text-sm text-muted">
          <li>
            Firebase Auth:{' '}
            {loading
              ? '…'
              : user
                ? 'Conectado'
                : 'Sin sesión'}
          </li>

          <li>
            Firestore:{' '}
            {room
              ? 'Conectado'
              : 'Cargando…'}
          </li>

          <li>
            Jugadores: {players.length}
          </li>

          <li>
            Estado de sala:{' '}
            {room?.status ?? 'Cargando…'}
          </li>

          <li>
            Ronda actual:{' '}
            {room?.currentRound ?? 0}
          </li>
        </ul>
      </section>
    </div>
  )
}