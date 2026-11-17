import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  SlidersHorizontal,
  Sun,
  UserRound,
} from "lucide-react";
import type { Photo, Rect } from "../lib/types";
import type { Person } from "../domain/session";
import type { NotebookTarget } from "../notebook/experience";
import { MOTIONS, type Motion } from "../notebook/experience";
import { PoseClient } from "../lib/pose-client";
import { photoCanvas } from "../lib/images";
import { aspectOf } from "../lib/geometry";
import { usableGroups } from "../domain/pose";
import { shootingBrief } from "../domain/collaboration";
import { displayBox } from "../domain/collaboration";
import { CropImage } from "../components/PhotoView";
import PhotoEditor from "../components/PhotoEditor";
import ReferenceStudio from "../notebook/ReferenceStudio";
import { LightInstructions } from "../components/LightPlan";
import { LIGHT_RECIPES, type LightStyle } from "../domain/lighting";
import type { Reference } from "./catalog";
import { COMPOSITIONS, type SceneResult, type SceneVariant } from "./scene";
import { InterestPicker, ObstaclePicker } from "./FieldTools";
import {
  applyFieldPlan,
  interestsOf,
  OBSTACLES,
  type FieldChoices,
} from "../domain/fieldwork";

export function Placement({
  photo,
  box,
  illustration = false,
  mirrored = false,
}: {
  photo: Photo;
  box?: Rect;
  illustration?: boolean;
  mirrored?: boolean;
}) {
  return (
    <div
      className="zp-placement"
      style={
        {
          aspectRatio: aspectOf(photo),
          "--placement-aspect": aspectOf(photo),
        } as import("react").CSSProperties
      }
    >
      <div
        className="zp-image-layer"
        style={{
          position: "absolute",
          inset: 0,
          transform: mirrored ? "scaleX(-1)" : undefined,
        }}
      >
        <CropImage
          photo={photo}
          alt={illustration ? "场景照片与建议人物站位示意" : "参考照片"}
        />
      </div>
      <div className="zp-thirds" aria-hidden="true" />
      {box && (
        <div
          className="zp-target"
          style={{
            left: box.x * 100 + "%",
            top: box.y * 100 + "%",
            width: box.width * 100 + "%",
            height: box.height * 100 + "%",
          }}
        >
          {illustration && (
            <svg
              viewBox="0 0 100 240"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <circle cx="50" cy="28" r="21" />
              <path d="M29 60Q50 48 71 60L83 132 70 138 61 86 64 145 68 235 53 235 49 164 43 235 27 235 35 145 37 86 26 137 14 130Z" />
            </svg>
          )}
          <span>{illustration ? "建议站这里" : "人物范围"}</span>
        </div>
      )}
      {illustration && (
        <small className="zp-illustration-label">站位示意 · 非人物检测</small>
      )}
    </div>
  );
}
export default function Plan({
  photo,
  reference,
  sceneResult,
  origin,
  initial,
  onPhoto,
  onBack,
  onStart,
  onSave,
  onChange,
  onTryLight,
}: {
  photo: Photo;
  reference?: Reference;
  sceneResult?: SceneResult;
  origin: "reference" | "ai" | "manual" | "example";
  initial?: NotebookTarget | null;
  onPhoto: (p: Photo) => void;
  onBack: () => void;
  onStart: (target: NotebookTarget) => void;
  onSave: (target: NotebookTarget) => void;
  onChange: (target: NotebookTarget) => void;
  onTryLight?: (target: NotebookTarget) => void;
}) {
  const isScene = origin !== "reference";
  const knownReferenceLight =
    reference?.lightKnown === false ? null : (reference?.light ?? null);
  const [mode, setMode] = useState<SceneVariant["id"]>(
    initial?.notebook?.sceneMode ?? "balanced",
  );
  const [box, setBox] = useState<Rect>(
    initial?.box ??
      sceneResult?.variants.find((v) => v.id === mode)?.box ?? {
        x: 0.57,
        y: 0.35,
        width: 0.22,
        height: 0.53,
      },
  );
  const [people, setPeople] = useState<Person[]>(
    initial?.person ? [initial.person] : [],
  );
  const [person, setPerson] = useState<Person | null>(initial?.person ?? null);
  const [detecting, setDetecting] = useState(false),
    [detectNote, setDetectNote] = useState("");
  const [confirmed, setConfirmed] = useState(
    isScene || !!initial || photo.subject.confirmed,
  );
  const [editor, setEditor] = useState(false),
    [advanced, setAdvanced] = useState(false);
  const [motion, setMotion] = useState<Motion>(
    initial?.field?.baseline.motion ?? initial?.notebook?.motion ?? "none",
  );
  const [followPose, setFollowPose] = useState(
    initial
      ? (initial.field?.baseline.groups ?? initial.groups).length > 0
      : false,
  );
  const [light, setLight] = useState<LightStyle | null>(
    initial?.field?.baseline.lighting?.setup ??
      initial?.lighting?.setup ??
      sceneResult?.light.style ??
      knownReferenceLight ??
      null,
  );
  const [mirror, setMirror] = useState(initial?.mirror ?? false);
  const [custom, setCustom] = useState<NotebookTarget | null>(initial ?? null);
  const [choices, setChoices] = useState<FieldChoices>(() =>
    initial
      ? { ...initial.field, interests: interestsOf(initial) }
      : {
          interests:
            knownReferenceLight || sceneResult?.light.style
              ? ["composition", "light"]
              : ["composition"],
        },
  );
  const [obstacleOpen, setObstacleOpen] = useState(false);
  const detectKey = `${photo.id}-${JSON.stringify(photo.crop)}`;
  const version = useRef(0);
  useEffect(() => {
    if (isScene || initial) return;
    if (photo.subject.confirmed) {
      setBox(photo.subject);
      setConfirmed(true);
      setDetecting(false);
      setDetectNote("已使用你确认的人物范围，先指导构图。");
      return;
    }
    const client = new PoseClient();
    let alive = true;
    setDetecting(true);
    setDetectNote("");
    setPerson(null);
    setPeople([]);
    setCustom(null);
    if (photo.subject.confirmed) {
      setBox(photo.subject);
      setConfirmed(true);
    } else setConfirmed(false);
    void photoCanvas(photo, 900)
      .then((c) => client.detect(c))
      .then((d) => {
        if (!alive) return;
        setPeople(d.people);
        if (d.people.length === 1) {
          setPerson(d.people[0]);
          if (!photo.subject.confirmed) setBox(d.people[0].box);
          setConfirmed(true);
          setDetectNote("已找到照片里的人物。你可以调整范围。");
        } else
          setDetectNote(
            d.people.length > 1
              ? "照片里有多个人，请选一个作为参考。"
              : "暂时没找到完整人物。框一下可见的人，仍然可以指导构图。",
          );
      })
      .catch(() => {
        if (alive)
          setDetectNote("暂时不能自动找到人物。手动框一下，仍然可以指导构图。");
      })
      .finally(() => {
        if (alive) setDetecting(false);
        client.dispose();
      });
    return () => {
      alive = false;
      client.dispose();
    };
  }, [detectKey, isScene, photo.subject.confirmed]);
  const variant = sceneResult?.variants.find((v) => v.id === mode);
  const manualCamera = `先让人物落进${box.x + box.width / 2 < 0.42 ? "左侧" : box.x + box.width / 2 > 0.58 ? "右侧" : "中间"}虚线框，留出头顶和脚边，再看背景线条。`;
  const adjusted =
    isScene && variant && JSON.stringify(box) !== JSON.stringify(variant.box);
  const camera =
    !isScene && mirror
      ? "参考已左右翻转。按虚线框取景，保留喜欢的背景与留白。"
      : isScene
        ? !adjusted && variant?.camera
          ? variant.camera
          : manualCamera
        : (reference?.cameraTip ?? manualCamera);
  const subject = isScene
    ? (variant?.subject ?? "先确认地面平稳可站，再在约好的位置侧身，放松肩膀。")
    : (reference?.subjectTip ?? "先站稳，选一个舒服的姿势，等同伴调整好取景。");
  const available = usableGroups(person).filter(
    (g) => g === "left_arm" || g === "right_arm",
  );
  const baseTarget: NotebookTarget = custom ?? {
    id: `plan-${photo.id}-${version.current}`,
    photoId: photo.id,
    revision: version.current,
    aspect: aspectOf(photo),
    mode: "partial",
    groups: followPose && motion === "none" ? available : [],
    features: light ? ["composition", "light", "color"] : ["composition"],
    ignoreContact: false,
    mirror,
    person: isScene ? null : person,
    box,
    text: `${camera} ${subject}`,
    preparation: [camera, subject],
    insights: [],
    lighting: {
      reference: isScene ? null : knownReferenceLight,
      setup: light,
    },
    notebook: {
      source: isScene ? "scene" : "reference",
      motion,
      sceneResult,
      sceneMode: isScene ? mode : undefined,
      origin: origin === "reference" ? undefined : origin,
      cameraAdvice: camera,
      subjectAdvice: subject,
    },
  };
  const target = applyFieldPlan(baseTarget, choices);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    latest.current(target);
  }, [JSON.stringify(target)]);
  function change(update: () => void) {
    version.current++;
    setCustom(null);
    update();
  }
  function chooseField(patch: Partial<FieldChoices>) {
    version.current++;
    setCustom({
      ...baseTarget,
      id: crypto.randomUUID(),
      revision: version.current,
    });
    setChoices((c) => ({ ...c, ...patch }));
  }
  function composition(id: SceneVariant["id"]) {
    change(() => {
      setMode(id);
      const v = sceneResult?.variants.find((x) => x.id === id);
      setBox(
        v?.box ??
          (id === "scenery"
            ? { x: 0.64, y: 0.58, width: 0.14, height: 0.3 }
            : id === "person"
              ? { x: 0.42, y: 0.17, width: 0.34, height: 0.73 }
              : { x: 0.57, y: 0.35, width: 0.22, height: 0.53 }),
      );
    });
  }
  const effectiveCamera = target.notebook?.cameraAdvice ?? camera,
    effectiveSubject = target.notebook?.subjectAdvice ?? subject;
  return (
    <main
      className={`zp-page zp-plan ${reference?.personal ? "zp-personal-plan" : ""} page-enter`}
    >
      <button className="zp-back" onClick={onBack}>
        <ArrowLeft size={17} /> 返回
      </button>
      <div className="zp-page-title">
        <span className="zp-step">第 1 步 · 先约好怎么拍</span>
        <h1>这张怎么拍</h1>
        <p>
          {isScene
            ? origin === "example"
              ? "湖边示例 · 建议由编辑整理，帮助你认识流程。"
              : origin === "manual"
                ? "你来选站位。以下是通用拍摄提示，没有分析这张照片。"
                : "AI 提出构图建议，现场站位由你们确认。"
            : reference?.kind === "painting"
              ? "把自己拍进这幅画里。喜欢哪一部分，就借哪一部分。"
              : reference?.kind === "checkin"
                ? "保留喜欢的动作和构图，拍出你的同款。"
                : "用这张照片，给两个人同一个拍摄方向。"}
        </p>
      </div>
      <Placement
        photo={photo}
        box={confirmed ? displayBox(target) : undefined}
        mirrored={target.mirror}
        illustration={isScene}
      />
      {isScene && (
        <>
          <div className="zp-segment" aria-label="选择人景比例">
            {COMPOSITIONS.map((c) => (
              <button
                key={c.id}
                aria-pressed={mode === c.id}
                onClick={() => composition(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="zp-caption">
            {variant?.why ??
              "虚线框表示你建议的人物大小和位置，请先确认真实地面。"}
          </p>
        </>
      )}
      {!isScene && (
        <div className="zp-detection" role="status">
          {detecting ? "正在确认参考里的人物…" : detectNote || "人物范围已确认"}
          <button onClick={() => setEditor(true)}>调整人物范围</button>
        </div>
      )}
      {people.length > 1 && (
        <div className="zp-chips" aria-label="选择参考人物">
          {people.map((p, i) => (
            <button
              key={i}
              aria-pressed={person === p}
              onClick={() =>
                change(() => {
                  setPerson(p);
                  setBox(p.box);
                  setConfirmed(true);
                })
              }
            >
              人物 {i + 1}
            </button>
          ))}
        </div>
      )}
      <section className="zp-role-card">
        <div>
          <Camera size={18} />
          <span>拿手机的人</span>
        </div>
        <p>{effectiveCamera}</p>
        <div>
          <UserRound size={18} />
          <span>镜头前的人</span>
        </div>
        <p>{effectiveSubject}</p>
      </section>
      <button
        className="zp-primary"
        disabled={!confirmed}
        onClick={() => onStart(target)}
      >
        <Camera size={18} /> 开始拍摄
      </button>
      {!confirmed && (
        <p className="zp-caption">
          先自动确认人物，或点「调整人物范围」手动框一下。
        </p>
      )}
      <section className="zp-field-section" aria-label="现场拍摄工具">
        <InterestPicker
          value={choices.interests}
          onChange={(interests) => chooseField({ interests })}
        />
        <div className="zp-field-actions">
          <button onClick={() => setObstacleOpen(true)}>这里拍不了？</button>
          {onTryLight && (
            <button
              disabled={!confirmed || !target.lighting?.setup}
              onClick={() => onTryLight(target)}
            >
              <Sun size={16} /> 先试一下光
            </button>
          )}
        </div>
        {!target.lighting?.setup && (
          <p className="zp-caption">在下方选好现场光线，就能试拍三种明暗。</p>
        )}
        {choices.obstacle && (
          <p className="zp-field-note" role="status">
            已适配：{OBSTACLES.find((o) => o.id === choices.obstacle)?.label}
            。上面的两人提示已更新。
          </p>
        )}
        {target.field?.trial && (
          <p className="zp-field-note">
            已记住这次试光的方向，拍摄口令会沿用它。
          </p>
        )}
      </section>
      {obstacleOpen && (
        <ObstaclePicker
          target={target}
          onClose={() => setObstacleOpen(false)}
          onApply={(patch) => {
            chooseField(patch);
            setObstacleOpen(false);
          }}
        />
      )}
      <details className="zp-details">
        <summary>
          <Sun size={17} /> 光线怎么用 <ChevronDown size={15} />
        </summary>
        {sceneResult && <p>{sceneResult.light.advice}</p>}
        <label className="zp-select">
          现场光线
          <select
            aria-label="现场光线"
            value={target.lighting?.setup ?? "unknown"}
            onChange={(e) =>
              change(() => {
                setLight(
                  e.target.value === "unknown"
                    ? null
                    : (e.target.value as LightStyle),
                );
                setChoices((c) => ({
                  ...c,
                  trial: undefined,
                  fallbackLight: undefined,
                  obstacle:
                    c.obstacle === "window" || c.obstacle === "sun"
                      ? undefined
                      : c.obstacle,
                  interests:
                    e.target.value !== "unknown" &&
                    !c.interests.includes("light")
                      ? [...c.interests, "light"]
                      : c.interests,
                }));
              })
            }
          >
            <option value="unknown">还不确定，先拍一张看看</option>
            {Object.entries(LIGHT_RECIPES).map(([id, r]) => (
              <option key={id} value={id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        {target.lighting?.setup && (
          <LightInstructions choice={target.lighting} />
        )}
        {sceneResult && (
          <details>
            <summary>为什么这样建议</summary>
            <p>{sceneResult.light.evidence}</p>
            {sceneResult.limitations.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </details>
        )}
        {!sceneResult && (
          <small>
            用光方案来自你选择的条件和编辑整理，并不是自动测出的现场光源。
          </small>
        )}
      </details>
      <details className="zp-details">
        <summary>
          <SlidersHorizontal size={17} /> 还想改哪里（可选）{" "}
          <ChevronDown size={15} />
        </summary>
        <h3>人站哪里、画面留多少</h3>
        <p className="zp-caption">
          画面中的相对位置，不是现实中的米数。改完会显示在上面的虚线框里。
        </p>
        {(["x", "y", "width", "height"] as const).map((key, i) => (
          <label className="zp-range" key={key}>
            {["左右位置", "上下位置", "人物框宽度", "人物框高度"][i]}
            <input
              aria-label={
                [
                  "建议位置左右",
                  "建议位置上下",
                  "建议人物宽度",
                  "建议人物高度",
                ][i]
              }
              type="range"
              min={key === "width" || key === "height" ? 0.06 : 0}
              max={
                key === "x"
                  ? 1 - box.width
                  : key === "y"
                    ? 1 - box.height
                    : key === "width"
                      ? 1 - box.x
                      : 1 - box.y
              }
              step="0.01"
              value={box[key]}
              onChange={(e) =>
                change(() => setBox({ ...box, [key]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
        {!isScene && (
          <>
            <label className="zp-check">
              <input
                type="checkbox"
                checked={followPose}
                onChange={(e) =>
                  change(() => {
                    setFollowPose(e.target.checked);
                    if (e.target.checked)
                      setChoices((c) => ({
                        ...c,
                        action: undefined,
                        interests: [
                          ...new Set([...c.interests, "pose" as const]),
                        ],
                      }));
                  })
                }
              />{" "}
              参考照片里的手臂动作
            </label>
            <small>
              {available.length
                ? "仅比较可以检测到的手臂。头部、表情和衣服供视觉参考。"
                : "这张的手臂暂不可可靠检测，动作供视觉参考，实时只引导构图。"}
            </small>
            <label className="zp-check">
              <input
                type="checkbox"
                checked={mirror}
                onChange={(e) => change(() => setMirror(e.target.checked))}
              />{" "}
              左右翻转参考，借另一侧的动作
            </label>
          </>
        )}
        <label className="zp-select">
          想试一个小动作
          <select
            aria-label="选择拍摄动作"
            value={motion}
            onChange={(e) =>
              change(() => {
                setMotion(e.target.value as Motion);
                setChoices((c) => ({
                  ...c,
                  action: undefined,
                  interests:
                    e.target.value !== "none"
                      ? [...new Set([...c.interests, "pose" as const])]
                      : c.interests,
                }));
                if (e.target.value !== "none") setFollowPose(false);
              })
            }
          >
            {Object.entries(MOTIONS).map(([id, m]) => (
              <option key={id} value={id}>
                {id === "none" ? "保留当前动作建议" : m.title}
              </option>
            ))}
          </select>
        </label>
        <button className="zp-secondary" onClick={() => onSave(target)}>
          <Check size={16} /> 保存这次拍摄
        </button>
        {!isScene && (
          <button
            className="zp-text-button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? "收起" : "打开"}照片裁切、动作选区和 AI 解读
          </button>
        )}
      </details>
      {advanced && !isScene && (
        <section className="zp-advanced">
          <ReferenceStudio
            photo={photo}
            template={reference?.personal ? undefined : reference}
            sourceLabel={
              reference?.source.type === "user"
                ? "个人参考"
                : reference?.source.type === "artwork"
                  ? "画作原图"
                  : reference?.source.type === "photo"
                    ? "经典照片"
                    : "原创示例"
            }
            confirmedTarget={target}
            onPhoto={onPhoto}
            onBack={() => setAdvanced(false)}
            confirmLabel="应用这些调整"
            onConfirm={(t) => {
              const brief = shootingBrief(t);
              setCustom({
                ...t,
                field: undefined,
                notebook: {
                  ...target.notebook,
                  ...t.notebook,
                  motion: t.notebook?.motion ?? "none",
                  cameraAdvice: brief.camera,
                  subjectAdvice: brief.subject,
                },
              });
              setChoices({
                interests: interestsOf({ ...t, field: undefined }),
              });
              setAdvanced(false);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        </section>
      )}
      {editor && (
        <PhotoEditor
          photo={photo}
          reference
          initialTab="subject"
          onClose={() => setEditor(false)}
          onSave={(p) => {
            setEditor(false);
            setPerson(null);
            setPeople([]);
            setFollowPose(false);
            onPhoto(p);
            change(() => {
              setBox(p.subject);
              setConfirmed(true);
            });
          }}
        />
      )}
    </main>
  );
}
