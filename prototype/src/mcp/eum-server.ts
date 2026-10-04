// claude CLI 가 --mcp-config 로 띄우는 stdio MCP 서버. E-UM API 를 도구로 노출한다.
// stdout 은 MCP 프로토콜 전용이므로 로그는 stderr 로만 쓴다.
//
// 직접 확인: EUM_CATALOG_PATH=../data/eum-api-catalog.json node src/mcp/eum-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadCatalog, type CatalogApi } from '../eum/catalog.ts';
import { callEum } from '../eum/client.ts';
import { EUM_TOOL_APIS } from '../eum/allowlist.ts';

function describe(api: CatalogApi, note: string | undefined): string {
  const fields = api.responseFields
    .filter((field) => !field.label.startsWith('응답'))
    .map((field) => `${field.name}(${field.label})`)
    .join(', ');
  return [`[E-UM ${api.serviceTitle}] ${api.name}`, api.description, note, `응답 필드: ${fields}`]
    .filter(Boolean)
    .join('\n');
}

function inputShape(api: CatalogApi, names: string[]): Record<string, z.ZodString> {
  const shape: Record<string, z.ZodString> = {};
  for (const name of names) {
    const param = api.params.find((p) => p.name === name);
    if (!param) throw new Error(`${api.apiId} 카탈로그에 파라미터 ${name} 이 없다`);
    shape[name] = z.string().describe(`${param.label}. ${param.description}${param.sample ? ` 예: ${param.sample}` : ''}`);
  }
  return shape;
}

// claude 의 인증 정보는 이 서버에 필요 없다. 물려받은 환경에서 지운다.
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const catalogPath = process.env.EUM_CATALOG_PATH;
if (!catalogPath) {
  console.error('[eum-mcp] EUM_CATALOG_PATH 가 설정되지 않았다');
  process.exit(1);
}
const catalog = loadCatalog(catalogPath);
const server = new McpServer({ name: 'eum', version: '0.1.0' });

for (const [apiId, { params, note }] of Object.entries(EUM_TOOL_APIS)) {
  const api = catalog.get(apiId);
  if (!api) throw new Error(`카탈로그에 ${apiId} 가 없다`);
  if (api.method !== 'GET') throw new Error(`${apiId} 는 ${api.method} 라 지원하지 않는다`);

  server.registerTool(
    apiId,
    {
      title: api.name,
      description: describe(api, note),
      inputSchema: inputShape(api, params),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args: Record<string, string>) => {
      const serviceKey = process.env.EUM_SERVICE_KEY;
      if (!serviceKey) {
        return { content: [{ type: 'text', text: 'EUM_SERVICE_KEY 가 서버에 설정되지 않아 E-UM 을 호출하지 못했다.' }], isError: true };
      }
      const result = await callEum(api, args, { serviceKey });
      if (!result.ok) console.error(`[eum-mcp] ${apiId} 실패: ${result.error}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], isError: !result.ok };
    },
  );
}

await server.connect(new StdioServerTransport());
