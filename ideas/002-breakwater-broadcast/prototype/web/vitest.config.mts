import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // lib/env.ts 가 클라이언트 유입을 막으려고 import 하는데, 그대로 두면
      // vitest 에서도 던진다. 테스트에서만 빈 모듈로 바꾼다.
      "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // 실호출 테스트가 있어 기본 타임아웃을 넉넉히 잡는다.
    testTimeout: 30_000,
    include: ["test/**/*.test.ts"],
  },
});
