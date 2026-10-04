import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 네이티브 모듈은 번들하지 않고 node_modules 에서 그대로 읽는다.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
