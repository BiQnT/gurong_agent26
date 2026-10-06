import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { localApiPlugin, readBridgeConfig } from './server/vite-api.ts';

export default defineConfig(({ mode }) => {
  // Loaded only by the Node config process. VITE_ remains the browser env prefix.
  const root = process.cwd();
  const env = loadEnv(mode, root, '');
  const serverConfig = readBridgeConfig(env, root);
  return {
    plugins: [react(), localApiPlugin(serverConfig)],
    server: {
      port: 3000,
      host: '127.0.0.1',
      // VM 의 dev 는 Caddy(https://dev.<도메인>) 뒤에 있다. 그 이름을 허용하고, 화면 자동 갱신 연결도 Caddy 의 443 으로 받는다.
      ...(env.DEV_ALLOWED_HOSTS
        ? { allowedHosts: env.DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()) }
        : {}),
      ...(env.DEV_HMR_CLIENT_PORT ? { hmr: { clientPort: Number(env.DEV_HMR_CLIENT_PORT) } } : {}),
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
