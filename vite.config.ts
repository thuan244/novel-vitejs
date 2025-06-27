import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { Buffer } from 'buffer';


global.Buffer = Buffer;
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
