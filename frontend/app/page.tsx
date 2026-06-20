"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import AppLayout from "@/components/AppLayout";
import ToastProvider, { showToast } from "@/components/ToastProvider";
import { listVideos, listReferences, startImageSearch, getJobStatus, VideoMeta, ReferenceMeta } from "@/lib/api";
import { useRouter } from "next/navigation";

// Animated counter hook
function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    let start = 0;
    const step = target / (duration / 16);
    const timer = setInterval(() => {
      start += step;
      if (start >= target) { setValue(target); clearInterval(timer); }
      else setValue(Math.floor(start));
    }, 16);
    return () => clearInterval(timer);
  }, [target, duration]);
  return value;
}

export default function DashboardPage() {
  const router = useRouter();
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [refs, setRefs] = useState<ReferenceMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoStep, setDemoStep] = useState("");
  const [demoJobId, setDemoJobId] = useState<string | null>(null);
  const [searchHistory, setSearchHistory] = useState<Array<{ jobId: string; timestamp: string; type: string; query: string; videosCount: number }>>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const videoCount = useCountUp(videos.length, 800);
  const refCount = useCountUp(refs.length, 800);

  // Particle / scanline canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    type Particle = { x: number; y: number; vx: number; vy: number; r: number; alpha: number };
    const particles: Particle[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.1,
    }));

    let animId: number;
    let scanY = 0;

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Grid lines
      ctx.strokeStyle = "rgba(233,69,96,0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
      }

      // Particles
      particles.forEach((p) => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(233,69,96,${p.alpha})`;
        ctx.fill();
      });

      // Scanline
      scanY = (scanY + 0.8) % canvas.height;
      const grad = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 20);
      grad.addColorStop(0, "transparent");
      grad.addColorStop(0.5, "rgba(0,212,255,0.04)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 20, canvas.width, 40);

      animId = requestAnimationFrame(draw);
    }
    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [v, r] = await Promise.all([listVideos(), listReferences()]);
        setVideos(v.videos);
        setRefs(r.references);
        setApiOk(true);
      } catch {
        setApiOk(false);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Load search history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("visioncctv_history");
    if (saved) {
      try { setSearchHistory(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, []);

  const runDemoInvestigation = async () => {
    if (demoRunning) return;
    setDemoRunning(true);

    try {
      setDemoStep("🎬 Loading demo video...");
      await new Promise(r => setTimeout(r, 600));

      const [v, r] = await Promise.all([listVideos(), listReferences()]);
      if (v.videos.length === 0) {
        showToast("No videos uploaded. Please upload a video first.", "error");
        setDemoRunning(false); setDemoStep(""); return;
      }
      if (r.references.length === 0) {
        showToast("No reference images found.", "error");
        setDemoRunning(false); setDemoStep(""); return;
      }

      setDemoStep("👤 Selecting suspects from database...");
      await new Promise(r => setTimeout(r, 700));

      setDemoStep("🔍 Launching AI face recognition...");
      const videoIds = v.videos.map(vv => vv.id);
      const refIds = r.references.slice(0, 4).map(rr => rr.id);
      const job = await startImageSearch(videoIds, refIds, 0.5, 0.8, 1.0);
      setDemoJobId(job.job_id);

      setDemoStep("⚡ Analyzing frames...");
      let completed = false;
      for (let i = 0; i < 30 && !completed; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const status = await getJobStatus(job.job_id);
        if (status.status === "completed") {
          completed = true;
          setDemoStep(`✅ Found ${status.match_count} matches! Navigating...`);
          await new Promise(r => setTimeout(r, 1000));
          router.push(`/results#${job.job_id}`);
        } else if (status.status === "failed") {
          throw new Error(status.error || "Search failed");
        } else {
          setDemoStep(`⚡ Analyzing frames... (${i * 2}s elapsed)`);
        }
      }
      if (!completed) {
        setDemoStep("🕐 Still running — check Results page");
        await new Promise(r => setTimeout(r, 2000));
        router.push(`/results#${job.job_id}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Demo failed";
      showToast(msg, "error");
      setDemoStep("");
      setDemoRunning(false);
    }
  };

  // Mock common tag cloud items
  const tags = [
    { text: "white van", size: "1rem", color: "var(--cyan)" },
    { text: "red car", size: "0.85rem", color: "var(--accent)" },
    { text: "person in black jacket", size: "1.1rem", color: "var(--green)" },
    { text: "helmet", size: "0.75rem", color: "var(--yellow)" },
    { text: "police uniform", size: "0.95rem", color: "var(--cyan)" },
    { text: "backpack", size: "0.75rem", color: "var(--text-secondary)" },
    { text: "motorcycle", size: "0.8rem", color: "var(--green)" },
    { text: "license plate", size: "1.05rem", color: "var(--yellow)" },
    { text: "speeding vehicle", size: "0.78rem", color: "var(--accent)" },
    { text: "lobby camera", size: "0.85rem", color: "var(--text-secondary)" },
  ];

  const handleTagClick = (tag: string) => {
    showToast(`Copied tag: "${tag}". Pasted in search panel.`, "success");
    localStorage.setItem("visioncctv_pending_tag", tag);
    router.push("/search");
  };

  return (
    <ToastProvider>
      <AppLayout>
        {/* ── Hero Section ─────────────────────────────── */}
        <div style={{
          position: "relative",
          borderRadius: "var(--radius-xl)",
          overflow: "hidden",
          marginBottom: 32,
          background: "linear-gradient(135deg, #0a0a0f 0%, #0f1a2e 40%, #16213e 100%)",
          border: "1px solid rgba(233,69,96,0.2)",
          minHeight: 280,
          display: "flex",
          alignItems: "center",
          padding: "40px 48px",
        }}>
          {/* Canvas background */}
          <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />

          {/* Glow orbs */}
          <div style={{ position: "absolute", top: -60, right: 80, width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(233,69,96,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
          <div style={{ position: "absolute", bottom: -40, left: 100, width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(0,212,255,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />

          <div style={{ position: "relative", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{
                padding: "4px 12px", borderRadius: 100,
                background: "rgba(233,69,96,0.15)", border: "1px solid rgba(233,69,96,0.4)",
                fontSize: "0.7rem", fontWeight: 700, color: "var(--accent)",
                textTransform: "uppercase", letterSpacing: "1px",
                animation: "pulse 2s infinite",
              }}>
                🔴 LIVE · AI Investigation System
              </div>
            </div>

            <h1 style={{
              fontSize: "2.5rem", fontWeight: 900, letterSpacing: "-1px",
              lineHeight: 1.1, marginBottom: 12,
              background: "linear-gradient(135deg, #fff 0%, rgba(255,255,255,0.7) 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            }}>
              Vision<span style={{ WebkitTextFillColor: "var(--accent)" }}>CCTV</span>
              <br />Intelligence Platform
            </h1>

            <p style={{ fontSize: "1rem", color: "var(--text-secondary)", maxWidth: 480, lineHeight: 1.6, marginBottom: 28 }}>
              Locate suspects, vehicles &amp; objects in hours of footage in <strong style={{ color: "var(--cyan)" }}>seconds</strong> using face re-identification and natural language AI search.
            </p>

            {/* Demo Button */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <button
                onClick={runDemoInvestigation}
                disabled={demoRunning || !apiOk}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "14px 28px", borderRadius: "var(--radius-md)",
                  background: demoRunning
                    ? "var(--bg-elevated)"
                    : "linear-gradient(135deg, var(--accent) 0%, #c0392b 100%)",
                  border: "none", cursor: demoRunning ? "not-allowed" : "pointer",
                  color: "white", fontWeight: 800, fontSize: "1rem",
                  boxShadow: demoRunning ? "none" : "0 8px 32px rgba(233,69,96,0.4)",
                  transition: "all 0.3s ease",
                  fontFamily: "Inter, sans-serif",
                  opacity: (!apiOk && !demoRunning) ? 0.5 : 1,
                }}
              >
                {demoRunning
                  ? <><span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span> {demoStep}</>
                  : <><span style={{ fontSize: "1.2rem" }}>🚀</span> Run Live Demo Investigation</>
                }
              </button>

              <Link href="/search">
                <button style={{
                  padding: "14px 24px", borderRadius: "var(--radius-md)",
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                  color: "white", fontWeight: 600, fontSize: "0.9rem", cursor: "pointer",
                  fontFamily: "Inter, sans-serif",
                }}>
                  Custom Search →
                </button>
              </Link>
            </div>

            {demoRunning && (
              <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 3, background: "var(--bg-elevated)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: "linear-gradient(90deg, var(--accent), var(--cyan))", borderRadius: 2, animation: "progressAnim 2s ease-in-out infinite", width: "60%" }} />
                </div>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Live</span>
              </div>
            )}
          </div>

          {/* Right panel — terminal style */}
          <div style={{
            position: "relative",
            background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "var(--radius-md)", padding: "16px 20px",
            fontFamily: "JetBrains Mono, monospace", fontSize: "0.72rem",
            color: "var(--text-secondary)", minWidth: 260, maxWidth: 300,
            backdropFilter: "blur(8px)",
          }}>
            <div style={{ color: "var(--green)", marginBottom: 10, fontWeight: 600 }}>// system.status</div>
            {[
              ["backend", apiOk === null ? "connecting…" : apiOk ? "online" : "offline", apiOk ? "var(--green)" : "var(--accent)"],
              ["ai.mode", "yolo8 + clip + lpr", "var(--cyan)"],
              ["videos", loading ? "…" : `${videos.length} uploaded`, "var(--text-primary)"],
              ["references", loading ? "…" : `${refs.length} loaded`, "var(--text-primary)"],
              ["search.modes", "face | keyword | plate", "var(--yellow)"],
              ["offline.dictionary", "50 index terms", "var(--green)"],
              ["integrity.verification", "sha256 matching", "var(--cyan)"],
            ].map(([k, v, col]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 5 }}>
                <span style={{ color: "var(--text-muted)" }}>{k}</span>
                <span style={{ color: col as string }}>{v as string}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Animated Stats ────────────────────────────── */}
        <div className="stats-grid" style={{ marginBottom: 32 }}>
          {[
            { value: loading ? "—" : videoCount.toString(), label: "Videos Ingested", icon: "🎬", color: "var(--accent)" },
            { value: loading ? "—" : refCount.toString(), label: "Target Profiles", icon: "👤", color: "var(--cyan)" },
            { value: "3", label: "AI Pipeline Modes", icon: "🔍", color: "var(--green)" },
            { value: "SHA-256", label: "Forensic Integrity", icon: "🛡", color: "var(--yellow)" },
          ].map((s) => (
            <div className="stat-card" key={s.label} style={{ borderTop: `2px solid ${s.color}` }}>
              <div style={{ fontSize: "1.5rem", marginBottom: 8 }}>{s.icon}</div>
              <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid-2" style={{ gap: 24, alignItems: "start", marginBottom: 32 }}>
          {/* Tag Cloud Card */}
          <div className="card">
            <div className="section-title">💬 Commonly Detected Tag Cloud</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: "8px 0" }}>
              {tags.map((tag) => (
                <div
                  key={tag.text}
                  onClick={() => handleTagClick(tag.text)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: "100px",
                    background: "var(--bg-elevated)",
                    border: "1px solid var(--border)",
                    cursor: "pointer",
                    fontSize: tag.size,
                    color: tag.color,
                    fontWeight: 600,
                    transition: "all 0.15s ease",
                  }}
                  className="tag-cloud-item"
                >
                  #{tag.text}
                </div>
              ))}
            </div>
          </div>

          {/* Forensic System Details */}
          <div className="card">
            <div className="section-title">🛡 Offline Forensic Safeguards</div>
            <div style={{ fontSize: "0.82rem", lineHeight: 1.6 }}>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <span style={{ color: "var(--green)" }}>✔</span>
                <span><strong>Bilingual translation indexing</strong> maps local languages (Hindi, Gujarati) directly to English vectors offline.</span>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <span style={{ color: "var(--cyan)" }}>✔</span>
                <span><strong>SHA-256 Integrity Verification</strong> logs absolute file checksums for raw footage, clips, and PDF report validation.</span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <span style={{ color: "var(--yellow)" }}>✔</span>
                <span><strong>Local Frame Extraction</strong> uses lightweight Haar cascade classifiers when running offline or on lower resource systems.</span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Search History Timeline ────────────────────── */}
        {searchHistory.length > 0 && (
          <div className="card" style={{ marginBottom: 32 }}>
            <div className="section-title">📈 Investigation History Timeline</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              {[{ type: "image", label: "👤 Face Re-ID", color: "var(--accent)" }, { type: "keyword", label: "💬 Keyword", color: "var(--cyan)" }, { type: "lpr", label: "🚗 LPR", color: "var(--yellow)" }].map(l => (
                <div key={l.type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
                  <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>{l.label}</span>
                </div>
              ))}
              <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: "var(--text-muted)" }}>{searchHistory.length} job{searchHistory.length !== 1 ? "s" : ""} in session</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {searchHistory.slice(0, 8).map((h, i) => {
                const typeColor = h.type === "image" ? "var(--accent)" : h.type === "lpr" ? "var(--yellow)" : "var(--cyan)";
                const widthPct = Math.max(15, 100 - i * 10);
                return (
                  <div
                    key={i}
                    onClick={() => router.push(`/results#${h.jobId}`)}
                    style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}
                    title={`${h.query} — ${h.timestamp}`}
                  >
                    <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontFamily: "JetBrains Mono, monospace", width: 56, flexShrink: 0, textAlign: "right" }}>
                      #{h.jobId}
                    </div>
                    <div style={{ flex: 1, height: 24, background: "var(--bg-elevated)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{
                        height: "100%", width: `${widthPct}%`,
                        background: `linear-gradient(90deg, ${typeColor}99, transparent)`,
                        borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 8,
                      }}>
                        <span style={{ fontSize: "0.62rem", fontWeight: 700, color: "rgba(255,255,255,0.9)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {h.query}
                        </span>
                      </div>
                    </div>
                    <div style={{ fontSize: "0.58rem", color: "var(--text-muted)", width: 54, flexShrink: 0 }}>
                      {h.videosCount}v · {i === 0 ? "latest" : `#${i + 1}`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Workflow Steps ────────────────────────────── */}
        <div className="section-title">Investigation Workflow</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
          {[
            { step: "01", title: "Upload Footage", desc: "Drag-drop .mp4/.avi/.mov files and register Camera IDs.", href: "/upload", icon: "⬆", color: "var(--accent)" },
            { step: "02", title: "Add Suspects", desc: "Ingest reference photos of persons or vehicles of interest.", href: "/suspects", icon: "👤", color: "var(--cyan)" },
            { step: "03", title: "AI Search", desc: "YOLO Face detection, CLIP keyword, or License Plate Search.", href: "/search", icon: "🔍", color: "var(--green)" },
            { step: "04", title: "Export Evidence", desc: "Download clips, timestamped frames, and certified PDF logs.", href: "/results", icon: "📄", color: "var(--yellow)" },
          ].map((card) => (
            <Link key={card.step} href={card.href} style={{ textDecoration: "none" }}>
              <div className="card" style={{ height: "100%", cursor: "pointer", borderTop: `2px solid ${card.color}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <div style={{ fontSize: "1.2rem" }}>{card.icon}</div>
                  <span style={{ fontSize: "0.65rem", fontWeight: 800, color: card.color, letterSpacing: "1px" }}>STEP {card.step}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: 5 }}>{card.title}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>{card.desc}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* ── Recent Uploads ────────────────────────────── */}
        {videos.length > 0 && (
          <>
            <div className="section-title">Recent Footage</div>
            <div className="video-list">
              {videos.slice(-3).reverse().map((v) => (
                <div className="video-item" key={v.id}>
                  <div className="video-thumb">
                    {v.thumbnail_url
                      ? <img src={`http://localhost:8000${v.thumbnail_url}`} alt={v.camera_id} />
                      : "🎬"}
                  </div>
                  <div className="video-info">
                    <div className="video-name">{v.original_filename || v.filename || v.id}</div>
                    <div className="video-meta">
                      <span>📹 {v.camera_id}</span>
                      {v.duration_seconds && <><span>·</span><span>{v.duration_seconds.toFixed(1)}s</span></>}
                      <span>·</span>
                      <span>{(v.size_bytes / 1024 / 1024).toFixed(1)} MB</span>
                    </div>
                  </div>
                  <Link href="/search">
                    <button className="btn btn-secondary btn-sm">Search →</button>
                  </Link>
                </div>
              ))}
            </div>
          </>
        )}

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes progressAnim {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
          .tag-cloud-item:hover {
            border-color: var(--accent) !important;
            transform: scale(1.05);
            background: rgba(233,69,96,0.08) !important;
          }
        `}</style>
      </AppLayout>
    </ToastProvider>
  );
}
