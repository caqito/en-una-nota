import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Crown, Music, Smartphone } from 'lucide-react'

const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1], delay },
  },
})

const cards = [
  {
    to: '/crear',
    title: 'Crear sala',
    description: 'Sos el anfitrión. Controlás la música, los puntajes y la partida.',
    accent: 'from-pink via-fuchsia-600 to-purple-700',
    glow: 'shadow-pink/30',
    glowHover: 'group-hover:shadow-pink/50',
    ring: 'ring-pink/20 group-hover:ring-pink/40',
    Icon: Crown,
    delay: 0.3,
  },
  {
    to: '/unirse',
    title: 'Unirse a una sala',
    description: 'Ingresá el código de la sala y competí con tu botonera.',
    accent: 'from-cyan/90 via-sky-500 to-blue-600',
    glow: 'shadow-cyan/20',
    glowHover: 'group-hover:shadow-cyan/40',
    ring: 'ring-cyan/15 group-hover:ring-cyan/35',
    Icon: Smartphone,
    delay: 0.6,
  },
]

const backgroundNotes = [
  { Icon: Music, top: '8%', left: '6%', size: 28, rotate: -12, delay: 0 },
  { Icon: Music, top: '18%', right: '8%', size: 36, rotate: 18, delay: 1.2 },
  { Icon: Music, top: '62%', left: '4%', size: 22, rotate: 8, delay: 0.6 },
  { Icon: Music, top: '72%', right: '5%', size: 32, rotate: -20, delay: 1.8 },
  { Icon: Music, top: '42%', left: '12%', size: 20, rotate: 14, delay: 2.4 },
  { Icon: Music, top: '85%', left: '18%', size: 26, rotate: -8, delay: 0.9 },
  { Icon: Music, top: '30%', right: '14%', size: 24, rotate: 22, delay: 1.5 },
]

export default function Home() {
  return (
    <div className="relative min-h-[calc(100dvh-3rem)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
        <div className="absolute -left-16 top-20 h-48 w-48 rounded-full bg-pink/20 blur-3xl" />
        <div className="absolute -right-12 top-1/3 h-56 w-56 rounded-full bg-purple-600/25 blur-3xl" />
        <div className="absolute bottom-16 left-1/4 h-40 w-40 rounded-full bg-cyan/15 blur-3xl" />

        {backgroundNotes.map((note, index) => (
          <motion.div
            key={index}
            className="absolute text-white/[0.05] blur-[0.5px]"
            style={{
              top: note.top,
              left: note.left,
              right: note.right,
              rotate: note.rotate,
            }}
            animate={{ y: [0, -8, 0], opacity: [0.04, 0.07, 0.04] }}
            transition={{
              duration: 5 + index * 0.4,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: note.delay,
            }}
          >
            <note.Icon size={note.size} strokeWidth={1.5} />
          </motion.div>
        ))}
      </div>

      <div className="relative flex min-h-[calc(100dvh-3rem)] flex-col justify-center gap-8 py-4 sm:gap-10">
        <motion.header
          initial="hidden"
          animate="visible"
          variants={fadeUp(0)}
          className="text-center"
        >
          <div className="mx-auto flex items-center justify-center gap-2 sm:gap-3">
            <motion.div
              animate={{ y: [0, -4, 0], rotate: [-3, 3, -3] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            >
              <Music
                className="h-7 w-7 shrink-0 text-yellow drop-shadow-[0_0_12px_rgba(255,216,74,0.4)] sm:h-8 sm:w-8"
                strokeWidth={2.25}
              />
            </motion.div>
            <h1 className="text-[clamp(2.5rem,11vw,4.25rem)] font-black leading-none tracking-tight">
              En una <span className="text-yellow">nota</span>
            </h1>
          </div>
          <p className="mt-4 text-[clamp(1.05rem,4.5vw,1.35rem)] font-semibold text-white/90">
            ¿Quién la saca primero?
          </p>
        </motion.header>

        <div className="flex flex-col gap-5 sm:gap-6">
          {cards.map((card) => (
            <motion.div
              key={card.to}
              initial="hidden"
              animate="visible"
              variants={fadeUp(card.delay)}
              whileHover={{
                y: -6,
                transition: { type: 'spring', stiffness: 380, damping: 26 },
              }}
              whileTap={{ scale: 0.98 }}
            >
              <Link
                to={card.to}
                className={`group block overflow-hidden rounded-3xl bg-panel/90 p-[1px] shadow-xl ${card.glow} ${card.glowHover} ring-1 ${card.ring} transition-[box-shadow,filter] duration-300 group-hover:brightness-110`}
              >
                <div className="relative rounded-[calc(1.5rem-1px)] bg-panel/95 px-5 py-7 sm:px-6 sm:py-8">
                  <div
                    className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${card.accent} opacity-20 blur-2xl transition-opacity duration-300 group-hover:opacity-45`}
                  />
                  <div className="relative">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-xl font-extrabold sm:text-2xl">{card.title}</h2>
                      <span
                        className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${card.accent} text-white shadow-lg transition-transform duration-300 group-hover:rotate-6`}
                      >
                        <card.Icon size={20} strokeWidth={2.25} />
                      </span>
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
                      {card.description}
                    </p>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}
