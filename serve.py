#!/usr/bin/env python3
import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run():
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url = f"http://localhost:{PORT}"
        print(f"=====================================================")
        print(f"🌊 구룡포 과메기 AI 어시스턴트 로컬 웹 서버 시작됨!")
        print(f"👉 접속 주소: {url}")
        print(f"👉 브라우저를 띄우고 있습니다... (종료: Ctrl + C)")
        print(f"=====================================================")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("
서버를 종료합니다.")
            sys.exit(0)

if __name__ == "__main__":
    run()
