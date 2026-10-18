package models

import "testing"

func TestInferAccountType(t *testing.T) {
	tests := []struct {
		name, desc string
		want       AccountType
	}{
		{"삼성 연금저축", "", AccountTypePension},
		{"미래에셋 IRP", "", AccountTypeIRP},
		{"IRP 연금", "", AccountTypeIRP},
		{"KB 퇴직연금 DC", "", AccountTypeDC},
		{"퇴직연금", "", AccountTypeDC},
		{"회사 DC형", "", AccountTypeDC},
		{"토스 ISA", "", AccountTypeISA},
		{"isa 계좌", "", AccountTypeISA},
		{"해외주식", "", AccountTypeGeneral},
		{"Discount 계좌", "", AccountTypeGeneral},
		{"메인", "연금저축 설명", AccountTypePension},
		{"", "", AccountTypeGeneral},
	}
	for _, tt := range tests {
		if got := InferAccountType(tt.name, tt.desc); got != tt.want {
			t.Errorf("InferAccountType(%q,%q)=%s want %s", tt.name, tt.desc, got, tt.want)
		}
	}
}

func TestAccountTypeHelpers(t *testing.T) {
	tests := []struct {
		t          AccountType
		valid, res bool
	}{
		{AccountTypeGeneral, true, false},
		{AccountTypeISA, true, false},
		{AccountTypePension, true, true},
		{AccountTypeIRP, true, true},
		{AccountTypeDC, true, true},
		{"", false, false},
		{"Foo", false, false},
	}
	for _, tt := range tests {
		if tt.t.IsValid() != tt.valid || tt.t.IsWithdrawalRestricted() != tt.res {
			t.Errorf("%q: valid=%v restricted=%v", tt.t, tt.t.IsValid(), tt.t.IsWithdrawalRestricted())
		}
	}
}
