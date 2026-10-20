const { useState, useEffect, useMemo, useRef } = React;

// Ensure SweetAlert modals behave as strict modal dialogs (no close on clicking outside)
if (typeof window !== 'undefined' && window.swal && typeof window.swal.setDefaults === 'function') {
    window.swal.setDefaults({ closeOnClickOutside: false });
}

// --- Currency Input Helpers ---
// Determine whether a currency input value represents zero (e.g. '0.000', '0', 0, 0.00, etc.)
function isZeroCurrencyValue(val) {
    if (val === null || val === undefined) return false;
    const str = String(val).trim();
    if (str === '') return false;
    return str === '0' || str === '0.000' || (!isNaN(Number(str)) && Number(str) === 0);
}

// Clear currency value on focus when current value is 0.000 or 0 so user can directly type new value
function handleCurrencyFocus(value, setValue) {
    if (isZeroCurrencyValue(value)) {
        if (typeof setValue === 'function') {
            setValue('');
        }
    }
}

// Global focusin listener for all currency inputs (inputs with step="0.001" or data-currency="true")
if (typeof document !== 'undefined') {
    document.addEventListener('focusin', function(e) {
        const target = e.target;
        if (target && target.tagName === 'INPUT') {
            const isCurrency = target.getAttribute('step') === '0.001' || target.getAttribute('data-currency') === 'true';
            if (isCurrency && isZeroCurrencyValue(target.value)) {
                const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (nativeSetter) {
                    nativeSetter.call(target, '');
                } else {
                    target.value = '';
                }
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }, true);
}

// --- API Helper ---
const api = {
    async request(url, options = {}) {
        options.headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({ success: false, error: 'Invalid response from server' }));
        if (!res.ok) {
            throw new Error(data.error || 'Request failed with status ' + res.status);
        }
        return data;
    },
    get(url) { return this.request(url, { method: 'GET' }); },
    post(url, body) { return this.request(url, { method: 'POST', body: JSON.stringify(body) }); },
    put(url, body) { return this.request(url, { method: 'PUT', body: JSON.stringify(body) }); },
    delete(url) { return this.request(url, { method: 'DELETE' }); }
};

// --- Date Formatter Helper: dd-mm-yyyy ---
function formatDateDMY(val) {
    if (!val || val === '0000-00-00' || val === '0000-00-00 00:00:00' || val === 'N/A' || val === 'NA') {
        return '—';
    }
    const str = String(val).trim();
    if (/^\d{2}-\d{2}-\d{4}$/.test(str)) {
        return str;
    }
    const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (isoMatch) {
        const [, year, month, day] = isoMatch;
        return `${day}-${month}-${year}`;
    }
    const slashMatch = str.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
    if (slashMatch) {
        const [, year, month, day] = slashMatch;
        return `${day}-${month}-${year}`;
    }
    return str;
}

// --- Number to Words Currency Formatter matching staging_parallel getCurrency ---
function getCurrencyWords(number) {
    if (number === null || number === undefined || isNaN(number)) return '';
    const num = Number(number);
    const intPart = Math.floor(Math.abs(num));
    const decimalPart = Math.round((Math.abs(num) - intPart) * 1000);

    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
        'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convertGroup(n) {
        let str = '';
        if (n >= 100) {
            str += ones[Math.floor(n / 100)] + ' Hundred ';
            n %= 100;
        }
        if (n >= 20) {
            str += tens[Math.floor(n / 10)] + ' ';
            n %= 10;
        }
        if (n > 0) {
            str += ones[n] + ' ';
        }
        return str.trim();
    }

    let words = '';
    let remainder = intPart;

    if (remainder >= 10000000) {
        const crore = Math.floor(remainder / 10000000);
        words += convertGroup(crore) + ' Crore ';
        remainder %= 10000000;
    }
    if (remainder >= 100000) {
        const lakh = Math.floor(remainder / 100000);
        words += convertGroup(lakh) + ' Lakh ';
        remainder %= 100000;
    }
    if (remainder >= 1000) {
        const thousand = Math.floor(remainder / 1000);
        words += convertGroup(thousand) + ' Thousand ';
        remainder %= 1000;
    }
    if (remainder > 0) {
        words += convertGroup(remainder);
    }
    words = words.trim();
    if (!words) words = 'Zero';

    if (decimalPart > 0) {
        return `${words} and ${decimalPart}/1000`;
    }
    return words;
}

// --- Entry Age & 24h Window Helper for Live Floor Pay Balance ---
function getEntryAgeInfo(createdAt, auctionDate) {
    if (!createdAt && !auctionDate) {
        return { isWithin24h: true, remainingHours: 24, hoursAgo: 0, text: 'Active' };
    }
    const raw = createdAt || (auctionDate ? `${auctionDate} 00:00:00` : '');
    const cleanStr = String(raw).trim();
    const isoStr = cleanStr.includes('T') ? cleanStr : cleanStr.replace(' ', 'T');
    let entryTime = new Date(isoStr).getTime();
    if (isNaN(entryTime)) {
        entryTime = new Date(cleanStr).getTime();
    }
    if (isNaN(entryTime)) {
        return { isWithin24h: true, remainingHours: 24, hoursAgo: 0, text: 'Active' };
    }

    const now = Date.now();
    const diffMs = now - entryTime;
    const diffHours = diffMs / (1000 * 60 * 60);
    const isWithin24h = diffHours >= 0 && diffHours <= 24;
    const remainingHours = Math.max(0, 24 - diffHours);

    return {
        isWithin24h,
        diffHours,
        remainingHours,
        entryTime,
        formattedDate: formatDateDMY(cleanStr)
    };
}

// --- Toast Component ---
function ToastContainer({ toasts, onDismiss }) {
    return (
        <div className="toast-container">
            {toasts.map(t => (
                <div key={t.id} className={`toast toast-${t.type}`} onClick={() => onDismiss(t.id)}>
                    <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '⚠️' : 'ℹ️'}</span>
                    <span>{t.message}</span>
                </div>
            ))}
        </div>
    );
}

// --- Signature Template Modal Header (Staging Parallel Inspired) ---
function ModalHeader({ title, icon, onClose, badge }) {
    return (
        <div className="modal-header gradient-45deg-purple-deep-orange">
            <div className="modal-header-branding">
                <img 
                    src="/images/logo/logo_web.png" 
                    alt="Cathedral Logo" 
                    className="modal-logo-banner"
                    onError={(e) => { e.target.src = '/images/logo/church_crest_white.png'; }}
                />
                <div className="modal-brand-divider"></div>
                <h4 className="modal-title">
                    {icon && <i className="material-icons" style={{ fontSize: '19px', flexShrink: 0 }}>{icon}</i>}
                    <span className="modal-title-text">{title}</span>
                    {badge && (
                        <span className="modal-header-badge">
                            {badge}
                        </span>
                    )}
                </h4>
            </div>
            <button type="button" className="modal-close-btn" onClick={onClose} title="Exit">×</button>
        </div>
    );
}

