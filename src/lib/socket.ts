import { io } from "socket.io-client";

// For GitHub Pages, you must host your backend (server.ts) on a service like Render, Heroku, or Cloud Run.
// Then set VITE_BACKEND_URL to your backend URL (e.g. in your GitHub Action or .env).
const serverUrl = import.meta.env.VITE_BACKEND_URL || undefined;

export const socket = io(serverUrl, { path: '/socket.io', autoConnect: false });
