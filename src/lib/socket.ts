import { io } from "socket.io-client";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || undefined;
export const socket = io(SERVER_URL, { path: '/socket.io', autoConnect: false });
