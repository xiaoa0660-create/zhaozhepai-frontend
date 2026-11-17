import { useEffect, useRef, useState } from "react";
import {
  Check,
  Camera,
  RefreshCw,
  Volume2,
  VolumeX,
  Sun,
  ArrowRight,
} from "lucide-react";
import Modal from "../components/Modal";
import type { NotebookTarget } from "../notebook/experience";
import type { Photo } from "../lib/types";
import { photoCanvas, downloadCanvas, releasePhoto } from "../lib/images";
import { LIGHT_RECIPES, type LightStyle } from "../domain/lighting";
import {
  INTERESTS,
  OBSTACLES,
  directorCues,
  lightTrialSteps,
  type Interest,
  type FieldChoices,
  type Obstacle,
  type TrialPose,
} from "../domain/fieldwork";

export function InterestPicker({
  value,
  onChange,
}: {
  value: Interest[];
  onChange: (value: Interest[]) => void;
}) {
  return (
    <fieldset className="zp-interests">
      <legend>这张参考，我喜欢的是</legend>
      <div>
        {INTERESTS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={value.includes(item.id)}
            title={item.detail}
            disabled={value.length === 1 && value.includes(item.id)}
            onClick={() =>
              onChange(
                value.includes(item.id)
                  ? value.filter((id) => id !== item.id)
                  : [...value, item.id],
              )
            }
          >
            {value.includes(item.id) && <Check size={13} />}
            {item.label}
          </button>
        ))}
      </div>
      <p>
        {value.includes("composition")
          ? "保留选中的特点，其他部分自在发挥。"
          : "人物位置和大小自由安排；选中构图后可实时对齐。"}
      </p>
    </fieldset>
  );
}

export function ObstaclePicker({
  target,
  onApply,
  onClose,
}: {
  target: NotebookTarget;
  onApply: (patch: Partial<FieldChoices>) => void;
  onClose: () => void;
}) {
  const [obstacle, setObstacle] = useState<Obstacle | undefined>(
    target.field?.obstacle,
  );
  const [fallback, setFallback] = useState<LightStyle | "">(
    target.field?.fallbackLight ?? "",
  );
  const needsLight = obstacle === "window" || obstacle === "sun";
  return (
    <Modal title="这里拍不了？换个办法" onClose={onClose}>
      <div className="zp-field-dialog">
        <p className="zp-caption">
          选这次最妨碍你的一个条件。喜欢的参考和其他目标继续保留。
        </p>
        <div className="zp-obstacles">
          {OBSTACLES.map((item) => (
            <button
              key={item.id}
              aria-pressed={obstacle === item.id}
              onClick={() => setObstacle(item.id)}
            >
              <span>
                <b>{item.label}</b>
                <small>{item.detail}</small>
              </span>
              {obstacle === item.id ? (
                <Check size={18} />
              ) : (
                <ArrowRight size={16} />
              )}
            </button>
          ))}
        </div>
        {needsLight && (
          <label className="zp-select">
            现在能用哪种光？
            <select
              aria-label="替代的现场光线"
              value={fallback}
              onChange={(e) => setFallback(e.target.value as LightStyle | "")}
            >
              <option value="">请按现场选择</option>
              {Object.entries(LIGHT_RECIPES)
                .filter(([id]) => obstacle !== "window" || id !== "window")
                .map(([id, recipe]) => (
                  <option key={id} value={id}>
                    {recipe.title}
                  </option>
                ))}
            </select>
            <small>站位图会跟着更新，原来的光影效果也会有所不同。</small>
          </label>
        )}
        {obstacle === "space" && (
          <p className="zp-field-note">
            先保持原地取景。人物框仍不合适时，可以回拍法页调节大小和留白。
          </p>
        )}
        <button
          className="zp-primary"
          disabled={
            !obstacle ||
            (needsLight &&
              (!fallback || (obstacle === "window" && fallback === "window")))
          }
          onClick={() =>
            onApply({
              obstacle,
              fallbackLight: needsLight
                ? (fallback as LightStyle)
                : target.field?.fallbackLight,
              trial: needsLight ? undefined : target.field?.trial,
              ...(needsLight
                ? {
                    interests: [
                      ...new Set([
                        ...(target.field?.interests ?? [
                          "composition" as const,
                        ]),
                        "light" as const,
                      ]),
                    ],
                  }
                : {}),
            })
          }
        >
          用这个办法继续
        </button>
        {target.field?.obstacle && (
          <button
            className="zp-text-button"
            onClick={() =>
              onApply({
                obstacle: undefined,
                fallbackLight: undefined,
                trial: undefined,
              })
            }
          >
            恢复原拍法
          </button>
        )}
      </div>
    </Modal>
  );
}

