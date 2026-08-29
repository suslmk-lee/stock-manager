package httpapi

import "github.com/gin-gonic/gin"

// RegisterRoutes 는 /api 그룹에 모든 엔드포인트를 등록한다.
//
// 인증, CORS, /health 처럼 실행 환경마다 달라지는 설정은 여기에 두지 않고
// 호출부(server.go / cmd/server/main.go)가 그룹에 미들웨어로 붙인다.
func RegisterRoutes(api *gin.RouterGroup, s *Services) {
	registerAccountRoutes(api, s)
	registerAssetRoutes(api, s)
	registerHoldingRoutes(api, s)
	registerTransactionRoutes(api, s)
	registerDividendRoutes(api, s)
	registerUtilityRoutes(api, s)
}
