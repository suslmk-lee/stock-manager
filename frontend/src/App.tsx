import { useState, useEffect } from 'react';
import { apiClient } from './api/client';
import { Account, AccountType } from './types/models';
import { Plus, Trash2, Wallet, Pencil, Lock } from 'lucide-react';
import AccountDashboard from './components/AccountDashboard';
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">로딩 중...</div>
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
        className={`bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 sm:p-6 border hover:border-blue-500 transition-colors cursor-pointer ${
          restricted ? 'border-slate-700 border-l-4 border-l-amber-500/70' : 'border-slate-700'
        }`}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full">
            <div className={`w-28 h-10 sm:w-36 sm:h-12 rounded-lg flex items-center justify-center overflow-hidden shrink-0 ${
              logo ? 'bg-white' : 'bg-gradient-to-br from-blue-500 to-purple-500'
            }`}>
              {logo ? (
                <img
                  src={logo}
                  alt={account.broker}
                  className="w-full h-full object-contain p-1"
                />
              ) : (
                <Wallet className="w-6 h-6" />
              )}
            </div>
            <div>
              <h3 className="text-xl font-semibold">{account.name}</h3>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
                  {account.market_type === 'Domestic' ? '국내' : '해외'}
                </span>
                <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${typeMeta.badgeClass}`}>
                  {restricted && <Lock className="w-3 h-3" />}
                  {typeMeta.short}
                </span>
                <p className="text-sm text-slate-400">{account.currency}</p>
              </div>
              {account.broker && (
                <p className="text-xs text-slate-500 mt-1">{account.broker}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <button
              onClick={(e) => { e.stopPropagation(); handleEditAccount(account); }}
              className="text-slate-400 hover:text-blue-300 transition-colors"
              title="계좌 수정"
            >
              <Pencil className="w-5 h-5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDeleteAccount(account.id); }}
              className="text-red-400 hover:text-red-300 transition-colors"
              title="계좌 삭제"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
        {account.description && (
          <p className="text-slate-300 text-sm mb-4">{account.description}</p>
        )}
        <div className="text-xs text-slate-500">
          생성일: {new Date(account.created_at).toLocaleDateString('ko-KR')}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">계좌 관리</h2>
        <button
          onClick={handleToggleCreateForm}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
        >
          <Plus className="w-5 h-5" />
          계좌 추가
        </button>
      </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {showForm && (
          <div className="bg-slate-800 rounded-xl p-6 mb-6 border border-slate-700">
            <h2 className="text-2xl font-semibold mb-4">{editingId !== null ? '계좌 수정' : '새 계좌 추가'}</h2>
            <form onSubmit={handleSubmitAccount} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">증권사 *</label>
                  <select
                    value={formData.broker}
                    onChange={(e) => setFormData({ ...formData, broker: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                  <label className="block text-sm font-medium mb-2">시장 구분 *</label>
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
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Domestic">국내</option>
                    <option value="International">해외</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">계좌 유형 *</label>
                <select
                  value={formData.accountType}
                  onChange={(e) => setFormData({ ...formData, accountType: e.target.value as AccountType })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {selectedTypeMeta?.restricted && (
                  <p className="flex items-center gap-1 text-xs text-amber-300 mt-1">
                    <Lock className="w-3 h-3" />
                    중도 인출이 제한되는 계좌로 분류됩니다
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-2">계좌명 *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 미국 주식 계좌"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">계좌번호</label>
                  <input
                    type="text"
                    value={formData.accountNumber}
                    onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                    className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 123-45-678901"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">통화</label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="KRW">KRW (원)</option>
                  <option value="USD">USD (달러)</option>
                  <option value="EUR">EUR (유로)</option>
                  <option value="JPY">JPY (엔)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">설명</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="계좌에 대한 설명을 입력하세요"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg transition-colors"
                >
                  {editingId !== null ? '저장' : '생성'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        )}

        {accounts.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Wallet className="w-12 h-12 sm:w-16 sm:h-16 mx-auto mb-4 opacity-50" />
            <p className="text-base sm:text-lg">등록된 계좌가 없습니다.</p>
            <p className="text-xs sm:text-sm mt-2">위의 "계좌 추가" 버튼을 눌러 새 계좌를 생성하세요.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {liquidAccounts.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-emerald-500/30">
                  <Wallet className="w-5 h-5 text-emerald-400" />
                  <h3 className="text-lg font-semibold text-emerald-300">인출 가능 계좌</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
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
                <div className="flex items-center gap-2 mb-3 pb-2 border-b border-amber-500/30">
                  <Lock className="w-5 h-5 text-amber-400" />
                  <h3 className="text-lg font-semibold text-amber-300">인출 제한 계좌 · 연금/IRP</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
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
