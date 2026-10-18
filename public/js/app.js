const { useState, useEffect, useMemo, useRef } = React;

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

                <div className="login-demo-box">
                    <p><strong>System Connected Credentials (tbl_users):</strong></p>
                    <div style={{ marginTop: '6px', fontSize: '12px', lineHeight: '1.6' }}>
                        <div><strong>Admin:</strong> <code>admin</code> / <code>Syskode123#$#</code></div>
                        <div><strong>HF Data Entry:</strong> <code>hf</code> / <code>Sreya8409</code></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '10px' }}>
                        <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => { setUsername('admin'); setPassword('Syskode123#$#'); }}
                        >
                            Admin Login
                        </button>
                        <button 
                            type="button" 
                            className="btn btn-secondary btn-sm" 
                            onClick={() => { setUsername('hf'); setPassword('Sreya8409'); }}
                        >
                            HF Login
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

// --- Dashboard View ---
function DashboardView({ stats, year, onNavigate, onOpenNewArticle, onOpenImport }) {
    return (
        <div>
            {/* Breadcrumbs Header matching staging_parallel */}
            <div className="breadcrumbs-wrapper">
                <div className="breadcrumbs-title">
                    <i className="material-icons">dashboard</i>
                    <h4>Festival Auction Dashboard ({year})</h4>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>Cathedral Auction</span> &gt; <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Festival Overview</span>
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

            {/* Quick Actions & Welcome Banner */}
            <div className="card" style={{ marginBottom: '28px', background: 'linear-gradient(135deg, var(--bg-card), var(--bg-card-hover))' }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '24px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
                        <img 
                            src="/images/logo/red_full_logo.png" 
                            alt="Auction Portal" 
                            style={{ height: '64px', maxWidth: '420px', objectFit: 'contain' }} 
                            onError={(e) => { e.target.src = '/images/logo/login-page-logo.png'; }}
                        />
                        <div>
                            <h2 style={{ fontSize: '20px', marginBottom: '6px' }}>Harvest Festival & Article Auction Hub ({year})</h2>
                            <p style={{ color: 'var(--text-secondary)' }}>
                                Manage article inventory with unique tags, conduct live member bidding, generate instant printed receipts, track payment collections, and monitor receivables.
                            </p>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <button className="btn btn-primary" onClick={onOpenNewArticle}>
                            <i className="material-icons">add_circle_outline</i> Add New Article
                        </button>
                        <button className="btn btn-orange" onClick={onOpenImport}>
                            <i className="material-icons">cloud_upload</i> Import Excel / CSV
                        </button>
                        <button className="btn btn-success" onClick={() => onNavigate('auction')}>
                            <i className="material-icons">gavel</i> Live Auction Desk
                        </button>
                    </div>
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
                            onCategoryDeleted(catId);
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
                    onCategoryDeleted(catId);
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
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{ maxWidth: '680px' }} onClick={e => e.stopPropagation()}>
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
function ArticlesView({ year, onOpenNewArticle, onEditArticle, onOpenImport, showToast }) {
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
            const url = `/api/articles?year=${year}&status=${statusFilter}&category=${categoryFilter}&search=${encodeURIComponent(search)}`;
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
    }, []);

    useEffect(() => {
        fetchArticles();
    }, [year, statusFilter, categoryFilter, search]);

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
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {/* Hidden for now as requested:
                        <button className="btn btn-indigo btn-sm" onClick={() => downloadExcelTemplate(year, categories)} title="Download Excel template with Master Categories tab">
                            <i className="material-icons">description</i> Template (.xlsx)
                        </button>
                        */}
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
                            id: 'sl_no',
                            searchable: false,
                            sortable: false,
                            headerStyle: { width: '60px', textAlign: 'center' },
                            style: { textAlign: 'center', width: '60px', fontWeight: 600, color: 'var(--text-muted)' },
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
                                            style={{ marginRight: '6px' }} 
                                            onClick={() => onEditArticle(a)}
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
                    initialPageSize={10} 
                    searchPlaceholder="Search by SL No, Tag No, Tag Name, Article, Donor..." 
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
                }}
                onCategoryDeleted={() => {
                    fetchCategories();
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
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content article-modal-content" onClick={e => e.stopPropagation()}>
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
                                    value={form.estimated_value}
                                    onChange={e => setForm({...form, estimated_value: e.target.value})}
                                />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Reserve Price (BHD)</label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    className="form-control" 
                                    value={form.reserve_price}
                                    onChange={e => setForm({...form, reserve_price: e.target.value})}
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
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{ maxWidth: '880px' }} onClick={e => e.stopPropagation()}>
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
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: `1.5px solid ${badgeColor}`,
                    borderRadius: '8px',
                    padding: '8px 12px',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <span className="badge" style={{ background: badgeColor, color: '#fff', fontSize: '11px', padding: '3px 8px', whiteSpace: 'nowrap', fontWeight: 700 }}>
                            {selectedHead.head_code}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {selectedHead.head_name}
                        </span>
                    </div>
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '3px 8px', fontSize: '11px', height: '26px', display: 'flex', alignItems: 'center', gap: '4px' }}
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
                            maxHeight: '220px',
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
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                                            <span className="badge" style={{ background: badgeColor, color: '#fff', fontSize: '11px', padding: '2px 7px', fontWeight: 700 }}>
                                                {opt.head_code}
                                            </span>
                                            <span style={{ fontSize: '13px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {opt.head_name}
                                            </span>
                                        </div>
                                        <span style={{ fontSize: '11px', color: badgeColor, fontWeight: 600, whiteSpace: 'nowrap' }}>
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

// --- Live Auction Desk View ---
function AuctionDeskView({ year, showToast, onOpenReceipt }) {
    const [transactions, setTransactions] = useState([]);
    const [availableArticles, setAvailableArticles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [recording, setRecording] = useState(false);
    const [paymentModalData, setPaymentModalData] = useState(null);

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
                
                // Initialize default Event
                const defEvt = accRes.events.find(e => e.default_status === 'Yes') || accRes.events[0];
                if (defEvt && !selectedEventId) {
                    setSelectedEventId(defEvt.event_id);
                }

                // Default Contribution Debit Head: Cash on Hand-Harvest Festival (02123)
                setSelectedContribDr(prev => {
                    if (prev) return prev;
                    return accRes.contribution_debit_heads.find(h => h.head_code === '02123') || accRes.contribution_debit_heads[0] || null;
                });

                // Default Contribution Credit Head: Church Building Fund or Harvest Festival head
                setSelectedContribCr(prev => {
                    if (prev) return prev;
                    return accRes.contribution_credit_heads.find(h => h.head_code === '02206') || accRes.contribution_credit_heads[0] || null;
                });

                // Default Promise Debit Head: Harvest Festival Auction Receivable (08583 or similar)
                setSelectedPromiseDr(prev => {
                    if (prev) return prev;
                    return accRes.promise_debit_heads.find(h => h.head_code === '08583' || (h.head_name && h.head_name.includes('Harvest Festival') && h.head_name.includes('Auction'))) || accRes.promise_debit_heads[0] || null;
                });

                // Default Promise Credit Head: Harvest Festival - Article Auction (07503)
                setSelectedPromiseCr(prev => {
                    if (prev) return prev;
                    return accRes.promise_credit_heads.find(h => h.head_code === '07503') || accRes.promise_credit_heads[0] || null;
                });
            }
        } catch (err) {
            showToast('error', err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchAuctionData();
    }, [year]);

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
        setSelectedMember(m);
        setMemberSearch('');
        setMemberResults([]);
    };

    const handleSelectArticle = (art) => {
        setSelectedArticleId(art.article_id);
        const bid = art.reserve_price > 0 ? art.reserve_price : art.estimated_value;
        setBidAmount(bid);
        setPaidAmount(bid);
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

        const paid = Number(paidAmount || 0);
        const balance = Math.max(0, bid - paid);

        // Validation for contribution posting heads when amount is paid
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
                paid_amount: paid,
                buyer_name: selectedMember.primary_member_name,
                buyer_member_id: selectedMember.primary_member_id,
                buyer_code_c: selectedMember.code_c,
                buyer_phone: selectedMember.bahrain_contact_no,
                notes: notes,
                auction_date: new Date().toISOString().split('T')[0],

                // Budget Event
                event_id: currentEvent ? currentEvent.event_id : null,
                event_name: currentEvent ? currentEvent.event_name : null,

                // Optional Manual Receipt Details
                receipt_book_no: receiptBookNo.trim() || '0',
                receipt_no: receiptNo.trim() || '0',

                // Contribution Posting Heads (Receipt)
                contrib_dr_code: selectedContribDr ? selectedContribDr.head_code : null,
                contrib_dr_name: selectedContribDr ? selectedContribDr.head_name : null,
                contrib_cr_code: selectedContribCr ? selectedContribCr.head_code : null,
                contrib_cr_name: selectedContribCr ? selectedContribCr.head_name : null,

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
                    successMsg += ` | Contrib ID: #${res.data.acc_contribution_id} (HRCPT #${res.data.contrib_voucher_no})`;
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
                setMemberSearch('');
                setNotes('');
                setReceiptBookNo('');
                setReceiptNo('');
                fetchAuctionData();

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
                        <div className="form-row" style={{ gridTemplateColumns: 'minmax(280px, 2fr) minmax(130px, 1fr) minmax(140px, 1fr)', gap: '12px', alignItems: 'flex-start', marginBottom: '6px' }}>
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
                                <label className="form-label">Winning Bid (BHD) *</label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    className="form-control" 
                                    style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--primary)' }}
                                    placeholder="0.000"
                                    required 
                                    value={bidAmount}
                                    onChange={e => setBidAmount(e.target.value)}
                                />
                            </div>

                            {/* Paid Now */}
                            <div className="form-group" style={{ margin: 0 }}>
                                <label className="form-label">Amount Paid Now (BHD)</label>
                                <input 
                                    type="number" 
                                    step="0.001" 
                                    className="form-control" 
                                    style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--success)' }}
                                    placeholder="0.000"
                                    value={paidAmount}
                                    onChange={e => setPaidAmount(e.target.value)}
                                />
                                <div style={{ fontSize: '11px', marginTop: '4px', color: 'var(--text-muted)' }}>
                                    Balance Due: <strong>BHD {currentBalance.toFixed(3)}</strong>
                                    {' '}(Winning Bid: BHD {(Number(bidAmount) || 0).toFixed(3)} posted as Promise)
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
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '12px 16px', borderRadius: '8px' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '15px' }}>{selectedMember.primary_member_name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                            Roll No: <strong style={{ color: 'var(--primary)' }}>{selectedMember.code_c}</strong> &nbsp;|&nbsp;
                                            CPR: {selectedMember.cpr_no} &nbsp;|&nbsp;
                                            Phone: {selectedMember.bahrain_contact_no} &nbsp;|&nbsp;
                                            {selectedMember.prayer_group_name}
                                        </div>
                                    </div>
                                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSelectedMember(null)}>
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
                                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>Accounts Ledger Posting Heads</h4>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                                            Select heads for automated General Ledger posting of Contribution & Promise records
                                        </div>
                                    </div>
                                </div>

                                {/* Budget Head / Event */}
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
                            </div>

                            {/* Section 1: Contribution Posting Heads (Receipt) */}
                            <div className={`accounting-section-box ${isPayingNow ? 'active-posting' : ''}`} style={{
                                opacity: isPayingNow ? 1 : 0.85,
                                background: isPayingNow ? 'rgba(16, 185, 129, 0.03)' : 'transparent',
                                borderLeft: isPayingNow ? '4px solid #10b981' : '1px solid var(--border-color)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '6px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span className="badge badge-success" style={{ fontSize: '11px', padding: '3px 8px' }}>
                                            <i className="material-icons" style={{ fontSize: '13px', verticalAlign: 'middle', marginRight: '4px' }}>receipt</i>
                                            Contribution Entry (Receipt Posting)
                                        </span>
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: isPayingNow ? 'var(--success)' : 'var(--text-muted)' }}>
                                        {isPayingNow ? `Posting Amount: BHD ${Number(paidAmount).toFixed(3)}` : 'No Immediate Floor Payment (BHD 0.000)'}
                                    </span>
                                </div>

                                <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
                                    <SearchableHeadSelect
                                        label="Debit Head (Receiving Cash/Bank)"
                                        placeholder="Search contribution debit head (e.g. 02123)..."
                                        options={accountsData.contribution_debit_heads}
                                        selectedHead={selectedContribDr}
                                        onSelect={setSelectedContribDr}
                                        required={isPayingNow}
                                        badgeColor="#3b82f6"
                                    />
                                    <SearchableHeadSelect
                                        label="Credit Head (Harvest / Auction Income)"
                                        placeholder="Search contribution credit head (e.g. 02206)..."
                                        options={accountsData.contribution_credit_heads}
                                        selectedHead={selectedContribCr}
                                        onSelect={setSelectedContribCr}
                                        required={isPayingNow}
                                        badgeColor="#10b981"
                                    />
                                </div>

                                {isPayingNow && (
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
                                )}
                            </div>

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
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--warning)' }}>
                                        Promise Amount: BHD {(Number(bidAmount) || 0).toFixed(3)} | Balance Due: BHD {currentBalance.toFixed(3)}
                                    </span>
                                </div>

                                <div className="form-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '14px' }}>
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
                <div className="card-header">
                    <div>
                        <h3>Recent Auction Transactions ({year})</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Browse, search, sort, and record settlements on auction ledger sales</p>
                    </div>
                    <span className="badge badge-info">{transactions.length} Total Sales</span>
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
                                const cvs = (t.contributions || []).map(c => `HRCPT ${c.voucher_no || ''} ${c.contribution_amount || ''} ${c.receipt_no || ''}`).join(' ');
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
                                                title={`Click to view & print official receipt for Voucher #${c.voucher_no}`}
                                            >
                                                <i className="material-icons" style={{ fontSize: '13px' }}>receipt</i>
                                                <span>HRCPT #{c.voucher_no}</span>
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
                        showToast('success', 'Balance payment recorded!');
                    }}
                    onOpenReceipt={onOpenReceipt}
                    showToast={showToast}
                    accountsData={accountsData}
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
                    msg += ` | Contrib ID: #${res.data.acc_contribution_id} (HRCPT #${res.data.contrib_voucher_no})`;
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
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content pay-balance-modal-content" onClick={e => e.stopPropagation()}>
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
                                    required 
                                    value={amount}
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

