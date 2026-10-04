import { NextResponse, type NextRequest } from 'next/server';

// 공개 주소 앞의 공용 암호. BASIC_AUTH="아이디:비밀번호" 가 있으면 모든 요청에 HTTP Basic 인증을 요구한다.
// 브라우저가 처음 한 번 묻고 이후 같은 주소의 fetch 에는 자동으로 붙인다. 비어 있으면 열어 둔다 (로컬 개발).
// /api/health 는 배포 스크립트가 쓰므로 뺀다.
export function proxy(request: NextRequest) {
  const expected = process.env.BASIC_AUTH;
  if (!expected || request.nextUrl.pathname === '/api/health') return NextResponse.next();
  // btoa 는 한글 등 Latin-1 밖 문자에서 예외가 나므로 UTF-8 로 인코딩한다 (WWW-Authenticate 의 charset 과 같다).
  if (request.headers.get('authorization') === `Basic ${Buffer.from(expected).toString('base64')}`) return NextResponse.next();
  return new NextResponse('인증이 필요하다', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="gwamegi", charset="UTF-8"' },
  });
}

export const config = {
  // _next/webpack-hmr 은 dev 화면 자동 갱신 연결이다. 폰 브라우저가 여기에 암호를 붙이지 않는 경우가 있어 뺀다.
  matcher: ['/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico).*)'],
};