// --- Interactive DataTable Component (Staging Parallel & Materialize Inspired) ---
function DataTable({
    columns,
    data = [],
    keyField = 'id',
    loading = false,
    emptyMessage = 'No matching records found.',
    initialPageSize = 10,
    pageSizeOptions = [10, 25, 50, 100],
    searchable = true,
    searchPlaceholder = 'Search records...',
    defaultSortKey = null,
    defaultSortDir = 'asc',
    toolbarExtras = null,
    tableClassName = '',
    compact = false
}) {
    const [searchTerm, setSearchTerm] = useState('');
    const [pageSize, setPageSize] = useState(initialPageSize);
    const [currentPage, setCurrentPage] = useState(1);
    const [sortKey, setSortKey] = useState(defaultSortKey || (columns.length > 0 ? (columns[0].accessor || columns[0].id) : ''));
    const [sortDir, setSortDir] = useState(defaultSortDir);

    // Reset pagination to first page when search or page size changes
    useEffect(() => {
        setCurrentPage(1);
    }, [searchTerm, pageSize]);

    // Handle column sorting
    const handleSort = (col) => {
        if (col.sortable === false) return;
        const key = col.accessor || col.id;
        if (!key) return;
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('asc');
        }
    };

    // Filter data across all searchable columns and row data (tag name, tag no, buyer, vouchers, etc.)
    const filteredData = useMemo(() => {
        if (!data || !Array.isArray(data)) return [];
        const query = searchTerm.trim().toLowerCase();
        if (!query) return data;

        const terms = query.split(/\s+/).filter(Boolean);

        return data.filter((row, idx) => {
            // 1. Collect column-level searchable values
            const colStrings = [];
            columns.forEach(col => {
                if (col.searchable === false) return;
                let val;
                if (typeof col.searchValue === 'function') {
                    val = col.searchValue(row, idx);
                } else if (typeof col.accessor === 'function') {
                    val = col.accessor(row);
                } else if (col.accessor) {
                    val = row[col.accessor];
                }
                if (val !== null && val !== undefined) {
                    colStrings.push(String(val).toLowerCase());
                }
            });

            // 2. Collect row-level object values (tag_number, article_name, article_number, buyer details, nested contributions/promises)
            const rowStrings = [];
            for (const k in row) {
                const v = row[k];
                if (v === null || v === undefined) continue;
                if (typeof v === 'string' || typeof v === 'number') {
                    rowStrings.push(String(v).toLowerCase());
                } else if (Array.isArray(v)) {
                    v.forEach(item => {
                        if (item && typeof item === 'object') {
                            for (const ik in item) {
                                const iv = item[ik];
                                if (iv !== null && iv !== undefined && (typeof iv === 'string' || typeof iv === 'number')) {
                                    rowStrings.push(String(iv).toLowerCase());
                                }
                            }
                        }
                    });
                }
            }

            const combinedSearch = colStrings.join(' ') + ' ' + rowStrings.join(' ');
            return terms.every(t => combinedSearch.includes(t));
        });
    }, [data, searchTerm, columns]);

    // Sort filtered data
    const sortedData = useMemo(() => {
        if (!sortKey) return filteredData;
        const col = columns.find(c => (c.accessor === sortKey || c.id === sortKey));
        if (!col) return filteredData;

        return [...filteredData].sort((a, b) => {
            let valA, valB;
            if (typeof col.sortValue === 'function') {
                valA = col.sortValue(a);
                valB = col.sortValue(b);
            } else if (typeof col.accessor === 'function') {
                valA = col.accessor(a);
                valB = col.accessor(b);
            } else if (col.accessor) {
                valA = a[col.accessor];
                valB = b[col.accessor];
            }

            if (valA === valB) return 0;
            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;

            const numA = Number(valA);
            const numB = Number(valB);
            if (!isNaN(numA) && !isNaN(numB) && typeof valA !== 'boolean' && typeof valB !== 'boolean') {
                return sortDir === 'asc' ? numA - numB : numB - numA;
            }

            const strA = String(valA).toLowerCase();
            const strB = String(valB).toLowerCase();
            return sortDir === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });
    }, [filteredData, sortKey, sortDir, columns]);

    // Pagination calculations
    const totalRecords = data.length;
    const filteredRecordsCount = sortedData.length;
    const totalPages = Math.ceil(filteredRecordsCount / pageSize) || 1;
    const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
    
    const startIndex = (safeCurrentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, filteredRecordsCount);
    const paginatedData = sortedData.slice(startIndex, endIndex);

    // Numbered pagination buttons
    const getPageNumbers = () => {
        const pages = [];
        const maxVisible = 5;
        let start = Math.max(1, safeCurrentPage - 2);
        let end = Math.min(totalPages, start + maxVisible - 1);
        if (end - start + 1 < maxVisible) {
            start = Math.max(1, end - maxVisible + 1);
        }
        for (let i = start; i <= end; i++) {
            pages.push(i);
        }
        return pages;
    };

    return (
        <div className="dataTables_wrapper">
            {(searchable || pageSizeOptions.length > 0 || toolbarExtras) && (
                <div className="dt-top-toolbar">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                        {pageSizeOptions.length > 0 && (
                            <div className="dataTables_length">
                                <label>
                                    Show
                                    <select 
                                        value={pageSize} 
                                        onChange={e => setPageSize(Number(e.target.value))}
                                    >
                                        {pageSizeOptions.map(opt => (
                                            <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                    </select>
                                    entries
                                </label>
                            </div>
                        )}
                        {toolbarExtras}
                    </div>

                    {searchable && (
                        <div className="dataTables_filter">
                            <label>
                                <div className="dt-search-wrapper">
                                    <i className="material-icons dt-search-icon">search</i>
                                    <input 
                                        type="text" 
                                        className="dt-search-input"
                                        placeholder={searchPlaceholder} 
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                    />
                                    {searchTerm && (
                                        <button 
                                            type="button" 
                                            className="dt-search-clear" 
                                            onClick={() => setSearchTerm('')}
                                            title="Clear search"
                                        >
                                            ×
                                        </button>
                                    )}
                                </div>
                            </label>
                        </div>
                    )}
                </div>
            )}

            <div className="dt-table-container">
                <table className={`dataTable stripe display ${tableClassName}`}>
                    <thead>
                        <tr>
                            {columns.map((col, idx) => {
                                const isSortable = col.sortable !== false && (col.accessor || col.id);
                                const isSorted = isSortable && sortKey === (col.accessor || col.id);
                                const sortClass = !isSortable ? '' : isSorted ? (sortDir === 'asc' ? 'sorting_asc' : 'sorting_desc') : 'sorting';

                                return (
                                    <th 
                                        key={col.id || col.accessor || idx}
                                        className={sortClass}
                                        style={col.headerStyle || col.style || {}}
                                        onClick={() => isSortable && handleSort(col)}
                                    >
                                        <span>{col.header}</span>
                                        {isSortable && (
                                            <span className="sort-icon">
                                                {isSorted ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                                            </span>
                                        )}
                                    </th>
                                );
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px' }}>
                                    <div className="spinner" style={{ margin: '0 auto 10px' }}></div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading data...</div>
                                </td>
                            </tr>
                        ) : paginatedData.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '45px 20px', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '32px', marginBottom: '8px' }}>📂</div>
                                    <div style={{ fontSize: '14px', fontWeight: 500 }}>{emptyMessage}</div>
                                    {searchTerm && (
                                        <button 
                                            type="button" 
                                            className="btn btn-secondary btn-sm" 
                                            style={{ marginTop: '12px' }}
                                            onClick={() => setSearchTerm('')}
                                        >
                                            Clear Filter
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ) : (
                            paginatedData.map((row, rowIdx) => {
                                const rowKey = typeof keyField === 'function' ? keyField(row, rowIdx) : (row[keyField] || rowIdx);
                                return (
                                    <tr key={rowKey}>
                                        {columns.map((col, colIdx) => {
                                            const rawVal = typeof col.accessor === 'function' 
                                                ? col.accessor(row) 
                                                : (col.accessor ? row[col.accessor] : null);
                                            let cellContent;
                                            if (typeof col.render === 'function') {
                                                cellContent = col.render(row, startIndex + rowIdx, rowIdx);
                                            } else {
                                                const isDateCol = (col.header && /date/i.test(col.header)) || 
                                                    (col.accessor && /date|created_at/i.test(String(col.accessor)));
                                                if (isDateCol || (typeof rawVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rawVal))) {
                                                    cellContent = formatDateDMY(rawVal);
                                                } else {
                                                    cellContent = rawVal;
                                                }
                                            }
                                            return (
                                                <td key={col.id || col.accessor || colIdx} style={col.style || {}} className={col.className || ''}>
                                                    {cellContent}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                    {/* Optional DataTable Footer for column totals / summaries across all pages */}
                    {!loading && filteredRecordsCount > 0 && columns.some(col => col.footer !== undefined) && (
                        <tfoot className="dt-table-footer">
                            <tr>
                                {columns.map((col, colIdx) => {
                                    let footerContent = null;
                                    if (typeof col.footer === 'function') {
                                        footerContent = col.footer(filteredData, data);
                                    } else if (col.footer !== undefined) {
                                        footerContent = col.footer;
                                    }
                                    return (
                                        <td 
                                            key={col.id || col.accessor || colIdx}
                                            style={{
                                                ...(col.headerStyle || {}),
                                                ...(col.style || {}),
                                                ...(col.footerStyle || {})
                                            }}
                                            className={`dt-footer-cell ${col.footerClassName || col.className || ''}`}
                                        >
                                            {footerContent}
                                        </td>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            {/* Bottom info & pagination */}
            <div className="dt-bottom-toolbar">
                <div className="dataTables_info">
                    {filteredRecordsCount === 0 ? (
                        'Showing 0 to 0 of 0 entries'
                    ) : (
                        `Showing ${startIndex + 1} to ${endIndex} of ${filteredRecordsCount} entries${
                            filteredRecordsCount !== totalRecords ? ` (filtered from ${totalRecords} total entries)` : ''
                        }`
                    )}
                </div>

                {totalPages > 1 && (
                    <div className="dataTables_paginate">
                        <button 
                            type="button"
                            className={`paginate_button ${safeCurrentPage <= 1 ? 'disabled' : ''}`}
                            disabled={safeCurrentPage <= 1}
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        >
                            Previous
                        </button>

                        {getPageNumbers().map(num => (
                            <button
                                key={num}
                                type="button"
                                className={`paginate_button ${num === safeCurrentPage ? 'current' : ''}`}
                                onClick={() => setCurrentPage(num)}
                            >
                                {num}
                            </button>
                        ))}

                        <button 
                            type="button"
                            className={`paginate_button ${safeCurrentPage >= totalPages ? 'disabled' : ''}`}
                            disabled={safeCurrentPage >= totalPages}
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        >
                            Next
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// --- Login Screen ---
function LoginScreen({ onLoginSuccess }) {
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('Syskode123#$#');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            const res = await api.post('/api/auth/login', { username, password });
            if (res.success) {
                onLoginSuccess(res.user);
            } else {
                setError(res.error || 'Login failed');
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-card">
                <div className="login-header">
                    <img 
                        src="/images/logo/red_full_logo.png" 
                        alt="Auction Portal" 
                        className="login-img-logo"
                        onError={(e) => { e.target.src = '/images/logo/login-page-logo.png'; }}
                    />
                    <h1>Auction Portal</h1>
                    <p>Harvest Festival & Article Auction Management</p>
                </div>

                {error && (
                    <div className="badge badge-danger" style={{ width: '100%', padding: '10px 14px', marginBottom: '18px', borderRadius: '8px' }}>
                        ⚠️ {error}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="form-label">Username</label>
                        <div className="login-input-wrapper">
                            <i className="material-icons">person</i>
                            <input 
                                type="text" 
                                className="form-control" 
                                placeholder="Enter username (e.g. admin)" 
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>
                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div className="login-input-wrapper">
                            <i className="material-icons">lock</i>
                            <input 
                                type="password" 
                                className="form-control" 
                                placeholder="Enter password" 
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button type="submit" className="btn btn-login-submit" disabled={loading}>
                        {loading ? 'Authenticating...' : 'Sign In to Portal →'}
                    </button>
                </form>
            </div>
        </div>
    );
}

// --- Dashboard View ---
function DashboardView({ stats, year, onNavigate, onOpenNewArticle, onOpenImport }) {
    return (
        <div>
            {/* Header */}
            <div className="breadcrumbs-wrapper">
                <div className="breadcrumbs-title">
                    <i className="material-icons">dashboard</i>
                    <h4>Festival Auction Dashboard ({year})</h4>
                </div>
            </div>

            {/* Stat Cards - Staging Parallel Gradient Round Accents */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Total Articles</span>
                        <div className="stat-value">{stats?.total_articles || 0}</div>
                        <div className="stat-sub">Registered for Year {year}</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-purple-deep-orange gradient-shadow white-text">inventory_2</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Articles Sold</span>
                        <div className="stat-value">{stats?.sold_articles || 0}</div>
                        <div className="stat-sub">
                            {stats?.total_articles > 0 
                                ? `${Math.round(((stats.sold_articles || 0) / stats.total_articles) * 100)}% Clearance`
                                : '0% Clearance'}
                        </div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-green-teal gradient-shadow white-text">check_circle</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Total Auction Value</span>
                        <div className="stat-value">BHD {Number(stats?.total_auction_sales || 0).toFixed(3)}</div>
                        <div className="stat-sub">{stats?.total_transactions || 0} Winning Bids</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-indigo-purple gradient-shadow white-text">gavel</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Payments Collected</span>
                        <div className="stat-value">BHD {Number(stats?.total_collected || 0).toFixed(3)}</div>
                        <div className="stat-sub">Cash & BenefitPay</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-light-blue-cyan gradient-shadow white-text">payments</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Pending Promises</span>
                        <div className="stat-value">BHD {Number(stats?.total_pending_promises || 0).toFixed(3)}</div>
                        <div className="stat-sub">{stats?.active_promises_count || 0} Open Member Dues</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-amber-amber gradient-shadow white-text">account_balance_wallet</i>
                </div>
            </div>

            {/* Visual Overview Columns */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
                <div className="card">
                    <div className="card-header">
                        <h3>📦 Article Clearance Status</h3>
                        <span className="badge badge-info">{stats?.available_articles || 0} Available</span>
                    </div>
                    <div className="card-body">
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                                <span>Sold & Delivered</span>
                                <span style={{ fontWeight: 'bold', color: 'var(--success)' }}>{stats?.sold_articles || 0} items</span>
                            </div>
                            <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ 
                                    height: '100%', 
                                    background: 'var(--success)', 
                                    width: `${stats?.total_articles > 0 ? (stats.sold_articles / stats.total_articles) * 100 : 0}%` 
                                }}></div>
                            </div>
                        </div>

                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
                                <span>Available for Bidding</span>
                                <span style={{ fontWeight: 'bold', color: 'var(--warning)' }}>{stats?.available_articles || 0} items</span>
                            </div>
                            <div style={{ width: '100%', height: '8px', background: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ 
                                    height: '100%', 
                                    background: 'var(--warning)', 
                                    width: `${stats?.total_articles > 0 ? (stats.available_articles / stats.total_articles) * 100 : 0}%` 
                                }}></div>
                            </div>
                        </div>

                        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-muted)' }}>
                            <span>Total Inventory Value: <strong>BHD {Number(stats?.total_estimated_value || 0).toFixed(3)}</strong></span>
                            <span style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }} onClick={() => onNavigate('articles')}>View All Articles →</span>
                        </div>
                    </div>
                </div>

                <div className="card">
                    <div className="card-header">
                        <h3>💰 Financial Recovery Ratio</h3>
                        <span className="badge badge-success">
                            {Number(stats?.total_auction_sales || 0) > 0 
                                ? `${Math.round(((stats.total_collected || 0) / stats.total_auction_sales) * 100)}% Collected`
                                : '0%'}
                        </span>
                    </div>
                    <div className="card-body">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                            <div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Collected Revenue</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--success)' }}>BHD {Number(stats?.total_collected || 0).toFixed(3)}</div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Outstanding Promises</div>
                                <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--danger)' }}>BHD {Number(stats?.total_pending_promises || 0).toFixed(3)}</div>
                            </div>
                        </div>

                        <div style={{ width: '100%', height: '12px', background: 'rgba(239, 68, 68, 0.25)', borderRadius: '6px', overflow: 'hidden', display: 'flex' }}>
                            <div style={{ 
                                height: '100%', 
                                background: 'var(--success)', 
                                width: `${stats?.total_auction_sales > 0 ? ((stats.total_collected || 0) / stats.total_auction_sales) * 100 : 0}%` 
                            }}></div>
                        </div>

                        <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                            <span style={{ color: 'var(--text-muted)' }}>Active Bidders: <strong>{stats?.unique_buyers || 0} Members</strong></span>
                            <span style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }} onClick={() => onNavigate('promises')}>Manage Promises →</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Category Management Modal ---
function CategoryManagementModal({ isOpen, onClose, categories, categoryDetails, onCategoryAdded, onCategoryDeleted, showToast }) {
    if (!isOpen) return null;

    const [newCategory, setNewCategory] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleAdd = async (e) => {
        e.preventDefault();
        const trimmed = newCategory.trim();
        if (!trimmed) return;

        setSubmitting(true);
        try {
            const res = await api.post('/api/articles/categories', { name: trimmed });
            if (res.success) {
                showToast('success', res.message || `Category "${trimmed}" added.`);
                setNewCategory('');
                onCategoryAdded(res);
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (catId, catName, articleCount) => {
        if (articleCount > 0) {
            if (typeof window.swal === 'function') {
                window.swal({
                    title: "Cannot Delete Category",
                    text: `Category "${catName}" is currently linked to ${articleCount} article(s).\nPlease reassign those articles before deleting.`,
                    icon: "warning",
                    button: "OK"
                });
            } else {
                showToast('error', `Cannot delete "${catName}" because it is linked to ${articleCount} article(s).`);
            }
            return;
        }

        if (typeof window.swal === 'function') {
            window.swal({
                title: "Delete Category?",
                text: `Are you sure you want to delete category "${catName}"?`,
                icon: "warning",
                buttons: {
                    cancel: {
                        text: "Cancel",
                        visible: true,
                        className: "swal-button--cancel",
                        closeModal: true
                    },
                    confirm: {
                        text: "Yes, Delete It",
                        visible: true,
                        className: "swal-button--danger",
                        closeModal: true
                    }
                },
                dangerMode: true
            }).then(async (willDelete) => {
                if (willDelete) {
                    try {
                        const res = await api.delete(`/api/articles/categories/${catId}`);
                        if (res.success) {
                            window.swal({
                                title: "Deleted!",
                                text: `Category "${catName}" has been deleted.`,
                                icon: "success",
                                timer: 2000,
                                buttons: false
                            });
                            showToast('success', `Category "${catName}" deleted.`);
                            if (typeof onCategoryDeleted === 'function') {
                                await onCategoryDeleted(catId);
                            }
                        }
                    } catch (err) {
                        window.swal("Error", err.message, "error");
                    }
                }
            });
        } else {
            if (!confirm(`Delete category "${catName}"?`)) return;
            try {
                const res = await api.delete(`/api/articles/categories/${catId}`);
                if (res.success) {
                    showToast('success', `Category "${catName}" deleted.`);
                    if (typeof onCategoryDeleted === 'function') {
                        await onCategoryDeleted(catId);
                    }
                }
            } catch (err) {
                showToast('error', err.message);
            }
        }
    };

    const categoryTableData = useMemo(() => {
        if (categoryDetails && categoryDetails.length > 0) {
            return categoryDetails;
        }
        return (categories || []).map((c, i) => ({
            category_id: i + 1,
            category_name: c,
            article_count: 0
        }));
    }, [categoryDetails, categories]);

    const categoryColumns = [
        {
            header: 'Category Name',
            accessor: 'category_name',
            sortable: true,
            render: (cat) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{cat.category_name}</strong>
                    {cat.category_name === 'General' && (
                        <span className="badge badge-secondary" style={{ fontSize: '10px' }}>Default</span>
                    )}
                </div>
            )
        },
        {
            header: 'Articles',
            accessor: 'article_count',
            sortable: true,
            headerStyle: { textAlign: 'center', width: '120px' },
            style: { textAlign: 'center' },
            render: (cat) => (
                <span className={`badge ${cat.article_count > 0 ? 'badge-primary' : 'badge-secondary'}`}>
                    {cat.article_count}
                </span>
            )
        },
        {
            header: 'Action',
            id: 'action',
            sortable: false,
            headerStyle: { textAlign: 'right', width: '90px' },
            style: { textAlign: 'right' },
            render: (cat) => (
                cat.category_name !== 'General' ? (
                    <button 
                        type="button"
                        className="btn gradient-45deg-red-pink gradient-shadow white-text btn-sm"
                        style={{ padding: '4px 8px', fontSize: '12px', minWidth: 'auto', height: '30px', opacity: cat.article_count > 0 ? 0.4 : 1 }}
                        title={cat.article_count > 0 ? "Cannot delete category in use by articles" : "Delete category"}
                        disabled={cat.article_count > 0}
                        onClick={() => handleDelete(cat.category_id, cat.category_name, cat.article_count)}
                    >
                        <i className="material-icons" style={{ fontSize: '15px' }}>delete</i>
                    </button>
                ) : <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>System</span>
            )
        }
    ];

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '680px' }}>
                <ModalHeader 
                    title="Article Categories Management" 
                    icon="category" 
                    onClose={onClose} 
                    badge={`${categoryTableData.length} Categories`}
                />

                <div className="modal-body">
                    {/* Add Category Form Area */}
                    <div style={{ background: 'rgba(142, 36, 170, 0.05)', padding: '16px 20px', borderRadius: '10px', border: '1px solid rgba(142, 36, 170, 0.15)', marginBottom: '22px' }}>
                        <label className="form-label" style={{ fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <i className="material-icons" style={{ fontSize: '18px', color: 'var(--primary)' }}>add_circle</i>
                            Add New Category
                        </label>
                        <form onSubmit={handleAdd} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <input 
                                type="text"
                                className="form-control"
                                placeholder="Enter category name (e.g. Sports Equipment, Antiques)..."
                                value={newCategory}
                                onChange={e => setNewCategory(e.target.value)}
                                required
                                style={{ height: '40px', fontSize: '13px' }}
                            />
                            <button 
                                type="submit" 
                                className="btn gradient-45deg-green-teal gradient-shadow white-text" 
                                disabled={submitting || !newCategory.trim()} 
                                style={{ height: '40px', whiteSpace: 'nowrap', padding: '0 20px' }}
                            >
                                <i className="material-icons" style={{ fontSize: '18px' }}>add</i> Add
                            </button>
                        </form>
                    </div>

                    {/* Category List DataTable */}
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0, color: 'var(--text-primary)' }}>
                                Existing Categories ({categoryTableData.length})
                            </h4>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                Active categories cannot be deleted if articles are assigned
                            </span>
                        </div>

                        <DataTable 
                            columns={categoryColumns} 
                            data={categoryTableData} 
                            keyField="category_id" 
                            initialPageSize={10} 
                            searchPlaceholder="Search categories..." 
                            emptyMessage="No categories registered yet."
                        />
                    </div>
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn gradient-45deg-red-pink gradient-shadow white-text" onClick={onClose}>
                        <i className="material-icons" style={{ fontSize: '16px' }}>close</i> Exit
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- Reusable Multi-Sheet Excel Template Generator with Master Categories ---
function downloadExcelTemplate(targetYear = new Date().getFullYear(), catList = []) {
    const categoriesToUse = (catList && catList.length > 0) 
        ? catList 
        : ['General', 'Traditional & Brass', 'Jewellery', 'Food & Delicacy', 'Handicrafts', 'Electronics', 'Apparel & Silk'];

    const sampleRows = [
        {
            'article_number': `ART-${targetYear}-001`,
            'tag_number': 'TAG-001',
            'applicable_year': targetYear,
            'article_name': 'Nilavilakku Traditional Brass Lamp',
            'category': categoriesToUse[1] || 'Traditional & Brass',
            'estimated_value': 85.000,
            'donor_name': 'George Varghese',
            'description': 'Heavy 5-step prayer lamp'
        },
        {
            'article_number': `ART-${targetYear}-002`,
            'tag_number': 'TAG-002',
            'applicable_year': targetYear,
            'article_name': 'Gold Sovereign 22K Coin',
            'category': categoriesToUse[2] || 'Jewellery',
            'estimated_value': 220.000,
            'donor_name': 'Anonymous Donor',
            'description': 'Donated for cathedral harvest auction'
        },
        {
            'article_number': `ART-${targetYear}-003`,
            'tag_number': 'TAG-003',
            'applicable_year': targetYear,
            'article_name': 'Harvest Organic Spices & Honey Box',
            'category': categoriesToUse[3] || 'Food & Delicacy',
            'estimated_value': 40.000,
            'donor_name': 'St. Thomas Prayer Group',
            'description': 'Cardamom, mountain pepper, forest honey'
        },
        {
            'article_number': `ART-${targetYear}-004`,
            'tag_number': 'TAG-004',
            'applicable_year': targetYear,
            'article_name': 'Handwoven Kasavu Silk Saree',
            'category': categoriesToUse[0] || 'General',
            'estimated_value': 55.000,
            'donor_name': 'Church Well-Wisher',
            'description': 'Traditional handloom silk'
        }
    ];

    const wb = XLSX.utils.book_new();

    // Sheet 1: Articles_Template (The data sheet the user edits)
    const wsArticles = XLSX.utils.json_to_sheet(sampleRows);
    wsArticles['!cols'] = [
        { wch: 18 }, // article_number
        { wch: 14 }, // tag_number
        { wch: 16 }, // applicable_year
        { wch: 38 }, // article_name
        { wch: 24 }, // category
        { wch: 22 }, // estimated_value
        { wch: 26 }, // donor_name
        { wch: 40 }  // description
    ];
    XLSX.utils.book_append_sheet(wb, wsArticles, 'Articles_Template');

    // Sheet 2: Master_Categories (Reference list of valid categories from Master)
    const catReferenceRows = categoriesToUse.map((cat, index) => ({
        '#': index + 1,
        'Master Category Name': cat,
        'How to Use in Template': index === 0 
            ? 'Default category (used if category column is left blank)' 
            : 'Copy exact category name into Articles_Template "category" column'
    }));

    const wsCats = XLSX.utils.json_to_sheet(catReferenceRows);
    wsCats['!cols'] = [
        { wch: 6 },
        { wch: 28 },
        { wch: 65 }
    ];
    XLSX.utils.book_append_sheet(wb, wsCats, 'Master_Categories');

    XLSX.writeFile(wb, `cathedral_articles_template_${targetYear}.xlsx`);
}

// --- Article Master Management View ---
function ArticlesView({ year, onOpenNewArticle, onEditArticle, onOpenImport, showToast, refreshTrigger, onDataChanged }) {
    const [articles, setArticles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('All');
    const [categoryFilter, setCategoryFilter] = useState('All');
    const [categories, setCategories] = useState([]);
    const [categoryDetails, setCategoryDetails] = useState([]);
    const [categoryModalOpen, setCategoryModalOpen] = useState(false);

    const fetchArticles = async () => {
        setLoading(true);
        try {
            const url = `/api/articles?year=${year}&status=${statusFilter}&category=${categoryFilter}&search=${encodeURIComponent(search)}&order=asc`;
            const res = await api.get(url);
            if (res.success) {
                setArticles(res.articles);
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const res = await api.get('/api/articles/categories');
            if (res.success) {
                if (res.categories) setCategories(res.categories);
                if (res.category_details) setCategoryDetails(res.category_details);
            }
        } catch (err) {}
    };

    useEffect(() => {
        fetchCategories();
    }, [refreshTrigger]);

    useEffect(() => {
        fetchArticles();
    }, [year, statusFilter, categoryFilter, search, refreshTrigger]);

    const handleDelete = (a) => {
        // Only articles with status 'Available' can be deleted
        if (a.status !== 'Available') {
            if (typeof window.swal === 'function') {
                window.swal({
                    title: "Cannot Delete Article",
                    text: `Only articles with status "Available" can be deleted.\nThis article is currently marked as "${a.status}".`,
                    icon: "warning",
                    button: "Understood"
                });
            } else {
                showToast('warning', `Only articles with status "Available" can be deleted (Current: ${a.status}).`);
            }
            return;
        }

        if (typeof window.swal === 'function') {
            window.swal({
                title: "Are you sure?",
                text: `Do you want to permanently delete Article [${a.article_number}] - "${a.article_name}"?\nThis action cannot be undone.`,
                icon: "warning",
                buttons: {
                    cancel: {
                        text: "No, Cancel",
                        visible: true,
                        className: "swal-button--cancel",
                        closeModal: true
                    },
                    confirm: {
                        text: "Yes, Delete It",
                        visible: true,
                        className: "swal-button--danger",
                        closeModal: true
                    }
                },
                dangerMode: true
            }).then(async (willDelete) => {
                if (willDelete) {
                    try {
                        const res = await api.delete(`/api/articles/${a.article_id}`);
                        if (res.success) {
                            window.swal({
                                title: "Deleted!",
                                text: `Article [${a.article_number}] has been deleted successfully.`,
                                icon: "success",
                                timer: 2200,
                                buttons: false
                            });
                            showToast('success', `Article [${a.article_number}] deleted successfully.`);
                            fetchArticles();
                            fetchCategories();
                            if (typeof onDataChanged === 'function') {
                                onDataChanged();
                            }
                        }
                    } catch (err) {
                        window.swal("Error", err.message, "error");
                    }
                }
            });
        } else {
            if (!confirm(`Are you sure you want to delete Article [${a.article_number}]?`)) return;
            api.delete(`/api/articles/${a.article_id}`)
                .then(res => {
                    if (res.success) {
                        showToast('success', `Article ${a.article_number} deleted successfully.`);
                        fetchArticles();
                        fetchCategories();
                        if (typeof onDataChanged === 'function') {
                            onDataChanged();
                        }
                    }
                })
                .catch(err => showToast('error', err.message));
        }
    };

    const exportToCsv = () => {
        if (!articles.length) return;
        const rows = articles.map(a => ({
            'Article No': a.article_number,
            'Tag No': a.tag_number,
            'Year': a.applicable_year,
            'Name': a.article_name,
            'Category': a.category,
            'Estimated Value (BHD)': a.estimated_value,
            'Reserve Price (BHD)': a.reserve_price,
            'Status': a.status,
            'Donor': a.donor_name || 'N/A',
            'Donor Roll No': a.donor_code_c || 'N/A',
            'Donor Phone': a.donor_phone || 'N/A',
            'Donor CPR': a.donor_cpr || 'N/A'
        }));
        const worksheet = XLSX.utils.json_to_sheet(rows);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `Articles_${year}`);
        XLSX.writeFile(workbook, `cathedral_articles_${year}.xlsx`);
    };

    return (
        <div>
            <div className="card">
                <div className="card-header" style={{ flexWrap: 'wrap', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <i className="material-icons" style={{ fontSize: '28px', color: 'var(--primary)' }}>inventory_2</i>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
                                Article Master Management ({year})
                            </h3>
                            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                                Create, edit, organize and assign unique tags to festival articles
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => {
                                fetchArticles();
                                fetchCategories();
                                if (typeof onDataChanged === 'function') onDataChanged();
                            }} 
                            title="Reload Articles Table"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                            <i className="material-icons" style={{ fontSize: '16px' }}>refresh</i> Reload Table
                        </button>
                        <button className="btn btn-purple btn-sm" onClick={() => setCategoryModalOpen(true)} title="Manage Categories">
                            <i className="material-icons">category</i> Categories ({categories.length})
                        </button>
                        <button className="btn btn-excel btn-sm" onClick={exportToCsv} title="Export all articles to Excel spreadsheet">
                            <i className="material-icons">file_download</i> Export Excel
                        </button>
                        <button className="btn btn-orange btn-sm" onClick={onOpenImport} title="Bulk upload articles via Excel or CSV">
                            <i className="material-icons">cloud_upload</i> Excel Import
                        </button>
                        <button className="btn btn-gradient btn-sm" onClick={onOpenNewArticle} title="Register new article">
                            <i className="material-icons">add_circle</i> Add Article
                        </button>
                    </div>
                </div>

                {/* Filter Toolbar */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Status:</span>
                        <select className="form-control" style={{ width: '165px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            <option value="All">All Statuses</option>
                            <option value="Available">Available</option>
                            <option value="Auctioned">Auctioned</option>
                            <option value="Sold">Sold</option>
                            <option value="Delivered">Delivered</option>
                            <option value="Cancelled">Cancelled</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Category:</span>
                        <select className="form-control" style={{ width: '195px' }} value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                            <option value="All">All Categories</option>
                            {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                </div>

                {/* DataTable */}
                <DataTable 
                    columns={[
                        {
                            header: 'SL No',
                            accessor: 'article_id',
                            id: 'article_id',
                            sortable: true,
                            sortValue: (a) => Number(a.article_id) || 0,
                            headerStyle: { width: '70px', textAlign: 'center' },
                            style: { textAlign: 'center', width: '70px', fontWeight: 600, color: 'var(--text-muted)' },
                            render: (a, index) => <span style={{ fontSize: '12px' }}>{index + 1}</span>
                        },
                        {
                            header: 'Article No',
                            accessor: 'article_number',
                            sortable: true,
                            render: (a) => <strong style={{ color: 'var(--text-primary)' }}>{a.article_number}</strong>
                        },
                        {
                            header: 'Tag No',
                            accessor: 'tag_number',
                            sortable: true,
                            searchValue: (a) => a.tag_number || '',
                            render: (a) => <span className="tag-badge">{a.tag_number}</span>
                        },
                        {
                            header: 'Tag Name / Article',
                            accessor: 'article_name',
                            sortable: true,
                            searchValue: (a) => `${a.tag_number || ''} ${a.article_name || ''} ${a.article_number || ''} ${a.description || ''}`,
                            render: (a) => (
                                <div>
                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.article_name}</div>
                                    {a.description && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{a.description}</div>}
                                </div>
                            )
                        },
                        {
                            header: 'Category',
                            accessor: 'category',
                            sortable: true,
                            render: (a) => <span className="badge badge-secondary">{a.category}</span>
                        },
                        {
                            header: 'Est. Value (BHD)',
                            accessor: 'estimated_value',
                            sortable: true,
                            sortValue: (a) => Number(a.estimated_value) || 0,
                            render: (a) => <strong style={{ color: 'var(--primary)' }}>{Number(a.estimated_value).toFixed(3)}</strong>
                        },
                        {
                            header: 'Donor',
                            accessor: 'donor_name',
                            sortable: true,
                            render: (a) => (
                                <div>
                                    <div style={{ fontWeight: 600 }}>{a.donor_name || 'Well-Wisher'}</div>
                                    {a.donor_code_c && <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600 }}>Roll No: {a.donor_code_c}</div>}
                                    {a.donor_phone && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Tel: {a.donor_phone}</div>}
                                </div>
                            )
                        },
                        {
                            header: 'Status',
                            accessor: 'status',
                            sortable: true,
                            render: (a) => (
                                <span className={`badge badge-${
                                    a.status === 'Available' ? 'warning' :
                                    a.status === 'Sold' ? 'success' :
                                    a.status === 'Auctioned' ? 'info' : 'secondary'
                                }`}>
                                    {a.status}
                                </span>
                            )
                        },
                        {
                            header: 'Actions',
                            id: 'actions',
                            sortable: false,
                            headerStyle: { textAlign: 'right' },
                            style: { textAlign: 'right', whiteSpace: 'nowrap' },
                            render: (a) => {
                                const isAvailable = a.status === 'Available';
                                return (
                                    <div>
                                        <button 
                                            type="button"
                                            className="btn btn-secondary btn-sm" 
                                            style={{ marginRight: '6px', ...(!isAvailable ? { opacity: 0.4, cursor: 'not-allowed' } : {}) }} 
                                            disabled={!isAvailable}
                                            onClick={() => {
                                                if (!isAvailable) {
                                                    showToast('warning', `Only articles with status "Available" can be edited (Current: ${a.status}).`);
                                                    return;
                                                }
                                                onEditArticle(a);
                                            }}
                                            title={isAvailable ? `Edit Article [${a.article_number}]` : `Cannot edit: Article status is "${a.status}" (only Available articles can be edited)`}
                                        >
                                            <i className="material-icons" style={{ fontSize: '15px' }}>edit</i> Edit
                                        </button>
                                        <button 
                                            type="button" 
                                            className={`btn btn-sm ${isAvailable ? 'btn-danger' : 'btn-secondary'}`}
                                            style={!isAvailable ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                                            onClick={() => handleDelete(a)}
                                            title={isAvailable ? `Delete Article [${a.article_number}]` : `Cannot delete: Article status is "${a.status}" (only Available articles can be deleted)`}
                                        >
                                            <i className="material-icons" style={{ fontSize: '15px' }}>delete</i>
                                        </button>
                                    </div>
                                );
                            }
                        }
                    ]} 
                    data={articles} 
                    loading={loading}
                    keyField="article_id" 
                    defaultSortKey="article_id"
                    defaultSortDir="asc"
                    initialPageSize={10} 
                    searchPlaceholder="Search by SL No, Article No, Tag No, Tag Name, Donor..." 
                    emptyMessage={`No articles found for year ${year} matching the selected filters.`}
                />
            </div>

            <CategoryManagementModal 
                isOpen={categoryModalOpen}
                onClose={() => setCategoryModalOpen(false)}
                categories={categories}
                categoryDetails={categoryDetails}
                onCategoryAdded={(res) => {
                    if (res.categories) setCategories(res.categories);
                    if (res.category_details) setCategoryDetails(res.category_details);
                    fetchArticles();
                    if (typeof onDataChanged === 'function') onDataChanged();
                }}
                onCategoryDeleted={async () => {
                    await fetchCategories();
                    fetchArticles();
                    if (typeof onDataChanged === 'function') onDataChanged();
                }}
                showToast={showToast}
            />
        </div>
    );
}

// --- Article Form Modal (Add / Edit) ---
function ArticleModal({ article, year, isOpen, onClose, onSuccess, showToast }) {
    if (!isOpen) return null;

    const [form, setForm] = useState({
        article_number: article ? article.article_number : '',
        tag_number: article ? article.tag_number : '',
        applicable_year: article ? article.applicable_year : year,
        article_name: article ? article.article_name : '',
        description: article ? (article.description || '') : '',
        category: article ? (article.category || 'General') : 'General',
        donor_name: article ? (article.donor_name || '') : '',
        donor_member_id: article ? (article.donor_member_id || '') : '',
        donor_code_c: article ? (article.donor_code_c || '') : '',
        donor_phone: article ? (article.donor_phone || '') : '',
        donor_cpr: article ? (article.donor_cpr || '') : '',
        estimated_value: article ? article.estimated_value : '0.000',
        reserve_price: article ? article.reserve_price : '0.000',
        status: article ? article.status : 'Available'
    });

    const [catOptions, setCatOptions] = useState([]);
    const [showNewCatInput, setShowNewCatInput] = useState(false);
    const [newCatName, setNewCatName] = useState('');
    const [addingCat, setAddingCat] = useState(false);
    const [memberSearch, setMemberSearch] = useState('');
    const [memberList, setMemberList] = useState([]);
    const [submitting, setSubmitting] = useState(false);
    const [isReserveCustomized, setIsReserveCustomized] = useState(!!article);

    const handleEstimatedValueChange = (val) => {
        setForm(f => ({
            ...f,
            estimated_value: val,
            reserve_price: (!article && !isReserveCustomized) ? val : f.reserve_price
        }));
    };

    const handleReservePriceChange = (val) => {
        setIsReserveCustomized(true);
        setForm(f => ({
            ...f,
            reserve_price: val
        }));
    };

    // Fetch next sequential unique article number for the selected year
    useEffect(() => {
        if (!article && isOpen && form.applicable_year) {
            api.get(`/api/articles/next-number?year=${form.applicable_year}`)
                .then(res => {
                    if (res.success && res.next_article_number) {
                        setForm(f => ({
                            ...f,
                            article_number: res.next_article_number,
                            tag_number: (!f.tag_number || f.tag_number.startsWith('TAG-'))
                                ? res.next_article_number.replace(`ART-${form.applicable_year}-`, 'TAG-')
                                : f.tag_number
                        }));
                    }
                })
                .catch(() => {});
        }
    }, [article, isOpen, form.applicable_year]);

    useEffect(() => {
        api.get('/api/articles/categories')
            .then(res => {
                if (res.success && res.categories) setCatOptions(res.categories);
            })
            .catch(() => {});
    }, []);

    const handleSaveInlineCategory = async () => {
        const trimmed = newCatName.trim();
        if (!trimmed) return;
        setAddingCat(true);
        try {
            const res = await api.post('/api/articles/categories', { name: trimmed });
            if (res.success) {
                showToast('success', `Category "${trimmed}" added!`);
                const updated = res.categories || [...catOptions, trimmed];
                setCatOptions(updated);
                setForm(f => ({ ...f, category: trimmed }));
                setNewCatName('');
                setShowNewCatInput(false);
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setAddingCat(false);
        }
    };

    useEffect(() => {
        if (memberSearch.trim().length > 1) {
            api.get(`/api/members/search?q=${encodeURIComponent(memberSearch)}`)
                .then(res => setMemberList(res.members || []))
                .catch(() => {});
        } else {
            setMemberList([]);
        }
    }, [memberSearch]);

    const handleSelectDonor = (m) => {
        setForm(f => ({
            ...f,
            donor_name: m.primary_member_name,
            donor_member_id: m.primary_member_id,
            donor_code_c: m.code_c,
            donor_phone: m.bahrain_contact_no || '',
            donor_cpr: m.cpr_no || ''
        }));
        setMemberSearch('');
        setMemberList([]);
    };

    const handleClearDonorMember = () => {
        setForm(f => ({
            ...f,
            donor_member_id: '',
            donor_code_c: '',
            donor_phone: '',
            donor_cpr: ''
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            if (article) {
                await api.put(`/api/articles/${article.article_id}`, form);
                showToast('success', `Article ${form.article_number} updated.`);
            } else {
                await api.post('/api/articles', form);
                showToast('success', `Article ${form.article_number} created.`);
            }
            onSuccess();
            onClose();
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content article-modal-content">
                <ModalHeader 
                    title={article ? "Edit Article Record" : "Create Article Record"}
                    icon={article ? "edit" : "add_circle"}
                    onClose={onClose}
                    badge={form.article_number || undefined}
                />
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
                        <div className="form-row article-top-row">
                            <div className="form-group">
                                <label className="form-label">Applicable Year *</label>
                                <input 
                                    type="number" 
                                    className="form-control" 
                                    required 
                                    disabled={!!article}
                                    value={form.applicable_year}
                                    onChange={e => setForm({...form, applicable_year: Number(e.target.value) || e.target.value})}
                                />
                                <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                                    {article ? 'Locked to registered festival year' : 'Selecting year recalculates article sequence'}
                                </small>
                            </div>
                            <div className="form-group">
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span>Article Number</span>
                                    <span className="badge badge-primary" style={{ fontSize: '10px', padding: '2px 6px' }}>Auto System ID</span>
                                </label>
                                <input 
                                    type="text" 
                                    className="form-control" 
                                    readOnly 
                                    disabled
                                    value={form.article_number || 'Auto-generating...'}
                                    style={{ background: 'rgba(0,0,0,0.04)', fontWeight: '700', color: 'var(--primary)', cursor: 'not-allowed' }}
                                />
                                <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '3px', marginTop: '4px' }}>
                                    <i className="material-icons" style={{ fontSize: '13px' }}>lock</i>
                                    {article ? 'System assigned (read-only)' : `Auto-created for year ${form.applicable_year}`}
                                </small>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Tag Number *</label>
                                <input 
                                    type="text" 
                                    className="form-control" 
                                    required 
                                    value={form.tag_number}
                                    onChange={e => setForm({...form, tag_number: e.target.value})}
                                />
                                <small style={{ color: 'var(--text-muted)', fontSize: '11px', display: 'block', marginTop: '4px' }}>
                                    Physical tag barcode / identifier
                                </small>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Article Name / Title *</label>
                            <input 
                                type="text" 
                                className="form-control" 
                                placeholder="e.g. Traditional Nilavilakku Brass Lamp" 
                                required 
                                value={form.article_name}
                                onChange={e => setForm({...form, article_name: e.target.value})}
                            />
                        </div>

                        {/* Category */}
                        <div className="form-group">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                <label className="form-label" style={{ margin: 0 }}>Category *</label>
                                <button 
                                    type="button" 
                                    className="btn btn-sm" 
                                    style={{ padding: '2px 8px', fontSize: '11px', background: 'transparent', color: 'var(--primary)', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                                    onClick={() => setShowNewCatInput(!showNewCatInput)}
                                >
                                    {showNewCatInput ? '✖ Cancel' : '➕ Add Category'}
                                </button>
                            </div>
                            <select 
                                className="form-control"
                                value={form.category}
                                onChange={e => setForm({...form, category: e.target.value})}
                            >
                                {(catOptions.length > 0 ? catOptions : ['General', 'Traditional & Brass', 'Jewellery', 'Food & Delicacy', 'Handicrafts', 'Electronics', 'Apparel & Silk']).map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                            {showNewCatInput && (
                                <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <input 
                                        type="text" 
                                        className="form-control" 
                                        placeholder="Enter new category name..." 
                                        value={newCatName} 
                                        onChange={e => setNewCatName(e.target.value)} 
                                        style={{ height: '36px', fontSize: '12px', flex: '1', minWidth: '180px' }}
                                    />
                                    <button 
                                        type="button" 
                                        className="btn btn-primary btn-sm" 
                                        disabled={addingCat || !newCatName.trim()}
                                        onClick={handleSaveInlineCategory}
                                        style={{ whiteSpace: 'nowrap', height: '36px' }}
                                    >
                                        Save
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Estimated Value (BHD)</label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    className="form-control" 
                                    placeholder="0.000"
                                    data-currency="true"
                                    value={form.estimated_value}
                                    onFocus={() => {
                                        handleCurrencyFocus(form.estimated_value, v => {
                                            setForm(f => ({
                                                ...f,
                                                estimated_value: v,
                                                reserve_price: (!article && !isReserveCustomized && isZeroCurrencyValue(f.reserve_price)) ? v : f.reserve_price
                                            }));
                                        });
                                    }}
                                    onChange={e => handleEstimatedValueChange(e.target.value)}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Reserve Price (BHD)</label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    className="form-control" 
                                    placeholder="0.000"
                                    data-currency="true"
                                    value={form.reserve_price}
                                    onFocus={() => handleCurrencyFocus(form.reserve_price, v => setForm(f => ({ ...f, reserve_price: v })))}
                                    onChange={e => handleReservePriceChange(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Donor Selection */}
                        <div className="form-group">
                            <label className="form-label">Donor Name / Member</label>
                            <input 
                                type="text" 
                                className="form-control" 
                                placeholder="Donor Name (e.g. John Mohan)" 
                                value={form.donor_name}
                                onChange={e => setForm({...form, donor_name: e.target.value})}
                            />

                            {/* Linked Member Details Info Badge / Card */}
                            {(form.donor_member_id || form.donor_code_c) && (
                                <div style={{
                                    marginTop: '8px',
                                    background: 'rgba(123, 31, 162, 0.06)',
                                    border: '1px solid rgba(123, 31, 162, 0.25)',
                                    borderRadius: '8px',
                                    padding: '10px 14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '12px',
                                    flexWrap: 'wrap'
                                }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span className="badge badge-primary" style={{ fontSize: '11px', padding: '2px 8px' }}>
                                                <i className="material-icons" style={{ fontSize: '13px' }}>verified</i> Linked Member
                                            </span>
                                            <strong style={{ color: 'var(--text-primary)', fontSize: '13px' }}>{form.donor_name}</strong>
                                        </div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
                                            <span>Roll No: <strong style={{ color: 'var(--primary)', fontWeight: 700 }}>{form.donor_code_c || 'N/A'}</strong></span>
                                            <span>Contact: <strong>{form.donor_phone || 'N/A'}</strong></span>
                                            <span>CPR: <strong>{form.donor_cpr || 'N/A'}</strong></span>
                                        </div>
                                    </div>
                                    <button 
                                        type="button" 
                                        className="btn btn-secondary btn-sm"
                                        style={{ fontSize: '11px', padding: '3px 10px', height: '28px' }}
                                        onClick={handleClearDonorMember}
                                        title="Unlink member details"
                                    >
                                        <i className="material-icons" style={{ fontSize: '14px' }}>link_off</i> Unlink
                                    </button>
                                </div>
                            )}

                            <div style={{ marginTop: '8px' }}>
                                <input 
                                    type="text" 
                                    className="form-control" 
                                    style={{ fontSize: '12px' }} 
                                    placeholder="🔍 Search Parish Member directory to auto-fill..."
                                    value={memberSearch}
                                    onChange={e => setMemberSearch(e.target.value)}
                                />
                                {memberList.length > 0 && (
                                    <div className="member-search-dropdown">
                                        {memberList.map(m => (
                                            <div 
                                                key={m.primary_member_id} 
                                                className="member-search-item"
                                                onClick={() => handleSelectDonor(m)}
                                            >
                                                <div className="member-search-item-title">{m.primary_member_name}</div>
                                                <div className="member-search-item-subtitle" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '3px' }}>
                                                    <span>Roll No: <strong style={{ color: 'var(--primary)', fontWeight: 600 }}>{m.code_c}</strong></span>
                                                    <span>Contact: <strong>{m.bahrain_contact_no || 'N/A'}</strong></span>
                                                    <span>CPR: <strong>{m.cpr_no || 'N/A'}</strong></span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label">Description / Remarks</label>
                            <textarea 
                                className="form-control" 
                                rows="3" 
                                placeholder="Condition, donor remarks, blessing details..."
                                value={form.description}
                                onChange={e => setForm({...form, description: e.target.value})}
                            ></textarea>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn gradient-45deg-red-pink gradient-shadow white-text" onClick={onClose}>
                            <i className="material-icons" style={{ fontSize: '16px' }}>close</i> Exit
                        </button>
                        <button type="submit" className="btn gradient-45deg-green-teal gradient-shadow white-text" disabled={submitting}>
                            <i className="material-icons" style={{ fontSize: '16px' }}>save</i> {submitting ? 'Saving...' : article ? 'Save Changes' : 'Save Article'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Excel Import Modal ---
function ExcelImportModal({ year, isOpen, onClose, onSuccess, showToast }) {
    if (!isOpen) return null;

    const [parsedRows, setParsedRows] = useState([]);
    const [fileName, setFileName] = useState('');
    const [loading, setLoading] = useState(false);
    const [masterCategories, setMasterCategories] = useState([]);
    const fileInputRef = useRef(null);

    useEffect(() => {
        api.get('/api/articles/categories')
            .then(res => {
                if (res.success && res.categories) setMasterCategories(res.categories);
            })
            .catch(() => {});
    }, []);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setFileName(file.name);

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

                // Map header variations to standardized names
                const formatted = json.map(r => {
                    const row = {};
                    Object.keys(r).forEach(k => {
                        const cleanKey = k.toLowerCase().trim().replace(/[\s\-\#]/g, '_');
                        if (cleanKey.includes('article') || cleanKey.includes('art_no')) row.article_number = String(r[k]).trim();
                        else if (cleanKey.includes('tag')) row.tag_number = String(r[k]).trim();
                        else if (cleanKey.includes('year')) row.applicable_year = Number(r[k]) || year;
                        else if (cleanKey.includes('name') || cleanKey.includes('title')) row.article_name = String(r[k]).trim();
                        else if (cleanKey.includes('category')) row.category = String(r[k]).trim();
                        else if (cleanKey.includes('value') || cleanKey.includes('price')) row.estimated_value = Number(r[k]) || 0;
                        else if (cleanKey.includes('donor')) row.donor_name = String(r[k]).trim();
                    });
                    if (!row.applicable_year) row.applicable_year = year;
                    return row;
                }).filter(r => r.article_number && r.tag_number);

                setParsedRows(formatted);
                if (formatted.length === 0) {
                    showToast('error', 'No valid rows found. Please ensure Article Number and Tag Number exist.');
                }
            } catch (err) {
                showToast('error', 'Error reading Excel/CSV: ' + err.message);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const handleCommit = async () => {
        if (!parsedRows.length) return;
        setLoading(true);
        try {
            const res = await api.post('/api/excel/import', { rows: parsedRows });
            if (res.success) {
                showToast('success', res.message);
                onSuccess();
                onClose();
            } else {
                showToast('error', res.error || 'Import failed');
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    const previewColumns = [
        {
            header: '#',
            id: 'index',
            sortable: false,
            style: { width: '50px' },
            render: (r, i) => i + 1
        },
        {
            header: 'Article No',
            accessor: 'article_number',
            sortable: true,
            render: (r) => <strong>{r.article_number}</strong>
        },
        {
            header: 'Tag No',
            accessor: 'tag_number',
            sortable: true,
            render: (r) => <span className="tag-badge">{r.tag_number}</span>
        },
        {
            header: 'Year',
            accessor: 'applicable_year',
            sortable: true,
            style: { width: '75px' }
        },
        {
            header: 'Article Name',
            accessor: 'article_name',
            sortable: true
        },
        {
            header: 'Category',
            accessor: 'category',
            sortable: true,
            render: (r) => <span className="badge badge-secondary">{r.category || 'General'}</span>
        },
        {
            header: 'Value (BHD)',
            accessor: 'estimated_value',
            sortable: true,
            sortValue: (r) => Number(r.estimated_value) || 0,
            render: (r) => Number(r.estimated_value || 0).toFixed(3)
        }
    ];

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '880px' }}>
                <ModalHeader 
                    title="Excel / CSV Article Batch Import" 
                    icon="cloud_upload" 
                    onClose={onClose} 
                    badge={parsedRows.length ? `${parsedRows.length} Valid Records` : undefined}
                />

                <div className="modal-body">
                    {/* Template & Master Category Info Box */}
                    <div style={{ background: 'rgba(142, 36, 170, 0.05)', border: '1px solid rgba(142, 36, 170, 0.2)', borderRadius: '10px', padding: '18px', marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '14px' }}>
                            <div>
                                <h4 style={{ color: 'var(--primary)', fontSize: '15px', fontWeight: '700', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className="material-icons" style={{ fontSize: '20px' }}>description</i> Download Import Template
                                </h4>
                                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0 }}>
                                    Download the template to add article data with pre-filled sample rows and the live Master Categories tab.
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                <button 
                                    type="button" 
                                    className="btn gradient-45deg-purple-deep-orange gradient-shadow white-text btn-sm" 
                                    onClick={() => downloadExcelTemplate(year, masterCategories)}
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    <i className="material-icons" style={{ fontSize: '16px' }}>file_download</i>
                                    Download Excel (.xlsx)
                                </button>
                                <a 
                                    href="/api/excel/template" 
                                    download 
                                    className="btn btn-secondary btn-sm" 
                                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                >
                                    <i className="material-icons" style={{ fontSize: '16px' }}>download</i>
                                    CSV Template
                                </a>
                            </div>
                        </div>

                        {/* Master Categories Reference Section */}
                        <div style={{ background: '#ffffff', borderRadius: '8px', padding: '12px 14px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                                <span style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <i className="material-icons" style={{ fontSize: '16px', color: 'var(--primary)' }}>category</i>
                                    Master Categories for Import ({masterCategories.length}):
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                    (Click any badge to copy name)
                                </span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {masterCategories.map(cat => (
                                    <span 
                                        key={cat} 
                                        className="badge" 
                                        style={{ 
                                            padding: '4px 10px', 
                                            fontSize: '11px', 
                                            fontWeight: '600', 
                                            cursor: 'pointer', 
                                            background: 'rgba(142, 36, 170, 0.08)', 
                                            color: 'var(--primary)', 
                                            border: '1px solid rgba(142, 36, 170, 0.25)',
                                            borderRadius: '6px'
                                        }}
                                        title={`Click to copy "${cat}"`}
                                        onClick={() => {
                                            if (navigator.clipboard) {
                                                navigator.clipboard.writeText(cat);
                                                showToast('info', `Copied "${cat}" to clipboard.`);
                                            }
                                        }}
                                    >
                                        {cat}
                                    </span>
                                ))}
                            </div>
                            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', marginBottom: 0 }}>
                                💡 <strong>Note on Categories:</strong> Use any of the Master Categories above in your sheet. If your file contains a new category not in the Master list, the system will automatically register it into the Category Master during import.
                            </p>
                        </div>
                    </div>

                    <div 
                        style={{ 
                            border: '2px dashed var(--border-color)', 
                            borderRadius: '12px', 
                            padding: '30px', 
                            textAlign: 'center', 
                            cursor: 'pointer',
                            background: 'rgba(255, 255, 255, 0.02)'
                        }}
                        onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    >
                        <input 
                            type="file" 
                            ref={fileInputRef} 
                            style={{ display: 'none' }} 
                            accept=".xlsx,.xls,.csv" 
                            onChange={handleFileChange}
                        />
                        <div style={{ fontSize: '36px', marginBottom: '8px' }}>📁</div>
                        <h4 style={{ fontSize: '15px', marginBottom: '4px' }}>
                            {fileName ? `Selected: ${fileName}` : 'Click or Drag & Drop Excel / CSV file here'}
                        </h4>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Supports .xlsx, .xls, and .csv formats</p>
                    </div>

                    {parsedRows.length > 0 && (
                        <div style={{ marginTop: '24px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <h4 style={{ fontSize: '14px', fontWeight: '700', margin: 0 }}>File Preview ({parsedRows.length} Valid Records Detected)</h4>
                                <span className="badge badge-success">Ready to Import</span>
                            </div>
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                <DataTable 
                                    columns={previewColumns}
                                    data={parsedRows}
                                    keyField={(r, i) => `${r.article_number}_${i}`}
                                    initialPageSize={10}
                                    searchPlaceholder="Search in imported file..."
                                    emptyMessage="No rows parsed."
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-footer">
                    <button type="button" className="btn gradient-45deg-red-pink gradient-shadow white-text" onClick={onClose}>
                        <i className="material-icons" style={{ fontSize: '16px' }}>close</i> Exit
                    </button>
                    <button 
                        type="button" 
                        className="btn gradient-45deg-green-teal gradient-shadow white-text" 
                        disabled={!parsedRows.length || loading}
                        onClick={handleCommit}
                    >
                        <i className="material-icons" style={{ fontSize: '16px' }}>cloud_upload</i>
                        {loading ? 'Importing Rows...' : `Import ${parsedRows.length} Articles`}
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- Searchable Head Select Dropdown Component ---
function SearchableHeadSelect({
    label,
    placeholder,
    options = [],
    selectedHead,
    onSelect,
    required = false,
    badgeColor = 'var(--primary)',
    helperText = ''
}) {
    const [search, setSearch] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredOptions = useMemo(() => {
        if (!search.trim()) return options.slice(0, 60);
        const q = search.toLowerCase().trim();
        return options.filter(opt => 
            String(opt.head_code || '').toLowerCase().includes(q) ||
            String(opt.head_name || '').toLowerCase().includes(q)
        ).slice(0, 60);
    }, [options, search]);

    return (
        <div className="form-group" ref={containerRef} style={{ position: 'relative', margin: 0 }}>
            <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontWeight: 600, fontSize: '13px' }}>
                    {label} {required && <strong style={{ color: 'var(--danger)' }}>*</strong>}
                </span>
                {selectedHead && (
                    <span style={{ fontSize: '11px', color: badgeColor, fontWeight: 700 }}>
                        Code: {selectedHead.head_code}
                    </span>
                )}
            </label>

            {selectedHead ? (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    background: 'var(--bg-card, rgba(255, 255, 255, 0.05))',
                    border: `1.5px solid ${badgeColor}`,
                    borderRadius: '8px',
                    padding: '8px 12px',
                    gap: '10px',
                    minHeight: '44px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1, paddingRight: '4px' }}>
                        <span className="badge" style={{ background: badgeColor, color: '#fff', fontSize: '12px', padding: '3px 8px', whiteSpace: 'nowrap', fontWeight: 700, flexShrink: 0 }}>
                            {selectedHead.head_code}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text-primary)', wordBreak: 'break-word', lineHeight: '1.35' }} title={`${selectedHead.head_code} - ${selectedHead.head_name}`}>
                            {selectedHead.head_name}
                        </span>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 10px', fontSize: '11px', height: '28px', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}
                        onClick={() => { onSelect(null); setSearch(''); }}
                        title="Click to search and pick another head"
                    >
                        <i className="material-icons" style={{ fontSize: '14px' }}>swap_horiz</i> Change
                    </button>
                </div>
            ) : (
                <div style={{ position: 'relative' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <i className="material-icons" style={{
                            position: 'absolute',
                            left: '10px',
                            color: 'var(--text-muted)',
                            fontSize: '18px',
                            pointerEvents: 'none'
                        }}>search</i>
                        <input
                            type="text"
                            className="form-control"
                            style={{ paddingLeft: '34px', paddingRight: search ? '30px' : '10px' }}
                            placeholder={placeholder || "Search code or name..."}
                            value={search}
                            onFocus={() => setIsOpen(true)}
                            onChange={e => { setSearch(e.target.value); setIsOpen(true); }}
                        />
                        {search && (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                style={{
                                    position: 'absolute',
                                    right: '8px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-muted)',
                                    cursor: 'pointer'
                                }}
                            >
                                <i className="material-icons" style={{ fontSize: '16px' }}>close</i>
                            </button>
                        )}
                    </div>

                    {isOpen && (
                        <div className="member-search-dropdown" style={{
                            position: 'absolute',
                            top: 'calc(100% + 4px)',
                            left: 0,
                            right: 0,
                            zIndex: 250,
                            maxHeight: '260px',
                            overflowY: 'auto'
                        }}>
                            {filteredOptions.length === 0 ? (
                                <div style={{ padding: '12px 14px', fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center' }}>
                                    No account heads match &ldquo;<strong>{search}</strong>&rdquo;
                                </div>
                            ) : (
                                filteredOptions.map(opt => (
                                    <div
                                        key={opt.head_id}
                                        className="member-search-item"
                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '9px 12px' }}
                                        onClick={() => {
                                            onSelect(opt);
                                            setIsOpen(false);
                                            setSearch('');
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                                            <span className="badge" style={{ background: badgeColor, color: '#fff', fontSize: '11px', padding: '2px 7px', fontWeight: 700, flexShrink: 0 }}>
                                                {opt.head_code}
                                            </span>
                                            <span style={{ fontSize: '13px', fontWeight: 500, wordBreak: 'break-word', lineHeight: '1.3' }}>
                                                {opt.head_name}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: '11px', color: badgeColor, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                            Select &rarr;
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// --- Modal: Default Live Auction Ledger Heads Configuration (Admin Only) ---
function DefaultLedgerSettingsModal({ isOpen, onClose, showToast, onSaved }) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [accountsData, setAccountsData] = useState({
        contribution_debit_heads: [],
        contribution_credit_heads: [],
        promise_debit_heads: [],
        promise_credit_heads: [],
        events: []
    });

    const [selectedEventId, setSelectedEventId] = useState('');
    const [selectedContribDr, setSelectedContribDr] = useState(null);
    const [selectedContribCr, setSelectedContribCr] = useState(null);
    const [selectedPromiseDr, setSelectedPromiseDr] = useState(null);
    const [selectedPromiseCr, setSelectedPromiseCr] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        api.get('/api/accounts/heads')
            .then(res => {
                if (res && res.success) {
                    setAccountsData(res);
                    const defs = res.default_heads || {};

                    // Event
                    let defEvt = null;
                    if (defs.event_id) {
                        defEvt = res.events.find(e => String(e.event_id) === String(defs.event_id));
                    }
                    if (!defEvt) {
                        defEvt = res.events.find(e => e.default_status === 'Yes') || res.events[0];
                    }
                    if (defEvt) {
                        setSelectedEventId(defEvt.event_id);
                    }

                    // Contrib Dr
                    const drCode = defs.contrib_dr_code || '02123';
                    const cDr = res.contribution_debit_heads.find(h => h.head_code === drCode) || res.contribution_debit_heads[0] || null;
                    setSelectedContribDr(cDr);

                    // Contrib Cr
                    const crCode = defs.contrib_cr_code || '02206';
                    const cCr = res.contribution_credit_heads.find(h => h.head_code === crCode) || res.contribution_credit_heads[0] || null;
                    setSelectedContribCr(cCr);

                    // Promise Dr
                    const pDrCode = defs.promise_dr_code || '08583';
                    const pDr = res.promise_debit_heads.find(h => h.head_code === pDrCode) || res.promise_debit_heads[0] || null;
                    setSelectedPromiseDr(pDr);

                    // Promise Cr
                    const pCrCode = defs.promise_cr_code || '07503';
                    const pCr = res.promise_credit_heads.find(h => h.head_code === pCrCode) || res.promise_credit_heads[0] || null;
                    setSelectedPromiseCr(pCr);
                }
            })
            .catch(err => {
                showToast('error', 'Failed to load ledger heads: ' + err.message);
            })
            .finally(() => setLoading(false));
    }, [isOpen]);

    const handleSave = async (e) => {
        e.preventDefault();
        if (!selectedContribDr || !selectedContribCr || !selectedPromiseDr || !selectedPromiseCr) {
            showToast('error', 'Please select all required default heads.');
            return;
        }

        const currentEvent = accountsData.events.find(ev => String(ev.event_id) === String(selectedEventId));
        setSaving(true);
        try {
            const payload = {
                event_id: currentEvent ? currentEvent.event_id : null,
                event_name: currentEvent ? currentEvent.event_name : null,
                contrib_dr_code: selectedContribDr.head_code,
                contrib_dr_name: selectedContribDr.head_name,
                contrib_cr_code: selectedContribCr.head_code,
                contrib_cr_name: selectedContribCr.head_name,
                promise_dr_code: selectedPromiseDr.head_code,
                promise_dr_name: selectedPromiseDr.head_name,
                promise_cr_code: selectedPromiseCr.head_code,
                promise_cr_name: selectedPromiseCr.head_name,
            };

            const res = await api.post('/api/accounts/default-heads', payload);
            if (res.success) {
                showToast('success', 'Default posting ledgers saved! Non-admin users will now automatically use these accounts.');
                if (typeof onSaved === 'function') {
                    onSaved(res.default_heads);
                }
                onClose();
            } else {
                showToast('error', res.error || 'Failed to save default heads.');
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div 
                className="modal-content" 
                style={{ width: '96%', maxWidth: '1080px', margin: 'auto', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} 
                onClick={e => e.stopPropagation()}
            >
                <ModalHeader 
                    title="Configure Default Live Auction Ledgers" 
                    icon="account_balance" 
                    onClose={onClose} 
                    badge="Admin Configuration"
                />

                {loading ? (
                    <div style={{ padding: '40px', textAlign: 'center' }}>
                        <div className="spinner" style={{ margin: '0 auto 12px auto' }}></div>
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading accounts and current defaults...</p>
                    </div>
                ) : (
                    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                        <div className="modal-body" style={{ overflowY: 'auto', padding: '20px 26px', flex: 1 }}>
                            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                                <i className="material-icons" style={{ color: 'var(--primary)', fontSize: '20px' }}>info</i>
                                <span>Set default church accounting heads. Non-admin users will automatically post to these ledgers on the Live Auction Desk and cannot change them.</span>
                            </div>
                            {/* Budget Event Head */}
                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label className="form-label" style={{ fontWeight: 700 }}>Default Budget Head / Event *</label>
                                <select 
                                    className="form-control"
                                    value={selectedEventId}
                                    onChange={e => setSelectedEventId(e.target.value)}
                                    required
                                >
                                    {accountsData.events.map(ev => (
                                        <option key={ev.event_id} value={ev.event_id}>
                                            {ev.event_name} {ev.default_status === 'Yes' ? '(Default)' : ''}
                                        </option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    Accounting event under which auction contributions & promises will be logged.
                                </div>
                            </div>

                            {/* Contribution Posting Defaults */}
                            <div style={{
                                background: 'rgba(16, 185, 129, 0.04)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderLeft: '4px solid #10b981',
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '16px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                                    <span className="badge badge-success" style={{ fontSize: '12px', padding: '4px 10px' }}>
                                        <i className="material-icons" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>receipt</i>
                                        Default Contribution Posting Heads (Receipt)
                                    </span>
                                </div>
                                <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '16px' }}>
                                    <SearchableHeadSelect
                                        label="Default Debit Head (Receiving Cash/Bank) *"
                                        placeholder="Search debit head (e.g. 02123)..."
                                        options={accountsData.contribution_debit_heads}
                                        selectedHead={selectedContribDr}
                                        onSelect={setSelectedContribDr}
                                        required={true}
                                        badgeColor="#3b82f6"
                                    />
                                    <SearchableHeadSelect
                                        label="Default Credit Head (Harvest / Auction Income) *"
                                        placeholder="Search credit head (e.g. 02206 or group 214)..."
                                        options={accountsData.contribution_credit_heads}
                                        selectedHead={selectedContribCr}
                                        onSelect={setSelectedContribCr}
                                        required={true}
                                        badgeColor="#10b981"
                                    />
                                </div>
                            </div>

                            {/* Promise Posting Defaults */}
                            <div style={{
                                background: 'rgba(245, 158, 11, 0.04)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                borderLeft: '4px solid #f59e0b',
                                borderRadius: '8px',
                                padding: '16px',
                                marginBottom: '12px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                                    <span className="badge badge-warning" style={{ fontSize: '12px', padding: '4px 10px' }}>
                                        <i className="material-icons" style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: '4px' }}>history_edu</i>
                                        Default Promise Posting Heads (Member Receivable)
                                    </span>
                                </div>
                                <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '16px' }}>
                                    <SearchableHeadSelect
                                        label="Default Debit Head (A/R Member Receivable) *"
                                        placeholder="Search debit head (e.g. 08583)..."
                                        options={accountsData.promise_debit_heads}
                                        selectedHead={selectedPromiseDr}
                                        onSelect={setSelectedPromiseDr}
                                        required={true}
                                        badgeColor="#f59e0b"
                                    />
                                    <SearchableHeadSelect
                                        label="Default Credit Head (Harvest Article Auction Income) *"
                                        placeholder="Search credit head (e.g. 07503)..."
                                        options={accountsData.promise_credit_heads}
                                        selectedHead={selectedPromiseCr}
                                        onSelect={setSelectedPromiseCr}
                                        required={true}
                                        badgeColor="#8b5cf6"
                                    />
                                </div>
                            </div>

                            <div style={{ background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                                <i className="material-icons" style={{ color: 'var(--primary)', fontSize: '18px' }}>info</i>
                                <span>When non-admin users submit an auction sale on the Live Auction Desk, the transaction will automatically be linked and posted to these exact heads.</span>
                            </div>
                        </div>

                        <div className="modal-footer" style={{ padding: '14px 24px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
                            <button type="submit" className="btn btn-primary" disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {saving ? (
                                    <>
                                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '14px', height: '14px' }}></span>
                                        Saving Defaults...
                                    </>
                                ) : (
                                    <>
                                        <i className="material-icons" style={{ fontSize: '16px' }}>check</i>
                                        Save Default Ledgers
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

// --- Live Auction Desk View ---
function AuctionDeskView({ year, showToast, onOpenReceipt, refreshTrigger, onDataChanged, isAdmin }) {
    const [transactions, setTransactions] = useState([]);
    const [availableArticles, setAvailableArticles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [recording, setRecording] = useState(false);
    const [paymentModalData, setPaymentModalData] = useState(null);
    const [ledgerSettingsOpen, setLedgerSettingsOpen] = useState(false);

    // Accounting heads data
    const [accountsData, setAccountsData] = useState({
        contribution_debit_heads: [],
        contribution_credit_heads: [],
        promise_debit_heads: [],
        promise_credit_heads: [],
        events: []
    });
    const [selectedEventId, setSelectedEventId] = useState('');

    // Contribution Posting heads
    const [selectedContribDr, setSelectedContribDr] = useState(null);
    const [selectedContribCr, setSelectedContribCr] = useState(null);

    // Promise Posting heads
    const [selectedPromiseDr, setSelectedPromiseDr] = useState(null);
    const [selectedPromiseCr, setSelectedPromiseCr] = useState(null);

    // Form states
    const [selectedArticleId, setSelectedArticleId] = useState('');
    const [articleSearch, setArticleSearch] = useState('');
    const [articleDropdownOpen, setArticleDropdownOpen] = useState(false);
    const articleDropdownRef = useRef(null);

    const [bidAmount, setBidAmount] = useState('');
    const [paidAmount, setPaidAmount] = useState('');
    const [receiptBookNo, setReceiptBookNo] = useState('');
    const [receiptNo, setReceiptNo] = useState('');
    const [memberSearch, setMemberSearch] = useState('');
    const [memberResults, setMemberResults] = useState([]);
    const [selectedMember, setSelectedMember] = useState(null);
    const [memberBalanceLoading, setMemberBalanceLoading] = useState(false);
    const [notes, setNotes] = useState('');

    const selectedArticle = useMemo(() => {
        return availableArticles.find(a => String(a.article_id) === String(selectedArticleId)) || null;
    }, [availableArticles, selectedArticleId]);

    const filteredArticles = useMemo(() => {
        if (!articleSearch.trim()) return availableArticles;
        const q = articleSearch.toLowerCase().trim();
        return availableArticles.filter(a => 
            String(a.tag_number || '').toLowerCase().includes(q) ||
            String(a.article_name || '').toLowerCase().includes(q) ||
            String(a.category || '').toLowerCase().includes(q) ||
            String(a.donor_name || '').toLowerCase().includes(q) ||
            String(a.article_number || '').toLowerCase().includes(q)
        );
    }, [availableArticles, articleSearch]);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (articleDropdownRef.current && !articleDropdownRef.current.contains(e.target)) {
                setArticleDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const fetchAuctionData = async () => {
        setLoading(true);
        try {
            const [transRes, artRes, accRes] = await Promise.all([
                api.get(`/api/auctions?year=${year}`),
                api.get(`/api/articles?year=${year}&status=Available`),
                api.get('/api/accounts/heads')
            ]);
            if (transRes.success) setTransactions(transRes.transactions);
            if (artRes.success) setAvailableArticles(artRes.articles);
            if (accRes && accRes.success) {
                setAccountsData(accRes);
                const defs = accRes.default_heads || {};

                // Initialize default Event
                let defEvt = null;
                if (defs.event_id) {
                    defEvt = accRes.events.find(e => String(e.event_id) === String(defs.event_id));
                }
                if (!defEvt) {
                    defEvt = accRes.events.find(e => e.default_status === 'Yes') || accRes.events[0];
                }
                if (defEvt && !selectedEventId) {
                    setSelectedEventId(defEvt.event_id);
                }

                // Default Contribution Debit Head
                const defContribDrCode = defs.contrib_dr_code || '02123';
                setSelectedContribDr(prev => {
                    if (prev) return prev;
                    return accRes.contribution_debit_heads.find(h => h.head_code === defContribDrCode) || accRes.contribution_debit_heads[0] || null;
                });

                // Default Contribution Credit Head
                const defContribCrCode = defs.contrib_cr_code || '02206';
                setSelectedContribCr(prev => {
                    if (prev) return prev;
                    return accRes.contribution_credit_heads.find(h => h.head_code === defContribCrCode) || accRes.contribution_credit_heads[0] || null;
                });

                // Default Promise Debit Head
                const defPromiseDrCode = defs.promise_dr_code || '08583';
                setSelectedPromiseDr(prev => {
                    if (prev) return prev;
                    return accRes.promise_debit_heads.find(h => h.head_code === defPromiseDrCode) || accRes.promise_debit_heads[0] || null;
                });

                // Default Promise Credit Head
                const defPromiseCrCode = defs.promise_cr_code || '07503';
                setSelectedPromiseCr(prev => {
                    if (prev) return prev;
                    return accRes.promise_credit_heads.find(h => h.head_code === defPromiseCrCode) || accRes.promise_credit_heads[0] || null;
                });
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    const [savingCurrentDefaults, setSavingCurrentDefaults] = useState(false);

    const handleSaveCurrentAsDefault = async () => {
        if (!isAdmin) return;
        if (!selectedContribDr || !selectedContribCr || !selectedPromiseDr || !selectedPromiseCr) {
            showToast('error', 'Please ensure all contribution and promise heads are selected.');
            return;
        }
        setSavingCurrentDefaults(true);
        try {
            const currentEvt = accountsData.events.find(e => String(e.event_id) === String(selectedEventId));
            const payload = {
                event_id: currentEvt ? currentEvt.event_id : null,
                event_name: currentEvt ? currentEvt.event_name : null,
                contrib_dr_code: selectedContribDr.head_code,
                contrib_dr_name: selectedContribDr.head_name,
                contrib_cr_code: selectedContribCr.head_code,
                contrib_cr_name: selectedContribCr.head_name,
                promise_dr_code: selectedPromiseDr.head_code,
                promise_dr_name: selectedPromiseDr.head_name,
                promise_cr_code: selectedPromiseCr.head_code,
                promise_cr_name: selectedPromiseCr.head_name,
            };
            const res = await api.post('/api/accounts/default-heads', payload);
            if (res.success) {
                showToast('success', 'Current heads successfully saved as default ledgers for all users!');
                fetchAuctionData();
            } else {
                showToast('error', res.error || 'Failed to save default heads.');
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setSavingCurrentDefaults(false);
        }
    };

    useEffect(() => {
        fetchAuctionData();
    }, [year, refreshTrigger]);

    useEffect(() => {
        if (memberSearch.trim().length > 1) {
            api.get(`/api/members/search?q=${encodeURIComponent(memberSearch)}`)
                .then(res => setMemberResults(res.members || []))
                .catch(() => {});
        } else {
            setMemberResults([]);
        }
    }, [memberSearch]);

    const handleSelectMember = (m) => {
        setSelectedMember({ ...m, outstanding_balance: null });
        setMemberSearch('');
        setMemberResults([]);
        setMemberBalanceLoading(true);

        api.get(`/api/members/${m.primary_member_id}/outstanding`)
            .then(res => {
                if (res.success) {
                    setSelectedMember(prev => {
                        if (!prev || prev.primary_member_id !== m.primary_member_id) return prev;
                        return {
                            ...prev,
                            outstanding_balance: Number(res.outstanding_balance || 0)
                        };
                    });
                }
            })
            .catch(err => {
                console.error("Failed to load member outstanding balance:", err);
            })
            .finally(() => {
                setMemberBalanceLoading(false);
            });
    };

    const handleSelectArticle = (art) => {
        setSelectedArticleId(art.article_id);
        setBidAmount('');
        setPaidAmount('');
        setArticleSearch('');
        setArticleDropdownOpen(false);
    };

    const handleClearArticle = () => {
        setSelectedArticleId('');
        setBidAmount('');
        setPaidAmount('');
        setArticleSearch('');
        setArticleDropdownOpen(false);
    };

    const handleRecordAuction = async (e) => {
        e.preventDefault();
        if (!selectedArticleId) {
            showToast('error', 'Please select an article to auction.');
            return;
        }

        if (!selectedMember) {
            showToast('error', 'Please search and select a Parish Member as the winning bidder.');
            return;
        }

        const bid = Number(bidAmount || 0);
        if (bid <= 0) {
            showToast('error', 'Winning bid amount must be greater than zero.');
            return;
        }

        const minReserve = selectedArticle ? Number(selectedArticle.reserve_price || 0) : 0;
        if (minReserve > 0 && bid < minReserve) {
            showToast('error', `Winning bid (BHD ${bid.toFixed(3)}) cannot be less than the Reserve Price of BHD ${minReserve.toFixed(3)}.`);
            return;
        }

        const paid = Number(paidAmount || 0);
        if (paid < 0) {
            showToast('error', 'Amount paid now cannot be negative.');
            return;
        }
        if (paid > bid) {
            showToast('error', `Amount paid now (BHD ${paid.toFixed(3)}) cannot exceed the winning bid amount (BHD ${bid.toFixed(3)}).`);
            return;
        }

        // Validation for contribution posting heads ONLY when amount is paid (> 0)
        if (paid > 0) {
            if (!selectedContribDr) {
                showToast('error', 'Please select a Debit Head for the Contribution Entry.');
                return;
            }
            if (!selectedContribCr) {
                showToast('error', 'Please select a Credit Head for the Contribution Entry.');
                return;
            }
        }

        // Validation for promise posting heads (always posted for winning bid amount)
        if (!selectedPromiseDr) {
            showToast('error', 'Please select a Debit Head for the Promise Posting.');
            return;
        }
        if (!selectedPromiseCr) {
            showToast('error', 'Please select a Credit Head for the Promise Posting.');
            return;
        }

        setRecording(true);
        try {
            const currentEvent = accountsData.events.find(ev => String(ev.event_id) === String(selectedEventId));

            const payload = {
                article_id: Number(selectedArticleId),
                applicable_year: Number(year),
                winning_bid_amount: bid,
                paid_amount: paid > 0 ? paid : 0,
                buyer_name: selectedMember.primary_member_name,
                buyer_member_id: selectedMember.primary_member_id,
                buyer_code_c: selectedMember.code_c,
                buyer_phone: selectedMember.bahrain_contact_no,
                notes: notes,
                auction_date: new Date().toISOString().split('T')[0],

                // Budget Event
                event_id: currentEvent ? currentEvent.event_id : null,
                event_name: currentEvent ? currentEvent.event_name : null,

                // Optional Manual Receipt Details (only if paid > 0)
                receipt_book_no: paid > 0 ? (receiptBookNo.trim() || '0') : '0',
                receipt_no: paid > 0 ? (receiptNo.trim() || '0') : '0',

                // Contribution Posting Heads (Receipt) - only if paid > 0
                contrib_dr_code: (paid > 0 && selectedContribDr) ? selectedContribDr.head_code : null,
                contrib_dr_name: (paid > 0 && selectedContribDr) ? selectedContribDr.head_name : null,
                contrib_cr_code: (paid > 0 && selectedContribCr) ? selectedContribCr.head_code : null,
                contrib_cr_name: (paid > 0 && selectedContribCr) ? selectedContribCr.head_name : null,

                // Promise Posting Heads (Receivable)
                promise_dr_code: selectedPromiseDr ? selectedPromiseDr.head_code : null,
                promise_dr_name: selectedPromiseDr ? selectedPromiseDr.head_name : null,
                promise_cr_code: selectedPromiseCr ? selectedPromiseCr.head_code : null,
                promise_cr_name: selectedPromiseCr ? selectedPromiseCr.head_name : null
            };

            const res = await api.post('/api/auctions', payload);
            if (res.success) {
                let successMsg = `Auction recorded! Ref: ${res.data.auction_ref_no}`;
                if (res.data.acc_contribution_id) {
                    successMsg += ` | Contrib ID: #${res.data.acc_contribution_id} (Receipt #${res.data.contrib_voucher_no})`;
                }
                if (res.data.acc_promise_id) {
                    successMsg += ` | Promise ID: #${res.data.acc_promise_id} (MP #${res.data.promise_voucher_no})`;
                }
                if (res.data.receipt_no) {
                    successMsg += ` | Receipt: #${res.data.receipt_no}`;
                }
                showToast('success', successMsg);

                // Reset form
                setSelectedArticleId('');
                setArticleSearch('');
                setArticleDropdownOpen(false);
                setBidAmount('');
                setPaidAmount('');
                setSelectedMember(null);
                setMemberBalanceLoading(false);
                setMemberSearch('');
                setNotes('');
                setReceiptBookNo('');
                setReceiptNo('');
                fetchAuctionData();
                if (typeof onDataChanged === 'function') {
                    onDataChanged();
                }

                // If receipt was generated, offer to open it
                if (res.data.receipt_no) {
                    onOpenReceipt(res.data.receipt_no);
                }
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setRecording(false);
        }
    };

    const currentBalance = Math.max(0, (Number(bidAmount) || 0) - (Number(paidAmount) || 0));
    const isPayingNow = Number(paidAmount || 0) > 0;
    const hasPromiseBalance = currentBalance > 0;
    const reservePrice = Number(selectedArticle?.reserve_price || 0);
    const isBelowReserve = Boolean(selectedArticle && reservePrice > 0 && bidAmount !== '' && Number(bidAmount) < reservePrice);
    const isPaidExceedingBid = Boolean(bidAmount !== '' && paidAmount !== '' && Number(paidAmount) > Number(bidAmount));

    return (
        <div>
            {/* Live Auction Entry Card */}
            <div className="card" style={{ marginBottom: '28px' }}>
                <div className="card-header" style={{ background: 'linear-gradient(90deg, rgba(245, 158, 11, 0.1), transparent)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <i className="material-icons" style={{ fontSize: '26px', color: 'var(--primary)' }}>gavel</i>
                        <div>
                            <h3>Live Auction Entry Desk ({year})</h3>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Record winning bids, assign buyers, print receipts and post contribution & promise entries directly to church accounts</p>
                        </div>
                    </div>
                    <span className="badge badge-warning">{availableArticles.length} Unsold Articles Ready</span>
                </div>

                <div className="card-body" style={{ padding: '16px 20px' }}>
                    <form onSubmit={handleRecordAuction}>
                        <div className="form-row auction-desk-form-row" style={{ gridTemplateColumns: 'minmax(280px, 2fr) minmax(130px, 1fr) minmax(140px, 1fr)', gap: '12px', alignItems: 'flex-start', marginBottom: '6px' }}>
                            {/* Article Searchable Selection */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Select Article to Auction *</span>
                                    {selectedArticle && (
                                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                            Tag: <strong style={{ color: 'var(--primary)' }}>{selectedArticle.tag_number || `#${selectedArticle.article_id}`}</strong> &nbsp;|&nbsp;
                                            Art No: <strong style={{ color: 'var(--primary)', fontFamily: 'monospace' }}>{selectedArticle.article_number || `ART-${selectedArticle.article_id}`}</strong>
                                        </span>
                                    )}
                                </label>

                                {selectedArticle ? (
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        background: 'rgba(245, 158, 11, 0.08)',
                                        border: '1px solid rgba(245, 158, 11, 0.35)',
                                        padding: '12px 16px',
                                        borderRadius: '8px',
                                        gap: '12px'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <span className="badge badge-warning" style={{ fontSize: '13px', padding: '4px 8px', whiteSpace: 'nowrap' }}>
                                                    {selectedArticle.tag_number ? `Tag #${selectedArticle.tag_number}` : `ID #${selectedArticle.article_id}`}
                                                </span>
                                                {selectedArticle.article_number && (
                                                    <span className="badge badge-secondary" style={{ fontSize: '11px', padding: '2px 6px', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                        {selectedArticle.article_number}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: '15px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {selectedArticle.article_name}
                                                </div>
                                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                    {selectedArticle.category && (
                                                        <span>Category: <strong>{selectedArticle.category}</strong></span>
                                                    )}
                                                    <span>Est. Value: <strong>BHD {Number(selectedArticle.estimated_value || 0).toFixed(3)}</strong></span>
                                                    {Number(selectedArticle.reserve_price) > 0 && (
                                                        <span>Reserve: <strong>BHD {Number(selectedArticle.reserve_price).toFixed(3)}</strong></span>
                                                    )}
                                                    <span>Donor: <strong>{selectedArticle.donor_name || 'Well-Wisher'}</strong></span>
                                                </div>
                                            </div>
                                        </div>
                                        <button 
                                            type="button" 
                                            className="btn btn-secondary btn-sm" 
                                            onClick={handleClearArticle}
                                            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' }}
                                        >
                                            <i className="material-icons" style={{ fontSize: '16px' }}>swap_horiz</i>
                                            Change Article
                                        </button>
                                    </div>
                                ) : (
                                    <div ref={articleDropdownRef} style={{ position: 'relative' }}>
                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                            <i className="material-icons" style={{
                                                position: 'absolute',
                                                left: '12px',
                                                color: 'var(--text-muted)',
                                                fontSize: '20px',
                                                pointerEvents: 'none'
                                            }}>search</i>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                style={{ paddingLeft: '38px', paddingRight: articleSearch ? '36px' : '12px' }}
                                                placeholder={availableArticles.length === 0 ? "No available articles to auction for this year" : "Search by Tag No, Name, Category, or Donor..."}
                                                disabled={availableArticles.length === 0}
                                                value={articleSearch}
                                                onFocus={() => setArticleDropdownOpen(true)}
                                                onChange={e => {
                                                    setArticleSearch(e.target.value);
                                                    setArticleDropdownOpen(true);
                                                }}
                                            />
                                            {articleSearch && (
                                                <button
                                                    type="button"
                                                    onClick={() => setArticleSearch('')}
                                                    style={{
                                                        position: 'absolute',
                                                        right: '10px',
                                                        background: 'transparent',
                                                        border: 'none',
                                                        color: 'var(--text-muted)',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center'
                                                    }}
                                                    title="Clear search"
                                                >
                                                    <i className="material-icons" style={{ fontSize: '18px' }}>close</i>
                                                </button>
                                            )}
                                        </div>

                                        {articleDropdownOpen && (
                                            <div className="member-search-dropdown" style={{
                                                position: 'absolute',
                                                top: 'calc(100% + 4px)',
                                                left: 0,
                                                right: 0,
                                                zIndex: 150,
                                                maxHeight: '260px',
                                                overflowY: 'auto'
                                            }}>
                                                {filteredArticles.length === 0 ? (
                                                    <div style={{ padding: '14px 16px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
                                                        {availableArticles.length === 0 ? (
                                                            <span>No unsold articles available in {year}.</span>
                                                        ) : (
                                                            <span>No articles match &ldquo;<strong>{articleSearch}</strong>&rdquo;</span>
                                                        )}
                                                    </div>
                                                ) : (
                                                    filteredArticles.map(a => (
                                                        <div 
                                                            key={a.article_id}
                                                            className="member-search-item"
                                                            onClick={() => handleSelectArticle(a)}
                                                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}
                                                        >
                                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px', flexWrap: 'wrap' }}>
                                                                    <span className="badge badge-warning" style={{ fontSize: '11px', padding: '2px 6px' }}>
                                                                        {a.tag_number ? `Tag #${a.tag_number}` : `#${a.article_id}`}
                                                                    </span>
                                                                    {a.article_number && (
                                                                        <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '2px 6px', fontFamily: 'monospace' }}>
                                                                            {a.article_number}
                                                                        </span>
                                                                    )}
                                                                    <span className="member-search-item-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                                        {a.article_name}
                                                                    </span>
                                                                </div>
                                                                <div className="member-search-item-subtitle" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                                                    {a.category && <span>Cat: <strong>{a.category}</strong></span>}
                                                                    <span>Est: <strong>BHD {Number(a.estimated_value || 0).toFixed(3)}</strong></span>
                                                                    {Number(a.reserve_price) > 0 && <span>Res: <strong>BHD {Number(a.reserve_price).toFixed(3)}</strong></span>}
                                                                    <span>Donor: <em>{a.donor_name || 'Well-Wisher'}</em></span>
                                                                </div>
                                                            </div>
                                                            <div style={{ fontSize: '11px', color: 'var(--primary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                                Select &rarr;
                                                            </div>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Winning Bid */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Winning Bid (BHD) *</span>
                                    {selectedArticle && reservePrice > 0 && (
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            Reserve: <strong style={{ color: 'var(--primary)' }}>BHD {reservePrice.toFixed(3)}</strong>
                                        </span>
                                    )}
                                </label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    min={selectedArticle && reservePrice > 0 ? reservePrice : 0.001}
                                    className="form-control" 
                                    style={{ 
                                        fontSize: '18px', 
                                        fontWeight: 'bold', 
                                        color: isBelowReserve ? 'var(--danger)' : 'var(--primary)',
                                        borderColor: isBelowReserve ? 'var(--danger)' : undefined,
                                        boxShadow: isBelowReserve ? '0 0 0 1px var(--danger)' : undefined
                                    }}
                                    placeholder="0.000"
                                    data-currency="true"
                                    required 
                                    value={bidAmount}
                                    onFocus={() => handleCurrencyFocus(bidAmount, setBidAmount)}
                                    onChange={e => setBidAmount(e.target.value)}
                                />
                                {isBelowReserve && (
                                    <div style={{ color: 'var(--danger)', fontSize: '11px', marginTop: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <i className="material-icons" style={{ fontSize: '14px' }}>error_outline</i>
                                        Cannot be lower than Reserve Price (BHD {reservePrice.toFixed(3)})
                                    </div>
                                )}
                            </div>

                            {/* Paid Now */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Amount Paid Now (BHD)</span>
                                    {isPayingNow ? (
                                        <span className="badge badge-success" style={{ fontSize: '10px', padding: '2px 6px' }}>Posting Receipt</span>
                                    ) : (
                                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Leave 0 for Promise</span>
                                    )}
                                </label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    min="0"
                                    max={bidAmount !== '' ? Number(bidAmount) : undefined}
                                    className="form-control" 
                                    style={{ 
                                        fontSize: '18px', 
                                        fontWeight: 'bold', 
                                        color: isPaidExceedingBid ? 'var(--danger)' : (isPayingNow ? 'var(--success)' : 'var(--text-secondary)'),
                                        borderColor: isPaidExceedingBid ? 'var(--danger)' : undefined,
                                        boxShadow: isPaidExceedingBid ? '0 0 0 1px var(--danger)' : undefined
                                    }}
                                    placeholder="0.000"
                                    data-currency="true"
                                    value={paidAmount}
                                    onFocus={() => handleCurrencyFocus(paidAmount, setPaidAmount)}
                                    onChange={e => setPaidAmount(e.target.value)}
                                />
                                {isPaidExceedingBid && (
                                    <div style={{ color: 'var(--danger)', fontSize: '11px', marginTop: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <i className="material-icons" style={{ fontSize: '14px' }}>error_outline</i>
                                        Amount paid cannot exceed winning bid (BHD {(Number(bidAmount) || 0).toFixed(3)})
                                    </div>
                                )}
                                <div style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-muted)' }}>
                                    Balance Due: <strong>BHD {currentBalance.toFixed(3)}</strong>
                                    {' '}(Winning Bid: BHD {(Number(bidAmount) || 0).toFixed(3)} posted as Promise)
                                    {selectedMember && selectedMember.outstanding_balance !== null && selectedMember.outstanding_balance !== undefined && (
                                        <span style={{ marginLeft: '8px', color: Number(selectedMember.outstanding_balance) > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                                            • Member Existing Due: BHD {Number(selectedMember.outstanding_balance).toFixed(3)}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Parish Member Buyer Details */}
                        <div style={{ background: 'rgba(0,0,0,0.03)', padding: '10px 14px', borderRadius: '8px', margin: '8px 0', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <label className="form-label" style={{ margin: 0 }}>Winning Bidder (Parish Member) *</label>
                                {selectedMember && (
                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                        Roll No: <strong style={{ color: 'var(--primary)' }}>{selectedMember.code_c}</strong>
                                    </span>
                                )}
                            </div>

                            {selectedMember ? (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    background: 'rgba(16, 185, 129, 0.08)',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    flexWrap: 'wrap',
                                    gap: '14px'
                                }}>
                                    <div style={{ minWidth: '220px', flex: '1 1 auto' }}>
                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '15px' }}>{selectedMember.primary_member_name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                            Roll No: <strong style={{ color: 'var(--primary)' }}>{selectedMember.code_c}</strong> &nbsp;|&nbsp;
                                            CPR: {selectedMember.cpr_no || 'NA'} &nbsp;|&nbsp;
                                            Phone: {selectedMember.bahrain_contact_no || 'NA'} &nbsp;|&nbsp;
                                            {selectedMember.prayer_group_name || ''}
                                        </div>
                                    </div>

                                    {/* Populated Member Outstanding Balance */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        background: Number(selectedMember.outstanding_balance || 0) > 0 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                                        border: `1px solid ${Number(selectedMember.outstanding_balance || 0) > 0 ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`,
                                        padding: '7px 14px',
                                        borderRadius: '8px',
                                        minWidth: '180px'
                                    }}>
                                        <i className="material-icons" style={{ fontSize: '24px', color: Number(selectedMember.outstanding_balance || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                                            account_balance_wallet
                                        </i>
                                        <div>
                                            <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700, color: 'var(--text-muted)' }}>
                                                Outstanding Balance
                                            </div>
                                            <div style={{ fontSize: '16px', fontWeight: 800, color: Number(selectedMember.outstanding_balance || 0) > 0 ? 'var(--danger)' : 'var(--success)' }}>
                                                {memberBalanceLoading ? (
                                                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                                                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '12px', height: '12px', marginRight: '6px', borderWidth: '2px', display: 'inline-block' }}></span>
                                                        Fetching balance...
                                                    </span>
                                                ) : (
                                                    `BHD ${Number(selectedMember.outstanding_balance || 0).toFixed(3)}`
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    <button 
                                        type="button" 
                                        className="btn btn-secondary btn-sm" 
                                        onClick={() => {
                                            setSelectedMember(null);
                                            setMemberBalanceLoading(false);
                                        }}
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        <i className="material-icons" style={{ fontSize: '15px' }}>swap_horiz</i>
                                        Change Member
                                    </button>
                                </div>
                            ) : (
                                <div>
                                    <input 
                                        type="text" 
                                        className="form-control" 
                                        placeholder="Search member by name or roll number..."
                                        value={memberSearch}
                                        onChange={e => setMemberSearch(e.target.value)}
                                    />
                                    {memberResults.length > 0 && (
                                        <div className="member-search-dropdown">
                                            {memberResults.map(m => (
                                                <div 
                                                    key={m.primary_member_id}
                                                    className="member-search-item"
                                                    onClick={() => handleSelectMember(m)}
                                                >
                                                    <div className="member-search-item-title">{m.primary_member_name}</div>
                                                    <div className="member-search-item-subtitle">
                                                        Roll No: <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{m.code_c}</span> | CPR: {m.cpr_no} | Phone: {m.bahrain_contact_no}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Floor Notes / Auctioneer Remarks */}
                        <div className="form-group" style={{ marginBottom: '10px' }}>
                            <label className="form-label" style={{ marginBottom: '4px' }}>Floor Notes / Auctioneer Remarks (Optional)</label>
                            <input 
                                type="text" 
                                className="form-control" 
                                placeholder="Special remarks if any"
                                value={notes} 
                                onChange={e => setNotes(e.target.value)}
                            />
                        </div>

                        {/* ========================================================================= */}
                        {/* ACCOUNTING POSTING HEADS SECTION (Budget, Contribution & Promise)         */}
                        {/* ========================================================================= */}
                        <div style={{
                            marginTop: '8px',
                            marginBottom: '14px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            padding: '12px 16px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <i className="material-icons" style={{ color: 'var(--primary)', fontSize: '22px' }}>account_balance</i>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Accounts Ledger Posting Heads</h4>
                                            {isAdmin ? (
                                                <span className="badge badge-primary" style={{ fontSize: '10px', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <i className="material-icons" style={{ fontSize: '12px' }}>admin_panel_settings</i>
                                                    Admin Access • Editable
                                                </span>
                                            ) : (
                                                <span className="badge badge-secondary" style={{ fontSize: '10px', padding: '2px 6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <i className="material-icons" style={{ fontSize: '12px' }}>lock</i>
                                                    Preset by Administrator
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            {isAdmin 
                                                ? (isPayingNow 
                                                    ? 'Posting heads for automated Contribution (Receipt) & Promise (Receivable) entries to church accounts' 
                                                    : 'Posting heads for automated Promise (Receivable) entry to church accounts (No floor payment)')
                                                : 'Default posting heads configured by Administrator. Transactions are automatically posted to these accounts.'}
                                        </div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                    {isAdmin && (
                                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                            <button
                                                type="button"
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setLedgerSettingsOpen(true)}
                                                style={{ fontSize: '11px', padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                title="Open settings modal to view and configure default ledgers"
                                            >
                                                <i className="material-icons" style={{ fontSize: '15px' }}>settings</i>
                                                Configure Defaults
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-primary btn-sm"
                                                onClick={handleSaveCurrentAsDefault}
                                                disabled={savingCurrentDefaults}
                                                style={{ fontSize: '11px', padding: '4px 9px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                                title="Save the currently selected heads below as the system default for all other users"
                                            >
                                                <i className="material-icons" style={{ fontSize: '15px' }}>done_all</i>
                                                {savingCurrentDefaults ? 'Saving...' : 'Set Current as Default'}
                                            </button>
                                        </div>
                                    )}

                                    {/* Budget Head / Event */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '220px' }}>
                                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Budget Head:</label>
                                        {isAdmin ? (
                                            <select
                                                className="form-control"
                                                style={{ height: '34px', fontSize: '12px', padding: '4px 8px' }}
                                                value={selectedEventId}
                                                onChange={e => setSelectedEventId(e.target.value)}
                                            >
                                                {accountsData.events.map(ev => (
                                                    <option key={ev.event_id} value={ev.event_id}>
                                                        {ev.event_name} {ev.default_status === 'Yes' ? '(Default)' : ''}
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', background: 'rgba(0,0,0,0.04)', padding: '5px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                <i className="material-icons" style={{ fontSize: '14px', color: 'var(--text-muted)' }}>event</i>
                                                {accountsData.events.find(e => String(e.event_id) === String(selectedEventId))?.event_name || 'Default Budget Event'}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Section 1: Contribution Posting Heads (Receipt) - ONLY DISPLAYED IF isPayingNow (paid amount > 0) */}
                            {isPayingNow && (
                                <div className="accounting-section-box active-posting" style={{
                                    opacity: 1,
                                    background: 'rgba(16, 185, 129, 0.04)',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    borderLeft: '4px solid #10b981',
                                    borderRadius: '8px',
                                    padding: '12px 14px',
                                    marginBottom: '12px'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span className="badge badge-success" style={{ fontSize: '11px', padding: '3px 8px' }}>
                                                <i className="material-icons" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '4px' }}>receipt</i>
                                                Contribution Entry (Receipt Posting)
                                            </span>
                                            {!isAdmin && (
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                    <i className="material-icons" style={{ fontSize: '13px' }}>lock</i>
                                                    Fixed Default
                                                </span>
                                            )}
                                        </div>
                                        <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)' }}>
                                            Posting Amount: BHD {Number(paidAmount).toFixed(3)}
                                        </span>
                                    </div>

                                    {isAdmin ? (
                                        <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
                                            <SearchableHeadSelect
                                                label="Debit Head (Receiving Cash/Bank) *"
                                                placeholder="Search contribution debit head (e.g. 02123)..."
                                                options={accountsData.contribution_debit_heads}
                                                selectedHead={selectedContribDr}
                                                onSelect={setSelectedContribDr}
                                                required={true}
                                                badgeColor="#3b82f6"
                                            />
                                            <SearchableHeadSelect
                                                label="Credit Head (Harvest / Auction Income) *"
                                                placeholder="Search contribution credit head (e.g. 02206)..."
                                                options={accountsData.contribution_credit_heads}
                                                selectedHead={selectedContribCr}
                                                onSelect={setSelectedContribCr}
                                                required={true}
                                                badgeColor="#10b981"
                                            />
                                        </div>
                                    ) : (
                                        <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                                            <div style={{ background: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.25)', padding: '10px 14px', borderRadius: '8px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    Debit Head (Receiving Cash/Bank)
                                                </div>
                                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                                                    <span className="badge badge-primary" style={{ marginRight: '6px', fontSize: '11px' }}>
                                                        {selectedContribDr ? selectedContribDr.head_code : '02123'}
                                                    </span>
                                                    {selectedContribDr ? selectedContribDr.head_name : 'Cash on Hand-Harvest Festival'}
                                                </div>
                                            </div>
                                            <div style={{ background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.25)', padding: '10px 14px', borderRadius: '8px' }}>
                                                <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                    Credit Head (Harvest / Auction Income)
                                                </div>
                                                <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                                                    <span className="badge badge-success" style={{ marginRight: '6px', fontSize: '11px' }}>
                                                        {selectedContribCr ? selectedContribCr.head_code : '02206'}
                                                    </span>
                                                    {selectedContribCr ? selectedContribCr.head_name : 'Church Building Fund - Harvest Festival'}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label" style={{ fontSize: '11px', fontWeight: 600 }}>Manual Receipt Book No (Optional)</label>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                style={{ height: '36px', fontSize: '13px' }}
                                                placeholder="e.g. 14" 
                                                value={receiptBookNo} 
                                                onChange={e => setReceiptBookNo(e.target.value)} 
                                            />
                                        </div>
                                        <div className="form-group" style={{ margin: 0 }}>
                                            <label className="form-label" style={{ fontSize: '11px', fontWeight: 600 }}>Manual Receipt No (Optional)</label>
                                            <input 
                                                type="text" 
                                                className="form-control" 
                                                style={{ height: '36px', fontSize: '13px' }}
                                                placeholder="e.g. 250" 
                                                value={receiptNo} 
                                                onChange={e => setReceiptNo(e.target.value)} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Section 2: Promise Posting Heads (Receivable) */}
                            <div className="accounting-section-box active-promise" style={{
                                opacity: 1,
                                background: 'rgba(245, 158, 11, 0.03)',
                                borderLeft: '4px solid #f59e0b',
                                marginBottom: 0
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge badge-warning" style={{ fontSize: '11px', padding: '3px 8px' }}>
                                            <i className="material-icons" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '4px' }}>history_edu</i>
                                            Promise Posting (Member Receivable Entry)
                                        </span>
                                        {!isAdmin && (
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                                <i className="material-icons" style={{ fontSize: '13px' }}>lock</i>
                                                Fixed Default
                                            </span>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--warning)' }}>
                                        Promise Amount: BHD {(Number(bidAmount) || 0).toFixed(3)} | Balance Due: BHD {currentBalance.toFixed(3)}
                                    </span>
                                </div>

                                {isAdmin ? (
                                    <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' }}>
                                        <SearchableHeadSelect
                                            label="Debit Head (A/R Member Receivable) *"
                                            placeholder="Search promise debit head (e.g. 08583)..."
                                            options={accountsData.promise_debit_heads}
                                            selectedHead={selectedPromiseDr}
                                            onSelect={setSelectedPromiseDr}
                                            required={true}
                                            badgeColor="#f59e0b"
                                        />
                                        <SearchableHeadSelect
                                            label="Credit Head (Harvest Article Auction Income) *"
                                            placeholder="Search promise credit head (e.g. 07503)..."
                                            options={accountsData.promise_credit_heads}
                                            selectedHead={selectedPromiseCr}
                                            onSelect={setSelectedPromiseCr}
                                            required={true}
                                            badgeColor="#8b5cf6"
                                        />
                                    </div>
                                ) : (
                                    <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                                        <div style={{ background: 'rgba(245, 158, 11, 0.05)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '10px 14px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Debit Head (A/R Member Receivable)
                                            </div>
                                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                                                <span className="badge badge-warning" style={{ marginRight: '6px', fontSize: '11px' }}>
                                                    {selectedPromiseDr ? selectedPromiseDr.head_code : '08583'}
                                                </span>
                                                {selectedPromiseDr ? selectedPromiseDr.head_name : 'Harvest Festival Auction Receivable'}
                                            </div>
                                        </div>
                                        <div style={{ background: 'rgba(139, 92, 246, 0.05)', border: '1px solid rgba(139, 92, 246, 0.25)', padding: '10px 14px', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Credit Head (Harvest Article Auction Income)
                                            </div>
                                            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                                                <span className="badge" style={{ marginRight: '6px', fontSize: '11px', background: '#8b5cf6', color: '#fff' }}>
                                                    {selectedPromiseCr ? selectedPromiseCr.head_code : '07503'}
                                                </span>
                                                {selectedPromiseCr ? selectedPromiseCr.head_name : 'Harvest Festival - Article Auction'}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
                            <button type="submit" className="btn btn-success btn-lg" disabled={recording || !selectedArticleId}>
                                <i className="material-icons">check_circle</i> {recording ? 'Processing Bid & Posting Ledger...' : 'Confirm Winning Bid & Generate Receipt'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {/* Auction Transactions Log DataTable */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                    <div>
                        <h3>Recent Auction Transactions ({year})</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Browse, search, sort, and record settlements on auction ledger sales</p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => {
                                fetchAuctionData();
                                if (typeof onDataChanged === 'function') onDataChanged();
                            }} 
                            title="Reload Transactions Table"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                            <i className="material-icons" style={{ fontSize: '16px' }}>refresh</i> Reload Table
                        </button>
                        <span className="badge badge-info">{transactions.length} Total Sales</span>
                    </div>
                </div>
                
                <DataTable 
                    columns={[
                        {
                            header: 'SL No',
                            id: 'sl_no',
                            searchable: false,
                            sortable: false,
                            headerStyle: { width: '60px', textAlign: 'center' },
                            style: { textAlign: 'center', width: '60px', fontWeight: 600, color: 'var(--text-muted)' },
                            footer: () => (
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700 }}>
                                    Total
                                </span>
                            ),
                            render: (t, index) => <span style={{ fontSize: '12px' }}>{index + 1}</span>
                        },
                        {
                            header: 'Auction Ref',
                            accessor: 'auction_ref_no',
                            sortable: true,
                            footer: (allRows) => (
                                <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    {allRows.length} Sales (All Pages)
                                </span>
                            ),
                            render: (t) => <strong style={{ color: 'var(--text-primary)' }}>{t.auction_ref_no}</strong>
                        },
                        {
                            header: 'Date',
                            accessor: 'auction_date',
                            sortable: true,
                            footer: () => null,
                            render: (t) => formatDateDMY(t.auction_date)
                        },
                        {
                            header: 'Tag No & Tag Name',
                            accessor: 'article_name',
                            sortable: true,
                            searchValue: (t) => `${t.tag_number || ''} ${t.article_name || ''} ${t.article_number || ''} ${t.category || ''} ${t.donor_name || ''}`,
                            footer: () => null,
                            render: (t) => (
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                        <span className="tag-badge" title="Tag Number">{t.tag_number}</span>
                                        {t.article_number && (
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '4px' }}>
                                                {t.article_number}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontWeight: 600 }} title="Tag Name / Article Title">{t.article_name}</div>
                                </div>
                            )
                        },
                        {
                            header: 'Buyer Details',
                            accessor: 'buyer_name',
                            sortable: true,
                            searchValue: (t) => `${t.buyer_name || ''} ${t.buyer_code_c || ''} ${t.buyer_phone || ''} ${t.buyer_cpr || ''} ${t.member_mobile || ''}`,
                            footer: () => null,
                            render: (t) => (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-primary)' }}>
                                        {t.buyer_name}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                                        {t.buyer_code_c && (
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Parish Member Roll Number">
                                                <i className="material-icons" style={{ fontSize: '13px', color: 'var(--primary)' }}>badge</i>
                                                <span>Roll No: <strong style={{ color: 'var(--text-primary)' }}>{t.buyer_code_c}</strong></span>
                                            </div>
                                        )}
                                        {t.buyer_phone && (
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Contact Mobile Number">
                                                <i className="material-icons" style={{ fontSize: '13px', color: '#10b981' }}>phone</i>
                                                <span>Mobile: <strong style={{ color: 'var(--text-primary)' }}>{t.buyer_phone}</strong></span>
                                            </div>
                                        )}
                                        {t.buyer_cpr && t.buyer_cpr !== '0' && (
                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }} title="Civil Population Registration (CPR)">
                                                <i className="material-icons" style={{ fontSize: '13px', color: '#f59e0b' }}>credit_card</i>
                                                <span>CPR: <strong style={{ color: 'var(--text-primary)' }}>{t.buyer_cpr}</strong></span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )
                        },
                        {
                            header: 'Winning Bid',
                            accessor: 'winning_bid_amount',
                            sortable: true,
                            sortValue: (t) => Number(t.winning_bid_amount) || 0,
                            footer: (allRows) => {
                                const totalWinning = allRows.reduce((sum, t) => sum + (Number(t.winning_bid_amount) || 0), 0);
                                return (
                                    <div className="dt-footer-amount-box">
                                        <span className="dt-footer-amount-label">Winning Total</span>
                                        <span className="dt-footer-amount-val" style={{ color: 'var(--primary)' }}>
                                            BHD {totalWinning.toFixed(3)}
                                        </span>
                                    </div>
                                );
                            },
                            render: (t) => <strong style={{ color: 'var(--text-primary)' }}>BHD {Number(t.winning_bid_amount).toFixed(3)}</strong>
                        },
                        {
                            header: 'Paid',
                            accessor: 'paid_amount',
                            sortable: true,
                            sortValue: (t) => Number(t.paid_amount) || 0,
                            footer: (allRows) => {
                                const totalPaid = allRows.reduce((sum, t) => sum + (Number(t.paid_amount) || 0), 0);
                                return (
                                    <div className="dt-footer-amount-box">
                                        <span className="dt-footer-amount-label">Paid Total</span>
                                        <span className="dt-footer-amount-val" style={{ color: 'var(--success)' }}>
                                            BHD {totalPaid.toFixed(3)}
                                        </span>
                                    </div>
                                );
                            },
                            render: (t) => <span style={{ color: 'var(--success)', fontWeight: 600 }}>{Number(t.paid_amount).toFixed(3)}</span>
                        },
                        {
                            header: 'Balance',
                            accessor: 'balance_amount',
                            sortable: true,
                            sortValue: (t) => Number(t.balance_amount) || 0,
                            footer: (allRows) => {
                                const totalBalance = allRows.reduce((sum, t) => sum + (Number(t.balance_amount) || 0), 0);
                                return (
                                    <div className="dt-footer-amount-box">
                                        <span className="dt-footer-amount-label">Balance Total</span>
                                        <span className="dt-footer-amount-val" style={{ color: totalBalance > 0.0001 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                            BHD {totalBalance.toFixed(3)}
                                        </span>
                                    </div>
                                );
                            },
                            render: (t) => (
                                <span style={{ color: Number(t.balance_amount) > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                                    {Number(t.balance_amount).toFixed(3)}
                                </span>
                            )
                        },
                        {
                            header: 'Account Posting',
                            id: 'account_posting',
                            sortable: false,
                            footer: () => null,
                            searchValue: (t) => {
                                const cvs = (t.contributions || []).map(c => `Receipt HRCPT ${c.voucher_no || ''} ${c.contribution_amount || ''} ${c.receipt_no || ''}`).join(' ');
                                const pvs = (t.promises || []).map(p => `MP ${p.voucher_no || ''} ${p.promise_amount || ''}`).join(' ');
                                return `${cvs} ${pvs} ${t.contrib_voucher_no || ''} ${t.promise_voucher_no || ''} ${t.manual_receipt_no || ''} ${t.receipt_book_no || ''}`;
                            },
                            render: (t) => {
                                const contribs = (t.contributions && t.contributions.length > 0) 
                                    ? t.contributions 
                                    : (t.contrib_voucher_no ? [{
                                        voucher_no: t.contrib_voucher_no,
                                        contribution_amount: t.paid_amount,
                                        contribution_date: t.auction_date,
                                        receipt_no: t.receipt_no || t.manual_receipt_no
                                    }] : []);

                                const promises = (t.promises && t.promises.length > 0) 
                                    ? t.promises 
                                    : (t.promise_voucher_no ? [{
                                        voucher_no: t.promise_voucher_no,
                                        promise_amount: t.balance_amount,
                                        balance_amount: t.balance_amount
                                    }] : []);

                                const hasContribs = contribs.length > 0;
                                const hasPromises = promises.length > 0;

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '160px' }}>
                                        {/* Contribution Voucher Badges from acc_contribution (Clickable to view/print receipt) */}
                                        {contribs.map((c, cIdx) => (
                                            <button
                                                type="button"
                                                key={c.contribution_id ? `cid_${c.contribution_id}` : `c_${cIdx}_${c.voucher_no}`}
                                                className="badge badge-success voucher-clickable-badge"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onOpenReceipt(c.receipt_no || c.voucher_no || c.contribution_id);
                                                }}
                                                style={{
                                                    fontSize: '11px',
                                                    padding: '3px 7px',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    cursor: 'pointer',
                                                    border: '1px solid rgba(16, 185, 129, 0.4)',
                                                    background: 'rgba(16, 185, 129, 0.12)',
                                                    color: '#10b981',
                                                    borderRadius: '6px',
                                                    fontWeight: 600,
                                                    textAlign: 'left',
                                                    width: 'fit-content'
                                                }}
                                                title={`Click to view & print official receipt #${c.voucher_no}`}
                                            >
                                                <i className="material-icons" style={{ fontSize: '13px' }}>receipt</i>
                                                <span>Receipt #{c.voucher_no}</span>
                                                {Number(c.contribution_amount) > 0 && (
                                                    <span>• BHD {Number(c.contribution_amount).toFixed(3)}</span>
                                                )}
                                                {c.contribution_date && (
                                                    <span style={{ fontSize: '10px', opacity: 0.85 }}>• {formatDateDMY(c.contribution_date)}</span>
                                                )}
                                            </button>
                                        ))}

                                        {/* Promise Voucher Badges from acc_promises */}
                                        {promises.map((p, pIdx) => (
                                            <span
                                                key={p.promise_id ? `pid_${p.promise_id}` : `p_${pIdx}_${p.voucher_no}`}
                                                className="badge badge-warning"
                                                style={{
                                                    fontSize: '11px',
                                                    padding: '3px 7px',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    borderRadius: '6px',
                                                    fontWeight: 600,
                                                    border: '1px solid rgba(245, 158, 11, 0.4)',
                                                    background: 'rgba(245, 158, 11, 0.12)',
                                                    color: '#f59e0b',
                                                    width: 'fit-content'
                                                }}
                                                title={`Cathedral Promise Receivable Voucher #${p.voucher_no} | Original: BHD ${Number(p.promise_amount || 0).toFixed(3)} | Due: BHD ${Number(p.balance_amount || 0).toFixed(3)}`}
                                            >
                                                <i className="material-icons" style={{ fontSize: '13px' }}>history_edu</i>
                                                <span>MP #{p.voucher_no}</span>
                                                {Number(p.promise_amount) > 0 && (
                                                    <span>• BHD {Number(p.promise_amount).toFixed(3)}</span>
                                                )}
                                            </span>
                                        ))}

                                        {/* Optional Manual Receipt Reference */}
                                        {(t.manual_receipt_no || t.receipt_book_no) && (
                                            <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                                                Rcpt: {t.receipt_book_no ? `Bk ${t.receipt_book_no} ` : ''}#{t.manual_receipt_no}
                                            </span>
                                        )}

                                        {!hasContribs && !hasPromises && (
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
                                        )}
                                    </div>
                                );
                            }
                        },
                        {
                            header: 'Status',
                            accessor: 'payment_status',
                            sortable: true,
                            footer: (allRows) => {
                                const paidCount = allRows.filter(t => t.payment_status === 'Paid').length;
                                const dueCount = allRows.length - paidCount;
                                return (
                                    <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ color: 'var(--success)', fontWeight: 700 }}>{paidCount} Settled</span>
                                        {dueCount > 0 && <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{dueCount} Due</span>}
                                    </div>
                                );
                            },
                            render: (t) => (
                                <span className={`badge badge-${
                                    t.payment_status === 'Paid' ? 'success' :
                                    t.payment_status === 'Partial' ? 'warning' : 'danger'
                                }`}>
                                    {t.payment_status}
                                </span>
                            )
                        },
                        {
                            header: 'Actions',
                            id: 'actions',
                            sortable: false,
                            headerStyle: { textAlign: 'right' },
                            style: { textAlign: 'right', whiteSpace: 'nowrap' },
                            footer: () => null,
                            render: (t) => {
                                const bal = Number(t.balance_amount) || 0;
                                if (bal <= 0.0001) {
                                    return <span className="badge badge-success" style={{ fontSize: '11px' }}>Settled</span>;
                                }

                                const ageInfo = getEntryAgeInfo(t.created_at, t.auction_date);

                                if (ageInfo.isWithin24h) {
                                    return (
                                        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                            <button 
                                                type="button"
                                                className="btn gradient-45deg-purple-deep-orange gradient-shadow white-text btn-sm" 
                                                style={{ 
                                                    fontSize: '12px', 
                                                    padding: '4px 10px', 
                                                    height: '30px',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    boxShadow: '0 2px 6px rgba(123, 31, 162, 0.28)'
                                                }}
                                                onClick={() => setPaymentModalData(t)}
                                                title={`Pay Balance Active: ${ageInfo.remainingHours.toFixed(1)}h remaining of 24-hour floor settlement window`}
                                            >
                                                <i className="material-icons" style={{ fontSize: '15px' }}>payments</i> Pay Balance
                                            </button>
                                            <span style={{ fontSize: '10px', color: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '3px', fontWeight: 600 }}>
                                                <i className="material-icons" style={{ fontSize: '12px' }}>schedule</i>
                                                {ageInfo.remainingHours >= 1 
                                                    ? `${Math.floor(ageInfo.remainingHours)}h ${Math.round((ageInfo.remainingHours % 1) * 60)}m left`
                                                    : `${Math.max(1, Math.round(ageInfo.remainingHours * 60))}m left`}
                                            </span>
                                        </div>
                                    );
                                }

                                // Older than 24 hours: Disabled
                                return (
                                    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                                        <button 
                                            type="button"
                                            className="btn btn-secondary btn-sm" 
                                            disabled
                                            style={{ 
                                                fontSize: '11px', 
                                                padding: '3px 8px', 
                                                height: '28px',
                                                opacity: 0.5,
                                                cursor: 'not-allowed',
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: '4px'
                                            }}
                                            title="Pay Balance window has expired (active only within 24 hours of auction entry). Settle dues through Cathedral Promises."
                                        >
                                            <i className="material-icons" style={{ fontSize: '13px' }}>lock_clock</i> Pay Balance
                                        </button>
                                        <span style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '2px' }} title="Auction entry is older than 24 hours">
                                            <i className="material-icons" style={{ fontSize: '11px' }}>history</i>
                                            24h Expired
                                        </span>
                                    </div>
                                );
                            }
                        }
                    ]}
                    data={transactions}
                    loading={loading}
                    keyField="transaction_id"
                    initialPageSize={10}
                    searchPlaceholder="Search by SL No, Ref, Tag No, Tag Name, Article, Buyer, Roll, Phone, CPR, Voucher..."
                    emptyMessage="No auction sales recorded yet for this year."
                />
            </div>

            {/* Payment Modal */}
            {paymentModalData && (
                <RecordPaymentModal 
                    transaction={paymentModalData}
                    isOpen={!!paymentModalData}
                    onClose={() => setPaymentModalData(null)}
                    onSuccess={() => {
                        fetchAuctionData();
                        if (typeof onDataChanged === 'function') {
                            onDataChanged();
                        }
                        showToast('success', 'Balance payment recorded!');
                    }}
                    onOpenReceipt={onOpenReceipt}
                    showToast={showToast}
                    accountsData={accountsData}
                />
            )}

            {/* Default Ledger Settings Modal for Admins */}
            {ledgerSettingsOpen && (
                <DefaultLedgerSettingsModal 
                    isOpen={ledgerSettingsOpen}
                    onClose={() => setLedgerSettingsOpen(false)}
                    showToast={showToast}
                    onSaved={() => fetchAuctionData()}
                />
            )}
        </div>
    );
}

// --- Redesigned Spacious Pay Balance / Settlement Modal (Matching Live Auction Entry Details) ---
function RecordPaymentModal({ transaction, isOpen, onClose, onSuccess, onOpenReceipt, showToast, accountsData }) {
    if (!isOpen || !transaction) return null;

    const maxBalance = Number(transaction.balance_amount) || 0;
    const [amount, setAmount] = useState(maxBalance > 0 ? maxBalance.toFixed(3) : '');
    const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [selectedEventId, setSelectedEventId] = useState(transaction.event_id || '');
    const [submitting, setSubmitting] = useState(false);

    // Contribution Posting heads (Receipt of balance installment)
    const [selectedDr, setSelectedDr] = useState(null);
    const [selectedCr, setSelectedCr] = useState(null);

    // Set default festival event
    useEffect(() => {
        if (accountsData?.events?.length > 0 && !selectedEventId) {
            const found = accountsData.events.find(ev => ev.event_id == transaction.event_id) || accountsData.events[0];
            setSelectedEventId(found.event_id);
        }
    }, [accountsData, transaction, selectedEventId]);

    // Set default debit & credit heads based on transaction and accountsData
    useEffect(() => {
        if (accountsData?.contribution_debit_heads?.length > 0) {
            const defDr = accountsData.contribution_debit_heads.find(h => h.head_code === (transaction.contrib_dr_code || '02123')) 
                || accountsData.contribution_debit_heads.find(h => h.head_code === '02123')
                || accountsData.contribution_debit_heads[0];
            setSelectedDr(defDr);
        }
        if (accountsData?.contribution_credit_heads?.length > 0) {
            const defCr = accountsData.contribution_credit_heads.find(h => h.head_code === (transaction.contrib_cr_code || '07503'))
                || accountsData.contribution_credit_heads.find(h => h.head_code === '02206')
                || accountsData.contribution_credit_heads[0];
            setSelectedCr(defCr);
        }
    }, [accountsData, transaction]);

    const amountNum = Number(amount) || 0;
    const remainingBal = Math.max(0, maxBalance - amountNum);
    const isOverpaying = amountNum > (maxBalance + 0.0001);
    const isFullSettlement = !isOverpaying && amountNum > 0 && remainingBal <= 0.0001;
    const isPartialSettlement = !isOverpaying && amountNum > 0 && remainingBal > 0.0001;

    const ageInfo = getEntryAgeInfo(transaction.created_at, transaction.auction_date);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!ageInfo.isWithin24h) {
            showToast('error', 'Pay Balance on the auction floor is only active for 24 hours from the entry. Please settle dues in Cathedral Promises.');
            return;
        }
        if (amountNum <= 0) {
            showToast('error', 'Payment amount must be greater than zero.');
            return;
        }
        if (isOverpaying) {
            showToast('error', `Payment amount (${amountNum.toFixed(3)} BHD) cannot exceed outstanding balance (${maxBalance.toFixed(3)} BHD).`);
            return;
        }
        if (!selectedDr || !selectedCr) {
            showToast('error', 'Please select both Debit Head and Credit Head for posting this receipt entry.');
            return;
        }

        const currentEvent = accountsData?.events?.find(ev => ev.event_id == selectedEventId);

        setSubmitting(true);
        try {
            const res = await api.post('/api/payments', {
                transaction_id: transaction.transaction_id,
                amount_paid: amountNum,
                payment_date: paymentDate,
                payment_mode: 'Cash',
                reference_no: null,
                receipt_book_no: '0',
                manual_receipt_no: '0',
                remarks: `Settlement for ${transaction.auction_ref_no}`,
                dr_code: selectedDr.head_code,
                dr_name: selectedDr.head_name,
                cr_code: selectedCr.head_code,
                cr_name: selectedCr.head_name,
                event_id: currentEvent ? currentEvent.event_id : (transaction.event_id || 10),
                event_name: currentEvent ? currentEvent.event_name : (transaction.event_name || 'Budget 2025')
            });
            if (res.success) {
                let msg = `Payment of BHD ${amountNum.toFixed(3)} recorded! Receipt: ${res.data.receipt_no}`;
                if (res.data.acc_contribution_id) {
                    msg += ` | Contrib ID: #${res.data.acc_contribution_id} (Receipt #${res.data.contrib_voucher_no})`;
                }
                showToast('success', msg);
                onSuccess();
                onClose();
                onOpenReceipt(res.data.receipt_no);
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content pay-balance-modal-content">
                <ModalHeader 
                    title="Settle Auction Balance" 
                    icon="payments" 
                    onClose={onClose} 
                    badge={transaction.auction_ref_no}
                />
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                    <div className="modal-body" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
                        
                        {/* 1. Article Details Card (Live Auction Style) */}
                        <div style={{ background: 'rgba(0,0,0,0.03)', padding: '14px 18px', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span className="badge badge-warning" style={{ fontSize: '12px', padding: '3px 8px', fontWeight: 700 }}>
                                        {transaction.tag_number ? `Tag #${transaction.tag_number}` : `#${transaction.article_id}`}
                                    </span>
                                    {transaction.article_number && (
                                        <span className="badge badge-secondary" style={{ fontSize: '11px', padding: '3px 8px', fontFamily: 'monospace' }}>
                                            {transaction.article_number}
                                        </span>
                                    )}
                                    <strong style={{ fontSize: '16px', color: 'var(--text-primary)' }}>{transaction.article_name}</strong>
                                    {transaction.category && (
                                        <span className="badge badge-info" style={{ fontSize: '11px' }}>{transaction.category}</span>
                                    )}
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Auction Ref: </span>
                                    <strong style={{ fontSize: '14px', color: 'var(--primary)' }}>{transaction.auction_ref_no}</strong>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                {Number(transaction.estimated_value) > 0 && <span>Est Value: <strong>BHD {Number(transaction.estimated_value).toFixed(3)}</strong></span>}
                                {transaction.donor_name && <span>Donor: <em>{transaction.donor_name}</em></span>}
                                {transaction.promise_voucher_no && (
                                    <span style={{ color: '#b45309', fontWeight: 600 }}>
                                        Promise: MP #{transaction.promise_voucher_no} {transaction.acc_promise_id ? `(#${transaction.acc_promise_id})` : ''}
                                    </span>
                                )}
                                {transaction.due_date && (
                                    <span>Due Date: <strong>{formatDateDMY(transaction.due_date)}</strong></span>
                                )}
                            </div>
                        </div>

                        {/* 24h Floor Window Status Banner */}
                        {ageInfo.isWithin24h ? (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                background: 'rgba(16, 185, 129, 0.08)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '8px',
                                padding: '8px 14px',
                                marginBottom: '14px',
                                fontSize: '12px'
                            }}>
                                <span style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <i className="material-icons" style={{ fontSize: '16px' }}>schedule</i>
                                    24-Hour Live Floor Window Active
                                </span>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '11px', fontWeight: 600 }}>
                                    {ageInfo.remainingHours >= 1 
                                        ? `${Math.floor(ageInfo.remainingHours)}h ${Math.round((ageInfo.remainingHours % 1) * 60)}m remaining`
                                        : `${Math.max(1, Math.round(ageInfo.remainingHours * 60))}m remaining`}
                                </span>
                            </div>
                        ) : (
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'rgba(239, 68, 68, 0.08)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '8px',
                                padding: '10px 14px',
                                marginBottom: '14px',
                                fontSize: '12px',
                                color: 'var(--danger)'
                            }}>
                                <i className="material-icons" style={{ fontSize: '18px' }}>lock_clock</i>
                                <span>
                                    <strong>24-Hour Window Expired:</strong> This auction entry was recorded on {ageInfo.formattedDate}. Floor settlement is locked; please record balance settlements through Cathedral Promises & Dues.
                                </span>
                            </div>
                        )}

                        {/* 2. Winning Bidder Details Card (Live Auction Style) */}
                        <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '14px 18px', borderRadius: '10px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '16px' }}>
                                        {transaction.buyer_name}
                                    </span>
                                    {transaction.buyer_code_c && (
                                        <span className="badge" style={{ background: 'rgba(142, 36, 170, 0.15)', color: 'var(--primary)', fontWeight: 700, fontSize: '11px' }}>
                                            Roll No: #{transaction.buyer_code_c}
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {transaction.buyer_cpr && <span>CPR: <strong>{transaction.buyer_cpr}</strong> &nbsp;|&nbsp; </span>}
                                    {transaction.buyer_phone && <span>Phone: <strong>{transaction.buyer_phone}</strong> &nbsp;|&nbsp; </span>}
                                    {transaction.prayer_group_name && <span>{transaction.prayer_group_name}</span>}
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span className="badge badge-success" style={{ fontSize: '11px', padding: '4px 8px' }}>
                                    <i className="material-icons" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '3px' }}>verified</i>
                                    Registered Member
                                </span>
                            </div>
                        </div>

                        {/* 3. 4-Stat Financial Breakdown Grid */}
                        <div className="settle-stats-grid" style={{ marginBottom: '16px' }}>
                            <div className="settle-stat-pill">
                                <span className="settle-stat-label">Winning Bid</span>
                                <span className="settle-stat-value">
                                    BHD {Number(transaction.winning_bid_amount || transaction.total_promise_amount || 0).toFixed(3)}
                                </span>
                            </div>
                            <div className="settle-stat-pill">
                                <span className="settle-stat-label">Paid Prior</span>
                                <span className="settle-stat-value" style={{ color: 'var(--success)' }}>
                                    BHD {Number(transaction.paid_amount || 0).toFixed(3)}
                                </span>
                            </div>
                            <div className="settle-stat-pill" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                                <span className="settle-stat-label" style={{ color: 'var(--danger)' }}>Outstanding Due</span>
                                <span className="settle-stat-value" style={{ color: 'var(--danger)' }}>
                                    BHD {maxBalance.toFixed(3)}
                                </span>
                            </div>
                            <div className="settle-stat-pill" style={{ 
                                background: isFullSettlement ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
                                borderColor: isFullSettlement ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'
                            }}>
                                <span className="settle-stat-label" style={{ color: isFullSettlement ? 'var(--success)' : 'var(--warning)' }}>
                                    Balance After Pay
                                </span>
                                <span className="settle-stat-value" style={{ color: isFullSettlement ? 'var(--success)' : 'var(--warning)' }}>
                                    BHD {remainingBal.toFixed(3)}
                                </span>
                            </div>
                        </div>

                        {/* 4. Settlement Inputs (Settlement Amount & Payment Date Only - Clean & Direct) */}
                        <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
                            gap: '16px', 
                            marginBottom: '16px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            padding: '16px'
                        }}>
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 700, fontSize: '13px' }}>Settlement Amount (BHD) *</span>
                                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Due: BHD {maxBalance.toFixed(3)}</span>
                                </label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    min="0.001"
                                    max={maxBalance}
                                    className="form-control" 
                                    style={{ 
                                        fontSize: '20px', 
                                        fontWeight: '800', 
                                        color: isOverpaying ? 'var(--danger)' : 'var(--success)',
                                        height: '46px',
                                        paddingLeft: '14px',
                                        letterSpacing: '0.5px'
                                    }}
                                    placeholder="0.000"
                                    data-currency="true"
                                    required 
                                    value={amount}
                                    onFocus={() => handleCurrencyFocus(amount, setAmount)}
                                    onChange={e => setAmount(e.target.value)}
                                />
                            </div>

                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label" style={{ fontWeight: 700, fontSize: '13px' }}>Payment Date *</label>
                                <input 
                                    type="date" 
                                    className="form-control" 
                                    style={{ height: '46px', fontSize: '14px' }}
                                    value={paymentDate} 
                                    onChange={e => setPaymentDate(e.target.value)}
                                    required 
                                />
                            </div>
                        </div>

                        {/* 5. Cathedral Accounts Contribution Posting Section (Live Auction Desk Style) */}
                        <div style={{
                            marginBottom: '16px',
                            background: 'rgba(255, 255, 255, 0.02)',
                            border: '1px solid var(--border-color)',
                            borderRadius: '10px',
                            padding: '16px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <i className="material-icons" style={{ color: 'var(--primary)', fontSize: '22px' }}>account_balance</i>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Cathedral Accounts Contribution Posting</h4>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            Automated HRCPT Ledger Posting into Cathedral Accounts
                                        </div>
                                    </div>
                                </div>

                                {accountsData?.events?.length > 0 && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
                                        <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Budget Head:</label>
                                        <select 
                                            className="form-control" 
                                            style={{ height: '34px', fontSize: '12px', padding: '4px 8px' }}
                                            value={selectedEventId}
                                            onChange={e => setSelectedEventId(e.target.value)}
                                        >
                                            {accountsData.events.map(ev => (
                                                <option key={ev.event_id} value={ev.event_id}>
                                                    {ev.event_name} {ev.default_status === 'Yes' ? '(Default)' : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>

                            <div className="accounting-section-box active-posting" style={{
                                background: 'rgba(16, 185, 129, 0.03)',
                                borderLeft: '4px solid #10b981',
                                marginBottom: 0
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge badge-success" style={{ fontSize: '11px', padding: '3px 8px' }}>
                                            <i className="material-icons" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '4px' }}>receipt</i>
                                            Contribution Entry (Receipt Posting)
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--success)' }}>
                                        Posting Amount: BHD {amountNum.toFixed(3)}
                                    </span>
                                </div>

                                <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                                    <SearchableHeadSelect
                                        label="Debit Head (Receiving Cash/Bank) *"
                                        placeholder="Search receiving debit head (e.g. 02123)..."
                                        options={accountsData?.contribution_debit_heads || []}
                                        selectedHead={selectedDr}
                                        onSelect={setSelectedDr}
                                        required={true}
                                        badgeColor="#3b82f6"
                                    />
                                    <SearchableHeadSelect
                                        label="Credit Head (Harvest / Auction Income) *"
                                        placeholder="Search income credit head (e.g. 02206 / 07503)..."
                                        options={accountsData?.contribution_credit_heads || []}
                                        selectedHead={selectedCr}
                                        onSelect={setSelectedCr}
                                        required={true}
                                        badgeColor="#10b981"
                                    />
                                </div>

                                {/* Live Double Entry Pill Summary */}
                                {selectedDr && selectedCr && amountNum > 0 && (
                                    <div className="double-entry-pill-box">
                                        <div style={{ fontWeight: 700, marginBottom: '4px', color: '#0f766e', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <i className="material-icons" style={{ fontSize: '15px' }}>sync_alt</i> Double Entry Ledger Impact:
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', fontSize: '12px' }}>
                                            <div>
                                                <strong style={{ color: '#2563eb' }}>Dr:</strong> [{selectedDr.head_code}] {selectedDr.head_name} ➔ <span style={{ fontWeight: 700 }}>BHD {amountNum.toFixed(3)}</span>
                                            </div>
                                            <div>
                                                <strong style={{ color: '#059669' }}>Cr:</strong> [{selectedCr.head_code}] {selectedCr.head_name} ➔ <span style={{ fontWeight: 700 }}>BHD {amountNum.toFixed(3)}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* 6. Live Settlement Status Banner */}
                        {isOverpaying ? (
                            <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#ef4444', fontSize: '13px', marginBottom: '16px' }}>
                                <i className="material-icons">error_outline</i>
                                <span>Entered payment amount (BHD {amountNum.toFixed(3)}) exceeds outstanding balance (BHD {maxBalance.toFixed(3)}).</span>
                            </div>
                        ) : isFullSettlement ? (
                            <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#059669', fontSize: '13px', marginBottom: '16px' }}>
                                <i className="material-icons">check_circle</i>
                                <span><strong>Full Settlement:</strong> This payment will completely settle the balance. Article status will be marked <strong>Sold</strong> and Promise marked <strong>Received</strong>.</span>
                            </div>
                        ) : isPartialSettlement ? (
                            <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', borderRadius: '8px', padding: '12px', display: 'flex', alignItems: 'center', gap: '8px', color: '#b45309', fontSize: '13px', marginBottom: '16px' }}>
                                <i className="material-icons">info</i>
                                <span><strong>Partial Installment:</strong> Remaining balance will be <strong>BHD {remainingBal.toFixed(3)}</strong>. Transaction will remain in Partial status.</span>
                            </div>
                        ) : null}

                    </div>

                    {/* Responsive Modal Footer */}
                    <div className="modal-footer" style={{ borderTop: '1px solid var(--border-color)', padding: '14px 22px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                        <button type="button" className="btn gradient-45deg-red-pink gradient-shadow white-text" onClick={onClose} disabled={submitting}>
                            <i className="material-icons" style={{ fontSize: '16px' }}>close</i> Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="btn gradient-45deg-green-teal gradient-shadow white-text btn-lg" 
                            disabled={submitting || !ageInfo.isWithin24h || amountNum <= 0 || isOverpaying || !selectedDr || !selectedCr}
                            style={{ minWidth: '240px', opacity: !ageInfo.isWithin24h ? 0.6 : 1 }}
                        >
                            <i className="material-icons" style={{ fontSize: '18px' }}>check_circle</i>
                            {submitting ? 'Recording Settlement...' : !ageInfo.isWithin24h ? '24h Window Expired' : `Confirm Settlement & Generate Receipt (${amountNum > 0 ? 'BHD ' + amountNum.toFixed(3) : ''})`}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Printable Receipt Voucher Copy matching staging_parallel/accounts/view/hf_receipt.php ---
function HfReceiptVoucherCopy({ receipt, copyType = 'Member Copy', showLetterhead = true }) {
    const formattedDate = receipt.payment_date 
        ? new Date(receipt.payment_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : '—';
    const amountVal = Number(receipt.amount_paid || 0).toFixed(3);
    const amountWords = getCurrencyWords(receipt.amount_paid);
    // Member Outstanding Balance logic from staging_parallel/accounts/view/hf_receipt.php
    const memberOutstanding = Number(receipt.member_outstanding_balance ?? receipt.total_transaction_balance ?? 0).toFixed(3);

    const artName = receipt.article_name || 'Auction Article';
    const tagNo = receipt.tag_number || 'N/A';
    const artNo = receipt.article_number || 'N/A';
    const category = receipt.category || '';
    const crCode = receipt.cr_code || '02206';
    const crName = receipt.cr_name || 'Church Building Fund - Harvest Festival';

    // Only number needs to display in the receipt print (no HRCPT # or text)
    const rawReceiptRef = receipt.voucher_no || receipt.manual_receipt_no || receipt.receipt_no || '';
    const cleanReceiptNo = String(rawReceiptRef).replace(/[^0-9]/g, '') || String(rawReceiptRef).replace(/^HRCPT\s*[-#]?\s*/i, '').replace(/^#/, '').trim();

    return (
        <div className="hf-receipt-sheet" style={{ background: '#ffffff', color: '#000000', fontFamily: 'Arial, Consolas, "Courier New", monospace', fontSize: '11.5px', lineHeight: '1.25' }}>
            {showLetterhead ? (
                <div style={{ textAlign: 'center', marginBottom: '3px', paddingTop: '1px' }}>
                    <img 
                        src="/images/logo/red_full_logo.png" 
                        alt="St. Mary's Indian Orthodox Cathedral" 
                        style={{ height: '34px', maxWidth: '340px', objectFit: 'contain' }}
                        onError={(e) => { e.target.src = '/images/logo/login-page-logo.png'; }}
                    />
                    <div style={{ fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.5px', marginTop: '1px', color: '#000000' }}>
                        RECEIPT
                    </div>
                </div>
            ) : (
                <div style={{ height: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '3px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '1.5px', color: '#000000' }}>
                        RECEIPT
                    </div>
                </div>
            )}

            {/* Top rounded box matching #rcorners2 in staging_parallel hf_receipt.php */}
            <div className="hf-receipt-box" style={{ borderRadius: '14px', border: '1px solid #646464', padding: '4px 10px', marginBottom: '4px', background: '#ffffff' }}>
                <table width="100%" border="0" cellSpacing="0" cellPadding="2" style={{ borderCollapse: 'collapse', fontSize: '11.5px', color: '#000000' }}>
                    <tbody>
                        <tr>
                            <td width="55%"><strong>Receipt No : </strong>{cleanReceiptNo}</td>
                            <td width="45%" style={{ textAlign: 'right', fontWeight: 'bold', fontSize: '11.5px' }}>{copyType}</td>
                        </tr>
                        <tr>
                            <td><strong>Date : </strong>{formattedDate}</td>
                            <td style={{ textAlign: 'right' }}>&nbsp;</td>
                        </tr>
                        <tr>
                            <td><strong>Received with thanks from : </strong><strong>{receipt.buyer_name}</strong></td>
                            <td style={{ textAlign: 'left' }}><strong>Receipt Total : </strong>{amountVal}</td>
                        </tr>
                        <tr>
                            <td>
                                <strong>Roll No : </strong>{receipt.buyer_code_c || 'NA'},&nbsp;
                                <strong>Edavaka Reg No : </strong>{receipt.buyer_code_m || 'NA'}
                            </td>
                            <td style={{ textAlign: 'left' }}>
                                <strong>Mobile : </strong>{receipt.buyer_phone || 'NA'}
                            </td>
                        </tr>
                        <tr>
                            <td>
                                <strong>PO Box : </strong>{receipt.buyer_pobox || 'NA'} ,&nbsp;
                                <strong>Tele(O) : </strong>{receipt.buyer_tel || 'NA'}
                            </td>
                            <td style={{ textAlign: 'left' }}>
                                <strong>Membership Status : </strong>{receipt.buyer_member_type || 'Permanent'}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {/* Contribution Details & Remarks Table */}
            <table width="100%" border="0" cellSpacing="0" cellPadding="4" className="hf-grid-table" style={{ borderCollapse: 'collapse', width: '100%', marginTop: '3px', fontSize: '11.5px', color: '#000000' }}>
                <thead>
                    <tr style={{ background: '#D1D1D1', borderTop: '1px solid #646464', borderBottom: '1px solid #646464' }}>
                        <th width="30" style={{ textAlign: 'center', padding: '3px 4px', color: '#000000', backgroundColor: '#D1D1D1' }}>#</th>
                        <th width="230" style={{ textAlign: 'left', padding: '3px 6px', color: '#000000', backgroundColor: '#D1D1D1' }}>Contribution Details</th>
                        <th width="420" style={{ textAlign: 'left', padding: '3px 6px', color: '#000000', backgroundColor: '#D1D1D1' }}>Remarks</th>
                        <th width="120" style={{ textAlign: 'right', padding: '3px 6px', color: '#000000', backgroundColor: '#D1D1D1' }}>Amount/Kind</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style={{ textAlign: 'center', verticalAlign: 'top', padding: '5px 4px' }}>1.</td>
                        <td style={{ textAlign: 'left', verticalAlign: 'top', padding: '5px 6px' }}>
                            <div style={{ fontWeight: 'bold' }}>{crCode}</div>
                            <div style={{ fontSize: '11px', color: '#222222' }}>{crName}</div>
                        </td>
                        <td style={{ textAlign: 'left', verticalAlign: 'top', padding: '5px 6px' }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#000000', marginBottom: '1px' }}>
                                {receipt.applicable_year || 2026} - {artName}
                            </div>
                            <div style={{ fontSize: '11px', color: '#222222' }}>
                                <strong>Tag No:</strong> {tagNo} &nbsp;|&nbsp; <strong>Article No:</strong> {artNo} {category ? `| ${category}` : ''}
                            </div>
                        </td>
                        <td style={{ textAlign: 'right', verticalAlign: 'top', padding: '5px 6px', fontWeight: 'bold' }}>
                            {amountVal}
                        </td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid #000000' }}>
                        <td colSpan="4" style={{ padding: '1px' }}></td>
                    </tr>
                    <tr>
                        <td colSpan="3" style={{ padding: '4px 6px', fontSize: '11px' }}>
                            Bahraini Dinar <strong>{amountWords}</strong> Only
                        </td>
                        <td style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 'bold', fontSize: '12.5px' }}>
                            <strong>{amountVal}</strong>
                        </td>
                    </tr>
                    <tr>
                        <td colSpan="3" style={{ padding: '6px 6px 2px 6px' }}>
                            <table width="100%" border="0" cellPadding="0" cellSpacing="0">
                                <tbody>
                                    <tr>
                                        <td width="90" style={{ fontSize: '10.5px', color: '#444444' }}>Page 1 of 1</td>
                                        <td style={{ textAlign: 'center', fontStyle: 'italic', fontSize: '11px', color: '#000000' }}>
                                            <i>NB : Outstanding Amount till date : BHD {memberOutstanding}</i>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </td>
                        <td style={{ textAlign: 'right', padding: '6px 6px 2px 6px', verticalAlign: 'bottom' }}>
                            <div style={{ borderTop: '1px solid #777777', width: '80px', marginLeft: 'auto', marginBottom: '2px' }}></div>
                            <strong style={{ fontSize: '11px' }}>Trustee</strong>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

// --- Printable Receipt Modal matching staging_parallel/accounts/view/hf_receipt.php ---
function ReceiptModal({ receiptNo, isOpen, onClose }) {
    if (!isOpen) return null;
    const [receipt, setReceipt] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showLetterhead, setShowLetterhead] = useState(true);
    const [showChurchCopy, setShowChurchCopy] = useState(true);

    useEffect(() => {
        if (receiptNo) {
            setLoading(true);
            api.get(`/api/payments/receipt/${encodeURIComponent(receiptNo)}`)
                .then(res => {
                    if (res.success) setReceipt(res.receipt);
                })
                .catch(() => {})
                .finally(() => setLoading(false));
        }
    }, [receiptNo]);

    const cleanReceiptBadge = receipt 
        ? (String(receipt.voucher_no || receipt.manual_receipt_no || receipt.receipt_no || receiptNo).replace(/[^0-9]/g, '') || receipt.receipt_no || receiptNo)
        : (String(receiptNo).replace(/[^0-9]/g, '') || receiptNo);

    const handlePrint = () => {
        const printArea = document.getElementById('hf-printable-receipt-area');
        if (!printArea) {
            window.print();
            return;
        }

        // Clean up any existing print iframe
        const oldIframe = document.getElementById('hf-receipt-print-frame');
        if (oldIframe) {
            oldIframe.remove();
        }

        const iframe = document.createElement('iframe');
        iframe.id = 'hf-receipt-print-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '10px';
        iframe.style.height = '10px';
        iframe.style.border = '0';
        iframe.style.opacity = '0.01';
        iframe.style.pointerEvents = 'none';
        iframe.style.zIndex = '-999';
        document.body.appendChild(iframe);

        const printHtml = `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Receipt ${cleanReceiptBadge}</title>
    <link rel="stylesheet" href="/css/app.css">
    <style>
        @page { size: A4 portrait; margin: 5mm 8mm; }
        html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            font-family: Arial, Consolas, "Courier New", monospace !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            height: 287mm !important;
            overflow: hidden !important;
        }
        .hf-receipt-container {
            width: 100% !important;
            max-width: 780px !important;
            margin: 0 auto !important;
            padding: 0 !important;
            background: #ffffff !important;
            box-sizing: border-box !important;
        }
        /* Half-A4: exactly 138mm height per copy for top & bottom halves */
        .hf-receipt-sheet {
            width: 100% !important;
            max-width: 780px !important;
            height: 138mm !important;
            max-height: 138mm !important;
            min-height: 138mm !important;
            box-sizing: border-box !important;
            margin: 0 auto !important;
            padding: 2mm 4mm !important;
            background: #ffffff !important;
            color: #000000 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
            display: flex !important;
            flex-direction: column !important;
            justify-content: flex-start !important;
            overflow: hidden !important;
            font-size: 11.5px !important;
        }
        .hf-receipt-box {
            border-radius: 14px !important;
            border: 1px solid #646464 !important;
            padding: 4px 10px !important;
            margin-bottom: 4px !important;
            background: #ffffff !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        .hf-grid-table {
            border-collapse: collapse !important;
            width: 100% !important;
        }
        .hf-grid-table th {
            background-color: #D1D1D1 !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
        }
        /* Center tear/cut line sitting at exactly the 148.5mm midpoint of the A4 page */
        .hf-receipt-divider {
            page-break-before: avoid !important;
            break-before: avoid !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 100% !important;
            height: 10mm !important;
            margin: 0 auto !important;
            padding: 0 !important;
            text-align: center !important;
            position: relative !important;
            box-sizing: border-box !important;
        }
        .hf-receipt-divider::before {
            content: '' !important;
            position: absolute !important;
            left: 0 !important;
            right: 0 !important;
            top: 50% !important;
            border-top: 1px dashed #777777 !important;
            z-index: 1 !important;
        }
        .hf-receipt-divider span {
            display: inline-block !important;
            position: relative !important;
            z-index: 2 !important;
            background: #ffffff !important;
            padding: 0 10px !important;
            font-size: 9.5px !important;
            color: #555555 !important;
            font-family: Arial, sans-serif !important;
            letter-spacing: 0.5px !important;
        }
    </style>
</head>
<body>
    <div class="hf-receipt-container">
        ${printArea.innerHTML}
    </div>
</body>
</html>`;

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(printHtml);
        doc.close();

        let printed = false;
        const doPrint = () => {
            if (printed) return;
            printed = true;
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (err) {
                console.error("Iframe print error:", err);
                window.print();
            }
        };

        setTimeout(doPrint, 350);
        iframe.onload = doPrint;
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '880px', width: '95%', background: 'var(--bg-surface)' }}>
                <div className="no-print">
                    <ModalHeader 
                        title="Harvest Festival Payment Receipt (Voucher Format)" 
                        icon="receipt_long" 
                        onClose={onClose} 
                        badge={cleanReceiptBadge}
                    />
                    <div style={{ padding: '8px 24px', background: 'var(--bg-card-hover)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', fontSize: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}>
                                <input 
                                    type="checkbox" 
                                    checked={showLetterhead} 
                                    onChange={e => setShowLetterhead(e.target.checked)} 
                                />
                                <span>Show Cathedral Header (uncheck for church pre-printed stationery)</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', margin: 0 }}>
                                <input 
                                    type="checkbox" 
                                    checked={showChurchCopy} 
                                    onChange={e => setShowChurchCopy(e.target.checked)} 
                                />
                                <span>Include Church Copy</span>
                            </label>
                        </div>
                        <button type="button" className="btn btn-primary btn-sm" onClick={handlePrint} disabled={!receipt}>
                            <i className="material-icons" style={{ fontSize: '15px' }}>print</i> Print Receipt
                        </button>
                    </div>
                </div>

                <div className="modal-body" style={{ background: '#f1f5f9', padding: '20px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
                    ) : !receipt ? (
                        <div style={{ color: '#000', textAlign: 'center', padding: '30px' }}>Receipt details not found.</div>
                    ) : (
                        <div className="hf-receipt-container" id="hf-printable-receipt-area">
                            {/* Member Copy */}
                            <HfReceiptVoucherCopy 
                                receipt={receipt} 
                                copyType="Member Copy" 
                                showLetterhead={showLetterhead} 
                            />

                            {/* Church Copy */}
                            {showChurchCopy && (
                                <>
                                    <div className="hf-receipt-divider">
                                        <span>✂ - - - - - - - - - - - - - - - - - - Tear / Cut Along This Line (Church Copy Below) - - - - - - - - - - - - - - - - - - ✂</span>
                                    </div>
                                    <HfReceiptVoucherCopy 
                                        receipt={receipt} 
                                        copyType="Church Copy" 
                                        showLetterhead={showLetterhead} 
                                    />
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div className="modal-footer no-print">
                    <button type="button" className="btn gradient-45deg-red-pink gradient-shadow white-text" onClick={onClose}>
                        <i className="material-icons" style={{ fontSize: '16px' }}>close</i> Close
                    </button>
                    <button type="button" className="btn gradient-45deg-light-blue-cyan gradient-shadow white-text" onClick={handlePrint} disabled={!receipt}>
                        <i className="material-icons" style={{ fontSize: '16px' }}>print</i> Print Receipt
                    </button>
                </div>
            </div>
        </div>
    );
}

// --- Promises Management View ---
function PromisesView({ year, showToast, onOpenReceipt, refreshTrigger, onDataChanged }) {
    const [promises, setPromises] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('All');
    const [search, setSearch] = useState('');
    const [paymentModalData, setPaymentModalData] = useState(null);
    const [accountsData, setAccountsData] = useState(null);

    const fetchPromises = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/api/promises?year=${year}&status=${statusFilter}&search=${encodeURIComponent(search)}`);
            if (res.success) setPromises(res.promises);
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPromises();
    }, [year, statusFilter, search, refreshTrigger]);

    useEffect(() => {
        api.get('/api/accounts/heads')
            .then(res => {
                if (res.success) setAccountsData(res.data);
            })
            .catch(err => console.error("Could not load account heads in PromisesView", err));
    }, []);

    return (
        <div>
            <div className="card">
                <div className="card-header" style={{ flexWrap: 'wrap', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <i className="material-icons" style={{ fontSize: '28px', color: 'var(--primary)' }}>account_balance_wallet</i>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
                                Auction Promises & Receivables ({year})
                            </h3>
                            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                                Track member credit purchases, pending balances, and record collections
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => {
                                fetchPromises();
                                if (typeof onDataChanged === 'function') onDataChanged();
                            }} 
                            title="Reload Promises Table"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                            <i className="material-icons" style={{ fontSize: '16px' }}>refresh</i> Reload Table
                        </button>
                        <select className="form-control" style={{ width: '150px' }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                            <option value="All">All Statuses</option>
                            <option value="Active">Active / Pending</option>
                            <option value="Fulfilled">Fulfilled / Cleared</option>
                        </select>
                    </div>
                </div>

                <DataTable 
                    columns={[
                        {
                            header: 'SL No',
                            id: 'sl_no',
                            searchable: false,
                            sortable: false,
                            headerStyle: { width: '60px', textAlign: 'center' },
                            style: { textAlign: 'center', width: '60px', fontWeight: 600, color: 'var(--text-muted)' },
                            footer: () => (
                                <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-muted)', fontWeight: 700 }}>
                                    Total
                                </span>
                            ),
                            render: (p, index) => <span style={{ fontSize: '12px' }}>{index + 1}</span>
                        },
                        {
                            header: 'Promise ID',
                            accessor: 'hf_promise_id',
                            sortable: true,
                            footer: (allRows) => (
                                <span style={{ color: 'var(--text-primary)', fontSize: '12px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    {allRows.length} Promises
                                </span>
                            ),
                            render: (p) => (
                                <div>
                                    <strong style={{ color: 'var(--text-primary)' }}>PRM-{p.hf_promise_id}</strong>
                                    {p.acc_promise_id ? (
                                        <div style={{ fontSize: '11px', color: 'var(--warning)', fontWeight: 600 }}>
                                            Acc ID: #{p.acc_promise_id}
                                        </div>
                                    ) : null}
                                    {p.voucher_no ? (
                                        <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                            Voucher: MP #{p.voucher_no}
                                        </div>
                                    ) : null}
                                </div>
                            )
                        },
                        {
                            header: 'Member Name',
                            accessor: 'member_name',
                            sortable: true,
                            searchValue: (p) => `${p.member_name || ''} ${p.member_phone || ''}`,
                            footer: () => null,
                            render: (p) => (
                                <div>
                                    <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.member_name}</div>
                                    {p.member_phone && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Phone: {p.member_phone}</div>}
                                </div>
                            )
                        },
                        {
                            header: 'Roll No / CPR',
                            accessor: 'member_code_c',
                            sortable: true,
                            searchValue: (p) => `${p.member_code_c || ''} ${p.member_cpr || ''}`,
                            footer: () => null,
                            render: (p) => (
                                <div>
                                    {p.member_code_c && <div>Roll No: <strong style={{ color: 'var(--primary)' }}>{p.member_code_c}</strong></div>}
                                    {p.member_cpr && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>CPR: {p.member_cpr}</div>}
                                </div>
                            )
                        },
                        {
                            header: 'Tag No & Tag Name',
                            accessor: 'article_name',
                            sortable: true,
                            searchValue: (p) => `${p.tag_number || ''} ${p.article_name || ''} ${p.article_number || ''}`,
                            footer: () => null,
                            render: (p) => (
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                        <span className="tag-badge">{p.tag_number}</span>
                                        {p.article_number && (
                                            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'monospace', background: 'rgba(255,255,255,0.06)', padding: '1px 5px', borderRadius: '4px' }}>
                                                {p.article_number}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontWeight: 600 }}>{p.article_name}</div>
                                </div>
                            )
                        },
                        {
                            header: 'Total Bid',
                            accessor: 'total_promise_amount',
                            sortable: true,
                            sortValue: (p) => Number(p.total_promise_amount) || 0,
                            footer: (allRows) => {
                                const total = allRows.reduce((sum, p) => sum + (Number(p.total_promise_amount) || 0), 0);
                                return (
                                    <div className="dt-footer-amount-box">
                                        <span className="dt-footer-amount-label">Bid Total</span>
                                        <span className="dt-footer-amount-val" style={{ color: 'var(--primary)' }}>
                                            BHD {total.toFixed(3)}
                                        </span>
                                    </div>
                                );
                            },
                            render: (p) => `BHD ${Number(p.total_promise_amount).toFixed(3)}`
                        },
                        {
                            header: 'Paid So Far',
                            accessor: 'paid_amount',
                            sortable: true,
                            sortValue: (p) => Number(p.paid_amount) || 0,
                            footer: (allRows) => {
                                const total = allRows.reduce((sum, p) => sum + (Number(p.paid_amount) || 0), 0);
                                return (
                                    <div className="dt-footer-amount-box">
                                        <span className="dt-footer-amount-label">Paid Total</span>
                                        <span className="dt-footer-amount-val" style={{ color: 'var(--success)' }}>
                                            BHD {total.toFixed(3)}
                                        </span>
                                    </div>
                                );
                            },
                            render: (p) => <span style={{ color: 'var(--success)', fontWeight: 600 }}>{Number(p.paid_amount).toFixed(3)}</span>
                        },
                        {
                            header: 'Outstanding Due',
                            accessor: 'balance_amount',
                            sortable: true,
                            sortValue: (p) => Number(p.balance_amount) || 0,
                            footer: (allRows) => {
                                const total = allRows.reduce((sum, p) => sum + (Number(p.balance_amount) || 0), 0);
                                return (
                                    <div className="dt-footer-amount-box">
                                        <span className="dt-footer-amount-label">Due Total</span>
                                        <span className="dt-footer-amount-val" style={{ color: total > 0.0001 ? 'var(--danger)' : 'var(--text-muted)' }}>
                                            BHD {total.toFixed(3)}
                                        </span>
                                    </div>
                                );
                            },
                            render: (p) => <strong style={{ color: 'var(--danger)', fontSize: '14px' }}>BHD {Number(p.balance_amount).toFixed(3)}</strong>
                        },
                        {
                            header: 'Due Date',
                            accessor: 'due_date',
                            sortable: true,
                            footer: () => null,
                            render: (p) => formatDateDMY(p.due_date)
                        },
                        {
                            header: 'Status',
                            accessor: 'promise_status',
                            sortable: true,
                            footer: (allRows) => {
                                const activeCount = allRows.filter(p => p.promise_status === 'Active').length;
                                const fulfilledCount = allRows.length - activeCount;
                                return (
                                    <div style={{ fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                        <span style={{ color: 'var(--warning)', fontWeight: 700 }}>{activeCount} Active</span>
                                        {fulfilledCount > 0 && <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fulfilledCount} Fulfilled</span>}
                                    </div>
                                );
                            },
                            render: (p) => (
                                <span className={`badge badge-${p.promise_status === 'Fulfilled' ? 'success' : 'warning'}`}>
                                    {p.promise_status}
                                </span>
                            )
                        }
                    ]}
                    data={promises}
                    loading={loading}
                    keyField="hf_promise_id"
                    initialPageSize={10}
                    searchPlaceholder="Search by SL No, Promise ID, Member, Roll, CPR, Tag No, Tag Name..."
                    emptyMessage="No promises found matching filters."
                />
            </div>

            {paymentModalData && (
                <RecordPaymentModal 
                    transaction={paymentModalData}
                    isOpen={!!paymentModalData}
                    onClose={() => setPaymentModalData(null)}
                    onSuccess={() => {
                        fetchPromises();
                        if (typeof onDataChanged === 'function') {
                            onDataChanged();
                        }
                        showToast('success', 'Promise payment recorded!');
                    }}
                    onOpenReceipt={onOpenReceipt}
                    showToast={showToast}
                    accountsData={accountsData}
                />
            )}
        </div>
    );
}

// --- Reports & Analytics View ---
function ReportsView({ year, showToast, refreshTrigger }) {
    const [summary, setSummary] = useState(null);
    const [buyers, setBuyers] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchReports = () => {
        setLoading(true);
        Promise.all([
            api.get(`/api/reports/summary?year=${year}`),
            api.get(`/api/reports/buyers?year=${year}`)
        ]).then(([sumRes, buyRes]) => {
            if (sumRes.success) setSummary(sumRes.summary);
            if (buyRes.success) setBuyers(buyRes.buyers);
        }).catch(err => {
            showToast('error', err.message);
        }).finally(() => setLoading(false));
    };

    useEffect(() => {
        fetchReports();
    }, [year, refreshTrigger]);

    const exportBuyerReport = () => {
        if (!buyers.length) return;
        const rows = buyers.map(b => ({
            'Buyer Name': b.buyer_name,
            'Roll No': b.buyer_code_c || 'N/A',
            'CPR': b.cpr_no || 'N/A',
            'Phone': b.buyer_phone || 'N/A',
            'Items Count': b.items_purchased,
            'Items Bought': Array.isArray(b.items) && b.items.length > 0 
                ? b.items.map(i => `${i.tag_number ? '[' + i.tag_number + '] ' : ''}${i.article_number ? '(' + i.article_number + ') ' : ''}${i.article_name || ''}`).join('; ')
                : (b.items_purchased || 0),
            'Total Bid (BHD)': b.total_purchased,
            'Total Paid (BHD)': b.total_paid,
            'Balance Due (BHD)': b.total_balance,
            'Status': b.overall_status
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `Buyers_${year}`);
        XLSX.writeFile(wb, `cathedral_auction_buyers_${year}.xlsx`);
    };

    const handlePrintReport = () => {
        if (!summary) {
            showToast('info', 'Report data is still loading...');
            return;
        }

        // Clean up any existing report print iframe
        const oldIframe = document.getElementById('hf-sales-report-print-frame');
        if (oldIframe) {
            oldIframe.remove();
        }

        const iframe = document.createElement('iframe');
        iframe.id = 'hf-sales-report-print-frame';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '10px';
        iframe.style.height = '10px';
        iframe.style.border = '0';
        iframe.style.opacity = '0.01';
        iframe.style.pointerEvents = 'none';
        iframe.style.zIndex = '-999';
        document.body.appendChild(iframe);

        const printDate = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Totals for Category breakdown
        const cats = summary.category_breakdown || [];
        const catTotalArticles = cats.reduce((sum, c) => sum + (Number(c.article_count) || 0), 0);
        const catTotalSold = cats.reduce((sum, c) => sum + (Number(c.sold_count) || 0), 0);
        const catTotalEst = cats.reduce((sum, c) => sum + (Number(c.estimated_val) || 0), 0);
        const catTotalBid = cats.reduce((sum, c) => sum + (Number(c.total_bid_val) || 0), 0);

        // Totals for Buyer Ledger
        const buyerTotalBid = buyers.reduce((sum, b) => sum + (Number(b.total_purchased) || 0), 0);
        const buyerTotalPaid = buyers.reduce((sum, b) => sum + (Number(b.total_paid) || 0), 0);
        const buyerTotalBalance = buyers.reduce((sum, b) => sum + (Number(b.total_balance) || 0), 0);

        const categoryRowsHtml = cats.map((c, idx) => `
            <tr>
                <td style="text-align: center;">${idx + 1}</td>
                <td style="font-weight: bold;">${c.category}</td>
                <td style="text-align: center;">${c.article_count || 0}</td>
                <td style="text-align: center;">${c.sold_count || 0}</td>
                <td style="text-align: right; padding-right: 6px;">${Number(c.estimated_val || 0).toFixed(3)}</td>
                <td style="text-align: right; font-weight: bold; padding-right: 6px;">${Number(c.total_bid_val || 0).toFixed(3)}</td>
            </tr>
        `).join('');

        const buyerRowsHtml = buyers.map((b, idx) => {
            const itemsStr = Array.isArray(b.items) && b.items.length > 0 
                ? b.items.map(i => `
                    <div style="margin-bottom: 2px; line-height: 1.35;">
                        ${i.tag_number ? `<strong style="color: #111;">[${i.tag_number}]</strong> ` : ''}
                        <span>${i.article_name || ''}</span>
                        <span style="color: #666; font-size: 9px; white-space: nowrap;"> (${Number(i.winning_bid_amount || 0).toFixed(3)})</span>
                    </div>
                `).join('')
                : `<span>${b.items_purchased || 0} Item(s)</span>`;
            
            const statusColor = b.overall_status === 'Paid' ? '#2e7d32' : b.overall_status === 'Partial' ? '#e65100' : '#c62828';
            const statusBg = b.overall_status === 'Paid' ? '#e8f5e9' : b.overall_status === 'Partial' ? '#fff3e0' : '#ffebee';

            return `
                <tr>
                    <td style="text-align: center; vertical-align: top;">${idx + 1}</td>
                    <td style="font-weight: bold; vertical-align: top; word-break: break-word;">
                        ${b.buyer_name}
                        ${b.prayer_group_name && b.prayer_group_name !== 'NA' ? `<br><small style="color: #666; font-weight: normal; font-size: 9px;">${b.prayer_group_name}</small>` : ''}
                    </td>
                    <td style="text-align: center; vertical-align: top;">${b.buyer_code_c || 'N/A'}</td>
                    <td style="text-align: center; vertical-align: top;">${b.buyer_phone || '—'}</td>
                    <td style="font-size: 10px; vertical-align: top; text-align: left;">${itemsStr}</td>
                    <td style="text-align: right; font-weight: bold; vertical-align: top; white-space: nowrap; padding-right: 8px;">${Number(b.total_purchased || 0).toFixed(3)}</td>
                    <td style="text-align: right; color: #2e7d32; font-weight: 600; vertical-align: top; white-space: nowrap; padding-right: 8px;">${Number(b.total_paid || 0).toFixed(3)}</td>
                    <td style="text-align: right; font-weight: bold; color: ${Number(b.total_balance) > 0 ? '#c62828' : '#222'}; vertical-align: top; white-space: nowrap; padding-right: 8px;">${Number(b.total_balance || 0).toFixed(3)}</td>
                    <td style="text-align: center; vertical-align: top; white-space: nowrap;">
                        <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: bold; background: ${statusBg}; color: ${statusColor};">
                            ${b.overall_status}
                        </span>
                    </td>
                </tr>
            `;
        }).join('');

        const printHtml = `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>Auction Sales & Financial Report (${year})</title>
    <style>
        @page {
            size: A4 portrait;
            margin: 8mm 8mm;
        }
        html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
            color: #000000;
            font-family: Arial, "Helvetica Neue", sans-serif;
            font-size: 10.5px;
            line-height: 1.3;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        .report-header {
            text-align: center;
            border-bottom: 2px solid #000000;
            padding-bottom: 6px;
            margin-bottom: 10px;
        }
        .report-header img {
            height: 38px;
            max-width: 360px;
            object-fit: contain;
            margin-bottom: 4px;
        }
        .report-title {
            font-size: 14px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin: 2px 0;
            color: #111111;
        }
        .report-subtitle {
            font-size: 11px;
            color: #444444;
            margin: 2px 0 4px 0;
        }
        .report-meta {
            display: flex;
            justify-content: space-between;
            font-size: 10px;
            color: #555555;
            margin-top: 5px;
            padding-top: 4px;
            border-top: 1px dashed #cccccc;
        }
        /* KPI Cards Grid */
        .kpi-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 8px;
            margin-bottom: 12px;
        }
        .kpi-card {
            border: 1px solid #777777;
            border-radius: 5px;
            padding: 6px 8px;
            background: #fafafa;
            text-align: center;
        }
        .kpi-title {
            font-size: 9px;
            text-transform: uppercase;
            font-weight: bold;
            color: #555555;
            margin-bottom: 2px;
        }
        .kpi-val {
            font-size: 13.5px;
            font-weight: bold;
            color: #000000;
        }
        /* Tables */
        h4.section-title {
            font-size: 11.5px;
            font-weight: bold;
            text-transform: uppercase;
            margin: 10px 0 4px 0;
            padding-bottom: 2px;
            border-bottom: 1.5px solid #444444;
            color: #000000;
        }
        table.report-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 10px;
            margin-bottom: 12px;
            table-layout: fixed;
        }
        table.report-table th, table.report-table td {
            box-sizing: border-box;
        }
        table.report-table th {
            background-color: #e2e8f0 !important;
            color: #000000 !important;
            font-weight: bold;
            border: 1px solid #94a3b8;
            padding: 4px 5px;
            text-align: left;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        table.report-table td {
            border: 1px solid #cbd5e1;
            padding: 4px 5px;
        }
        table.report-table tr:nth-child(even) td {
            background-color: #f8fafc;
        }
        table.report-table tfoot td {
            background-color: #e2e8f0 !important;
            font-weight: bold;
            border: 1px solid #94a3b8;
            padding: 4px 5px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }
        tr {
            page-break-inside: avoid;
            break-inside: avoid;
        }
    </style>
</head>
<body>
    <div class="report-header">
        <img src="/images/logo/red_full_logo.png" alt="St. Mary's Indian Orthodox Cathedral" onerror="this.src='/images/logo/login-page-logo.png'">
        <div class="report-title">Harvest Festival & Article Auction — Official Sales & Financial Report</div>
        <div class="report-subtitle">Annual Cathedral Auction Settlement & Revenue Summary</div>
        <div class="report-meta">
            <div><strong>Year:</strong> ${year}</div>
            <div><strong>Total Registered Bidders:</strong> ${summary.total_bidders || 0}</div>
            <div><strong>Report Generated:</strong> ${printDate}</div>
        </div>
    </div>

    <!-- KPI Summary Cards -->
    <div class="kpi-grid">
        <div class="kpi-card">
            <div class="kpi-title">Total Auction Revenue</div>
            <div class="kpi-val">BHD ${Number(summary.total_auction_revenue || 0).toFixed(3)}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-title">Cash Collections (Paid)</div>
            <div class="kpi-val" style="color: #2e7d32;">BHD ${Number(summary.total_collected_amount || 0).toFixed(3)}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-title">Outstanding Receivables</div>
            <div class="kpi-val" style="color: #c62828;">BHD ${Number(summary.total_receivable_promises || 0).toFixed(3)}</div>
        </div>
        <div class="kpi-card">
            <div class="kpi-title">Articles Clearance</div>
            <div class="kpi-val">${summary.sold_articles || 0} / ${summary.total_articles || 0} Sold</div>
        </div>
    </div>

    <!-- Category Breakdown Table -->
    <h4 class="section-title">Category-Wise Performance Summary</h4>
    <table class="report-table">
        <thead>
            <tr>
                <th style="width: 5%; text-align: center; vertical-align: middle;">#</th>
                <th style="width: 35%; text-align: left; vertical-align: middle;">Category</th>
                <th style="width: 12%; text-align: center; vertical-align: middle;">Articles</th>
                <th style="width: 12%; text-align: center; vertical-align: middle;">Sold</th>
                <th style="width: 18%; text-align: right; vertical-align: middle; padding-right: 6px;">Est. Value (BHD)</th>
                <th style="width: 18%; text-align: right; vertical-align: middle; padding-right: 6px;">Total Sales (BHD)</th>
            </tr>
        </thead>
        <tbody>
            ${categoryRowsHtml || '<tr><td colspan="6" style="text-align: center;">No categories available.</td></tr>'}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="2" style="text-align: right; font-weight: bold;">Total:</td>
                <td style="text-align: center; font-weight: bold;">${catTotalArticles}</td>
                <td style="text-align: center; font-weight: bold;">${catTotalSold}</td>
                <td style="text-align: right; font-weight: bold; padding-right: 6px;">${catTotalEst.toFixed(3)}</td>
                <td style="text-align: right; font-weight: bold; padding-right: 6px;">${catTotalBid.toFixed(3)}</td>
            </tr>
        </tfoot>
    </table>

    <!-- Buyer Settlement Ledger -->
    <h4 class="section-title">Member & Buyer Settlement Ledger</h4>
    <table class="report-table">
        <thead>
            <tr>
                <th style="width: 3%; text-align: center; vertical-align: middle;">#</th>
                <th style="width: 16%; text-align: left; vertical-align: middle;">Buyer / Member Name</th>
                <th style="width: 5.5%; text-align: center; vertical-align: middle;">Roll No</th>
                <th style="width: 8.5%; text-align: center; vertical-align: middle;">Phone</th>
                <th style="width: 32%; text-align: left; vertical-align: middle;">Articles</th>
                <th style="width: 10%; text-align: right; vertical-align: middle; padding-right: 8px;">Total Bid<br><span style="font-size: 8.5px; font-weight: normal; color: #444;">(BHD)</span></th>
                <th style="width: 10%; text-align: right; vertical-align: middle; padding-right: 8px;">Total Paid<br><span style="font-size: 8.5px; font-weight: normal; color: #444;">(BHD)</span></th>
                <th style="width: 9%; text-align: right; vertical-align: middle; padding-right: 8px;">Balance<br><span style="font-size: 8.5px; font-weight: normal; color: #444;">(BHD)</span></th>
                <th style="width: 6%; text-align: center; vertical-align: middle;">Status</th>
            </tr>
        </thead>
        <tbody>
            ${buyerRowsHtml || '<tr><td colspan="9" style="text-align: center;">No buyer records found.</td></tr>'}
        </tbody>
        <tfoot>
            <tr>
                <td colspan="5" style="text-align: right; font-weight: bold;">Grand Totals (${buyers.length} Buyers):</td>
                <td style="text-align: right; white-space: nowrap; font-weight: bold; padding-right: 8px;">${buyerTotalBid.toFixed(3)}</td>
                <td style="text-align: right; color: #2e7d32; white-space: nowrap; font-weight: bold; padding-right: 8px;">${buyerTotalPaid.toFixed(3)}</td>
                <td style="text-align: right; color: ${buyerTotalBalance > 0 ? '#c62828' : '#222'}; white-space: nowrap; font-weight: bold; padding-right: 8px;">${buyerTotalBalance.toFixed(3)}</td>
                <td></td>
            </tr>
        </tfoot>
    </table>
</body>
</html>`;

        const doc = iframe.contentWindow.document;
        doc.open();
        doc.write(printHtml);
        doc.close();

        let printed = false;
        const doPrint = () => {
            if (printed) return;
            printed = true;
            try {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
            } catch (err) {
                console.error("Iframe print error:", err);
                window.print();
            }
        };

        setTimeout(doPrint, 350);
        iframe.onload = doPrint;
    };

    return (
        <div>
            <div className="card" style={{ marginBottom: '28px' }}>
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <i className="material-icons" style={{ fontSize: '28px', color: 'var(--primary)' }}>insert_chart</i>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
                                Auction Sales & Financial Reports ({year})
                            </h3>
                            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                                Annual Harvest Festival Auction Summary across all categories
                            </p>
                        </div>
                    </div>
                    <button className="btn btn-indigo btn-sm" onClick={handlePrintReport}>
                        <i className="material-icons">print</i> Print Report
                    </button>
                </div>
                <div className="card-body">
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '30px' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
                    ) : summary && (
                        <div>
                            <div className="stats-grid">
                                <div className="stat-card">
                                    <div className="stat-info-col">
                                        <span className="stat-title">Auction Revenue</span>
                                        <div className="stat-value">BHD {Number(summary.total_auction_revenue).toFixed(3)}</div>
                                    </div>
                                    <i className="material-icons background-round gradient-45deg-indigo-purple gradient-shadow white-text">gavel</i>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-info-col">
                                        <span className="stat-title">Cash Collections</span>
                                        <div className="stat-value">BHD {Number(summary.total_collected_amount).toFixed(3)}</div>
                                    </div>
                                    <i className="material-icons background-round gradient-45deg-green-teal gradient-shadow white-text">check_circle</i>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-info-col">
                                        <span className="stat-title">Outstanding Receivables</span>
                                        <div className="stat-value">BHD {Number(summary.total_receivable_promises).toFixed(3)}</div>
                                    </div>
                                    <i className="material-icons background-round gradient-45deg-amber-amber gradient-shadow white-text">account_balance_wallet</i>
                                </div>
                                <div className="stat-card">
                                    <div className="stat-info-col">
                                        <span className="stat-title">Total Participants</span>
                                        <div className="stat-value">{summary.total_bidders} Bidders</div>
                                    </div>
                                    <i className="material-icons background-round gradient-45deg-light-blue-cyan gradient-shadow white-text">groups</i>
                                </div>
                            </div>

                            <h4 style={{ fontSize: '15px', marginTop: '24px', marginBottom: '14px', fontWeight: '700' }}>Category Wise Performance</h4>
                            <DataTable 
                                columns={[
                                    {
                                        header: 'SL No',
                                        id: 'sl_no',
                                        searchable: false,
                                        sortable: false,
                                        headerStyle: { width: '60px', textAlign: 'center' },
                                        style: { textAlign: 'center', width: '60px', fontWeight: 600, color: 'var(--text-muted)' },
                                        render: (c, index) => <span style={{ fontSize: '12px' }}>{index + 1}</span>
                                    },
                                    {
                                        header: 'Category',
                                        accessor: 'category',
                                        sortable: true,
                                        render: (c) => <strong style={{ color: 'var(--text-primary)' }}>{c.category}</strong>
                                    },
                                    {
                                        header: 'Articles Count',
                                        accessor: 'article_count',
                                        sortable: true,
                                        sortValue: (c) => Number(c.article_count) || 0
                                    },
                                    {
                                        header: 'Sold Count',
                                        accessor: 'sold_count',
                                        sortable: true,
                                        sortValue: (c) => Number(c.sold_count) || 0,
                                        render: (c) => <span className="badge badge-success">{c.sold_count}</span>
                                    },
                                    {
                                        header: 'Est. Value',
                                        accessor: 'estimated_val',
                                        sortable: true,
                                        sortValue: (c) => Number(c.estimated_val) || 0,
                                        render: (c) => `BHD ${Number(c.estimated_val).toFixed(3)}`
                                    },
                                    {
                                        header: 'Total Auction Sales',
                                        accessor: 'total_bid_val',
                                        sortable: true,
                                        sortValue: (c) => Number(c.total_bid_val) || 0,
                                        render: (c) => <strong style={{ color: 'var(--primary)' }}>BHD {Number(c.total_bid_val).toFixed(3)}</strong>
                                    }
                                ]}
                                data={summary.category_breakdown || []}
                                keyField="category"
                                initialPageSize={10}
                                searchPlaceholder="Search category performance..."
                                emptyMessage="No category performance data."
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Buyer Report */}
            <div className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <i className="material-icons" style={{ fontSize: '28px', color: 'var(--primary)' }}>receipt_long</i>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
                                Member & Buyer Settlement Ledger ({year})
                            </h3>
                            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)' }}>
                                Buyer-wise purchase totals, payments, and open balances
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            onClick={fetchReports} 
                            title="Reload Report Data"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                            <i className="material-icons" style={{ fontSize: '16px' }}>refresh</i> Reload
                        </button>
                        <button className="btn btn-excel btn-sm" onClick={exportBuyerReport}>
                            <i className="material-icons">file_download</i> Export Excel Ledger
                        </button>
                    </div>
                </div>
                
                <DataTable 
                    columns={[
                        {
                            header: 'SL No',
                            id: 'sl_no',
                            searchable: false,
                            sortable: false,
                            headerStyle: { width: '60px', textAlign: 'center' },
                            style: { textAlign: 'center', width: '60px', fontWeight: 600, color: 'var(--text-muted)' },
                            render: (b, index) => <span style={{ fontSize: '12px' }}>{index + 1}</span>
                        },
                        {
                            header: 'Buyer / Member Name',
                            accessor: 'buyer_name',
                            sortable: true,
                            render: (b) => <strong style={{ color: 'var(--text-primary)' }}>{b.buyer_name}</strong>
                        },
                        {
                            header: 'Roll No',
                            accessor: 'buyer_code_c',
                            sortable: true,
                            render: (b) => b.buyer_code_c ? <strong style={{ color: 'var(--primary)' }}>{b.buyer_code_c}</strong> : 'N/A'
                        },
                        {
                            header: 'CPR No',
                            accessor: 'cpr_no',
                            sortable: true,
                            render: (b) => b.cpr_no || 'N/A'
                        },
                        {
                            header: 'Contact Phone',
                            accessor: 'buyer_phone',
                            sortable: true,
                            render: (b) => b.buyer_phone || 'N/A'
                        },
                        {
                            header: 'Items Bought',
                            accessor: 'items_purchased',
                            sortable: true,
                            sortValue: (b) => Number(b.items_purchased) || 0,
                            searchValue: (b) => {
                                const itemsStr = Array.isArray(b.items) 
                                    ? b.items.map(i => `${i.tag_number || ''} ${i.article_number || ''} ${i.article_name || ''}`).join(' ') 
                                    : '';
                                return `${b.items_purchased || ''} ${itemsStr}`;
                            },
                            style: { minWidth: '260px' },
                            render: (b) => (
                                <div>
                                    <div style={{ marginBottom: (Array.isArray(b.items) && b.items.length > 0) ? '6px' : '0' }}>
                                        <span className="badge badge-secondary" style={{ fontWeight: 700, fontSize: '11px', letterSpacing: '0.3px' }}>
                                            {b.items_purchased} {b.items_purchased === 1 ? 'Item' : 'Items'}
                                        </span>
                                    </div>
                                    {Array.isArray(b.items) && b.items.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                            {b.items.map((it, idx) => (
                                                <div 
                                                    key={idx} 
                                                    style={{ 
                                                        fontSize: '12px', 
                                                        lineHeight: '1.3',
                                                        padding: '4px 8px',
                                                        background: 'var(--bg-card, rgba(255, 255, 255, 0.04))',
                                                        border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                                                        borderRadius: '6px'
                                                    }}
                                                >
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px', flexWrap: 'wrap' }}>
                                                        {it.tag_number && (
                                                            <span className="tag-badge" style={{ fontSize: '10px', padding: '1px 5px', fontWeight: 700 }}>
                                                                {it.tag_number}
                                                            </span>
                                                        )}
                                                        {it.article_number && (
                                                            <span style={{ 
                                                                fontSize: '10px', 
                                                                color: 'var(--text-muted)', 
                                                                fontFamily: 'monospace', 
                                                                background: 'rgba(255,255,255,0.06)', 
                                                                padding: '1px 4px', 
                                                                borderRadius: '3px' 
                                                            }}>
                                                                {it.article_number}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                        {it.article_name}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )
                        },
                        {
                            header: 'Total Purchases',
                            accessor: 'total_purchased',
                            sortable: true,
                            sortValue: (b) => Number(b.total_purchased) || 0,
                            render: (b) => <strong>BHD {Number(b.total_purchased).toFixed(3)}</strong>
                        },
                        {
                            header: 'Paid Amount',
                            accessor: 'total_paid',
                            sortable: true,
                            sortValue: (b) => Number(b.total_paid) || 0,
                            render: (b) => <span style={{ color: 'var(--success)' }}>{Number(b.total_paid).toFixed(3)}</span>
                        },
                        {
                            header: 'Balance Due',
                            accessor: 'total_balance',
                            sortable: true,
                            sortValue: (b) => Number(b.total_balance) || 0,
                            render: (b) => (
                                <span style={{ color: Number(b.total_balance) > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                                    {Number(b.total_balance).toFixed(3)}
                                </span>
                            )
                        },
                        {
                            header: 'Status',
                            accessor: 'overall_status',
                            sortable: true,
                            render: (b) => (
                                <span className={`badge badge-${
                                    b.overall_status === 'Paid' ? 'success' :
                                    b.overall_status === 'Partial' ? 'warning' : 'danger'
                                }`}>
                                    {b.overall_status}
                                </span>
                            )
                        }
                    ]}
                    data={buyers}
                    loading={loading}
                    keyField={(b, i) => `${b.buyer_name}_${i}`}
                    initialPageSize={10}
                    searchPlaceholder="Search by SL No, Buyer Name, Roll No, CPR, Phone..."
                    emptyMessage="No buyer ledger records found for this year."
                />
            </div>
        </div>
    );
}

// --- User Management Modal (Create / Edit) ---
function UserModal({ isOpen, onClose, userToEdit, onSaved, showToast }) {
    if (!isOpen) return null;

    const isEdit = Boolean(userToEdit);
    const [profileName, setProfileName] = useState(userToEdit?.profile_name || '');
    const [username, setUsername] = useState(userToEdit?.username || '');
    const [password, setPassword] = useState('');
    const [mobileNumber, setMobileNumber] = useState(userToEdit?.mobile_number || '');
    const [userType, setUserType] = useState(userToEdit?.user_type || 'User');
    const [status, setStatus] = useState(userToEdit?.status || 'Active');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!profileName.trim()) {
            setError('Please enter Profile Name.');
            return;
        }
        if (!isEdit && !username.trim()) {
            setError('Please enter Username.');
            return;
        }
        if (!isEdit && !password.trim()) {
            setError('Please enter Password.');
            return;
        }

        setLoading(true);
        try {
            if (isEdit) {
                const res = await api.put(`/api/users/${userToEdit.id}`, {
                    profile_name: profileName.trim(),
                    mobile_number: mobileNumber.trim(),
                    user_type: userType,
                    status: status
                });
                if (res.success) {
                    if (typeof window.swal === 'function') {
                        window.swal({
                            title: "User Updated",
                            text: `User details for "${res.user.profile_name}" have been saved.`,
                            icon: "success",
                            timer: 2000,
                            buttons: false
                        });
                    }
                    showToast('success', 'User updated successfully.');
                    onSaved();
                    onClose();
                } else {
                    setError(res.error || 'Failed to update user.');
                }
            } else {
                const res = await api.post('/api/users', {
                    profile_name: profileName.trim(),
                    username: username.trim(),
                    password: password.trim(),
                    mobile_number: mobileNumber.trim(),
                    user_type: userType,
                    status: status
                });
                if (res.success) {
                    if (typeof window.swal === 'function') {
                        window.swal({
                            title: "User Created",
                            text: `New user "${res.user.profile_name}" (@${res.user.username}) created.`,
                            icon: "success",
                            timer: 2000,
                            buttons: false
                        });
                    }
                    showToast('success', `User @${res.user.username} created successfully.`);
                    onSaved();
                    onClose();
                } else {
                    setError(res.error || 'Failed to create user.');
                }
            }
        } catch (err) {
            setError(err.message || 'An error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div 
                className="modal-content" 
                style={{ width: '95%', maxWidth: '640px', margin: 'auto', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            >
                <ModalHeader 
                    title={isEdit ? `Edit User: @${userToEdit.username}` : "Add New User"} 
                    icon={isEdit ? "manage_accounts" : "person_add"} 
                    onClose={onClose} 
                    badge={isEdit ? userToEdit.user_type : "tbl_users"}
                />

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                        {error && (
                            <div className="badge badge-danger" style={{ width: '100%', padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px' }}>
                                ⚠️ {error}
                            </div>
                        )}

                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label className="form-label" style={{ fontWeight: 600 }}>Profile Name <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input 
                                type="text"
                                className="form-control"
                                placeholder="Profile Name"
                                value={profileName}
                                onChange={e => setProfileName(e.target.value)}
                                required
                            />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: isEdit ? '1fr' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                            <div className="form-group">
                                <label className="form-label" style={{ fontWeight: 600 }}>Username <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <input 
                                    type="text"
                                    className="form-control"
                                    placeholder="Username"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                    disabled={isEdit}
                                    style={isEdit ? { background: 'var(--bg-card)', opacity: 0.75, cursor: 'not-allowed' } : {}}
                                    required
                                />
                            </div>

                            {!isEdit && (
                                <div className="form-group">
                                    <label className="form-label" style={{ fontWeight: 600 }}>Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                                    <div style={{ position: 'relative' }}>
                                        <input 
                                            type={showPassword ? "text" : "password"}
                                            className="form-control"
                                            placeholder="Password"
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            style={{ paddingRight: '38px' }}
                                            required
                                        />
                                        <i 
                                            className="material-icons"
                                            onClick={() => setShowPassword(!showPassword)}
                                            style={{ position: 'absolute', right: '10px', top: '10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '18px', userSelect: 'none' }}
                                            title={showPassword ? "Hide password" : "Show password"}
                                        >
                                            {showPassword ? "visibility_off" : "visibility"}
                                        </i>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px', marginBottom: '14px' }}>
                            <div className="form-group">
                                <label className="form-label" style={{ fontWeight: 600 }}>Mobile Number</label>
                                <input 
                                    type="text"
                                    className="form-control"
                                    placeholder="Mobile Number"
                                    value={mobileNumber}
                                    onChange={e => setMobileNumber(e.target.value)}
                                />
                            </div>

                            <div className="form-group">
                                <label className="form-label" style={{ fontWeight: 600 }}>User Type <span style={{ color: 'var(--danger)' }}>*</span></label>
                                <select 
                                    className="form-control"
                                    value={userType}
                                    onChange={e => setUserType(e.target.value)}
                                >
                                    <option value="User">User</option>
                                    <option value="Administrator">Administrator</option>
                                </select>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label" style={{ fontWeight: 600 }}>Status</label>
                            <select 
                                className="form-control"
                                value={status}
                                onChange={e => setStatus(e.target.value)}
                            >
                                <option value="Active">Active</option>
                                <option value="Inactive">Inactive</option>
                            </select>
                        </div>

                        {isEdit && (
                            <div style={{ marginTop: '12px', padding: '10px 14px', background: 'rgba(33, 150, 243, 0.08)', borderRadius: '8px', border: '1px solid rgba(33, 150, 243, 0.2)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                💡 To change the password, use the <strong>Reset Password</strong> button on the user row.
                            </div>
                        )}
                    </div>

                    <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-gradient btn-sm" disabled={loading}>
                            {loading ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create User')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Reset Password Modal ---
function ResetPasswordModal({ isOpen, onClose, user, onResetSuccess, showToast }) {
    if (!isOpen || !user) return null;

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const handleReset = async (e) => {
        e.preventDefault();
        setError(null);

        if (!newPassword.trim()) {
            setError('Please enter New Password.');
            return;
        }
        if (newPassword.length < 3) {
            setError('Password must be at least 3 characters.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match. Please retype carefully.');
            return;
        }

        setLoading(true);
        try {
            const res = await api.post(`/api/users/${user.id}/reset-password`, {
                password: newPassword.trim()
            });
            if (res.success) {
                if (typeof window.swal === 'function') {
                    window.swal({
                        title: "Password Reset Successful",
                        text: `The password for user "${user.profile_name}" (@${user.username}) has been updated.`,
                        icon: "success",
                        timer: 2500,
                        buttons: false
                    });
                }
                showToast('success', `Password reset for @${user.username}.`);
                onResetSuccess();
                onClose();
            } else {
                setError(res.error || 'Failed to reset password.');
            }
        } catch (err) {
            setError(err.message || 'An error occurred.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div 
                className="modal-content" 
                style={{ width: '95%', maxWidth: '520px', margin: 'auto', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            >
                <ModalHeader 
                    title={`Reset Password: @${user.username}`} 
                    icon="lock_reset" 
                    onClose={onClose} 
                    badge={user.user_type}
                />

                <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                    <div className="modal-body" style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
                        {error && (
                            <div className="badge badge-danger" style={{ width: '100%', padding: '10px 14px', marginBottom: '16px', borderRadius: '8px', fontSize: '13px' }}>
                                ⚠️ {error}
                            </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: 'var(--bg-card)', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '18px' }}>
                            <div style={{ 
                                width: '42px', 
                                height: '42px', 
                                borderRadius: '50%', 
                                background: 'linear-gradient(45deg, #1565c0, #1e88e5)', 
                                color: '#ffffff', 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center', 
                                fontWeight: 700, 
                                fontSize: '18px' 
                            }}>
                                {(user.profile_name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{user.profile_name}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{user.username} &bull; {user.user_type}</div>
                            </div>
                        </div>

                        <div className="form-group" style={{ marginBottom: '14px' }}>
                            <label className="form-label" style={{ fontWeight: 600 }}>New Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <div style={{ position: 'relative' }}>
                                <input 
                                    type={showPassword ? "text" : "password"}
                                    className="form-control"
                                    placeholder="New Password"
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    style={{ paddingRight: '38px' }}
                                    required
                                />
                                <i 
                                    className="material-icons"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{ position: 'absolute', right: '10px', top: '10px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '18px', userSelect: 'none' }}
                                    title={showPassword ? "Hide password" : "Show password"}
                                >
                                    {showPassword ? "visibility_off" : "visibility"}
                                </i>
                            </div>
                        </div>

                        <div className="form-group">
                            <label className="form-label" style={{ fontWeight: 600 }}>Confirm New Password <span style={{ color: 'var(--danger)' }}>*</span></label>
                            <input 
                                type={showPassword ? "text" : "password"}
                                className="form-control"
                                placeholder="Confirm New Password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="modal-footer" style={{ padding: '14px 20px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose} disabled={loading}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-indigo btn-sm" disabled={loading}>
                            {loading ? 'Updating...' : 'Set New Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

// --- Users Management View (Connected with tbl_users) ---
function UsersView({ currentUser, showToast }) {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [roleFilter, setRoleFilter] = useState('All');
    const [statusFilter, setStatusFilter] = useState('All');
    const [ledgerModalOpen, setLedgerModalOpen] = useState(false);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/users');
            if (res.success) {
                setUsers(res.users);
            } else {
                showToast('error', res.error || 'Failed to load users.');
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUsers();
    }, []);

    const filteredUsers = useMemo(() => {
        return users.filter(u => {
            if (roleFilter !== 'All' && u.user_type !== roleFilter) return false;
            if (statusFilter !== 'All' && u.status !== statusFilter) return false;
            return true;
        });
    }, [users, roleFilter, statusFilter]);

    // Metrics
    const totalUsers = users.length;
    const activeUsers = users.filter(u => u.status === 'Active').length;
    const adminUsers = users.filter(u => u.user_type === 'Administrator').length;
    const hfUsers = users.filter(u => u.user_type === 'Harvest Festival' || u.user_type !== 'Administrator').length;

    const columns = [
        {
            header: 'User / Profile',
            accessor: 'profile_name',
            sortable: true,
            render: (u) => {
                const initial = (u.profile_name || 'U').charAt(0).toUpperCase();
                const isAdmin = u.user_type === 'Administrator';
                return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ 
                            width: '38px', 
                            height: '38px', 
                            borderRadius: '50%', 
                            background: isAdmin ? 'linear-gradient(45deg, #7b1fa2, #ab47bc)' : 'linear-gradient(45deg, #1565c0, #1e88e5)',
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '15px',
                            boxShadow: isAdmin ? '0 2px 8px rgba(123, 31, 162, 0.35)' : '0 2px 8px rgba(21, 101, 192, 0.35)'
                        }}>
                            {initial}
                        </div>
                        <div>
                            <strong style={{ color: 'var(--text-primary)', fontSize: '14px', display: 'block' }}>{u.profile_name}</strong>
                            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>@{u.username}</span>
                        </div>
                    </div>
                );
            }
        },
        {
            header: 'Username',
            accessor: 'username',
            sortable: true,
            render: (u) => (
                <code style={{ 
                    background: 'var(--bg-card)', 
                    padding: '3px 8px', 
                    borderRadius: '6px', 
                    border: '1px solid var(--border-color)', 
                    fontWeight: 600, 
                    color: 'var(--text-primary)',
                    fontSize: '12px' 
                }}>
                    {u.username}
                </code>
            )
        },
        {
            header: 'Mobile Number',
            accessor: 'mobile_number',
            sortable: true,
            render: (u) => (u.mobile_number && u.mobile_number !== 'NA') ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', fontSize: '13px' }}>
                    <i className="material-icons" style={{ fontSize: '15px', color: 'var(--primary)' }}>phone</i>
                    {u.mobile_number}
                </span>
            ) : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>&mdash;</span>
        },
        {
            header: 'User Type',
            accessor: 'user_type',
            sortable: true,
            render: (u) => {
                const isAdmin = u.user_type === 'Administrator';
                return (
                    <span 
                        className={`badge ${isAdmin ? 'btn-purple' : 'btn-indigo'}`}
                        style={{ 
                            padding: '4px 10px', 
                            borderRadius: '12px', 
                            fontSize: '11px', 
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        <i className="material-icons" style={{ fontSize: '13px' }}>{isAdmin ? 'shield' : 'person'}</i>
                        {u.user_type}
                    </span>
                );
            }
        },
        {
            header: 'Status',
            accessor: 'status',
            sortable: true,
            render: (u) => {
                const isActive = u.status === 'Active';
                return (
                    <span 
                        className={`badge ${isActive ? 'badge-success' : 'badge-danger'}`}
                        style={{ padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}
                    >
                        {isActive ? '● Active' : '○ Inactive'}
                    </span>
                );
            }
        },
        {
            header: 'Email',
            accessor: 'user_email',
            sortable: true,
            render: (u) => (u.user_email && u.user_email !== 'NA') ? (
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{u.user_email}</span>
            ) : <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>&mdash;</span>
        },
        {
            header: 'Created On',
            accessor: 'created_at',
            sortable: true,
            render: (u) => (
                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    {formatDateDMY(u.created_at)}
                </span>
            )
        }
    ];

    return (
        <div>
            {/* Page Header */}
            <div style={{ marginBottom: '20px' }}>
                <h2 style={{ color: 'var(--primary)', fontWeight: 700, margin: 0, fontSize: '24px' }}>
                    User Administration
                </h2>
            </div>

            {/* Metrics Grid */}
            <div className="stats-grid" style={{ marginBottom: '20px' }}>
                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Total Users</span>
                        <div className="stat-value">{totalUsers}</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-indigo-blue gradient-shadow white-text">group</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Active Accounts</span>
                        <div className="stat-value" style={{ color: 'var(--success)' }}>{activeUsers}</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-green-teal gradient-shadow white-text">check_circle</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">Administrators</span>
                        <div className="stat-value" style={{ color: '#8e24aa' }}>{adminUsers}</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-purple-amber gradient-shadow white-text">shield</i>
                </div>

                <div className="stat-card">
                    <div className="stat-info-col">
                        <span className="stat-title">HF Data Entry</span>
                        <div className="stat-value" style={{ color: '#1565c0' }}>{hfUsers}</div>
                    </div>
                    <i className="material-icons background-round gradient-45deg-amber-double gradient-shadow white-text">assignment_ind</i>
                </div>
            </div>

            {/* Main Card */}
            <div className="card">
                <div className="card-header" style={{ flexWrap: 'wrap', gap: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3>Portal User Accounts (tbl_users)</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Authorized Administrator and Harvest Festival data entry accounts from tbl_users</p>
                    </div>
                    <div>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setLedgerModalOpen(true)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
                            title="Configure default church accounts ledgers for all auction users"
                        >
                            <i className="material-icons" style={{ fontSize: '18px' }}>account_balance</i>
                            Default Auction Ledgers
                        </button>
                    </div>
                </div>

                {/* Filter Toolbar */}
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>User Type:</span>
                        <select className="form-control" style={{ width: '190px' }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                            <option value="All">All User Types</option>
                            <option value="Administrator">Administrator</option>
                            <option value="Harvest Festival">Harvest Festival</option>
                        </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Status:</span>
                        <select className="form-control" style={{ width: '150px' }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                            <option value="All">All Statuses</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                        </select>
                    </div>

                    <div style={{ marginLeft: 'auto' }}>
                        <button 
                            className="btn btn-secondary btn-sm"
                            onClick={fetchUsers}
                            title="Refresh users list"
                        >
                            <i className="material-icons" style={{ fontSize: '16px' }}>refresh</i> Refresh
                        </button>
                    </div>
                </div>

                <div className="card-body" style={{ padding: '0' }}>
                    <DataTable 
                        columns={columns}
                        data={filteredUsers}
                        loading={loading}
                        keyField={(u) => u.id}
                        initialPageSize={10}
                        searchPlaceholder="Search by profile name, username, mobile..."
                        emptyMessage="No system users match the selected filters."
                    />
                </div>
            </div>

            {/* Default Ledger Settings Modal for Admins */}
            {ledgerModalOpen && (
                <DefaultLedgerSettingsModal 
                    isOpen={ledgerModalOpen}
                    onClose={() => setLedgerModalOpen(false)}
                    showToast={showToast}
                />
            )}
        </div>
    );
}

// --- Main App Root Component ---
function App() {
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('dashboard');
    const currentCalYear = new Date().getFullYear();
    const [year, setYear] = useState(currentCalYear);
    const [availableYears, setAvailableYears] = useState([currentCalYear]);
    const [stats, setStats] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [reportsDropdownOpen, setReportsDropdownOpen] = useState(false);
    const reportsDropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (e) => {
            if (reportsDropdownRef.current && !reportsDropdownRef.current.contains(e.target)) {
                setReportsDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Theme state: default to 'light' (white color mode across application), user can toggle
    const [theme, setTheme] = useState(() => {
        const saved = localStorage.getItem('auction_portal_theme');
        return saved ? saved : 'light';
    });

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('auction_portal_theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(t => t === 'dark' ? 'light' : 'dark');
    };

    // Modals
    const [articleModalOpen, setArticleModalOpen] = useState(false);
    const [editingArticle, setEditingArticle] = useState(null);
    const [importModalOpen, setImportModalOpen] = useState(false);
    const [receiptModalNo, setReceiptModalNo] = useState(null);
    const [globalLedgerModalOpen, setGlobalLedgerModalOpen] = useState(false);

    // Global data revision trigger for live datatable updates across views
    const [dataRevision, setDataRevision] = useState(0);

    const refreshData = () => {
        setDataRevision(prev => prev + 1);
        fetchYearsAndStats();
    };

    const showToast = (type, message) => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, type, message }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    };

    const checkAuth = async () => {
        try {
            const res = await api.get('/api/auth/me');
            if (res.authenticated) {
                setUser(res.user);
            }
        } catch (err) {}
        finally {
            setAuthLoading(false);
        }
    };

    const fetchYearsAndStats = async (targetYear) => {
        if (!user) return;
        const activeYear = targetYear !== undefined ? targetYear : year;
        try {
            const [yRes, sRes] = await Promise.all([
                api.get('/api/articles/years'),
                api.get(`/api/auctions/stats?year=${activeYear}`)
            ]);
            if (yRes.success && yRes.years && yRes.years.length) {
                setAvailableYears(yRes.years);
                if (targetYear === undefined) {
                    setYear(prev => {
                        if (yRes.years.includes(currentCalYear)) {
                            return currentCalYear;
                        }
                        return yRes.years.includes(prev) ? prev : yRes.years[0];
                    });
                }
            }
            if (sRes.success) {
                setStats(sRes.stats);
            }
        } catch (err) {}
    };

    const handleYearChange = (newYear) => {
        const y = Number(newYear);
        if (!y || y === year) return;
        setYear(y);
        fetchYearsAndStats(y);
    };

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        fetchYearsAndStats(year);
    }, [user, year]);

    const isAdmin = String(user?.user_type || '').trim().toLowerCase() === 'administrator';

    useEffect(() => {
        if (user && !isAdmin && currentTab === 'users') {
            setCurrentTab('dashboard');
        }
    }, [user, isAdmin, currentTab]);

    const handleLogout = async () => {
        await api.post('/api/auth/logout');
        setUser(null);
        setCurrentTab('dashboard');
        showToast('info', 'Logged out.');
    };

    if (authLoading) {
        return (
            <div className="initial-loader">
                <div className="spinner"></div>
                <p>Verifying session...</p>
            </div>
        );
    }

    if (!user) {
        return (
            <div>
                <ToastContainer toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
                <LoginScreen 
                    onLoginSuccess={u => { 
                        setUser(u); 
                        setCurrentTab('dashboard'); 
                        showToast('success', `Welcome back, ${u.profile_name || u.user_name || u.username}!`); 
                    }} 
                />
            </div>
        );
    }

    return (
        <div className="app-container">
            <ToastContainer toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />

            {/* Top Navigation Bar */}
            <header className="top-navbar">
                <div className="top-navbar-inner">
                    {/* Brand */}
                    <div className="brand-section" onClick={() => setCurrentTab('dashboard')}>
                        <img 
                            src="/images/logo/white_full_logo_2x.png" 
                            srcSet="/images/logo/white_full_logo.png 2x, /images/logo/white_full_logo_2x.png 1x"
                            alt="St. Mary's Indian Orthodox Cathedral" 
                            className="brand-logo-img"
                            onError={(e) => { e.target.src = '/images/logo/white_full_logo.png'; }}
                        />
                        <div className="brand-divider"></div>
                        <div className="brand-text">
                            <h2>Auction Portal</h2>
                        </div>
                    </div>

                    {/* Top Menu Tabs */}
                    <nav className="top-nav-menu">
                        <div 
                            className={`top-nav-item ${currentTab === 'dashboard' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('dashboard')}
                        >
                            <i className="material-icons">dashboard</i>
                            <span>Dashboard</span>
                        </div>

                        <div 
                            className={`top-nav-item ${currentTab === 'articles' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('articles')}
                        >
                            <i className="material-icons">inventory_2</i>
                            <span>Article Master</span>
                            {stats?.total_articles > 0 && <span className="nav-badge">{stats.total_articles}</span>}
                        </div>

                        <div 
                            className={`top-nav-item ${currentTab === 'auction' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('auction')}
                        >
                            <i className="material-icons">gavel</i>
                            <span>Live Auction Desk</span>
                            {stats?.available_articles > 0 && (
                                <span className="nav-badge" style={{ background: 'rgba(255, 255, 255, 0.3)', color: '#ffffff' }}>
                                    {stats.available_articles}
                                </span>
                            )}
                        </div>

                        {/* Sub Menu: More Dropdown (Promises & Dues, Sales Reports, User Management) */}
                        <div className="top-nav-dropdown-container" ref={reportsDropdownRef}>
                            <div 
                                className={`top-nav-item top-nav-dropdown-trigger ${['promises', 'reports', 'users'].includes(currentTab) ? 'active' : ''}`}
                                onClick={() => setReportsDropdownOpen(prev => !prev)}
                                title="More: Promises & Dues, Reports, User Management"
                            >
                                <i className="material-icons">more_horiz</i>
                                <span>More</span>
                                {stats?.active_promises_count > 0 && (
                                    <span className="nav-badge" style={{ background: 'rgba(255, 82, 82, 0.45)', color: '#ffffff' }}>
                                        {stats.active_promises_count}
                                    </span>
                                )}
                                <i className="material-icons dropdown-caret">{reportsDropdownOpen ? 'expand_less' : 'expand_more'}</i>
                            </div>

                            {reportsDropdownOpen && (
                                <div className="top-nav-dropdown-menu">
                                    <div 
                                        className={`top-nav-dropdown-item ${currentTab === 'promises' ? 'active' : ''}`}
                                        onClick={() => {
                                            setCurrentTab('promises');
                                            setReportsDropdownOpen(false);
                                        }}
                                    >
                                        <i className="material-icons">account_balance_wallet</i>
                                        <span style={{ flex: 1 }}>Promises & Dues</span>
                                        {stats?.active_promises_count > 0 && (
                                            <span className="nav-badge" style={{ background: 'rgba(255, 82, 82, 0.25)', color: 'var(--danger)', fontWeight: 700 }}>
                                                {stats.active_promises_count}
                                            </span>
                                        )}
                                    </div>

                                    <div 
                                        className={`top-nav-dropdown-item ${currentTab === 'reports' ? 'active' : ''}`}
                                        onClick={() => {
                                            setCurrentTab('reports');
                                            setReportsDropdownOpen(false);
                                        }}
                                    >
                                        <i className="material-icons">insert_chart</i>
                                        <span>Sales Reports</span>
                                    </div>

                                    {isAdmin && (
                                        <>
                                            <div 
                                                className={`top-nav-dropdown-item ${currentTab === 'users' ? 'active' : ''}`}
                                                onClick={() => {
                                                    setCurrentTab('users');
                                                    setReportsDropdownOpen(false);
                                                }}
                                            >
                                                <i className="material-icons">manage_accounts</i>
                                                <span>User Management</span>
                                            </div>
                                            <div 
                                                className="top-nav-dropdown-item"
                                                onClick={() => {
                                                    setGlobalLedgerModalOpen(true);
                                                    setReportsDropdownOpen(false);
                                                }}
                                            >
                                                <i className="material-icons">account_balance</i>
                                                <span>Default Auction Ledgers</span>
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </nav>

                    {/* Top Actions: Year + Theme Switcher + Profile */}
                    <div className="top-actions">
                        <div className="year-badge-selector">
                            <span>YEAR:</span>
                            <select 
                                className="year-select"
                                value={year} 
                                onChange={e => handleYearChange(e.target.value)}
                            >
                                {availableYears.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>

                        {/* Dark / Light Mode Switcher Button */}
                        <button 
                            className="theme-toggle-btn"
                            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`}
                            onClick={toggleTheme}
                        >
                            {theme === 'dark' ? '☀️' : '🌙'}
                        </button>

                        {/* User Profile - Name, Role & Logout */}
                        <div className="user-profile-badge">
                            <div className="user-info-text">
                                <div className="name">{user.profile_name || user.user_name}</div>
                                <div className="role">{user.user_type}</div>
                            </div>
                            <button className="logout-btn" title="Sign Out" onClick={handleLogout}>
                                <i className="material-icons">keyboard_tab</i>
                            </button>
                        </div>

                        {/* Mobile Hamburger */}
                        <button 
                            className="mobile-hamburger"
                            onClick={() => setSidebarOpen(!sidebarOpen)}
                            title="Toggle Menu"
                        >
                            <i className="material-icons">menu</i>
                        </button>
                    </div>
                </div>

                {/* Mobile Menu Dropdown */}
                <div className={`mobile-nav-drawer ${sidebarOpen ? 'open' : ''}`}>
                    <div style={{ padding: '8px 14px', borderBottom: '1px solid rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ color: '#ffffff', fontSize: '13px', fontWeight: 600 }}>Festival Year:</span>
                        <select 
                            className="form-control" 
                            style={{ width: '120px', padding: '4px 8px', fontSize: '13px', background: 'rgba(255,255,255,0.9)', color: '#2c3e50', fontWeight: 700 }}
                            value={year} 
                            onChange={e => { handleYearChange(e.target.value); setSidebarOpen(false); }}
                        >
                            {availableYears.map(y => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </div>
                    <div 
                        className={`top-nav-item ${currentTab === 'dashboard' ? 'active' : ''}`}
                        onClick={() => { setCurrentTab('dashboard'); setSidebarOpen(false); }}
                    >
                        <i className="material-icons">dashboard</i>
                        <span>Dashboard</span>
                    </div>
                    <div 
                        className={`top-nav-item ${currentTab === 'articles' ? 'active' : ''}`}
                        onClick={() => { setCurrentTab('articles'); setSidebarOpen(false); }}
                    >
                        <i className="material-icons">inventory_2</i>
                        <span>Article Master ({stats?.total_articles || 0})</span>
                    </div>
                    <div 
                        className={`top-nav-item ${currentTab === 'auction' ? 'active' : ''}`}
                        onClick={() => { setCurrentTab('auction'); setSidebarOpen(false); }}
                    >
                        <i className="material-icons">gavel</i>
                        <span>Live Auction Desk ({stats?.available_articles || 0})</span>
                    </div>

                    <div className="mobile-nav-section-title">
                        <span>More Modules & Reports</span>
                    </div>
                    <div 
                        className={`top-nav-item ${currentTab === 'promises' ? 'active' : ''}`}
                        onClick={() => { setCurrentTab('promises'); setSidebarOpen(false); }}
                    >
                        <i className="material-icons">account_balance_wallet</i>
                        <span>Promises & Dues ({stats?.active_promises_count || 0})</span>
                    </div>
                    <div 
                        className={`top-nav-item ${currentTab === 'reports' ? 'active' : ''}`}
                        onClick={() => { setCurrentTab('reports'); setSidebarOpen(false); }}
                    >
                        <i className="material-icons">insert_chart</i>
                        <span>Sales Reports</span>
                    </div>

                    {isAdmin && (
                        <>
                            <div 
                                className={`top-nav-item ${currentTab === 'users' ? 'active' : ''}`}
                                onClick={() => { setCurrentTab('users'); setSidebarOpen(false); }}
                            >
                                <i className="material-icons">manage_accounts</i>
                                <span>User Management</span>
                            </div>
                            <div 
                                className="top-nav-item"
                                onClick={() => { setGlobalLedgerModalOpen(true); setSidebarOpen(false); }}
                            >
                                <i className="material-icons">account_balance</i>
                                <span>Default Auction Ledgers</span>
                            </div>
                        </>
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="main-content">
                {currentTab === 'dashboard' && (
                    <DashboardView 
                        key={year}
                        stats={stats} 
                        year={year} 
                        onNavigate={setCurrentTab}
                        onOpenNewArticle={() => { setEditingArticle(null); setArticleModalOpen(true); }}
                        onOpenImport={() => setImportModalOpen(true)}
                    />
                )}

                {currentTab === 'articles' && (
                    <ArticlesView 
                        key={year}
                        year={year} 
                        refreshTrigger={dataRevision}
                        onDataChanged={refreshData}
                        onOpenNewArticle={() => { setEditingArticle(null); setArticleModalOpen(true); }}
                        onEditArticle={(a) => { 
                            if (a.status !== 'Available') {
                                showToast('warning', `Only articles with status "Available" can be edited (Current: ${a.status}).`);
                                return;
                            }
                            setEditingArticle(a); 
                            setArticleModalOpen(true); 
                        }}
                        onOpenImport={() => setImportModalOpen(true)}
                        showToast={showToast}
                    />
                )}

                {currentTab === 'auction' && (
                    <AuctionDeskView 
                        key={year}
                        year={year} 
                        refreshTrigger={dataRevision}
                        onDataChanged={refreshData}
                        showToast={showToast}
                        onOpenReceipt={rno => setReceiptModalNo(rno)}
                        isAdmin={isAdmin}
                    />
                )}

                {currentTab === 'promises' && (
                    <PromisesView 
                        key={year}
                        year={year} 
                        refreshTrigger={dataRevision}
                        onDataChanged={refreshData}
                        showToast={showToast}
                        onOpenReceipt={rno => setReceiptModalNo(rno)}
                    />
                )}

                {currentTab === 'reports' && (
                    <ReportsView 
                        key={year}
                        year={year} 
                        refreshTrigger={dataRevision}
                        showToast={showToast}
                    />
                )}

                {currentTab === 'users' && isAdmin && (
                    <UsersView 
                        currentUser={user}
                        showToast={showToast}
                    />
                )}
            </main>

            {/* Staging Parallel Cathedral Footer */}
            <footer className="page-footer footer gradient-45deg-purple-deep-orange gradient-shadow">
                <div className="footer-inner">
                    <span>Property of <a href="#" target="_blank">St. Mary’s Indian Orthodox Cathedral</a>.</span>
                    <span>Article Auction & Harvest Festival Management Module</span>
                </div>
            </footer>

            {/* Modals */}
            <ArticleModal 
                article={editingArticle}
                year={year}
                isOpen={articleModalOpen}
                onClose={() => setArticleModalOpen(false)}
                onSuccess={() => {
                    refreshData();
                }}
                showToast={showToast}
            />

            <ExcelImportModal 
                year={year}
                isOpen={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                onSuccess={() => {
                    refreshData();
                }}
                showToast={showToast}
            />

            <ReceiptModal 
                receiptNo={receiptModalNo}
                isOpen={!!receiptModalNo}
                onClose={() => setReceiptModalNo(null)}
            />

            {/* Global Default Auction Ledgers Modal (accessible from More dropdown) */}
            {isAdmin && globalLedgerModalOpen && (
                <DefaultLedgerSettingsModal 
                    isOpen={globalLedgerModalOpen}
                    onClose={() => setGlobalLedgerModalOpen(false)}
                    showToast={showToast}
                    onSaved={() => refreshData()}
                />
            )}
        </div>
    );
}

// Mount React App
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