export function LightTrials({
  style,
  aspect,
  media,
  ready,
  mirrored = false,
  capture,
  onApply,
  onClose,
}: {
  style: LightStyle;
  aspect: number;
  media: MediaStream | null;
  ready: boolean;
  mirrored?: boolean;
  capture: () => Promise<Photo>;
  onApply: (pose: TrialPose) => void;
  onClose: () => void;
}) {
  const steps = lightTrialSteps(style);
  const [step, setStep] = useState(0),
    [photos, setPhotos] = useState<(Photo | null)[]>([null, null, null]);
  const [selected, setSelected] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const preview = useRef<HTMLVideoElement>(null),
    held = useRef<(Photo | null)[]>([null, null, null]),
    alive = useRef(false),
    pending = useRef(false);
  const allDone = photos.every(Boolean);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      held.current.forEach((p) => p && releasePhoto(p));
    };
  }, []);
  useEffect(() => {
    const el = preview.current;
    if (el) {
      el.srcObject = media;
      if (media) void el.play().catch(() => {});
    }
    return () => {
      if (el) el.srcObject = null;
    };
  }, [media, allDone]);
  async function shoot() {
    if (pending.current || !ready) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const photo = await capture();
      if (!alive.current) {
        releasePhoto(photo);
        return;
      }
      const updated = [...held.current];
      if (updated[step]) releasePhoto(updated[step]!);
      updated[step] = photo;
      held.current = updated;
      setPhotos(updated);
      const missing = updated.findIndex((p) => !p);
      if (missing >= 0) setStep(missing);
      setSelected(null);
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "试拍没有保存成功，请重试。");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function download() {
    if (selected === null || !photos[selected] || busy) return;
    setBusy(true);
    setError("");
    try {
      await downloadCanvas(
        await photoCanvas(photos[selected]!),
        `照着拍-试光-${steps[selected].label}.jpg`,
        true,
      );
    } catch {
      if (alive.current) setError("这次没有导出成功，试拍还在，可以重试。");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal title="试一下光" onClose={onClose}>
      <div className="zp-field-dialog zp-light-trials">
        <p className="zp-caption">
          <Sun size={14} /> {LIGHT_RECIPES[style].title} · 同一画幅，试三种明暗
        </p>
        {!allDone && (
          <>
            <div className="zp-trial-live" style={{ aspectRatio: aspect }}>
              <video
                ref={preview}
                autoPlay
                playsInline
                muted
                style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
                aria-label="试光实时画面"
              />
            </div>
            <span className="zp-step">
              {step + 1} / 3 · {steps[step].label}
            </span>
            <h3>{steps[step].cue}</h3>
            <p>{steps[step].detail}</p>
            <button
              className="zp-primary"
              disabled={!ready || busy}
              onClick={() => void shoot()}
            >
              <Camera size={17} />
              {busy ? "正在保存试拍…" : `拍下第 ${step + 1} 张试光`}
            </button>
            {!ready && (
              <p role="status">相机还没准备好，返回取景页后重试即可。</p>
            )}
          </>
        )}
        {allDone && (
          <>
            <h3>哪一种，更接近你喜欢的感觉？</h3>
            <p className="zp-caption">
              点击看大图。手机可能自动调整曝光，选喜欢的明暗即可。
            </p>
          </>
        )}
        <div className="zp-trial-grid">
          {steps.map((s, i) => (
            <button
              key={s.id}
              disabled={!photos[i] || busy}
              aria-pressed={selected === i}
              aria-label={`选择${s.label}的试拍`}
              onClick={() => setSelected(i)}
            >
              {photos[i] ? (
                <img src={photos[i]!.url} alt={`试光${i + 1}：${s.label}`} />
              ) : (
                <span>{i + 1}</span>
              )}
              <small>{s.label}</small>
              {selected === i && <Check size={14} />}
            </button>
          ))}
        </div>
        {selected !== null && photos[selected] && (
          <div className="zp-trial-selected">
            <img src={photos[selected]!.url} alt="选中的试光原片" />
            <p>{steps[selected].cue}</p>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        {selected !== null && (
          <>
            <button
              className="zp-primary"
              disabled={busy}
              onClick={() => onApply(steps[selected].id)}
            >
              按这束光继续拍
            </button>
            <div className="zp-field-actions">
              <button disabled={busy} onClick={() => void download()}>
                保存这张试拍
              </button>
              <button
                disabled={busy || !ready}
                onClick={() => {
                  const next = [...held.current];
                  if (next[selected]) releasePhoto(next[selected]!);
                  next[selected] = null;
                  held.current = next;
                  setPhotos(next);
                  setStep(selected);
                  setSelected(null);
                }}
              >
                <RefreshCw size={14} /> 重拍这一种
              </button>
            </div>
          </>
        )}
        <small className="zp-caption">
          选择后会记住用光方向。试拍仅保留在本轮比较中，喜欢的照片可以先保存。
        </small>
      </div>
    </Modal>
  );
}

export function Director({
  target,
  ready,
  onAlternative,
  onShutter,
  onClose,
}: {
  target: NotebookTarget;
  ready: boolean;
  onAlternative?: () => void;
  onShutter: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0),
    [detail, setDetail] = useState(false),
    [speaking, setSpeaking] = useState(false),
    [voiceError, setVoiceError] = useState("");
  const active = useRef<SpeechSynthesisUtterance | null>(null);
  const available =
    "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  const cues = directorCues(target),
    cue = cues[step];
  function stop() {
    if (active.current) {
      active.current.onend = null;
      active.current.onerror = null;
      window.speechSynthesis.cancel();
      active.current = null;
    }
    setSpeaking(false);
  }
  useEffect(() => {
    stop();
    return stop;
  }, [step, cue.text]);
  function read() {
    stop();
    setVoiceError("");
    if (!available) return;
    const u = new SpeechSynthesisUtterance(
      `${cue.actor}。${cue.text}${detail ? cue.detail : ""}`,
    );
    u.lang = "zh-CN";
    u.rate = 0.88;
    const voice = window.speechSynthesis
      .getVoices()
      .find((v) => v.localService && v.lang.startsWith("zh"));
    if (voice) u.voice = voice;
    active.current = u;
    u.onend = () => {
      active.current = null;
      setSpeaking(false);
    };
    u.onerror = () => {
      active.current = null;
      setSpeaking(false);
      setVoiceError("语音没有播出来，可以照着大字提示转达。");
    };
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }
  return (
    <Modal title="导演口令" onClose={onClose}>
      <div className="zp-field-dialog zp-director">
        <div
          className="zp-director-progress"
          aria-label={`口令第 ${step + 1} 步，共 3 步`}
        >
          {cues.map((_, i) => (
            <span key={i} className={i <= step ? "active" : ""} />
          ))}
        </div>
        <span className="zp-tag">
          {cue.actor} · {step + 1} / 3
        </span>
        <h3>{cue.title}</h3>
        <p className="zp-director-words">{cue.text}</p>
        {detail && <p className="zp-field-note">{cue.detail}</p>}
        <div className="zp-field-actions">
          <button onClick={() => setDetail((v) => !v)}>
            {detail ? "收起解释" : "说具体点"}
          </button>
          {onAlternative && (
            <button
              onClick={() => {
                stop();
                onAlternative();
                setStep(1);
              }}
            >
              换个动作
            </button>
          )}
        </div>
        <button
          className="zp-secondary"
          disabled={!available}
          onClick={speaking ? stop : read}
        >
          {speaking ? <VolumeX size={17} /> : <Volume2 size={17} />}
          {speaking ? "停止朗读" : "朗读这句口令"}
        </button>
        <small role="status">
          {voiceError ||
            (available
              ? "按需朗读，翻到下一步会停止上一句。"
              : "当前浏览器暂不支持语音，可以直接看大字提示。")}
        </small>
        {step < 2 ? (
          <button
            className="zp-primary"
            onClick={() => {
              stop();
              setStep(step + 1);
              setDetail(false);
            }}
          >
            准备好了，下一步 <ArrowRight size={17} />
          </button>
        ) : (
          <button
            className="zp-primary"
            disabled={!ready}
            onClick={() => {
              stop();
              onShutter();
            }}
          >
            <Camera size={17} /> 按口令拍一张
          </button>
        )}
        {step > 0 && (
          <button
            className="zp-text-button"
            onClick={() => {
              stop();
              setStep(step - 1);
            }}
          >
            上一句
          </button>
        )}
      </div>
    </Modal>
  );
}
