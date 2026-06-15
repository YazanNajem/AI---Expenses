import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Plus, Pencil, Trash2, ArrowLeft, X } from 'lucide-react';

const ASSET_TABS = [
  { value: 'gold', label: 'Gold Portfolio', color: '#f59e0b' },
  { value: 'real_estate', label: 'Real Estate', color: '#10b981' },
  { value: 'stocks', label: 'Stocks', color: '#3b82f6' },
  { value: 'crypto', label: 'Crypto', color: '#8b5cf6' },
];

const TYPE_LABEL = Object.fromEntries(ASSET_TABS.map(t => [t.value, t.label]));
const TYPE_COLOR = Object.fromEntries(ASSET_TABS.map(t => [t.value, t.color]));

const emptyForm = {
  asset_type: 'gold',
  name: '',
  quantity: '',
  unit: '',
  value_per_unit: '0',
  total_value: '',
  current_value: '',
  notes: '',
  purchase_date: '',
  location: '',
  ticker: ''
};

export default function PortfolioDashboard({ effectiveTheme, blurExpenses, toggleBlurExpenses }) {
  const navigate = useNavigate();
  const isDark = effectiveTheme === 'dark';

  const [summary, setSummary] = useState(null);
  const [assets, setAssets] = useState([]);
  const [activeTab, setActiveTab] = useState('gold');
  const [showForm, setShowForm] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: '', total_value: '', current_value: '', name: '', notes: '' });
  const [form, setForm] = useState({ ...emptyForm });
  const [goldPrice, setGoldPrice] = useState(null);
  const [liveCryptoPrice, setLiveCryptoPrice] = useState(() => Number(localStorage.getItem('lastKnownCryptoPrice')) || null);
  const [weightOverrides, setWeightOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem('portfolio_weight_overrides') || '{}'); } catch { return {}; }
  });

  useEffect(() => { localStorage.setItem('portfolio_weight_overrides', JSON.stringify(weightOverrides)); }, [weightOverrides]);

  const load = async () => {
    try {
      const [sRes, aRes, gpRes] = await Promise.all([
        fetch('/api/portfolio/summary'),
        fetch('/api/portfolio/assets'),
        fetch('/api/gold-price')
      ]);
      setSummary(await sRes.json());
      setAssets(await aRes.json());
      const gp = await gpRes.json();
      if (gp.aed_per_gram > 0) setGoldPrice(gp.aed_per_gram);
    } catch (e) { console.error('Portfolio load error:', e); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (activeTab === 'gold') { const iv = setInterval(load, 60000); return () => clearInterval(iv); } }, [activeTab]);

  const fetchCryptoPrice = async () => {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=aed');
      const d = await res.json();
      if (d?.bitcoin?.aed) {
        setLiveCryptoPrice(d.bitcoin.aed);
        localStorage.setItem('lastKnownCryptoPrice', String(d.bitcoin.aed));
      }
    } catch (e) { console.error('Crypto price fetch error:', e); }
  };
  useEffect(() => { fetchCryptoPrice(); }, []);
  useEffect(() => { if (activeTab === 'crypto') { const iv = setInterval(fetchCryptoPrice, 60000); return () => clearInterval(iv); } }, [activeTab]);

  const handleAdd = async (e) => {
    e.preventDefault();
    try {
      const body = {
        asset_type: form.asset_type,
        name: form.name,
        quantity: parseFloat(form.quantity) || 1,
        unit: form.unit,
        value_per_unit: parseFloat(form.value_per_unit) || 0,
        total_value: parseFloat(form.total_value) || 0,
        notes: form.notes,
        purchase_date: form.purchase_date || null
      };
      if (form.asset_type === 'crypto') {
        const q = parseFloat(form.quantity);
        if (!isNaN(q) && q > 0 && liveCryptoPrice) body.current_value = q * liveCryptoPrice;
      } else {
        const cv = parseFloat(form.current_value);
        if (!isNaN(cv) && cv > 0) body.current_value = cv;
      }
      if (form.asset_type === 'gold') {
        const q = parseFloat(form.quantity);
        if (!isNaN(q) && q > 0) { body.weight_g = q; body.quantity = q; }
        if (form.unit) {
          const k = parseInt(form.unit.replace('K', '').replace('k', ''));
          if (!isNaN(k) && k > 0) body.purity = k;
        }
      }
      if (form.location) body.location = form.location;
      if (form.ticker) body.ticker = form.ticker;
      const res = await fetch('/api/portfolio/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await res.json();
      if (d.success) {
        setShowForm(false);
        setForm({ ...emptyForm });
        load();
      }
    } catch (e) { console.error('Add asset error:', e); }
  };

  const handleUpdateAsset = async (id, payload) => {
    try {
      const res = await fetch(`/api/portfolio/assets/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const d = await res.json();
      if (!d.success) console.error('Update failed:', d.error);
    } catch (e) { console.error('Update asset error:', e); }
  };

  const handleRowWeightChange = (a, newWeight) => {
    const v = isNaN(parseFloat(newWeight)) ? 0 : parseFloat(newWeight);
    setWeightOverrides(prev => ({ ...prev, [a?.id]: { ...(prev[a?.id] || {}), weight_g: v } }));
    handleUpdateAsset(a.id, { weight_g: v, quantity: v });
  };

  const handleRowPurityChange = (a, newUnit) => {
    setWeightOverrides(prev => ({ ...prev, [a?.id]: { ...(prev[a?.id] || {}), purity: newUnit, unit: newUnit } }));
    const k = parseInt(newUnit.replace('K', '').replace('k', ''));
    const payload = { unit: newUnit };
    if (!isNaN(k) && k > 0) payload.purity = k;
    handleUpdateAsset(a.id, payload);
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`/api/portfolio/assets/${id}`, { method: 'DELETE' });
      load();
    } catch (e) { console.error('Delete asset error:', e); }
  };

  const openEdit = (a) => {
    setEditingAsset(a);
    setEditForm({
      quantity: a?.quantity || a?.weight_g || '',
      total_value: a?.total_value || '',
      current_value: a?.current_value || '',
      name: a?.name || '',
      notes: a?.notes || '',
    });
  };

  const handleEditSave = async () => {
    if (!editingAsset) return;
    const payload = {};
    const q = parseFloat(editForm.quantity);
    if (!isNaN(q) && q > 0) { payload.quantity = q; if (editingAsset.asset_type === 'gold') payload.weight_g = q; }
    const tv = parseFloat(editForm.total_value);
    if (!isNaN(tv) && tv >= 0) payload.total_value = tv;
    if (editingAsset.asset_type === 'crypto') {
      if (!isNaN(q) && q > 0 && liveCryptoPrice) payload.current_value = q * liveCryptoPrice;
    } else {
      const cv = parseFloat(editForm.current_value);
      if (!isNaN(cv) && cv >= 0) payload.current_value = cv;
    }
    if (editForm.name.trim()) payload.name = editForm.name.trim();
    if (editForm.notes.trim()) payload.notes = editForm.notes.trim();
    await handleUpdateAsset(editingAsset.id, payload);
    setEditingAsset(null);
    load();
  };

  const fmt = (v) => 'AED ' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const pnl = (purchase, current) => {
    const cv = current ?? 0;
    const pp = purchase || 0;
    const diff = cv - pp;
    const pct = pp > 0 ? (diff / pp) * 100 : 0;
    return { diff, pct, isProfit: diff > 0, isLoss: diff < 0 };
  };

  const effectiveWeight = (a) => weightOverrides[a?.id]?.weight_g != null ? weightOverrides[a.id].weight_g : (a?.weight_g || 0);
  const effectivePurity = (a) => {
    const raw = weightOverrides[a?.id]?.purity || a?.purity || '24';
    return raw.replace('K', '').replace('k', '');
  };
  const liveCurrentValue = (a) => {
    if (a?.asset_type === 'crypto') {
      const qty = parseFloat(a?.quantity || 0);
      if (liveCryptoPrice) return qty * liveCryptoPrice;
      return (a?.current_value || 0);
    }
    const w = effectiveWeight(a);
    if (!w || w <= 0) return (a?.current_value || 0);
    const k = parseInt(effectivePurity(a).replace('K', '').replace('k', '')) || 24;
    if (!goldPrice) return (a?.current_value || 0);
    return w * (k / 24) * goldPrice;
  };

  const filteredAssets = assets.filter(a => a.asset_type === activeTab);
  const cryptoQty = assets.filter(a => a.asset_type === 'crypto').reduce((s, a) => s + parseFloat(a?.quantity || 0), 0);
  const goldQty = assets.filter(a => a.asset_type === 'gold').reduce((s, a) => s + Number(a?.weight_g || a?.quantity || 0), 0);
  const totalNetAssets = (Number(cryptoQty || 0) * Number(liveCryptoPrice || 0)) + (Number(goldQty || 0) * Number(goldPrice || 0));
  const cryptoTotalsCurrentValue = Number(cryptoQty || 0) * Number(liveCryptoPrice || 0);
  const currentType = ASSET_TABS.find(t => t.value === activeTab);
  const tc = currentType?.color || '#6c757d';

  const blurClass = blurExpenses ? 'blur-md pointer-events-none select-none' : '';

  const extraCols = () => {
    switch (activeTab) {
      case 'gold': return { label: 'Qty / Unit', width: '150px' };
      case 'real_estate': return { label: 'Location', width: '140px' };
      case 'stocks': return { label: 'Ticker', width: '100px' };
      case 'crypto': return { label: 'Qty', width: '80px' };
      default: return null;
    }
  };
  const ec = extraCols();

  const renderExtraCell = (a) => {
    switch (activeTab) {
      case 'gold':
        const qty = effectiveWeight(a) || a?.quantity || 0;
        const u = a?.unit || (parseInt(effectivePurity(a)) ? effectivePurity(a) + 'K' : '24K');
        return (
          <div className="d-flex align-items-center gap-1" onClick={e => e.stopPropagation()}>
            <input type="number" className="form-control form-control-sm" style={{ width: '60px', padding: '0.15rem 0.3rem', fontSize: '0.7rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit' }} step="0.01" min="0" placeholder="qty" value={qty || ''} onChange={e => handleRowWeightChange(a, e.target.value)} />
            <select className="form-select form-select-sm" style={{ width: '70px', padding: '0.15rem 0.3rem', fontSize: '0.7rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: 'inherit' }} value={u} onChange={e => handleRowPurityChange(a, e.target.value)}>
              <option value="24K">24K</option>
              <option value="22K">22K</option>
              <option value="21K">21K</option>
              <option value="18K">18K</option>
              <option value="Grams">Grams</option>
              <option value="Pieces">Pieces</option>
            </select>
          </div>
        );
      case 'real_estate': return a?.location || '—';
      case 'stocks': return a?.ticker || '—';
      case 'crypto': return a?.quantity ? `${a.quantity}${a.unit ? ' ' + a.unit : ''}` : '—';
      default: return '—';
    }
  };

  const formExtraFields = () => {
    switch (form.asset_type) {
      case 'real_estate':
        return (
            <div className="mb-3">
              <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Location</label>
              <input className="input-theme" placeholder="e.g. Dubai Marina, Apt 14B" value={form.location} onChange={e => setForm({...form, location: e.target.value})} />
            </div>
        );
      case 'stocks':
        return (
          <div className="mb-3">
            <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Ticker Symbol</label>
            <input className="input-theme" placeholder="e.g. AAPL, TSLA" value={form.ticker} onChange={e => setForm({...form, ticker: e.target.value})} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="container pb-4" style={{ minHeight: '100vh', paddingTop: '24px', paddingBottom: '24px' }}>
        {/* Top Bar */}
        <div className="d-flex align-items-center justify-content-between w-100 mb-3" style={{ paddingTop: '1rem' }}>
           <button
             className="btn btn-sm glass-btn px-3 py-1 rounded-2 d-inline-flex align-items-center gap-1"
             onClick={() => navigate('/expenses')}
           >
            <ArrowLeft size={16} /> Expenses
          </button>
          <div className="d-flex align-items-center gap-3">
            <div className="text-end">
              <div className="small fw-bold text-muted text-uppercase" style={{ letterSpacing: '0.05em', fontSize: '0.7rem' }}>Total Net Assets</div>
              <div className={`fw-bold ${blurClass}`} style={{ fontSize: '1.3rem', transition: 'filter 0.3s' }}>
                {fmt(totalNetAssets)}
              </div>
            </div>
            <button
              className="btn btn-sm glass-btn px-2 py-1 rounded-2 d-inline-flex align-items-center justify-content-center"
              onClick={toggleBlurExpenses}
              title="Toggle amounts visibility"
            >
              {blurExpenses ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="d-flex gap-2 mb-4" style={{ paddingBottom: '0.75rem' }}>
          {ASSET_TABS.map(tab => (
            <button
              key={tab.value}
              className={`btn btn-sm px-3 py-1${activeTab === tab.value ? ' btn-success' : ' btn-outline-secondary'}`}
              onClick={() => setActiveTab(tab.value)}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Live Gold Ticker */}
        {activeTab === 'gold' && goldPrice && (
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="d-inline-block rounded-circle" style={{ width: '8px', height: '8px', background: '#10B981', animation: 'pulse 2s infinite' }}></span>
            <span className="small fw-bold">Live 24K Gold</span>
            <span className={`small fw-bold ${blurClass}`} style={{ fontWeight: 600, letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>AED {goldPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })} / gram</span>
            <span className="small text-muted" style={{ fontSize: '0.65rem' }}>Auto-updates every 60s</span>
          </div>
        )}

        {/* Live Crypto Ticker */}
        {activeTab === 'crypto' && liveCryptoPrice && (
          <div className="d-flex align-items-center gap-2 mb-3">
            <span className="d-inline-block rounded-circle" style={{ width: '8px', height: '8px', background: '#8b5cf6', animation: 'pulse 2s infinite' }}></span>
            <span className="small fw-bold">Live BTC</span>
            <span className={`small fw-bold ${blurClass}`} style={{ fontWeight: 600, letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>AED {liveCryptoPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            <span className="small text-muted" style={{ fontSize: '0.65rem' }}>Auto-updates every 60s</span>
          </div>
        )}

        {/* Category Summary Card */}
        {summary && (
          <div className="asset-mini-card mb-4" style={{ borderLeft: `3px solid ${tc}` }}>
            <div className="d-flex align-items-center justify-content-between">
              <div>
                <span className="fw-bold small text-muted" style={{ letterSpacing: '0.05em', textTransform: 'uppercase', fontSize: '0.7rem' }}>
                  {currentType?.icon} {currentType?.label}
                </span>
                <div className={`fw-bold mt-1 ${blurClass}`} style={{ fontSize: '1.15rem', transition: 'filter 0.3s' }}>
                  {fmt(activeTab === 'crypto' ? cryptoTotalsCurrentValue : (filteredAssets.reduce((s, a) => s + parseFloat(liveCurrentValue(a) || 0), 0) || summary[activeTab] || 0))}
                </div>
              </div>
              <div className="text-end">
                <div className="small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600 }}>{filteredAssets.length} item{filteredAssets.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </div>
        )}

        {/* Add Button */}
        <div className="d-flex justify-content-end mb-3">
          <button
            className="btn btn-sm px-3 py-1 rounded-2 d-inline-flex align-items-center gap-1 fw-bold"
            style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#10B981', fontWeight: 600, transition: 'all 0.2s' }}
            onClick={() => { setForm({ ...emptyForm, asset_type: activeTab }); setShowForm(true); }}
          >
            <Plus size={16} /> Add Entry
          </button>
        </div>

        {/* Ledger Table */}
        {filteredAssets.length > 0 ? (() => {
          const totals = filteredAssets.reduce((acc, a) => {
            let lv;
            if (activeTab === 'crypto') {
              lv = parseFloat(a?.quantity || 0) * Number(liveCryptoPrice || 0);
            } else if (activeTab === 'gold' && goldPrice) {
              const w = effectiveWeight(a);
              if (w && w > 0) {
                const k = parseInt(effectivePurity(a).replace('K', '').replace('k', '')) || 24;
                lv = w * (k / 24) * goldPrice;
              } else lv = parseFloat(liveCurrentValue(a) || 0);
            } else {
              lv = parseFloat(liveCurrentValue(a) || 0);
            }
            return { purchaseSum: acc.purchaseSum + parseFloat(a?.total_value || 0), currentSum: acc.currentSum + lv };
          }, { purchaseSum: 0, currentSum: 0 });
          const netPnl = pnl(totals.purchaseSum, totals.currentSum);
          const netColor = netPnl.diff === 0 ? '#888' : (netPnl.isProfit ? '#28a745' : '#dc3545');
          return (
          <div className="table-responsive" style={{ overflow: 'hidden' }}>
            <table className="table table-sm table-borderless mb-0" style={{ color: 'inherit', minWidth: '700px' }}>
              <thead>
                <tr>
                  <th className="fw-bold small px-3 py-2 text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', width: '110px' }}>Date</th>
                  <th className="fw-bold small px-3 py-2 text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Description / Specs</th>
                  {ec && <th className="fw-bold small px-3 py-2 text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', width: ec.width }}>{ec.label}</th>}
                  <th className={`fw-bold small px-3 py-2 text-end ${blurExpenses ? 'blur-md' : ''} text-muted`} style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', width: '120px', transition: 'filter 0.3s' }}>Purchase Price</th>
                  <th className={`fw-bold small px-3 py-2 text-end ${blurExpenses ? 'blur-md' : ''} text-muted`} style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', width: '120px', transition: 'filter 0.3s' }}>Current Value</th>
                  <th className={`fw-bold small px-3 py-2 text-end ${blurExpenses ? 'blur-md' : ''} text-muted`} style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', width: '140px', transition: 'filter 0.3s' }}>P&amp;L</th>
                  <th className="px-3 py-2" style={{ width: '72px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredAssets.map(a => {
                  const liveVal = liveCurrentValue(a);
                  const purchasePrice = a?.total_value || 0;
                  const p = pnl(purchasePrice, liveVal);
                  const pnlColor = p.diff === 0 ? '#888' : (p.isProfit ? '#28a745' : '#dc3545');
                  return (
                    <tr key={a?.id || Math.random()} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="small px-3 py-2 text-nowrap">{a?.purchase_date || '—'}</td>
                      <td className="small px-3 py-2">
                        <span className="fw-bold">{a?.name || 'Unnamed'}</span>
                      </td>
                      {ec && <td className="small px-3 py-2 text-nowrap">{renderExtraCell(a)}</td>}
                      <td className={`small px-3 py-2 text-end text-nowrap ${blurClass}`} style={{ fontWeight: 600, letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>{fmt(purchasePrice)}</td>
                      <td className={`small px-3 py-2 text-end text-nowrap fw-bold ${blurClass}`} style={{ letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>{fmt(liveVal)}</td>
                      <td className={`small px-3 py-2 text-end text-nowrap fw-bold ${blurClass}`} style={{ color: pnlColor, fontWeight: 600, letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>
                        {p.diff !== 0 && (p.isProfit ? '+' : '-')}{fmt(Math.abs(p.diff))}
                        <span className="text-muted" style={{ fontSize: '0.65rem' }}> ({p.diff === 0 ? '0.0' : (p.isProfit ? '+' : '')}{p.pct.toFixed(1)}%)</span>
                      </td>
                      <td className="px-3 py-2 text-end" style={{ whiteSpace: 'nowrap' }}>
                          <button className="btn btn-sm p-1 me-1" style={{ color: 'rgba(255,255,255,0.3)', transition: 'color 0.2s' }}
                            onMouseEnter={e => e.target.style.color = '#f59e0b'}
                            onMouseLeave={e => e.target.style.color = 'rgba(255,255,255,0.3)'}
                            onClick={() => openEdit(a)}><Pencil size={13} /></button>
                          <button className="btn btn-sm p-1" style={{ color: '#EF444466' }} onClick={() => handleDelete(a.id)}><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="small px-3 py-2 fw-bold text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{currentType?.value === 'gold' ? 'Gold Totals' : 'Totals'}</td>
                  <td className={`small px-3 py-2 text-end text-nowrap fw-bold ${blurClass}`} style={{ letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>{fmt(totals.purchaseSum)}</td>
                  <td className={`small px-3 py-2 text-end text-nowrap fw-bold ${blurClass}`} style={{ letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>{fmt(activeTab === 'crypto' ? cryptoTotalsCurrentValue : totals.currentSum)}</td>
                  <td className={`small px-3 py-2 text-end text-nowrap fw-bold ${blurClass}`} style={{ color: netColor, fontWeight: 600, letterSpacing: '-0.02em', transition: 'filter 0.3s' }}>
                    {netPnl.diff !== 0 && (netPnl.isProfit ? '+' : '-')}{fmt(Math.abs(netPnl.diff))}
                    <span className="text-muted" style={{ fontSize: '0.65rem' }}> ({netPnl.diff === 0 ? '0.0' : (netPnl.isProfit ? '+' : '')}{netPnl.pct.toFixed(1)}%)</span>
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          );
        })() : (
          <div className="text-center">
            <p className="mb-1 text-muted" style={{ fontSize: '0.8rem' }}>No {currentType?.label.toLowerCase()} entries recorded.</p>
            <p className="text-muted" style={{ fontSize: '0.8rem' }}>Click "Add Entry" above to register your first asset.</p>
          </div>
        )}

        {/* Add Form Modal */}
        {showForm && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowForm(false)}>
            <div style={{ maxWidth: '520px', width: '90%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div className={isDark ? 'form-wrapper-dark' : 'form-wrapper-light'}>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="m-0 fw-bold" style={{ color: isDark ? '#f1f5f9' : '#1e293b' }}>Add New Asset Entry</h5>
                  <button className="btn btn-sm p-1" onClick={() => setShowForm(false)} style={{ color: isDark ? '#64748b' : '#94a3b8', background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '8px', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={handleAdd}>
                  <div className="mb-3">
                    <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Asset Type</label>
                    <select className="input-theme" value={form.asset_type} onChange={e => setForm({...form, asset_type: e.target.value})} required>
                      {ASSET_TABS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="mb-3">
                    <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Asset Name</label>
                    <input className="input-theme" placeholder="e.g. Swiss Gold Bar" value={form.name} onChange={e => setForm({...form, name: e.target.value})} required />
                  </div>
                  <div className="row g-3 mb-3">
                    <div className="col-6">
                      <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Quantity</label>
                      <input type="number" className="input-theme" step="any" min="0" placeholder="e.g. 0.005" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value === '' ? '' : parseFloat(e.target.value)})} />
                    </div>
                    <div className="col-6">
                      <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Unit</label>
                      <select className="input-theme" value={form.unit} onChange={e => setForm({...form, unit: e.target.value})}>
                        <option value="">Select</option>
                        <option value="24K">24K</option>
                        <option value="22K">22K</option>
                        <option value="21K">21K</option>
                        <option value="18K">18K</option>
                        <option value="Grams">Grams</option>
                        <option value="Pieces">Pieces</option>
                      </select>
                    </div>
                  </div>
                  {formExtraFields()}
                  <div className="mb-3">
                    <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Purchase Date</label>
                    <input type="date" className="input-theme" value={form.purchase_date} onChange={e => setForm({...form, purchase_date: e.target.value})} />
                  </div>
                  <div className="row g-3 mb-3">
                    <div className="col-6">
                      <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Purchase Price (AED)</label>
                      <input type="number" className="input-theme" step="any" min="0" value={form.total_value} onChange={e => setForm({...form, total_value: e.target.value})} required />
                    </div>
                    {activeTab === 'crypto' ? (
                      <div className="col-6">
                        <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Current Value (AED)</label>
                        <div className={`current-value-display ${isDark ? 'current-value-dark' : 'current-value-light'}`}>
                          {liveCryptoPrice && parseFloat(form.quantity) > 0 ? (
                            <span className="current-value-live">
                              AED {(parseFloat(form.quantity) * liveCryptoPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="current-value-placeholder">Enter quantity to calculate</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="col-6">
                        <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Current Value (AED)</label>
                        <input type="number" className="input-theme" step="any" min="0" value={form.current_value} onChange={e => setForm({...form, current_value: e.target.value})} placeholder="Same as purchase" />
                      </div>
                    )}
                  </div>
                  <div className="mb-3">
                    <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Notes</label>
                    <textarea className="input-theme" rows="2" value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Optional notes..." />
                  </div>
                  <button type="submit" className="btn w-100 fw-bold d-flex align-items-center justify-content-center gap-2 submit-btn">
                    <Plus size={16} /> Register Asset Entry
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Edit Asset Modal */}
        {editingAsset && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setEditingAsset(null)}>
            <div style={{ maxWidth: '480px', width: '90%', maxHeight: '85vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div className="premium-clean-form-card" style={{ padding: '32px 28px', borderRadius: '24px' }}>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="m-0 fw-bold">Edit Asset</h5>
                  <button className="btn btn-sm p-1" onClick={() => setEditingAsset(null)} style={{ color: '#aaa', background: 'none', border: 'none' }}><X size={18} /></button>
                </div>
                <div className="mb-3">
                  <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Asset Name</label>
                  <input className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} />
                </div>
                <div className="mb-3">
                  <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Quantity</label>
                  <input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} step="any" min="0" value={editForm.quantity} onChange={e => setEditForm({...editForm, quantity: e.target.value})} />
                </div>
                <div className="row g-2 mb-3">
                  <div className="col-6">
                    <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Purchase Price (AED)</label>
                    <input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} step="any" min="0" value={editForm.total_value} onChange={e => setEditForm({...editForm, total_value: e.target.value})} />
                  </div>
                  {editingAsset?.asset_type === 'crypto' ? (
                    <div className="col-6">
                      <label className="form-label small" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: isDark ? '#94a3b8' : '#64748b' }}>Current Value (AED)</label>
                      <div className={`current-value-display ${isDark ? 'current-value-dark' : 'current-value-light'}`}>
                        {liveCryptoPrice && parseFloat(editForm.quantity) > 0 ? (
                          <span className="current-value-live">
                            AED {(parseFloat(editForm.quantity) * liveCryptoPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        ) : (
                          <span className="current-value-placeholder">Enter quantity to calculate</span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="col-6">
                      <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Current Value (AED)</label>
                      <input type="number" className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} step="any" min="0" value={editForm.current_value} onChange={e => setEditForm({...editForm, current_value: e.target.value})} />
                    </div>
                  )}
                </div>
                <div className="mb-3">
                  <label className="form-label small text-muted" style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Notes</label>
                  <textarea className={`form-control ${isDark ? 'bg-dark text-white border-secondary' : ''}`} rows="2" value={editForm.notes} onChange={e => setEditForm({...editForm, notes: e.target.value})} />
                </div>
                <button className="landing-glow-btn w-100 justify-content-center" onClick={handleEditSave}>Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
