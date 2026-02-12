import { useState, useEffect } from 'react';
import { GetAllAccounts, CreateAccount, DeleteAccount } from '../wailsjs/go/main/App';
import { Account } from './types/models';
import { Plus, Trash2, Wallet } from 'lucide-react';

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

function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    broker: '',
    accountNumber: '',
    marketType: 'Domestic' as 'Domestic' | 'International',
    currency: 'KRW',
    description: '',
  });

  useEffect(() => {
    loadAccounts();
  }, []);

  const loadAccounts = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await GetAllAccounts();
      setAccounts(data as Account[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '계좌 목록을 불러오는데 실패했습니다.');
      console.error('Failed to load accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await CreateAccount(
        formData.name,
        formData.broker,
        formData.accountNumber,
        formData.marketType,
        formData.currency,
        formData.description
      );
      setFormData({ 
        name: '', 
        broker: '', 
        accountNumber: '', 
        marketType: 'Domestic', 
        currency: 'KRW', 
        description: '' 
      });
      setShowForm(false);
      await loadAccounts();
    } catch (err) {
      setError(err instanceof Error ? err.message : '계좌 생성에 실패했습니다.');
      console.error('Failed to create account:', err);
    }
  };

  const handleDeleteAccount = async (id: number) => {
    if (!confirm('정말로 이 계좌를 삭제하시겠습니까?')) return;
    
    try {
      await DeleteAccount(id);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">계좌 관리</h2>
        <button
          onClick={() => setShowForm(!showForm)}
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
            <h2 className="text-2xl font-semibold mb-4">새 계좌 추가</h2>
            <form onSubmit={handleCreateAccount} className="space-y-4">
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
                  생성
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg transition-colors"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-400">
              <Wallet className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg">등록된 계좌가 없습니다.</p>
              <p className="text-sm mt-2">위의 "계좌 추가" 버튼을 눌러 새 계좌를 생성하세요.</p>
            </div>
          ) : (
            accounts.map((account) => (
              <div
                key={account.id}
                className="bg-slate-800 rounded-xl p-6 border border-slate-700 hover:border-blue-500 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-36 h-12 rounded-lg flex items-center justify-center overflow-hidden ${
                      ['메리츠증권', '토스증권', '카카오증권', '한국투자증권', '삼성증권', '신한투자증권', '대신증권', 'NH투자증권', '미래에셋증권', 'KB증권'].includes(account.broker)
                        ? 'bg-white' 
                        : 'bg-gradient-to-br from-blue-500 to-purple-500'
                    }`}>
                      {account.broker === '메리츠증권' ? (
                        <img 
                          src="/meritz.png" 
                          alt="메리츠증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '토스증권' ? (
                        <img 
                          src="/toss.png" 
                          alt="토스증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '카카오증권' ? (
                        <img 
                          src="/kakao.png" 
                          alt="카카오증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '한국투자증권' ? (
                        <img 
                          src="/korea.png" 
                          alt="한국투자증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '삼성증권' ? (
                        <img 
                          src="/samsung.png" 
                          alt="삼성증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '신한투자증권' ? (
                        <img 
                          src="/shinhan.png" 
                          alt="신한투자증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '대신증권' ? (
                        <img 
                          src="/daishin.png" 
                          alt="대신증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === 'NH투자증권' ? (
                        <img 
                          src="/NH.png" 
                          alt="NH투자증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === '미래에셋증권' ? (
                        <img 
                          src="/miraeasset.png" 
                          alt="미래에셋증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : account.broker === 'KB증권' ? (
                        <img 
                          src="/kb.png" 
                          alt="KB증권" 
                          className="w-full h-full object-contain p-1"
                        />
                      ) : (
                        <Wallet className="w-6 h-6" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-xl font-semibold">{account.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300">
                          {account.market_type === 'Domestic' ? '국내' : '해외'}
                        </span>
                        <p className="text-sm text-slate-400">{account.currency}</p>
                      </div>
                      {account.broker && (
                        <p className="text-xs text-slate-500 mt-1">{account.broker}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteAccount(account.id)}
                    className="text-red-400 hover:text-red-300 transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
                {account.description && (
                  <p className="text-slate-300 text-sm mb-4">{account.description}</p>
                )}
                <div className="text-xs text-slate-500">
                  생성일: {new Date(account.created_at).toLocaleDateString('ko-KR')}
                </div>
              </div>
            ))
          )}
      </div>
    </div>
  );
}

export default App;
