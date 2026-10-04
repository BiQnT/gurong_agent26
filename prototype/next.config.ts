import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 네이티브 모듈은 번들하지 않고 node_modules 에서 그대로 읽는다.
  serverExternalPackages: ['better-sqlite3'],
  // next dev 는 localhost 가 아닌 주소(예: 폰에서 서버 IP 로 접속)에서 오는 개발용 요청을 막는다.
  // VM 의 dev 서비스가 DEV_ALLOWED_ORIGINS 로 서버 주소를 넘긴다 (쉼표로 여러 개).
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export default nextConfig;
