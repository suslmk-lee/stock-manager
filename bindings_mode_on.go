//go:build bindings

package main

// Wails 가 바인딩(wailsjs)을 만들 때는 앱을 'bindings' 태그로 빌드해 잠깐 실행한다.
// 이때는 DB 연결·마이그레이션·내장 API 서버를 건너뛴다.
const bindingsMode = true
