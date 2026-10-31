import { useState, useEffect } from 'react';
import { apiClient } from './api/client';
import { Account, AccountType } from './types/models';
import { Plus, Trash2, Wallet, Pencil, Lock } from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
import IconTile from './components/ui/IconTile';
import { ACCOUNT_TYPES, getAccountType, getAccountTypeMeta, isRestrictedAccount } from './utils/accountType';

const DOMESTIC_BROKERS = [
  '삼성증권',
  '미래에셋증권',
  '한국투자증권',
  'NH투자증권',
  '키움증권',
  'KB증권',
  '신한투자증권',
  '하나증권',
  '메리츠증권',
  '대신증권',
  '토스증권',
  '카카오증권',
  '유안타증권',
  '현대차증권',
  '교보증권',
  '유진투자증권',
  'IBK투자증권',
  '부국증권',
  '케이프투자증권',
  '하이투자증권',
  '기타',
];

const BROKER_LOGOS: Record<string, string> = {
  '메리츠증권': '/meritz.png',
  '토스증권': '/toss.png',
  '카카오증권': '/kakao.png',
  '한국투자증권': '/korea.png',
  '삼성증권': '/samsung.png',
  '신한투자증권': '/shinhan.png',
  '대신증권': '/daishin.png',
  'NH투자증권': '/NH.png',
  '미래에셋증권': '/miraeasset.png',
  'KB증권': '/kb.png',
};

