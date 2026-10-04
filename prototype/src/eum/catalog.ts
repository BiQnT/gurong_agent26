import { readFileSync } from 'node:fs';

// data/eum-api-catalog.json 을 읽어 API ID로 찾을 수 있게 한다.
// 카탈로그는 research/api-tests/fetch_eum_catalog.py 의 생성물이라 손으로 고치지 않는다.

export type CatalogParam = {
  name: string;
  label: string;
  description: string;
  sample?: string;
};

export type CatalogApi = {
  apiId: string;
  serviceTitle: string;
  name: string;
  description: string;
  method: string;
  url: string;
  params: CatalogParam[];
  responseFields: { name: string; label: string }[];
};

type RawItem = {
  itemNameEn: string;
  itemNameKo: string;
  sampleData?: string;
  itemDescription?: string;
};

type RawApi = {
  apiId: string;
  serviceName: string;
  description: string;
  method: string;
  url: string;
  requestItems?: RawItem[];
  responseItems?: RawItem[];
};

type RawService = { serviceTitle: string; apis: RawApi[] };

export function loadCatalog(file: string): Map<string, CatalogApi> {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, RawService>;
  const apis = new Map<string, CatalogApi>();
  for (const service of Object.values(raw)) {
    for (const api of service.apis) {
      apis.set(api.apiId, {
        apiId: api.apiId,
        serviceTitle: service.serviceTitle,
        name: api.serviceName,
        description: api.description,
        method: api.method,
        url: api.url,
        // serviceKey 는 서버가 붙인다. 카탈로그의 sampleData 에 키 일부가 들어 있어 아예 빼둔다.
        params: (api.requestItems ?? [])
          .filter((item) => item.itemNameEn !== 'serviceKey')
          .map((item) => ({
            name: item.itemNameEn,
            label: item.itemNameKo,
            description: item.itemDescription ?? '',
            sample: item.sampleData || undefined,
          })),
        responseFields: (api.responseItems ?? []).map((item) => ({
          name: item.itemNameEn,
          label: item.itemNameKo,
        })),
      });
    }
  }
  return apis;
}
