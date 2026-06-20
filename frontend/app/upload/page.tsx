"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import AppLayout from "@/components/AppLayout";
import ToastProvider from "@/components/ToastProvider";
import { showToast } from "@/components/ToastProvider";
import { uploadVideo, listVideos, deleteVideo, VideoMeta } from "@/lib/api";

interface UploadItem {
  file: File;
  cameraId: string;
  status: "pending" | "uploading" | "done" | "error";
  progress: number;
  result?: VideoMeta;
  error?: string;
  previewUrl?: string;
  localDuration?: number;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadPage() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedVideos, setUploadedVideos] = useState<VideoMeta[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load existing uploaded videos
  useEffect(() => {
    async function load() {
      try {
        const res = await listVideos();
        setUploadedVideos(res.videos);
      } catch {
        // silent
      } finally {
        setLoadingVideos(false);
      }
    }
    load();
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const valid = files.filter((f) =>
      [".mp4", ".avi", ".mov", ".mkv", ".wmv"].some((ext) =>
        f.name.toLowerCase().endsWith(ext)
      )
    );
    if (valid.length < files.length) {
      showToast("Some files were skipped (unsupported format)", "error");
    }

    const newItems: UploadItem[] = valid.map((f, idx) => {
      // Create an object URL for local preview
      const previewUrl = URL.createObjectURL(f);
      return {
        file: f,
        cameraId: `CAM-${String(items.length + idx + 1).padStart(2, "0")}`,
        status: "pending" as const,
        progress: 0,
        previewUrl,
      };
    });

    setItems((prev) => [...prev, ...newItems]);
  }, [items.length]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  const updateItem = (index: number, patch: Partial<UploadItem>) =>
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));

  const handleUploadAll = async () => {
    const pending = items.filter((it) => it.status === "pending");
    if (!pending.length) { showToast("No pending files to upload", "info"); return; }

    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== "pending") continue;
      updateItem(i, { status: "uploading", progress: 30 });
      try {
        const result = await uploadVideo(items[i].file, items[i].cameraId);
        updateItem(i, { status: "done", progress: 100, result: result.video });
        showToast(`✓ ${items[i].file.name} uploaded`, "success");
        setUploadedVideos((prev) => [result.video, ...prev]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        updateItem(i, { status: "error", progress: 0, error: msg });
        showToast(`Failed: ${items[i].file.name}`, "error");
      }
    }
  };

  const removeItem = (index: number) => {
    const item = items[index];
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDeleteVideo = async (vid: VideoMeta) => {
    if (!confirm(`Delete "${vid.original_filename || vid.id}"? This cannot be undone.`)) return;
    setDeletingId(vid.id);
    try {
      await deleteVideo(vid.id);
      setUploadedVideos((prev) => prev.filter((v) => v.id !== vid.id));
      showToast(`Deleted: ${vid.original_filename || vid.id}`, "success");
    } catch {
      showToast("Delete failed", "error");
    } finally {
      setDeletingId(null);
    }
  };

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <ToastProvider>
      <AppLayout>
        <div className="page-header">
          <h1 className="page-title">⬆ Upload CCTV Footage</h1>
          <p className="page-subtitle">
            Drag and drop video files. Assign camera IDs before uploading. Preview locally before submitting.
          </p>
        </div>

        {/* Drop Zone */}
        <div
          className={`drop-zone ${dragOver ? "drag-over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          style={{ marginBottom: 24 }}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".mp4,.avi,.mov,.mkv,.wmv"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && addFiles(Array.from(e.target.files))}
          />
          <div className="drop-zone-icon">🎬</div>
          <div className="drop-zone-title">
            {dragOver ? "Drop to add files" : "Drop CCTV videos here or click to browse"}
          </div>
          <div className="drop-zone-sub">Supports .mp4 .avi .mov .mkv .wmv — Batch upload supported</div>
        </div>

        {/* File Queue */}
        {items.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div className="section-title" style={{ marginBottom: 0 }}>
                Upload Queue ({items.length} file{items.length !== 1 ? "s" : ""})
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setItems([])}>Clear All</button>
                <button
                  className="btn btn-primary"
                  onClick={handleUploadAll}
                  disabled={pendingCount === 0}
                >
                  ⬆ Upload {pendingCount > 0 ? `${pendingCount} File${pendingCount !== 1 ? "s" : ""}` : ""}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {items.map((item, i) => (
                <div
                  key={i}
                  className="card"
                  style={{
                    padding: "16px 18px",
                    borderColor:
                      item.status === "done" ? "rgba(0,255,136,0.3)" :
                      item.status === "error" ? "rgba(233,69,96,0.3)" : "var(--border)",
                  }}
                >
                  <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                    {/* Video Preview */}
                    <div style={{
                      width: 140, height: 88, flexShrink: 0,
                      background: "#000", borderRadius: 8, overflow: "hidden",
                      border: "1px solid var(--border)",
                    }}>
                      {item.previewUrl ? (
                        <video
                          src={item.previewUrl}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          muted
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const dur = (e.target as HTMLVideoElement).duration;
                            updateItem(i, { localDuration: isFinite(dur) ? dur : undefined });
                          }}
                          onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                          onMouseLeave={(e) => { (e.target as HTMLVideoElement).pause(); (e.target as HTMLVideoElement).currentTime = 0; }}
                        />
                      ) : (
                        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "2rem" }}>🎬</div>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.file.name}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 8, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <span>📦 {formatSize(item.file.size)}</span>
                        {item.localDuration && <span>⏱ {formatDuration(item.localDuration)}</span>}
                        {item.localDuration && (
                          <span style={{ color: "var(--cyan)" }}>
                            🖼 ~{Math.ceil(item.localDuration)} frames/sec sampled at 1fps
                          </span>
                        )}
                      </div>
                      {item.status === "uploading" && (
                        <div className="progress-bar">
                          <div className="progress-bar-fill pulse" style={{ width: "60%" }} />
                        </div>
                      )}
                      {item.status === "error" && (
                        <div style={{ fontSize: "0.75rem", color: "var(--accent)" }}>{item.error}</div>
                      )}
                      {item.status === "done" && (
                        <div style={{ fontSize: "0.75rem", color: "var(--green)" }}>
                          ✓ Uploaded · ID: <span className="mono">{item.result?.id}</span>
                          {item.result?.duration_seconds && (
                            <span style={{ marginLeft: 8, color: "var(--cyan)" }}>
                              · Duration: {formatDuration(item.result.duration_seconds)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Camera ID + Remove */}
                    <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                      <div>
                        <label className="input-label" style={{ marginBottom: 4 }}>Camera ID</label>
                        <input
                          className="input-field"
                          style={{ width: 120 }}
                          value={item.cameraId}
                          disabled={item.status !== "pending"}
                          onChange={(e) => updateItem(i, { cameraId: e.target.value })}
                          placeholder="CAM-01"
                        />
                      </div>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeItem(i)}
                        style={{ color: "var(--text-muted)" }}
                        title="Remove from queue"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {items.length === 0 && (
          <div className="empty-state" style={{ marginBottom: 32 }}>
            <div className="empty-state-icon">🎬</div>
            <div className="empty-state-title">No files queued</div>
            <div className="empty-state-sub">Drop video files above to get started</div>
          </div>
        )}

        {/* Uploaded Videos Manager */}
        <div style={{ marginTop: 32 }}>
          <div className="section-title">📁 Uploaded Footage Library ({uploadedVideos.length} videos)</div>
          {loadingVideos ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading library…</div>
          ) : uploadedVideos.length === 0 ? (
            <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>No videos uploaded yet.</div>
          ) : (
            <div className="video-list">
              {uploadedVideos.map((v) => (
                <div className="video-item" key={v.id}>
                  <div className="video-thumb">
                    {v.thumbnail_url
                      ? <img src={`http://localhost:8000${v.thumbnail_url}`} alt={v.camera_id} />
                      : "🎬"}
                  </div>
                  <div className="video-info">
                    <div className="video-name">{v.original_filename || v.stored_filename || v.id}</div>
                    <div className="video-meta">
                      <span>📹 {v.camera_id}</span>
                      {v.duration_seconds && (
                        <><span>·</span><span>⏱ {formatDuration(v.duration_seconds)}</span></>
                      )}
                      <span>·</span>
                      <span>{formatSize(v.size_bytes)}</span>
                      <span>·</span>
                      <span className="mono" style={{ fontSize: "0.65rem" }}>#{v.id}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <a href="/search">
                      <button className="btn btn-secondary btn-sm">Search →</button>
                    </a>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ color: "var(--accent)", borderColor: "rgba(233,69,96,0.3)" }}
                      onClick={() => handleDeleteVideo(v)}
                      disabled={deletingId === v.id}
                      title="Delete video"
                    >
                      {deletingId === v.id ? "⏳" : "🗑 Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AppLayout>
    </ToastProvider>
  );
}
