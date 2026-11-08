package services

import "testing"

func TestContainsHangul(t *testing.T) {
	cases := map[string]bool{"삼성전자": true, "KODEX 200": false, "005930": false, "AAPL": false, "TIGER 미국배당": true}
	for in, want := range cases {
		if got := containsHangul(in); got != want {
			t.Errorf("containsHangul(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestParseNaverAutocomplete(t *testing.T) {
	body := `{"query":"x","items":[
	 {"code":"005930","name":"삼성전자","typeCode":"KOSPI","nationCode":"KOR"},
	 {"code":"086520","name":"에코프로","typeCode":"KOSDAQ","nationCode":"KOR"},
	 {"code":"123456","name":"코넥스종목","typeCode":"KONEX","nationCode":"KOR"},
	 {"code":"BRK B","name":"버크셔 해서웨이 Class B","typeCode":"NYSE","nationCode":"USA"},
	 {"code":"O","name":"리얼티 인컴","typeCode":"NYSE","nationCode":"USA"},
	 {"code":"2788","name":"애플인터내셔널","typeCode":"TOKYO","nationCode":"JPN"},
	 {"code":"","name":"빈 코드","typeCode":"KOSPI","nationCode":"KOR"}
	]}`
	got, err := parseNaverAutocomplete([]byte(body), 10)
	if err != nil {
		t.Fatal(err)
	}
	want := []struct{ symbol, name, currency string }{
		{"005930.KS", "삼성전자", "KRW"},
		{"086520.KQ", "에코프로", "KRW"},
		{"BRK-B", "버크셔 해서웨이 Class B", "USD"},
		{"O", "리얼티 인컴", "USD"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d items, want %d: %+v", len(got), len(want), got)
	}
	for i, w := range want {
		if got[i].Symbol != w.symbol || got[i].Name != w.name || got[i].Currency != w.currency {
			t.Errorf("item %d = %+v, want %+v", i, got[i], w)
		}
	}

	limited, _ := parseNaverAutocomplete([]byte(body), 2)
	if len(limited) != 2 {
		t.Fatalf("limit not applied: %d", len(limited))
	}
}
