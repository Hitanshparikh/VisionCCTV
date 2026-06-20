"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import AppLayout from "@/components/AppLayout";
import ToastProvider, { showToast } from "@/components/ToastProvider";
import {
  listVideos, listReferences,
  startImageSearch, startKeywordSearch, startLprSearch, getJobStatus,
  VideoMeta, ReferenceMeta, SearchJob
} from "@/lib/api";

type SearchMode = "image" | "keyword" | "lpr";

interface HistoryItem {
  jobId: string;
  timestamp: string;
  type: string;
  query: string;
  videosCount: number;
}

export default function SearchPage() {
  const router = useRouter();
  const [mode, setMode] = useState<SearchMode>("image");
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [refs, setRefs] = useState<ReferenceMeta[]>([]);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState("");
  const [plateText, setPlateText] = useState("");
  const [startTimeStr, setStartTimeStr] = useState("");
  const [endTimeStr, setEndTimeStr] = useState("");
  const [sampleFps, setSampleFps] = useState(1.0);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.65);
  const [similarityThreshold, setSimilarityThreshold] = useState(0.70);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<SearchJob | null>(null);
  const [polling, setPolling] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [framesMatched, setFramesMatched] = useState(0);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  // Update similarity threshold default based on mode
  useEffect(() => {
    if (mode === "image") setSimilarityThreshold(0.70);
    else if (mode === "keyword") setSimilarityThreshold(0.25);
    else setSimilarityThreshold(0.50);
  }, [mode]);

  // Load history & assets on mount
  useEffect(() => {
    async function load() {
      try {
        const [v, r] = await Promise.all([listVideos(), listReferences()]);
        setVideos(v.videos);
        setRefs(r.references);
        setSelectedVideos(new Set(v.videos.map((vv) => vv.id)));
        setSelectedRefs(new Set(r.references.map((rr) => rr.id)));

        // Load search history
        const saved = localStorage.getItem("visioncctv_history");
        if (saved) {
          setHistory(JSON.parse(saved));
        }
      } catch {
        showToast("Failed to load assets", "error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Poll job status
  const pollJob = useCallback((id: string) => {
    setPolling(true);
    setPollError(null);
    setFramesProcessed(0);
    setFramesMatched(0);
    let consecutiveErrors = 0;
    const startTime = Date.now();
    const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min hard frontend timeout

    const interval = setInterval(async () => {
      // Frontend timeout guard
      if (Date.now() - startTime > POLL_TIMEOUT_MS) {
        clearInterval(interval);
        setPolling(false);
        setPollError("Search timed out after 5 minutes. The backend may still be running — check /results manually.");
        showToast("⏰ Search timed out on frontend. Check Results page.", "error");
        return;
      }

      try {
        const status = await getJobStatus(id);
        consecutiveErrors = 0; // reset on success
        setJob(status);
        setFramesProcessed((status as any).frames_processed ?? 0);
        setFramesMatched((status as any).frames_matched ?? 0);

        if (status.status === "completed" || status.status === "failed") {
          clearInterval(interval);
          setPolling(false);
          if (status.status === "completed") {
            showToast(`✅ Search complete! Found ${status.match_count} match(es).`, "success");
            setTimeout(() => router.push(`/results#${id}`), 1200);
          } else {
            setPollError(status.error || "Pipeline failed");
            showToast(`Search failed: ${status.error}`, "error");
          }
        }
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          clearInterval(interval);
          setPolling(false);
          const msg = err instanceof Error ? err.message : "Network error";
          setPollError(`Lost connection after ${consecutiveErrors} retries: ${msg}`);
          showToast("❌ Lost connection to backend", "error");
        }
        // else silently retry
      }
    }, 2000);
  }, [router]);

  const handleSearch = async () => {
    if (selectedVideos.size === 0) { showToast("Select at least one video to analyze", "error"); return; }
    if (mode === "image" && selectedRefs.size === 0) { showToast("Select at least one suspect reference photo", "error"); return; }
    if (mode === "keyword" && !keyword.trim()) { showToast("Enter a search keyword", "error"); return; }
    if (mode === "lpr" && !plateText.trim()) { showToast("Enter a target license plate number", "error"); return; }

    const startVal = startTimeStr.trim() ? parseFloat(startTimeStr) : null;
    const endVal = endTimeStr.trim() ? parseFloat(endTimeStr) : null;

    try {
      let result: { job_id: string; status: string };
      let queryStr = "";

      if (mode === "image") {
        result = await startImageSearch(
          Array.from(selectedVideos),
          Array.from(selectedRefs),
          confidenceThreshold,
          similarityThreshold,
          sampleFps,
          startVal,
          endVal
        );
        const selectedNames = refs
          .filter(r => selectedRefs.has(r.id))
          .map(r => r.label);
        queryStr = `Face Re-ID: ${selectedNames.join(", ")}`;
      } else if (mode === "keyword") {
        result = await startKeywordSearch(
          Array.from(selectedVideos),
          keyword.trim(),
          similarityThreshold,
          sampleFps,
          startVal,
          endVal
        );
        queryStr = `Keyword: "${keyword.trim()}"`;
      } else {
        result = await startLprSearch(
          Array.from(selectedVideos),
          plateText.trim(),
          similarityThreshold,
          sampleFps,
          startVal,
          endVal
        );
        queryStr = `Plate: "${plateText.trim().toUpperCase()}"`;
      }

      // Save search in local history
      const newHistoryItem: HistoryItem = {
        jobId: result.job_id,
        timestamp: new Date().toLocaleString(),
        type: mode,
        query: queryStr,
        videosCount: selectedVideos.size
      };
      const updatedHistory = [newHistoryItem, ...history].slice(0, 10);
      setHistory(updatedHistory);
      localStorage.setItem("visioncctv_history", JSON.stringify(updatedHistory));

      setJobId(result.job_id);
      setJob({ status: "queued", type: mode, match_count: 0 });
      showToast(`🔍 Search job triggered (${result.job_id})`, "info");
      pollJob(result.job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Search failed";
      showToast(msg, "error");
    }
  };

  const toggleVideo = (id: string) =>
    setSelectedVideos((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleRef = (id: string) =>
    setSelectedRefs((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  return (
    <ToastProvider>
      <AppLayout>
        <div className="page-header">
          <h1 className="page-title">🔍 Search Footage</h1>
          <p className="page-subtitle">
            Scan your uploaded CCTV videos using advanced Face Re-ID, Open-Vocab CLIP, or License Plate Detection.
          </p>
        </div>

        {/* Search Mode Tab Group */}
        <div className="tab-group">
          <button className={`tab ${mode === "image" ? "active" : ""}`} onClick={() => setMode("image")}>
            👤 Face Re-ID
          </button>
          <button className={`tab ${mode === "keyword" ? "active" : ""}`} onClick={() => setMode("keyword")}>
            💬 Keyword Search
          </button>
          <button className={`tab ${mode === "lpr" ? "active" : ""}`} onClick={() => setMode("lpr")}>
            🚗 License Plate (LPR)
          </button>
        </div>

        <div className="grid-2" style={{ gap: 24, alignItems: "start" }}>
          {/* Left Column: Config Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Input Selection Card */}
            <div className="card">
              <div className="section-title">
                {mode === "image" ? "Suspect Database References" : mode === "keyword" ? "Keyword Query Description" : "Target License Plate"}
              </div>

              {mode === "image" && (
                <div>
                  {loading ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading references…</div>
                  ) : refs.length === 0 ? (
                    <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                      No references found. <a href="/suspects" style={{ color: "var(--accent)" }}>Add suspect photos →</a>
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                      {refs.map((ref) => (
                        <div
                          key={ref.id}
                          onClick={() => toggleRef(ref.id)}
                          style={{
                            cursor: "pointer",
                            borderRadius: 8,
                            overflow: "hidden",
                            border: `2px solid ${selectedRefs.has(ref.id) ? "var(--accent)" : "var(--border)"}`,
                            transition: "var(--transition)",
                            position: "relative",
                          }}
                        >
                          {ref.image_url ? (
                            <img
                              src={`http://localhost:8000${ref.image_url}`}
                              alt={ref.label}
                              style={{ width: "100%", height: 70, objectFit: "cover" }}
                            />
                          ) : (
                            <div style={{ width: "100%", height: 70, background: "var(--bg-elevated)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.5rem" }}>👤</div>
                          )}
                          {selectedRefs.has(ref.id) && (
                            <div style={{
                              position: "absolute", top: 4, right: 4,
                              width: 16, height: 16, borderRadius: "50%",
                              background: "var(--accent)", display: "flex",
                              alignItems: "center", justifyContent: "center",
                              fontSize: "0.6rem", color: "white", fontWeight: 800,
                            }}>✓</div>
                          )}
                          <div style={{ padding: "4px 6px", fontSize: "0.65rem", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {ref.label}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {mode === "keyword" && (
                <>
                  <div className="input-group">
                    <label className="input-label">Natural Language Search Query</label>
                    <input
                      className="input-field"
                      placeholder='e.g. "person in black jacket", "white van", "man in red shirt"'
                      value={keyword}
                      onChange={(e) => setKeyword(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    💡 Supports multiple languages (Hindi &amp; Gujarati translation local fallback). Try: <em>"सफ़ेद वैन", "લાલ કાર", "police uniform"</em>
                  </div>
                </>
              )}

              {mode === "lpr" && (
                <>
                  <div className="input-group" style={{ marginBottom: 0 }}>
                    <label className="input-label">License Plate Number</label>
                    <input
                      className="input-field"
                      placeholder='e.g. "MH12AB1234", "DL3C"'
                      value={plateText}
                      onChange={(e) => setPlateText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    />
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 10, lineHeight: 1.5 }}>
                    🔍 Scans video frames for vehicle license plates and matches the requested character sequences.
                  </div>
                </>
              )}
            </div>

            {/* Time Window Filtering Card */}
            <div className="card">
              <div className="section-title">🕒 Time Bounds Filter (Optional)</div>
              <div style={{ display: "flex", gap: 12 }}>
                <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="input-label">Start Time (sec)</label>
                  <input
                    type="number"
                    className="input-field"
                    placeholder="e.g. 0"
                    value={startTimeStr}
                    onChange={(e) => setStartTimeStr(e.target.value)}
                  />
                </div>
                <div className="input-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="input-label">End Time (sec)</label>
                  <input
                    type="number"
                    className="input-field"
                    placeholder="e.g. 120"
                    value={endTimeStr}
                    onChange={(e) => setEndTimeStr(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: 8 }}>
                Leave empty to search the entire video length. Specifying bounds boosts search speeds.
              </div>
            </div>

            {/* Advanced Settings */}
            <div className="card">
              <div className="section-title">Search &amp; AI Thresholds</div>
              <div className="input-group">
                <label className="input-label">Frame Sample Rate (per sec): {sampleFps} Hz</label>
                <input type="range" min={0.1} max={5} step={0.1} value={sampleFps} onChange={(e) => setSampleFps(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
                <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>1.0 fps recommended for surveillance. Higher rates parse more frames but run slower.</div>
              </div>
              {mode === "image" && (
                <div className="input-group">
                  <label className="input-label">YOLO Face Detection Confidence: {(confidenceThreshold * 100).toFixed(0)}%</label>
                  <input type="range" min={0.3} max={0.95} step={0.05} value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
                </div>
              )}
              <div className="input-group" style={{ marginBottom: 0 }}>
                <label className="input-label">Model Match Threshold: {(similarityThreshold * 100).toFixed(0)}%</label>
                <input type="range" min={0.1} max={0.95} step={0.05} value={similarityThreshold} onChange={(e) => setSimilarityThreshold(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
              </div>
            </div>

            {/* Run Button */}
            <button
              className="btn btn-primary btn-lg"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleSearch}
              disabled={polling}
            >
              {polling ? "⏳ Processing AI Pipeline..." : "🔍 Run Intelligence Search"}
            </button>
          </div>

          {/* Right Column: Asset Selection & Status */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Video Selector */}
            <div className="card">
              <div className="section-title">
                Select CCTV Video Files ({selectedVideos.size}/{videos.length} selected)
              </div>
              {loading ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>Loading footage database…</div>
              ) : videos.length === 0 ? (
                <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                  No videos found. <a href="/upload" style={{ color: "var(--accent)" }}>Upload video files →</a>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVideos(new Set(videos.map((v) => v.id)))}>All</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelectedVideos(new Set())}>None</button>
                  </div>
                  {videos.map((v) => (
                    <div
                      key={v.id}
                      className={`video-item ${selectedVideos.has(v.id) ? "selected" : ""}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => toggleVideo(v.id)}
                    >
                      <input
                        type="checkbox"
                        className="video-checkbox"
                        checked={selectedVideos.has(v.id)}
                        onChange={() => {}}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="video-thumb">
                        {v.thumbnail_url ? (
                          <img src={`http://localhost:8000${v.thumbnail_url}`} alt="" />
                        ) : "🎬"}
                      </div>
                      <div className="video-info">
                        <div className="video-name">{v.original_filename || v.filename || v.id}</div>
                        <div className="video-meta">
                          <span>📹 {v.camera_id}</span>
                          {v.duration_seconds && <><span>·</span><span>{v.duration_seconds.toFixed(0)}s</span></>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Active Job Tracker */}
            {(job || pollError) && (
              <div className="card" style={{ borderColor: job?.status === "completed" ? "rgba(0,255,136,0.3)" : job?.status === "failed" || pollError ? "rgba(233,69,96,0.3)" : "var(--border)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div className="section-title" style={{ marginBottom: 0 }}>Active Job Status</div>
                  {job && <span className={`status-pill status-${job.status}`}>{job.status}</span>}
                </div>
                {jobId && <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 8 }}>Job ID: <span className="mono">{jobId}</span></div>}

                {(job?.status === "running" || job?.status === "queued") && (
                  <>
                    <div className="progress-bar" style={{ marginBottom: 8 }}>
                      <div className="progress-bar-fill pulse" style={{ width: "100%", animation: "pulse 1.5s infinite" }} />
                    </div>
                    {framesProcessed > 0 && (
                      <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", marginTop: 4, display: "flex", gap: 16 }}>
                        <span>🖼 <strong style={{ color: "var(--cyan)" }}>{framesProcessed}</strong> frames analyzed</span>
                        <span>🎯 <strong style={{ color: "var(--green)" }}>{framesMatched}</strong> matches so far</span>
                      </div>
                    )}
                    {framesProcessed === 0 && (
                      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                        ⏳ Starting pipeline… extracting frames
                      </div>
                    )}
                  </>
                )}

                {job?.status === "completed" && (
                  <div>
                    <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "var(--green)", marginBottom: 6 }}>
                      🎯 Extraction Success! {job.match_count} Match{job.match_count !== 1 ? "es" : ""}
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Auto-navigating to results grid…</div>
                  </div>
                )}


                {job?.status === "failed" && (
                  <div style={{ color: "var(--accent)", fontSize: "0.8rem" }}>
                    ❌ Pipeline Error: {job.error || "Search execution failed"}
                  </div>
                )}

                {pollError && !polling && (
                  <div style={{ color: "var(--accent)", fontSize: "0.78rem", marginTop: 6, lineHeight: 1.5 }}>
                    ⚠️ {pollError}
                  </div>
                )}
              </div>
            )}

            {/* Search History Card */}
            {history.length > 0 && (
              <div className="card">
                <div className="section-title">Search History</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 220, overflowY: "auto" }}>
                  {history.map((h, i) => (
                    <div
                      key={i}
                      onClick={() => router.push(`/results#${h.jobId}`)}
                      style={{
                        padding: "8px 12px",
                        background: "var(--bg-elevated)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        cursor: "pointer",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                      className="history-item-hover"
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: "0.75rem", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.query}
                        </div>
                        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginTop: 2 }}>
                          {h.timestamp} · {h.videosCount} Video(s)
                        </div>
                      </div>
                      <div className="mono" style={{ fontSize: "0.65rem", padding: "2px 6px", background: "var(--bg-card)", borderRadius: 4, color: "var(--cyan)" }}>
                        #{h.jobId}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </AppLayout>
    </ToastProvider>
  );
}