// --- Printable Receipt Modal ---
function ReceiptModal({ receiptNo, isOpen, onClose }) {
    if (!isOpen) return null;
    const [receipt, setReceipt] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (receiptNo) {
            setLoading(true);
            api.get(`/api/payments/receipt/${receiptNo}`)
                .then(res => {
                    if (res.success) setReceipt(res.receipt);
                })
                .catch(() => {})
                .finally(() => setLoading(false));
        }
    }, [receiptNo]);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" style={{ maxWidth: '620px', background: 'var(--bg-surface)' }} onClick={e => e.stopPropagation()}>
                <div className="no-print">
                    <ModalHeader 
                        title="Official Auction Receipt Voucher" 
                        icon="receipt_long" 
                        onClose={onClose} 
                        badge={receipt?.receipt_no || receiptNo}
                    />
                </div>

                <div className="modal-body" style={{ background: '#f1f5f9', padding: '24px' }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
                    ) : !receipt ? (
                        <div style={{ color: '#000', textAlign: 'center' }}>Receipt not found.</div>
                    ) : (
                        <div className="receipt-wrapper">
                            <div className="receipt-header">
                                <img 
                                    src="/images/logo/login-page-logo.png" 
                                    alt="Auction Portal Logo" 
                                    style={{ maxHeight: '68px', maxWidth: '440px', width: '100%', marginBottom: '12px', objectFit: 'contain' }} 
                                />
                                <h2>ST. MARY'S INDIAN ORTHODOX CATHEDRAL</h2>
                                <p>Kingdom of Bahrain • Harvest Festival & Auction</p>
                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                                    OFFICIAL PAYMENT RECEIPT
                                </div>
                            </div>

                            <div className="receipt-grid">
                                <div><span className="label">Receipt No:</span> <div className="val">{receipt.receipt_no}</div></div>
                                <div><span className="label">Payment Date:</span> <div className="val">{formatDateDMY(receipt.payment_date)}</div></div>
                                <div><span className="label">Auction Ref:</span> <div className="val">{receipt.auction_ref_no}</div></div>
                                <div><span className="label">Payment Mode:</span> <div className="val">{receipt.payment_mode}</div></div>
                            </div>

                            <div className="receipt-item-box">
                                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Buyer Information</div>
                                <div style={{ fontWeight: 800, fontSize: '15px' }}>{receipt.buyer_name}</div>
                                {receipt.buyer_code_c && <div>Member Roll No: <strong>{receipt.buyer_code_c}</strong></div>}
                                {receipt.buyer_phone && <div>Contact: {receipt.buyer_phone}</div>}
                                {receipt.buyer_cpr && <div>CPR: {receipt.buyer_cpr}</div>}
                            </div>

                            <div className="receipt-item-box">
                                <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' }}>Auction Item Details</div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontWeight: 700 }}>{receipt.article_name}</div>
                                        <div style={{ fontSize: '12px', color: '#64748b' }}>Tag: <strong>{receipt.tag_number}</strong> | Art No: <strong style={{ fontFamily: 'monospace' }}>{receipt.article_number}</strong></div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <span style={{ background: '#f59e0b', color: '#fff', padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                                            {receipt.applicable_year}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {(receipt.voucher_no || receipt.manual_receipt_no || receipt.dr_code || receipt.initial_promise_voucher) && (
                                <div className="receipt-item-box" style={{ background: '#f8fafc', border: '1px dashed #cbd5e1' }}>
                                    <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase', marginBottom: '6px', fontWeight: 700 }}>
                                        Cathedral Accounts Posting Reference
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '8px', fontSize: '12px' }}>
                                        {(receipt.acc_contribution_id || receipt.initial_acc_contrib_id) && (
                                            <div>
                                                <span style={{ color: '#64748b' }}>Contribution ID:</span>{' '}
                                                <strong style={{ color: '#0f766e' }}>#{receipt.acc_contribution_id || receipt.initial_acc_contrib_id}</strong>
                                            </div>
                                        )}
                                        {receipt.voucher_no && (
                                            <div>
                                                <span style={{ color: '#64748b' }}>HRCPT Voucher:</span>{' '}
                                                <strong style={{ color: '#0f766e' }}>#{receipt.voucher_no}</strong>
                                            </div>
                                        )}
                                        {(receipt.receipt_book_no || receipt.manual_receipt_no) && (
                                            <div>
                                                <span style={{ color: '#64748b' }}>Receipt Book/No:</span>{' '}
                                                <strong>{receipt.receipt_book_no ? `Bk ${receipt.receipt_book_no}` : ''} {receipt.manual_receipt_no ? `#${receipt.manual_receipt_no}` : ''}</strong>
                                            </div>
                                        )}
                                        {receipt.dr_code && (
                                            <div>
                                                <span style={{ color: '#64748b' }}>Dr Head:</span>{' '}
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{receipt.dr_code}</span> ({receipt.dr_name})
                                            </div>
                                        )}
                                        {receipt.cr_code && (
                                            <div>
                                                <span style={{ color: '#64748b' }}>Cr Head:</span>{' '}
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{receipt.cr_code}</span> ({receipt.cr_name})
                                            </div>
                                        )}
                                        {receipt.initial_promise_voucher && (
                                            <div>
                                                <span style={{ color: '#64748b' }}>Linked Promise Ref:</span>{' '}
                                                <strong style={{ color: '#b45309' }}>MP #{receipt.initial_promise_voucher}</strong>
                                                {receipt.initial_acc_promise_id && (
                                                    <span style={{ fontSize: '11px', color: '#b45309', marginLeft: '4px' }}>
                                                        (ID: #{receipt.initial_acc_promise_id})
                                                    </span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div className="receipt-totals">
                                <div className="receipt-row">
                                    <span>Winning Bid Amount:</span>
                                    <span>BHD {Number(receipt.winning_bid_amount).toFixed(3)}</span>
                                </div>
                                <div className="receipt-row bold">
                                    <span>Amount Paid (This Voucher):</span>
                                    <span>BHD {Number(receipt.amount_paid).toFixed(3)}</span>
                                </div>
                                <div className="receipt-row">
                                    <span>Cumulative Total Paid:</span>
                                    <span>BHD {Number(receipt.total_transaction_paid).toFixed(3)}</span>
                                </div>
                                <div className="receipt-row" style={{ color: Number(receipt.total_transaction_balance) > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                                    <span>Remaining Balance:</span>
                                    <span>BHD {Number(receipt.total_transaction_balance).toFixed(3)}</span>
                                </div>
                            </div>

                            <div className="receipt-footer">
                                <p>Thank you for supporting the Cathedral Harvest Festival.</p>
                                <p style={{ marginTop: '4px' }}>Cashier: {receipt.cashier_name || 'Accounts Desk'} • Authorized Signatory</p>
                            </div>
                        </div>
                    )}
                </div>

                <div className="modal-footer no-print">
                    <button type="button" className="btn gradient-45deg-red-pink gradient-shadow white-text" onClick={onClose}>
                        <i className="material-icons" style={{ fontSize: '16px' }}>close</i> Exit
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
function PromisesView({ year, showToast, onOpenReceipt }) {
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
    }, [year, statusFilter, search]);

    useEffect(() => {
        api.get('/api/accounts/heads')
            .then(res => {
                if (res.success) setAccountsData(res.data);
            })
            .catch(err => console.error("Could not load account heads in PromisesView", err));
    }, []);

    return (
        <div>
            {/* Breadcrumbs Header */}
            <div className="breadcrumbs-wrapper">
                <div className="breadcrumbs-title">
                    <i className="material-icons">account_balance_wallet</i>
                    <h4>Auction Promises & Receivables ({year})</h4>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>Cathedral Auction</span> &gt; <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Member Credit & Receivables</span>
                </div>
            </div>

            <div className="card">
                <div className="card-header">
                    <div>
                        <h3>Auction Promises & Receivables ({year})</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Track member credit purchases, pending balances, and record collections</p>
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
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
                            render: (p, index) => <span style={{ fontSize: '12px' }}>{index + 1}</span>
                        },
                        {
                            header: 'Promise ID',
                            accessor: 'hf_promise_id',
                            sortable: true,
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
                            render: (p) => `BHD ${Number(p.total_promise_amount).toFixed(3)}`
                        },
                        {
                            header: 'Paid So Far',
                            accessor: 'paid_amount',
                            sortable: true,
                            sortValue: (p) => Number(p.paid_amount) || 0,
                            render: (p) => <span style={{ color: 'var(--success)' }}>{Number(p.paid_amount).toFixed(3)}</span>
                        },
                        {
                            header: 'Outstanding Due',
                            accessor: 'balance_amount',
                            sortable: true,
                            sortValue: (p) => Number(p.balance_amount) || 0,
                            render: (p) => <strong style={{ color: 'var(--danger)', fontSize: '14px' }}>BHD {Number(p.balance_amount).toFixed(3)}</strong>
                        },
                        {
                            header: 'Due Date',
                            accessor: 'due_date',
                            sortable: true,
                            render: (p) => formatDateDMY(p.due_date)
                        },
                        {
                            header: 'Status',
                            accessor: 'promise_status',
                            sortable: true,
                            render: (p) => (
                                <span className={`badge badge-${p.promise_status === 'Fulfilled' ? 'success' : 'warning'}`}>
                                    {p.promise_status}
                                </span>
                            )
                        },
                        {
                            header: 'Actions',
                            id: 'actions',
                            sortable: false,
                            headerStyle: { textAlign: 'right' },
                            style: { textAlign: 'right', whiteSpace: 'nowrap' },
                            render: (p) => (
                                p.promise_status === 'Active' ? (
                                    <button 
                                        type="button"
                                        className="btn gradient-45deg-purple-deep-orange gradient-shadow white-text btn-sm"
                                        style={{ fontSize: '12px', padding: '4px 10px', height: '32px' }}
                                        onClick={() => setPaymentModalData({
                                            transaction_id: p.transaction_id,
                                            auction_ref_no: p.auction_ref_no,
                                            buyer_name: p.member_name,
                                            buyer_code_c: p.member_code_c,
                                            buyer_phone: p.member_phone,
                                            buyer_cpr: p.member_cpr,
                                            tag_number: p.tag_number,
                                            article_number: p.article_number,
                                            article_name: p.article_name,
                                            category: p.category,
                                            winning_bid_amount: p.total_promise_amount,
                                            total_promise_amount: p.total_promise_amount,
                                            paid_amount: p.paid_amount,
                                            balance_amount: p.balance_amount,
                                            due_date: p.due_date,
                                            promise_voucher_no: p.voucher_no,
                                            acc_promise_id: p.acc_promise_id,
                                            contrib_dr_code: p.dr_code || '02123',
                                            contrib_cr_code: p.cr_code || '02206',
                                            event_id: p.event_id,
                                            event_name: p.event_name
                                        })}
                                    >
                                        <i className="material-icons" style={{ fontSize: '15px' }}>payments</i> Collect
                                    </button>
                                ) : <span className="badge badge-success">Cleared</span>
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
function ReportsView({ year, showToast }) {
    const [summary, setSummary] = useState(null);
    const [buyers, setBuyers] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
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
    }, [year]);

    const exportBuyerReport = () => {
        if (!buyers.length) return;
        const rows = buyers.map(b => ({
            'Buyer Name': b.buyer_name,
            'Roll No': b.buyer_code_c || 'N/A',
            'CPR': b.cpr_no || 'N/A',
            'Phone': b.buyer_phone || 'N/A',
            'Items Won': b.items_purchased,
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

    return (
        <div>
            {/* Breadcrumbs Header */}
            <div className="breadcrumbs-wrapper">
                <div className="breadcrumbs-title">
                    <i className="material-icons">insert_chart</i>
                    <h4>Auction Sales & Financial Reports ({year})</h4>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    <span>Cathedral Auction</span> &gt; <span style={{ color: 'var(--primary)', fontWeight: 600 }}>Financial Ledger & Analysis</span>
                </div>
            </div>

            <div className="card" style={{ marginBottom: '28px' }}>
                <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                        <img 
                            src="/images/logo/red_full_logo.png" 
                            alt="Auction Portal" 
                            style={{ height: '52px', maxWidth: '360px', objectFit: 'contain' }} 
                            onError={(e) => { e.target.src = '/images/logo/login-page-logo.png'; }}
                        />
                        <div>
                            <h3>Annual Harvest Festival Auction Summary ({year})</h3>
                            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Financial and volume breakdown across all auction categories</p>
                        </div>
                    </div>
                    <button className="btn btn-indigo btn-sm" onClick={() => window.print()}>
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
                <div className="card-header">
                    <div>
                        <h3>Member & Buyer Settlement Ledger ({year})</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Buyer-wise purchase totals, payments, and open balances</p>
                    </div>
                    <button className="btn btn-excel btn-sm" onClick={exportBuyerReport}>
                        <i className="material-icons">file_download</i> Export Excel Ledger
                    </button>
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
                            render: (b) => <span className="badge badge-secondary">{b.items_purchased}</span>
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
        <div className="modal-overlay" onClick={onClose}>
            <div 
                className="modal-content" 
                style={{ width: '95%', maxWidth: '640px', margin: 'auto', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} 
                onClick={e => e.stopPropagation()}
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
        <div className="modal-overlay" onClick={onClose}>
            <div 
                className="modal-content" 
                style={{ width: '95%', maxWidth: '520px', margin: 'auto', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }} 
                onClick={e => e.stopPropagation()}
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
                <div className="card-header" style={{ flexWrap: 'wrap', gap: '14px' }}>
                    <div>
                        <h3>Portal User Accounts (tbl_users)</h3>
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Authorized Administrator and Harvest Festival data entry accounts from tbl_users</p>
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
        </div>
    );
}

// --- Main App Root Component ---
function App() {
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [currentTab, setCurrentTab] = useState('dashboard');
    const [year, setYear] = useState(2026);
    const [availableYears, setAvailableYears] = useState([2026, 2025, 2024]);
    const [stats, setStats] = useState(null);
    const [toasts, setToasts] = useState([]);
    const [sidebarOpen, setSidebarOpen] = useState(false);

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

    const fetchYearsAndStats = async () => {
        if (!user) return;
        try {
            const [yRes, sRes] = await Promise.all([
                api.get('/api/articles/years'),
                api.get(`/api/auctions/stats?year=${year}`)
            ]);
            if (yRes.success && yRes.years.length) {
                setAvailableYears(yRes.years);
            }
            if (sRes.success) {
                setStats(sRes.stats);
            }
        } catch (err) {}
    };

    useEffect(() => {
        checkAuth();
    }, []);

    useEffect(() => {
        fetchYearsAndStats();
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

                        <div 
                            className={`top-nav-item ${currentTab === 'promises' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('promises')}
                        >
                            <i className="material-icons">account_balance_wallet</i>
                            <span>Promises & Dues</span>
                            {stats?.active_promises_count > 0 && (
                                <span className="nav-badge" style={{ background: 'rgba(255, 82, 82, 0.4)', color: '#ffffff' }}>
                                    {stats.active_promises_count}
                                </span>
                            )}
                        </div>

                        <div 
                            className={`top-nav-item ${currentTab === 'reports' ? 'active' : ''}`}
                            onClick={() => setCurrentTab('reports')}
                        >
                            <i className="material-icons">insert_chart</i>
                            <span>Sales Reports</span>
                        </div>

                        {isAdmin && (
                            <div 
                                className={`top-nav-item ${currentTab === 'users' ? 'active' : ''}`}
                                onClick={() => setCurrentTab('users')}
                            >
                                <i className="material-icons">manage_accounts</i>
                                <span>Users</span>
                            </div>
                        )}
                    </nav>

                    {/* Top Actions: Year + Theme Switcher + Profile */}
                    <div className="top-actions">
                        <div className="year-badge-selector">
                            <span>YEAR:</span>
                            <select 
                                className="year-select"
                                value={year} 
                                onChange={e => setYear(Number(e.target.value))}
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
                        <div 
                            className={`top-nav-item ${currentTab === 'users' ? 'active' : ''}`}
                            onClick={() => { setCurrentTab('users'); setSidebarOpen(false); }}
                        >
                            <i className="material-icons">manage_accounts</i>
                            <span>User Management</span>
                        </div>
                    )}
                </div>
            </header>

            {/* Main Content Area */}
            <main className="main-content">
                {currentTab === 'dashboard' && (
                    <DashboardView 
                        stats={stats} 
                        year={year} 
                        onNavigate={setCurrentTab}
                        onOpenNewArticle={() => { setEditingArticle(null); setArticleModalOpen(true); }}
                        onOpenImport={() => setImportModalOpen(true)}
                    />
                )}

                {currentTab === 'articles' && (
                    <ArticlesView 
                        year={year} 
                        onOpenNewArticle={() => { setEditingArticle(null); setArticleModalOpen(true); }}
                        onEditArticle={(a) => { setEditingArticle(a); setArticleModalOpen(true); }}
                        onOpenImport={() => setImportModalOpen(true)}
                        showToast={showToast}
                    />
                )}

                {currentTab === 'auction' && (
                    <AuctionDeskView 
                        year={year} 
                        showToast={showToast}
                        onOpenReceipt={rno => setReceiptModalNo(rno)}
                    />
                )}

                {currentTab === 'promises' && (
                    <PromisesView 
                        year={year} 
                        showToast={showToast}
                        onOpenReceipt={rno => setReceiptModalNo(rno)}
                    />
                )}

                {currentTab === 'reports' && (
                    <ReportsView 
                        year={year} 
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
                    fetchYearsAndStats();
                }}
                showToast={showToast}
            />

            <ExcelImportModal 
                year={year}
                isOpen={importModalOpen}
                onClose={() => setImportModalOpen(false)}
                onSuccess={() => {
                    fetchYearsAndStats();
                }}
                showToast={showToast}
            />

            <ReceiptModal 
                receiptNo={receiptModalNo}
                isOpen={!!receiptModalNo}
                onClose={() => setReceiptModalNo(null)}
            />
        </div>
    );
}

// Mount React App
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