const EMPTY_FORM = {
  name: '',
  broker: '',
  accountNumber: '',
  marketType: 'Domestic' as 'Domestic' | 'International',
  currency: 'KRW',
  description: '',
  accountType: 'General' as AccountType,
};

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedAccountDetail, setSelectedAccountDetail] = useState<Account | null>(null);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.GetAllAccounts();
      setAccounts(data as Account[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '계좌 목록을 불러오는데 실패했습니다.');
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
  };

  const handleToggleCreateForm = () => {
    if (showForm && editingId === null) {
      closeForm();
      return;
    }
    setEditingId(null);
    setFormData({ ...EMPTY_FORM });
    setShowForm(true);
  };

  const handleEditAccount = (account: Account) => {
    setEditingId(account.id);
    setFormData({
      name: account.name,
      broker: account.broker || '',
      accountNumber: account.account_number || '',
      marketType: account.market_type as 'Domestic' | 'International',
      currency: account.currency,
      description: account.description || '',
      accountType: getAccountType(account),
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmitAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId !== null) {
        await apiClient.UpdateAccount(
          editingId,
          formData.name,
          formData.broker,
          formData.accountNumber,
          formData.marketType,
          formData.currency,
          formData.description,
          formData.accountType
        );
      } else {
        await apiClient.CreateAccount(
          formData.name,
          formData.broker,
          formData.accountNumber,
          formData.marketType,
          formData.currency,
          formData.description,
          formData.accountType
        );
      }
      closeForm();
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : editingId !== null ? '계좌 수정에 실패했습니다.' : '계좌 생성에 실패했습니다.');
      console.error('Failed to save account:', err);
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('정말로 이 계좌를 삭제하시겠습니까?')) return;

    try {
      await apiClient.DeleteAccount(id);
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '계좌 삭제에 실패했습니다.');
      console.error('Failed to delete account:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="label-mono text-sm">로딩 중...</div>
      </div>
    );
  }

  // 계좌 상세 드릴다운
  if (selectedAccountDetail) {
    return <AccountDashboard account={selectedAccountDetail} onBack={() => setSelectedAccountDetail(null)} />;
  }

  const liquidAccounts = accounts.filter((a) => !isRestrictedAccount(a));
  const restrictedAccounts = accounts.filter((a) => isRestrictedAccount(a));
  const selectedTypeMeta = ACCOUNT_TYPES.find((t) => t.value === formData.accountType);

  const renderAccountCard = (account: Account) => {
    const typeMeta = getAccountTypeMeta(account);
    const restricted = typeMeta.restricted;
    const logo = BROKER_LOGOS[account.broker];
    return (
      <div
        key={account.id}
        onClick={() => setSelectedAccountDetail(account)}
        className={`surface surface-interactive flex h-full flex-col p-5 ${
          restricted ? 'border-l-2 !border-l-amber-300/60' : ''
        }`}
      >
        {/* 윗줄: 증권사 로고 · 수정/삭제 */}
        <div className="flex items-start justify-between gap-3">
          <div
            className={`flex h-11 w-36 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 ${
              logo ? 'bg-paper' : 'surface-inset text-zinc-400'
            }`}
          >
            {logo ? (
              <img src={logo} alt={account.broker} className="h-full w-full object-contain px-2 py-1.5" />
            ) : (
              <Wallet className="h-5 w-5" />
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={(e) => { e.stopPropagation(); handleEditAccount(account); }}
              className="btn-icon"
              title="계좌 수정"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteAccount(account.id); }}
              className="btn-icon hover:!border-rose-400/40 hover:!text-rose-300"
              title="계좌 삭제"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 계좌 이름 · 증권사 · 속성 */}
        <div className="mb-4 mt-4 min-w-0">
          <h3 className="truncate text-lg font-medium tracking-tight text-white" title={account.name}>
            {account.name}
          </h3>
          {account.broker && <p className="label-mono mt-1 truncate">{account.broker}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="chip">{account.market_type === 'Domestic' ? '국내' : '해외'}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${typeMeta.badgeClass}`}>
              {restricted && <Lock className="h-3 w-3" />}
              {typeMeta.short}
            </span>
            <span className="chip">{account.currency}</span>
          </div>
          {account.description && <p className="mt-3 line-clamp-2 text-sm text-zinc-400">{account.description}</p>}
        </div>

        {/* 아래줄: 생성일 (카드 높이가 달라도 바닥에 맞춘다) */}
        <div className="label-mono mt-auto border-t border-white/[0.06] pt-3">
          생성일 {new Date(account.created_at).toLocaleDateString('ko-KR')}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 min-w-0">
          <IconTile icon={Wallet} tone="mint" />
          <div className="min-w-0">
            <h2 className="text-2xl font-light tracking-tight text-white">계좌 관리</h2>
            <p className="label-mono">{accounts.length} accounts</p>
          </div>
        </div>
        <button
          onClick={handleToggleCreateForm}
          className="btn-primary shrink-0"
        >
          <Plus className="w-5 h-5" />
          계좌 추가
        </button>
      </div>

        {error && (
          <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 text-rose-200 text-sm px-4 py-3 mb-6">
            {error}
          </div>
        )}

        {showForm && (
          <div className="surface p-5 sm:p-6 mb-6">
            <h2 className="section-title text-lg mb-4">{editingId !== null ? '계좌 수정' : '새 계좌 추가'}</h2>
            <form onSubmit={handleSubmitAccount} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">증권사 *</label>
                  <select
                    value={formData.broker}
                    onChange={(e) => setFormData({ ...formData, broker: e.target.value })}
                    className="input-field"
                    required
                  >
                    <option value="">증권사를 선택하세요</option>
                    {DOMESTIC_BROKERS.map((broker) => (
                      <option key={broker} value={broker}>
                        {broker}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">시장 구분 *</label>
                  <select
                    value={formData.marketType}
                    onChange={(e) => {
                      const market = e.target.value as 'Domestic' | 'International';
                      setFormData({
                        ...formData,
                        marketType: market,
                        currency: market === 'Domestic' ? 'KRW' : 'USD'
                      });
                    }}
                    className="input-field"
                  >
                    <option value="Domestic">국내</option>
                    <option value="International">해외</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">계좌 유형 *</label>
                <select
                  value={formData.accountType}
                  onChange={(e) => setFormData({ ...formData, accountType: e.target.value as AccountType })}
                  className="input-field"
                  required
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {selectedTypeMeta?.restricted && (
                  <p className="flex items-center gap-1 text-xs text-amber-300 mt-1.5">
                    <Lock className="w-3 h-3" />
                    중도 인출이 제한되는 계좌로 분류됩니다
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="field-label">계좌명 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="input-field"
                    placeholder="예: 미국 주식 계좌"
                    required
                  />
                </div>
                <div>
                  <label className="field-label">계좌번호</label>
                  <input
                    type="text"
                    value={formData.accountNumber}
                    onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                    className="input-field"
                    placeholder="예: 123-45-678901"
                  />
                </div>
              </div>
              <div>
                <label className="field-label">통화</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="input-field"
                >
                  <option value="KRW">KRW (원)</option>
                  <option value="USD">USD (달러)</option>
                  <option value="EUR">EUR (유로)</option>
                  <option value="JPY">JPY (엔)</option>
                </select>
              </div>
              <div>
                <label className="field-label">설명</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field"
                  placeholder="계좌에 대한 설명을 입력하세요"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="btn-primary flex-1"
                >
                  {editingId !== null ? '저장' : '생성'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="btn-ghost flex-1"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="surface text-center py-14 px-4 text-zinc-400">
            <IconTile icon={Wallet} tone="mint" className="mx-auto mb-4" />
            <p className="text-base sm:text-lg text-zinc-200">등록된 계좌가 없습니다.</p>
            <p className="label-mono mt-2">위의 "계좌 추가" 버튼을 눌러 새 계좌를 생성하세요.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {liquidAccounts.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <IconTile icon={Wallet} tone="mint" size="sm" />
                  <h3 className="section-title">인출 가능 계좌</h3>
                  <span className="chip">
                    {liquidAccounts.length}개
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {liquidAccounts.map(renderAccountCard)}
                </div>
              </section>
            )}
            {restrictedAccounts.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-4">
                  <IconTile icon={Lock} tone="amber" size="sm" />
                  <h3 className="section-title">인출 제한 계좌 · 연금/IRP</h3>
                  <span className="chip !text-amber-300">
                    {restrictedAccounts.length}개
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                  {restrictedAccounts.map(renderAccountCard)}
                </div>
              </section>
            )}
          </div>
        )}
    </div>
  );
}

export default App;
