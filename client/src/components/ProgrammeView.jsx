import { apiFetch } from '../apiFetch.js';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useZoom } from '../zoomContext.js';

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IE', { day: '2-digit', month: 'short', year: 'numeric' });
}
const DAY_MS = 86400000;
const MONTH_LABEL = d => d.toLocaleDateString('en-IE', { month: 'short', year: '2-digit' });

export default function ProgrammeView({ projectId, readOnly }) {
  const zoom = useZoom();
  const [programme,  setProgramme]  = useState(null);
  const [activities, setActivities] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [uploading,  setUploading]  = useState(false);
  const [error,      setError]      = useState('');
  const fileRef = useRef();

  const load = () => {
    setLoading(true);
    apiFetch(`/api/v1/projects/${projectId}/programme`)
      .then(r => r.json())
      .then(d => { setProgramme(d.programme); setActivities(d.activities || []); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [projectId]);

  const doUpload = async (file) => {
    if (!file) return;
    setError(''); setUploading(true);
    const form = new FormData();
    form.append('file', file);
    const res = await apiFetch(`/api/v1/projects/${projectId}/programme/upload`, { method: 'POST', body: form });
    const json = await res.json();
    setUploading(false);
    if (!res.ok) { setError(json.error || 'Upload failed'); return; }
    if (fileRef.current) fileRef.current.value = '';
    load();
  };

  const viewOriginal = async () => {
    // Open the tab synchronously (within the click's user-gesture window) so
    // browsers don't treat it as a blocked popup once we set its URL after the await.
    const tab = window.open('', '_blank');
    const res = await apiFetch(`/api/v1/projects/${projectId}/programme/file`);
    if (!res.ok) { setError('Could not load the PDF'); tab?.close(); return; }
    const blob = await res.blob();
    if (tab) tab.location.href = URL.createObjectURL(blob);
  };

  const doDelete = async () => {
    if (!window.confirm(`Delete the uploaded programme "${programme.filename}"? You can upload a new one afterwards.`)) return;
    await apiFetch(`/api/v1/projects/${projectId}/programme`, { method: 'DELETE' });
    setProgramme(null); setActivities([]);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(a => a.task_name.toLowerCase().includes(q));
  }, [activities, search]);

  const { minDate, maxDate } = useMemo(() => {
    let min = null, max = null;
    for (const a of activities) {
      if (a.start_date && (!min || a.start_date < min)) min = a.start_date;
      if (a.finish_date && (!max || a.finish_date > max)) max = a.finish_date;
    }
    return { minDate: min, maxDate: max };
  }, [activities]);

  const totalDays = minDate && maxDate
    ? Math.max(1, Math.round((new Date(maxDate) - new Date(minDate)) / DAY_MS))
    : 0;
  const PX_PER_DAY = 3.2;
  const timelineWidth = Math.max(600, totalDays * PX_PER_DAY);

  const monthMarks = useMemo(() => {
    if (!minDate || !maxDate) return [];
    const marks = [];
    const start = new Date(minDate + 'T12:00:00');
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(maxDate + 'T12:00:00');
    while (cur <= end) {
      const offsetDays = (cur - start) / DAY_MS;
      marks.push({ label: MONTH_LABEL(cur), left: offsetDays * PX_PER_DAY });
      cur.setMonth(cur.getMonth() + 1);
    }
    return marks;
  }, [minDate, maxDate]);

  const barFor = (a) => {
    if (!a.start_date || !a.finish_date || !minDate) return null;
    const left  = ((new Date(a.start_date) - new Date(minDate)) / DAY_MS) * PX_PER_DAY;
    const days  = Math.max(0, (new Date(a.finish_date) - new Date(a.start_date)) / DAY_MS);
    const width = Math.max(3, days * PX_PER_DAY);
    return { left, width, milestone: days === 0 };
  };

  if (loading) return <div className="state-box"><div className="icon">⏳</div><p>Loading…</p></div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {!programme ? (
        <div className="state-box">
          <div className="icon">📅</div>
          <p>No programme uploaded yet.</p>
          {!readOnly && (
            <>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
                onChange={e => doUpload(e.target.files[0])} />
              <button className="btn-primary" disabled={uploading} onClick={() => fileRef.current.click()}>
                {uploading ? 'Uploading…' : '+ Upload Programme (PDF)'}
              </button>
            </>
          )}
          {error && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{error}</div>}
        </div>
      ) : (
        <>
          <div className="programme-header">
            <div className="programme-header-info">
              <div className="programme-filename">📄 {programme.filename}</div>
              <div className="programme-meta">Uploaded {fmtDateTime(programme.uploaded_at)}{programme.uploaded_by ? ` by ${programme.uploaded_by}` : ''} · {activities.length} activities</div>
            </div>
            <input type="search" placeholder="Filter activity…" value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, width: 220 }} />
            <button className="btn-secondary" onClick={viewOriginal}>⬇ View Original PDF</button>
            {!readOnly && (
              <>
                <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
                  onChange={e => doUpload(e.target.files[0])} />
                <button className="btn-secondary" disabled={uploading} onClick={() => fileRef.current.click()}>
                  {uploading ? 'Uploading…' : '🔁 Replace'}
                </button>
                <button className="btn-danger-ghost" onClick={doDelete}>🗑 Delete</button>
              </>
            )}
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 12, padding: '4px 0' }}>{error}</div>}

          <div className="programme-scroll-wrap" style={{ zoom: `${zoom}%` }}>
            <table className="programme-table">
              <thead>
                <tr>
                  <th className="programme-task-head">Task Name</th>
                  <th className="programme-date-head programme-start-head">Start</th>
                  <th className="programme-date-head programme-finish-head">Finish</th>
                  <th className="programme-dur-head">Duration</th>
                  <th className="programme-timeline-head">
                    <div className="programme-timeline-marks" style={{ width: timelineWidth }}>
                      {monthMarks.map((m, i) => (
                        <span key={i} className="programme-month-mark" style={{ left: m.left }}>{m.label}</span>
                      ))}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(a => {
                  const bar = barFor(a);
                  return (
                    <tr key={a.seq}>
                      <td className="programme-task-cell" style={{ paddingLeft: 10 + a.level * 14 }} title={a.task_name}>
                        {a.task_name}
                      </td>
                      <td className="programme-date-cell programme-start-cell">{fmtDate(a.start_date)}</td>
                      <td className="programme-date-cell programme-finish-cell">{fmtDate(a.finish_date)}</td>
                      <td className="programme-dur-cell">{a.duration_label || '—'}</td>
                      <td className="programme-timeline-cell">
                        <div className="programme-timeline-track" style={{ width: timelineWidth }}>
                          {bar && (
                            bar.milestone ? (
                              <div className="programme-milestone" style={{ left: bar.left }} title={`${fmtDate(a.start_date)}`} />
                            ) : (
                              <div className="programme-bar" style={{ left: bar.left, width: bar.width }}
                                title={`${fmtDate(a.start_date)} → ${fmtDate(a.finish_date)}`} />
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
