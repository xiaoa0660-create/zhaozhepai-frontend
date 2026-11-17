import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Camera, Download, Square } from "lucide-react";
import type { PlayScript } from "../domain/scene-play";

export default function PlayRecorder({
  script,
  onDirty,
  onBack,
}: {
  script: PlayScript;
  onDirty: (dirty: boolean) => void;
  onBack: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    media = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null);
  const run = useRef(0),
    interval = useRef<ReturnType<typeof setInterval> | null>(null),
    limit = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunks = useRef<Blob[]>([]),
    clipRef = useRef<string | null>(null),
    alive = useRef(false),
    requesting = useRef(false),
    recordingStarted = useRef(0);
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [audio, setAudio] = useState(true);
  const [countdown, setCountdown] = useState<number | null>(null),
    [recording, setRecording] = useState(false),
    [finishing, setFinishing] = useState(false),
    [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{
      url: string;
      mime: string;
      duration: number;
    } | null>(null),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  function clearTimers() {
    if (interval.current) clearInterval(interval.current);
    if (limit.current) clearTimeout(limit.current);
    interval.current = null;
    limit.current = null;
  }
  function stopTracks() {
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
    if (video.current) video.current.srcObject = null;
  }
  function finish() {
    clearTimers();
    if (recorder.current?.state === "recording") {
      setFinishing(true);
      recorder.current.stop();
    } else {
      setCountdown(null);
      setRecording(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    const hide = () => {
      if (document.hidden) {
        run.current++;
        setBusy(false);
        finish();
        stopTracks();
        setReady(false);
        setError(
          "离开页面时已停止相机，已录制的片段会保留。可以重新打开相机。",
        );
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      alive.current = false;
      run.current++;
      clearTimers();
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        recorder.current.onerror = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      stopTracks();
      if (clipRef.current) URL.revokeObjectURL(clipRef.current);
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useLayoutEffect(() => {
    onDirty(recording || countdown !== null || finishing || (!!clip && !saved));
  }, [recording, countdown, finishing, clip, saved, onDirty]);
  async function openCamera() {
    if (requesting.current) return;
    requesting.current = true;
    const id = ++run.current;
    setBusy(true);
    setError("");
    stopTracks();
    setReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext)
        throw new Error("请通过 HTTPS 或本机地址打开录制相机。");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 720 },
          height: { ideal: 1280 },
        },
      });
      if (!alive.current || id !== run.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = stream;
      const track = stream.getVideoTracks()[0];
      track.onended = () => {
        if (alive.current) {
          finish();
          setReady(false);
          setError("相机已断开，请重新打开。已录片段会保留。");
        }
      };
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      if (alive.current && id === run.current) setReady(true);
    } catch (e) {
      if (alive.current && id === run.current) {
        stopTracks();
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "相机或麦克风权限未开启。可以在站点设置中允许，或关闭录音再试。"
            : e instanceof Error
              ? e.message
              : "相机没有打开，请重试。",
        );
      }
    } finally {
      requesting.current = false;
      if (alive.current && id === run.current) setBusy(false);
    }
  }
  function record() {
    if (
      !ready ||
      !media.current ||
      countdown !== null ||
      recording ||
      finishing
    )
      return;
    if (typeof MediaRecorder === "undefined") {
      setError(
        "这个浏览器暂不支持网页录像。可以保存剧本，用系统相机完成拍摄。",
      );
      return;
    }
    const mime = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ].find((m) => MediaRecorder.isTypeSupported(m));
    if (!mime) {
      setError("当前浏览器没有可用的录像格式，可以保存剧本后用系统相机拍摄。");
      return;
    }
    setError("");
    setSeconds(0);
    setSaved(false);
    setCountdown(3);
    const end = performance.now() + 3000;
    interval.current = setInterval(() => {
      const remaining = Math.ceil((end - performance.now()) / 1000);
      if (remaining > 0) {
        setCountdown(remaining);
        return;
      }
      clearTimers();
      setCountdown(null);
      try {
        if (!media.current?.active) throw new Error("相机已暂停，请重新打开。");
        const next = new MediaRecorder(media.current, { mimeType: mime });
        recorder.current = next;
        chunks.current = [];
        recordingStarted.current = performance.now();
        next.ondataavailable = (e) => {
          if (e.data.size) chunks.current.push(e.data);
        };
        next.onerror = () => {
          if (alive.current) {
            clearTimers();
            setRecording(false);
            setFinishing(false);
            setError("录制遇到问题，请重新打开相机后重试。");
            stopTracks();
            setReady(false);
          }
        };
        next.onstop = () => {
          clearTimers();
          if (!alive.current) return;
          const blob = new Blob(chunks.current, {
            type: next.mimeType || mime,
          });
          setRecording(false);
          setFinishing(false);
          setCountdown(null);
          if (!blob.size) {
            setError("没有收到录像画面，请重试。原来的视频仍然保留。");
            return;
          }
          if (clipRef.current) URL.revokeObjectURL(clipRef.current);
          clipRef.current = URL.createObjectURL(blob);
          setClip({
            url: clipRef.current,
            mime: blob.type,
            duration: Math.min(
              15,
              (performance.now() - recordingStarted.current) / 1000,
            ),
          });
          setSaved(false);
        };
        next.start(250);
        setRecording(true);
        interval.current = setInterval(
          () =>
            setSeconds(
              Math.min(
                15,
                (performance.now() - recordingStarted.current) / 1000,
              ),
            ),
          100,
        );
        limit.current = setTimeout(finish, 15000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "录像没有启动，请重试。");
        setRecording(false);
      }
    }, 100);
  }
  const beat =
    script.beats.find((b) => seconds >= b.start && seconds < b.end) ??
    script.beats[2];
  return (
    <section className="zp-play-recorder">
      <div className="zp-page-title">
        <span className="zp-step">15 秒 · 一镜到底</span>
        <h2>《{script.title}》</h2>
      </div>
      <div className="zp-play-viewfinder">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          aria-label="短剧实时取景"
        />
        {!ready && (
          <div>
            <Camera size={26} />
            <p>准备好站位，再打开相机。</p>
          </div>
        )}
        {countdown !== null && (
          <strong className="zp-play-countdown" role="status">
            {countdown}
          </strong>
        )}
        {recording && (
          <span className="zp-play-rec">
            ● REC · {Math.floor(seconds)} / 15 秒
          </span>
        )}
      </div>
      {recording ? (
        <div className="zp-play-live-cue" aria-live="polite">
          <span>
            {beat.start}—{beat.end} 秒 · {beat.actor}
          </span>
          <p>{beat.action}</p>
          {beat.line && <b>“{beat.line}”</b>}
        </div>
      ) : (
        <p className="zp-caption">{script.camera}</p>
      )}
      {!ready && (
        <>
          <label className="zp-check">
            <input
              type="checkbox"
              checked={audio}
              disabled={busy}
              onChange={(e) => setAudio(e.target.checked)}
            />
            录入现场声音
          </label>
          <button
            className="zp-primary"
            disabled={busy}
            onClick={() => void openCamera()}
          >
            {busy ? "正在打开…" : "打开录制相机"}
          </button>
        </>
      )}
      {ready && (
        <button
          className="zp-primary"
          disabled={finishing}
          onClick={recording || countdown !== null ? finish : record}
        >
          {recording || countdown !== null ? (
            <Square size={17} />
          ) : (
            <Camera size={17} />
          )}
          {finishing
            ? "正在保存片段…"
            : recording
              ? "结束录制"
              : countdown !== null
                ? "取消倒计时"
                : clip
                  ? "再录一遍"
                  : "倒计时 3 秒，开始录制"}
        </button>
      )}
      {error && (
        <p role="alert" className="zp-field-note">
          {error}
        </p>
      )}
      {clip && !recording && countdown === null && (
        <div className="zp-play-result">
          <h3>这次，是真人演出来的。</h3>
          <video
            src={clip.url}
            controls
            playsInline
            aria-label="刚录下的短剧"
          />
          <p className="zp-caption">
            约 {Math.round(clip.duration)} 秒 ·{" "}
            {clip.mime.includes("mp4") ? "MP4" : "WebM"} ·
            原始录制，口令不写入视频
          </p>
          <a
            className="zp-primary"
            href={clip.url}
            download={`照着拍-${script.title}.${clip.mime.includes("mp4") ? "mp4" : "webm"}`}
            onClick={() => setSaved(true)}
          >
            <Download size={17} /> 保存这段短片
          </a>
          {saved && (
            <p role="status" className="zp-caption">
              已发起下载，请在浏览器下载中查看。
            </p>
          )}
        </div>
      )}
      <button
        className="zp-text-button"
        disabled={recording || countdown !== null || finishing}
        onClick={onBack}
      >
        返回剧本
      </button>
    </section>
  );
}
