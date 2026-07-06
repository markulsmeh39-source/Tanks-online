import { io } from "socket.io-client";
const SERVER_URL = import.meta.env.VITE_SERVER_URL || (import.meta.env.PROD ? 'https://ais-pre-ppybn2vjeqm7czxdgqgnbm-537493505293.europe-west1.run.app' : undefined);
export const socket = io(SERVER_URL, { path: '/socket.io', autoConnect: false });
