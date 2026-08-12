# En una nota

Juego musical con salas y botoneras desde el celular.

## Stack

- React + Vite
- Firebase (Authentication anónimo + Firestore)
- Tailwind CSS
- React Router
- Deploy en Vercel

## Desarrollo local

1. Copiá `.env.example` a `.env` y completá las credenciales de Firebase.
2. Instalá dependencias:

```bash
npm install
```

3. Iniciá el servidor de desarrollo:

```bash
npm run dev
```

## Deploy en Vercel

1. Importá el repositorio en Vercel.
2. Agregá las variables de entorno `VITE_FIREBASE_*` desde tu proyecto de Firebase.
3. Deploy automático con `npm run build`.

## Páginas

- `/` — Home
- `/crear` — Crear sala
- `/unirse` — Unirse a sala
- `/sala/anfitrion/:roomId` — Sala del anfitrión
- `/sala/jugador/:roomId` — Sala del jugador
