import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 실호출 테스트가 있어 기본 타임아웃을 넉넉히 잡는다.
    testTimeout: 30_000,
    include: ["test/**/*.test.ts"],
  },
});
