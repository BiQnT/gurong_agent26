# 0007. dev 를 440 대신 같은 443 의 `dev.` 주소로 연다

- **날짜**: 2026-10-06
- **상태**: 확정
- **정한 사람**: 안동현
- **관련**: [0005](0005-merge-backend-into-haepung-app.md)의 dev 주소(440)를 대체한다, [infra/gcp/README.md](../../infra/gcp/README.md), [docs/design/backend.md 접근 제어](../design/backend.md#접근-제어)

## 맥락

0005 는 prod 를 443, dev 를 440 으로 열었다. 배포 뒤 확인하니 VM 안에서는 440 이 정상(Caddy 가 401 로 응답)인데 바깥에서는 응답이 없었다. GCP 방화벽은 VM 의 `http-server`·`https-server` 태그 기본 규칙으로 80·443 만 연다. 방화벽은 VM 의 sudo 로 바꿀 수 없고 GCP 프로젝트 권한이 필요한데, 그 권한은 멘토 계정에 있다.

## 결정

dev 도 443 을 쓰고 주소 이름으로 나눈다. Caddy 가 이름을 보고 보낸다.

| | 주소 | 앱 |
| --- | --- | --- |
| prod | `https://<IP 를 -로>.sslip.io` | 127.0.0.1:3000 |
| dev | `https://dev.<IP 를 -로>.sslip.io` | 127.0.0.1:3001 |

80 은 두 이름 모두 https 로 넘긴다. `dev.<…>.sslip.io` 도 sslip.io 가 같은 IP 로 풀어 준다 (2026-10-06 `dig` 로 확인).

## 검토한 대안

- **440 을 그대로 두고 방화벽 규칙 추가**: 멘토에게 권한이나 작업을 부탁해야 하고, 폰에서 포트 번호를 붙여야 한다.

## 결과

- GCP 방화벽 변경이 필요 없다.
- dev 와 prod 의 로그인 쿠키가 나뉜다 (`Domain` 을 붙이지 않아 이름별로 따로). 0005 때는 같은 이름이라 로그인이 공유됐다. 계정은 같은 DB 라 같다.
- dev 화면이 prod API 를 부르는 요청은 같은 사이트여도 계속 거부한다 (출처 전체 일치와 `Sec-Fetch-Site`).
