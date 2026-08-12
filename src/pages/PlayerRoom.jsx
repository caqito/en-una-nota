import { Link, useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore'
import { useAnonymousAuth } from '../hooks/useAnonymousAuth'
import { db } from '../firebase/config'

export default function PlayerRoom() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const { user, loading } = useAnonymousAuth()

  const [room, setRoom] = useState(null)
  const [player, setPlayer] = useState(null)
  const [players, setPlayers] = useState([])
  const [roomError, setRoomError] = useState(null)
  const [buzzing, setBuzzing] = useState(false)

  const normalizedRoomId = roomId?.toUpperCase()

  useEffect(() => {
    if (!normalizedRoomId) return

    const roomRef = doc(db, 'rooms', normalizedRoomId)

    return onSnapshot(
      roomRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setRoom(null)
          setRoomError('La sala ya no existe.')
          return
        }

        setRoom(snapshot.data())
        setRoomError(null)
      },
      (error) => {
        console.error(error)
        setRoomError('Se perdió la conexión con la sala.')
      },
    )
  }, [normalizedRoomId])

  useEffect(() => {
    if (!normalizedRoomId || !user?.uid) return

    const playerRef = doc(
      db,
      'rooms',
      normalizedRoomId,
      'players',
      user.uid,
    )

    return onSnapshot(
      playerRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setPlayer(null)
          return
        }

        setPlayer({
          id: snapshot.id,
          ...snapshot.data(),
        })
      },
      (error) => {
        console.error(error)
      },
    )
  }, [normalizedRoomId, user?.uid])

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

        setPlayers(playerList)
      },
      (error) => {
        console.error(error)
      },
    )
  }, [normalizedRoomId])

  useEffect(() => {
    const nextRoomCode = room?.nextRoomCode

    if (!nextRoomCode) return

    navigate(`/sala/jugador/${nextRoomCode}`, {
      replace: true,
    })
  }, [room?.nextRoomCode, navigate])

  const alreadyBuzzed =
    user &&
    room?.buzzQueue?.includes(user.uid)

  const canPlayFromRound = player?.canPlayFromRound ?? 1

  const waitingForNextRound =
    room?.status === 'playing' &&
    (room?.currentRound ?? 0) < canPlayFromRound

  const canBuzz =
    room?.status === 'playing' &&
    room?.roundStatus !== 'finished' &&
    room?.buzzerEnabled === true &&
    user &&
    !waitingForNextRound &&
    !alreadyBuzzed &&
    !buzzing

  const playBuzzSound = () => {
    const sound = new Audio('/sounds/vine-boom-sound-effect_KT89XIq.mp3')
    sound.currentTime = 0
    sound.play().catch((error) => {
      console.error('No se pudo reproducir el sonido del pulsador.', error)
    })
  }

  const handleBuzz = async () => {
    if (!canBuzz || !normalizedRoomId || !user) return

    playBuzzSound()
    setBuzzing(true)

    try {
      const roomRef = doc(db, 'rooms', normalizedRoomId)
      const playerRef = doc(
        db,
        'rooms',
        normalizedRoomId,
        'players',
        user.uid,
      )

      await runTransaction(db, async (transaction) => {
        const roomSnapshot = await transaction.get(roomRef)
        const playerSnapshot = await transaction.get(playerRef)

        if (!roomSnapshot.exists()) {
          throw new Error('La sala ya no existe.')
        }

        if (!playerSnapshot.exists()) {
          throw new Error('No se encontró tu jugador.')
        }

        const roomData = roomSnapshot.data()
        const playerData = playerSnapshot.data()
        const playerCanPlayFromRound = playerData.canPlayFromRound ?? 1

        if (
          roomData.status !== 'playing' ||
          roomData.roundStatus === 'finished' ||
          roomData.buzzerEnabled !== true ||
          (roomData.currentRound ?? 0) < playerCanPlayFromRound
        ) {
          return
        }

        const currentQueue = roomData.buzzQueue ?? []

        if (currentQueue.includes(user.uid)) return

        transaction.update(roomRef, {
          buzzQueue: [...currentQueue, user.uid],
        })
      })
    } catch (error) {
      console.error(error)
      setRoomError('No se pudo registrar tu pulsación.')
    } finally {
      setBuzzing(false)
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
    (item) => (item.score ?? 0) === topScore,
  )

  const plannedRoundsFinished =
    room?.status === 'playing' &&
    room?.roundStatus === 'finished' &&
    (room?.currentRound ?? 0) >=
      (room?.settings?.totalRounds ?? 5)

  const finalWinner =
    plannedRoundsFinished &&
    leaders.length === 1
      ? leaders[0]
      : null

  const getPlayerName = (uid) =>
    players.find((item) => item.id === uid)?.name ?? 'Jugador'

  const buzzQueue = room?.buzzQueue ?? []
  const responderIndex = room?.currentResponderIndex ?? 0

  const currentResponderUid =
    room?.roundStatus !== 'finished'
      ? buzzQueue[responderIndex] ?? null
      : null

  const currentResponderName =
    currentResponderUid
      ? getPlayerName(currentResponderUid)
      : null

  const renderResponderStatus = () => {
    if (!currentResponderUid) return null

    const isMe = user?.uid === currentResponderUid

    return (
      <section className="rounded-3xl bg-yellow p-6 text-center text-black ring-1 ring-yellow">
        <p className="text-sm font-black tracking-[0.15em]">
          🎤 TURNO DE RESPONDER
        </p>

        <p className="mt-2 text-3xl font-black">
          {isMe
            ? 'ESTÁS RESPONDIENDO'
            : `${currentResponderName.toUpperCase()} ESTÁ RESPONDIENDO`}
        </p>
      </section>
    )
  }

  const renderBuzzOrder = () => {
    if (buzzQueue.length === 0) return null

    return (
      <section className="rounded-3xl bg-panel/90 p-5 ring-1 ring-white/10">
        <h2 className="font-bold">
          Orden de pulsación
        </h2>

        <ol className="mt-4 space-y-3">
          {buzzQueue.map((uid, index) => {
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
                {index + 1}º — {getPlayerName(uid)}

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
      </section>
    )
  }

  if (roomError) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-3xl font-black">
          Ups
        </h1>

        <p className="text-red-400">
          {roomError}
        </p>

        <Link
          to="/unirse"
          className="inline-block rounded-2xl bg-panel px-5 py-3 font-bold ring-1 ring-white/10"
        >
          Volver
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-80">
      <header>
        <Link
          to="/unirse"
          className="text-sm text-muted hover:text-white"
        >
          ← Volver
        </Link>

        <h1 className="mt-4 text-3xl font-black">
          Sala del jugador
        </h1>
      </header>

      <section className="rounded-3xl bg-panel/90 p-5 text-center ring-1 ring-white/10">
        <p className="text-sm text-muted">
          Código de sala
        </p>

        <p className="mt-2 text-3xl font-black tracking-[0.2em] text-yellow">
          {normalizedRoomId ?? '----'}
        </p>

        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="text-sm text-muted">
            Jugador
          </p>

          <p className="mt-1 text-2xl font-black">
            {player?.name ?? 'Cargando…'}
          </p>
        </div>
      </section>

      {!room && (
        <section className="rounded-3xl bg-panel/90 p-6 text-center ring-1 ring-white/10">
          <p className="font-bold">
            Conectando con la sala…
          </p>
        </section>
      )}

      {room?.status === 'lobby' && (
        <section className="rounded-3xl bg-panel/90 p-8 text-center ring-1 ring-white/10">
          <p className="text-3xl font-black">
            Nueva partida
          </p>

          <p className="mt-3 text-muted">
            Ya estás en la nueva sala. Esperando al anfitrión.
          </p>
        </section>
      )}

      {room?.status === 'playing' &&
        room?.roundStatus !== 'finished' && (
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

            {renderResponderStatus()}

            {renderBuzzOrder()}

            {waitingForNextRound ? (
              <section className="rounded-3xl bg-panel/90 p-8 text-center ring-1 ring-white/10">
                <p className="text-3xl font-black">
                  Partida en curso
                </p>

                <p className="mt-3 text-muted">
                  Te uniste durante esta ronda. Podrás jugar a partir de la próxima.
                </p>
              </section>
            ) : (
              <>
                <div className="fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-3 px-4">
                  <button
                    type="button"
                    onClick={handleBuzz}
                    disabled={!canBuzz}
                    className={`grid aspect-square w-64 place-items-center rounded-full border-[12px] text-center text-4xl font-black transition ${
                      canBuzz
                        ? 'cursor-pointer border-red-900 bg-gradient-to-br from-red-400 via-red-600 to-red-900 shadow-[0_18px_0_#79070c,0_30px_55px_rgba(239,27,36,0.42)] active:scale-95'
                        : 'cursor-not-allowed border-red-950 bg-red-950 opacity-50'
                    }`}
                  >
                    {buzzing
                      ? '...'
                      : alreadyBuzzed
                        ? '¡PULSASTE!'
                        : '¡LA SÉ!'}
                  </button>

                  <p className="rounded-full bg-bg/90 px-4 py-2 text-center text-sm text-muted ring-1 ring-white/10 backdrop-blur">
                    {!room.buzzerEnabled
                      ? 'Esperá a que comience la canción.'
                      : alreadyBuzzed
                        ? 'Tu pulsación quedó registrada.'
                        : '¡Ya podés pulsar!'}
                  </p>
                </div>
              </>
            )}
          </>
        )}

      {room?.status === 'playing' &&
        room?.roundStatus === 'finished' &&
        !plannedRoundsFinished && (
          <>
            {renderBuzzOrder()}

            <section className="rounded-3xl bg-panel/90 p-7 text-center ring-1 ring-white/10">
            <p className="text-sm text-muted">
              Ronda finalizada
            </p>

            {room.roundResult === 'correct' ? (
              <p className="mt-3 text-3xl font-black text-ok">
                ✅ {getPlayerName(room.winnerUid)} acertó
              </p>
            ) : room.roundResult === 'all_wrong' ? (
              <p className="mt-3 text-3xl font-black">
                ❌ Todos fallaron
              </p>
            ) : room.roundResult === 'host_finished' ? (
              <p className="mt-3 text-3xl font-black">
                ⏹ Finalizada por el anfitrión
              </p>
            ) : null}

            <p className="mt-5 text-sm text-muted">
              La canción era
            </p>

            <p className="mt-2 break-words text-2xl font-black text-yellow">
              {room.currentSong}
            </p>

            <p className="mt-6 text-muted">
              Esperando que el anfitrión inicie la siguiente ronda…
            </p>
            </section>
          </>
        )}

      {plannedRoundsFinished && (
        <>
          {renderBuzzOrder()}

          <section className="rounded-3xl bg-panel/90 p-7 text-center ring-1 ring-white/10">
          <p className="text-sm font-black tracking-[0.2em] text-yellow">
            🏆 PARTIDA FINALIZADA
          </p>

          <p className="mt-5 text-sm text-muted">
            La última canción era
          </p>

          <p className="mt-2 break-words text-2xl font-black text-yellow">
            {room.currentSong}
          </p>

          {finalWinner ? (
            <div className="mt-7">
              <p className="text-sm font-bold text-muted">
                GANADOR
              </p>

              <p className="mt-2 text-5xl font-black text-yellow">
                {finalWinner.name}
              </p>

              <p className="mt-2 text-lg text-muted">
                {finalWinner.score ?? 0} puntos
              </p>
            </div>
          ) : (
            <div className="mt-7">
              <p className="text-4xl font-black">
                🤝 EMPATE
              </p>

              <p className="mt-3 text-muted">
                Hay más de un jugador en el primer puesto.
              </p>
            </div>
          )}

          <div className="mt-7">
            <p className="text-sm font-bold text-muted">
              Clasificación final
            </p>

            <ol className="mt-3 space-y-2">
              {sortedPlayers.map((item, index) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between rounded-2xl bg-bg/60 px-4 py-3"
                >
                  <span className="font-bold">
                    {index + 1}º — {item.name}
                  </span>

                  <span className="font-black text-yellow">
                    {item.score ?? 0} pts
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-6 text-sm text-muted">
            Esperando la decisión del anfitrión…
          </p>
          </section>
        </>
      )}

      <p className="text-center text-xs text-muted">
        {loading
          ? 'Conectando…'
          : user
            ? 'Conectado a la partida'
            : 'Sin conexión'}
      </p>
    </div>
  )
}
