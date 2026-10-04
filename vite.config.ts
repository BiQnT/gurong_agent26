import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localApiPlugin, readBridgeConfig } from './server/vite-api.ts';

export default defineConfig(({ mode }) => {
  // Loaded only by the Node config process. VITE_ remains the browser env prefix.
  const root = process.cwd();
  const serverConfig = readBridgeConfig(loadEnv(mode, root, ''), root);
  return {
    plugins: [react(), localApiPlugin(serverConfig)],
    server: {
      port: 3000,
      host: '127.0.0.1',
      fs: {
        // Preserve Vite's default secret-file protections and deny the local account database.
        deny: [
          '.env',
          '.env.*',
          '*.{crt,pem,key,p12,pfx,cer,der}',
          '.npmrc',
          '.yarnrc.yml',
          '**/.git/**',
          '**/.local-data/**',
        ],
      },
    },
    preview: { host: '127.0.0.1', allowedHosts: ['.loca.lt', '.ngrok-free.dev', '.ngrok.io'] },
  };
});
