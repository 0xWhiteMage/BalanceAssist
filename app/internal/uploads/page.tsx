'use client';

import { useEffect, useMemo, useState } from 'react';

type UploadRow = {
  id: number;
  sessionId: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number;
  createdAt: string;
  status: string | null;
  contactName: string | null;
  contactCompany: string | null;
  downloadUrl: string | null;
};

export default function InternalUploadsPage() {
  const [token, setToken] = useState('');
  const [savedToken, setSavedToken] = useState('');
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const existing = window.sessionStorage.getItem('balance-assist-admin-token') ?? '';
    setSavedToken(existing);
  }, []);

  async function loadUploads(activeToken: string) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/internal/uploads', {
        headers: { Authorization: `Bearer ${activeToken}` }
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? 'Failed to load uploads');
      }
      setUploads(data.uploads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  const activeToken = savedToken || token;

  const totalBytes = useMemo(
    () => uploads.reduce((sum, upload) => sum + upload.sizeBytes, 0),
    [uploads]
  );

  return (
    <main style={{ minHeight: '100vh', background: '#101010', color: '#f2f2f2', padding: '32px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <h1 style={{ margin: 0, fontSize: '32px' }}>Internal Uploads</h1>
        <p style={{ marginTop: '8px', color: 'rgba(255,255,255,0.7)' }}>
          Review uploaded files with signed download links.
        </p>

        {!savedToken && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              window.sessionStorage.setItem('balance-assist-admin-token', token);
              setSavedToken(token);
              loadUploads(token);
            }}
            style={{ marginTop: '24px', display: 'flex', gap: '12px' }}
          >
            <input
              type="password"
              placeholder="Enter SETUP_TOKEN"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 1, padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: '#1d1d1d', color: '#f2f2f2' }}
            />
            <button type="submit" style={{ padding: '10px 16px', borderRadius: '8px', border: 'none', background: '#dbb580', color: '#101010', cursor: 'pointer', fontWeight: 600 }}>
              Load
            </button>
          </form>
        )}

        {savedToken && (
          <div style={{ marginTop: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ color: 'rgba(255,255,255,0.7)' }}>
                {uploads.length} uploads · {(totalBytes / (1024 * 1024)).toFixed(1)} MB
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => loadUploads(savedToken)} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#f2f2f2', cursor: 'pointer' }}>
                  Refresh
                </button>
                <button onClick={() => { window.sessionStorage.removeItem('balance-assist-admin-token'); setSavedToken(''); setUploads([]); }} style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'transparent', color: '#f2f2f2', cursor: 'pointer' }}>
                  Clear token
                </button>
              </div>
            </div>

            {loading && <p>Loading…</p>}
            {error && <p style={{ color: '#ff8f8f' }}>{error}</p>}

            <div style={{ display: 'grid', gap: '16px' }}>
              {uploads.map((upload) => (
                <div key={upload.id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '12px', padding: '14px', background: 'rgba(255,255,255,0.02)', display: 'grid', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{upload.fileName}</div>
                      <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)', marginTop: '4px' }}>
                        Session {upload.sessionId.slice(0, 8)} · {upload.contactName || 'Unknown'}{upload.contactCompany ? ` / ${upload.contactCompany}` : ''}
                      </div>
                    </div>
                    <a href={upload.downloadUrl ?? undefined} target="_blank" rel="noopener noreferrer" style={{ color: '#dbb580', textDecoration: 'underline' }}>
                      Download
                    </a>
                  </div>

                  {upload.downloadUrl && upload.mimeType?.startsWith('image/') && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={upload.downloadUrl} alt={upload.fileName} style={{ maxWidth: '240px', maxHeight: '160px', borderRadius: '8px', objectFit: 'cover' }} />
                  )}

                  {upload.downloadUrl && upload.mimeType?.startsWith('video/') && (
                    <video src={upload.downloadUrl} controls style={{ maxWidth: '240px', maxHeight: '160px', borderRadius: '8px' }} />
                  )}

                  <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.65)' }}>
                    {(upload.sizeBytes / (1024 * 1024)).toFixed(2)} MB · {upload.mimeType || 'unknown type'} · {new Date(upload.createdAt).toLocaleString()} · {upload.status || 'unknown status'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
