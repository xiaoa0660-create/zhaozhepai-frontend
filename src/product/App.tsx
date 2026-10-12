import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  ChevronRight,
  Heart,
  ImagePlus,
  Images,
  LoaderCircle,
  MapPin,
  Search,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
import Modal from "../components/Modal";
import { CropImage } from "../components/PhotoView";
import {
  readPhoto,
  releasePhoto,
  releasePhotos,
  photoCanvas,
} from "../lib/images";
import { referenceData } from "../lib/imaging";
import type { Photo } from "../lib/types";
import type { Capture } from "../domain/session";
import type { NotebookTarget } from "../notebook/experience";
import {
  REFERENCES,
  REFERENCE_CATEGORIES,
  referencePhoto,
  exampleScenePhoto,
  type Reference,
  personalAsReference,
} from "./catalog";
import {
  listPersonalReferences,
  savePersonalReference,
  putPersonalReference,
  deletePersonalReference,
  PERSONAL_CATEGORY_LABELS,
  type PersonalCategory,
  type PersonalReference,
} from "./personal";
import Plan, { Placement } from "./Plan";
import { LAKE_EXAMPLE, sceneResultSchema, type SceneResult } from "./scene";
import GuidedCamera from "../notebook/GuidedCamera";
import PhotoResult from "../notebook/PhotoResult";
import {
  deleteCard,
  listCards,
  restoreCard,
  saveCard,
  type SavedCard,
} from "../notebook/storage";

type Page =
  | "start"
  | "discover"
  | "detail"
  | "scene"
  | "plan"
  | "camera"
  | "result"
  | "favorites"
  | "mine";
type Origin = "reference" | "ai" | "manual" | "example";
type Shot = { capture: Capture; target: NotebookTarget };
const tabs = [
  { id: "start", label: "开始拍", icon: Camera },
  { id: "discover", label: "找参考", icon: Images },
  { id: "favorites", label: "收藏", icon: Heart },
  { id: "mine", label: "我的拍摄", icon: UserRound },
] as const;
const favoriteKey = "zhaozhepai-notebook-favorites";
function getFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(favoriteKey) ?? "[]").filter(
      (v: unknown) => typeof v === "string",
    );
  } catch {
    return [];
  }
}
function Thumbnail({ reference, alt }: { reference: Reference; alt?: string }) {
  if (reference.personal)
    return (
      <StoredThumbnail
        blob={reference.personal.photo.blob}
        alt={alt ?? reference.title}
      />
    );
  const c = reference.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  if (reference.image === "curated/city-life-sheet.png")
    return (
      <svg
        className="zp-sheet-thumb"
        viewBox="0 0 384 512"
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={alt ?? reference.title}
      >
        <image
          href={`${import.meta.env.BASE_URL}images/${reference.image}`}
          width="1536"
          height="1024"
          x={-c.x * 1536}
          y={-c.y * 1024}
        />
      </svg>
    );
  return (
    <img
      loading="lazy"
      src={`${import.meta.env.BASE_URL}images/${reference.image}`}
      alt={alt ?? reference.title}
      style={{
        width: 100 / c.width + "%",
        height: 100 / c.height + "%",
        left: (-100 * c.x) / c.width + "%",
        top: (-100 * c.y) / c.height + "%",
      }}
    />
  );
}
export default function ProductApp({
  theme: initialTheme,
}: {
  theme: "editorial" | "notebook";
}) {
  const [theme, setTheme] = useState<"editorial" | "notebook">(() => {
    const requested = new URLSearchParams(location.search).get("theme");
    return requested === "editorial" || requested === "notebook"
      ? requested
      : initialTheme;
  });
  const [page, setPage] = useState<Page>("start"),
    [detail, setDetail] = useState<Reference | null>(null);
  const [listReturn, setListReturn] = useState<Page>("discover");
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("all"),
    [sceneFilter, setSceneFilter] = useState("全部场景");
  const [favorites, setFavorites] = useState<string[]>(getFavorites),
    [cards, setCards] = useState<SavedCard[]>([]);
  const [personalReferences, setPersonalReferences] = useState<
    PersonalReference[]
  >([]);
  const [referenceScope, setReferenceScope] = useState<"all" | "personal">(
    "all",
  );
  const [editingReference, setEditingReference] =
    useState<PersonalReference | null>(null);
  const [personalName, setPersonalName] = useState(""),
    [personalKind, setPersonalKind] = useState<PersonalCategory>("daily");
  const [deletingPersonal, setDeletingPersonal] =
    useState<PersonalReference | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null),
    [reference, setReference] = useState<Reference | undefined>(),
    [origin, setOrigin] = useState<Origin>("reference");
  const [sceneResult, setSceneResult] = useState<SceneResult | undefined>(),
    [target, setTarget] = useState<NotebookTarget | null>(null),
    [initial, setInitial] = useState<NotebookTarget | null>(null);
  const [shots, setShots] = useState<Shot[]>([]),
    [selectedShot, setSelectedShot] = useState(0);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [intro, setIntro] = useState(() => {
    try {
      return localStorage.getItem("zhaozhepai-guide-collapsed") !== "yes";
    } catch {
      return true;
    }
  });
  const [example, setExample] = useState<number | null>(null),
    [tutorialPhoto, setTutorialPhoto] = useState<Photo | null>(null);
  const [handoff, setHandoff] = useState(false),
    [consent, setConsent] = useState(false),
    [analysis, setAnalysis] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null),
    [leave, setLeave] = useState<(() => void) | null>(null);
  const [savedPlan, setSavedPlan] = useState(""),
    [savedCapture, setSavedCapture] = useState("");
  const handed = useRef(false),
    upload = useRef<HTMLInputElement>(null),
    sceneUpload = useRef<HTMLInputElement>(null),
    request = useRef<AbortController | null>(null),
    generation = useRef(0),
    listScroll = useRef(0);
  const uploadKind = useRef<PersonalCategory>("daily");
  const referencePool = [
    ...REFERENCES,
    ...personalReferences.map(personalAsReference),
  ];
  const currentShot = shots[selectedShot];
  const dirty =
    !!photo &&
    (page === "plan" || page === "result") &&
    ((page === "result" ? currentShot?.target.id : target?.id) !== savedPlan ||
      (!!currentShot && savedCapture !== currentShot.capture.id));
  useEffect(() => {
    void refreshCards();
    void refreshPersonal();
    void exampleScenePhoto()
      .then(setTutorialPhoto)
      .catch(() => {});
    return () => {
      generation.current++;
      request.current?.abort();
      releasePhotos();
    };
  }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || analysis) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, analysis]);
  useEffect(() => {
    document.title = `${page === "start" ? "开始拍" : page === "discover" ? "找参考" : page === "plan" ? "这张怎么拍" : "照着拍"} · ${theme === "editorial" ? "杂志版" : "笔记版"}`;
    const url = new URL(location.href);
    url.searchParams.set("theme", theme);
    url.hash = page;
    history.replaceState(history.state, "", url);
  }, [page, theme]);
  async function refreshCards() {
    try {
      setCards((await listCards()).sort((a, b) => b.updated - a.updated));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function go(next: Page, restoreScroll = false) {
    setPage(next);
    setError("");
    request.current?.abort();
    setAnalysis(false);
    setTimeout(
      () => window.scrollTo({ top: restoreScroll ? listScroll.current : 0 }),
      0,
    );
  }
  async function refreshPersonal() {
    try {
      setPersonalReferences(await listPersonalReferences());
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function manageReference(record: PersonalReference) {
    setPersonalName(record.name);
    setPersonalKind(record.category);
    setEditingReference(record);
  }
  function guarded(action: () => void) {
    if (dirty) setLeave(() => action);
    else action();
  }
  function reset(keep?: Photo) {
    generation.current++;
    request.current?.abort();
    releasePhotos(keep);
    setPhoto(null);
    setTarget(null);
    setInitial(null);
    setSceneResult(undefined);
    setReference(undefined);
    setShots([]);
    setSelectedShot(0);
    setSavedPlan("");
    setSavedCapture("");
    handed.current = false;
  }
  function startScene() {
    guarded(() => {
      reset();
      setOrigin("manual");
      go("scene");
    });
  }
  function ownReference(kind: PersonalCategory = "daily") {
    guarded(() => {
      uploadKind.current = kind;
      upload.current?.click();
    });
  }
  async function uploadFile(file: File, isScene: boolean) {
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const p = await readPhoto(file);
      if (id !== generation.current) {
        releasePhoto(p);
        return;
      }
      let personal: PersonalReference | undefined,
        saveError = "";
      if (!isScene) {
        try {
          personal = await savePersonalReference(p, uploadKind.current);
        } catch (e) {
          saveError = (e as Error).message;
        }
        if (id !== generation.current) {
          releasePhoto(p);
          return;
        }
      }
      reset(p);
      setPhoto(p);
      if (personal) {
        setReference(personalAsReference(personal));
        setListReturn("discover");
        setReferenceScope("personal");
        setCategory(personal.category);
        setSceneFilter("全部场景");
        setQuery("");
        await refreshPersonal();
        setStatus("已加入「我的参考」。现在可以直接看拍法。");
      }
      setOrigin(isScene ? "manual" : "reference");
      go(isScene ? "scene" : "plan");
      if (saveError)
        setError(saveError + " 当前照片仍可继续拍摄，但未保存到我的参考。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (id <= generation.current) setBusy(false);
    }
  }
  async function choose(r: Reference) {
    const id = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const p = await referencePhoto(r);
      if (id !== generation.current) {
        releasePhoto(p);
        return;
      }
      reset(p);
      setPhoto(p);
      setReference(r);
      setOrigin("reference");
      go("plan");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function openDetail(r: Reference) {
    listScroll.current = window.scrollY;
    setListReturn(page);
    setDetail(r);
    go("detail");
  }
  function favorite(r: Reference) {
    const next = favorites.includes(r.id)
      ? favorites.filter((id) => id !== r.id)
      : [...favorites, r.id];
    try {
      localStorage.setItem(favoriteKey, JSON.stringify(next));
      setFavorites(next);
    } catch {
      setError("收藏没有保存成功。浏览器可能未允许本地存储。");
    }
  }
  function collapseIntro() {
    setIntro(false);
    try {
      localStorage.setItem("zhaozhepai-guide-collapsed", "yes");
    } catch {}
  }
  async function openAI() {
    setConsent(true);
    setConfigured(null);
    if (import.meta.env.VITE_FRONTEND_ONLY === "true") {
      setConfigured(false);
      return;
    }
    try {
      const r = await fetch("/api/health");
      const d = await r.json();
      setConfigured(r.ok && d.sceneConfigured === true);
    } catch {
      setConfigured(false);
    }
  }
  async function analyze() {
    if (!photo || !configured) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const id = ++generation.current;
    setConsent(false);
    setAnalysis(true);
    setError("");
    try {
      const image = await referenceData(photo);
      if (controller.signal.aborted) return;
      const response = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent: true, image }),
        signal: controller.signal,
      });
      let value;
      try {
        value = await response.json();
      } catch {
        throw new Error(
          "这次分析没有返回可用的建议，照片已保留。可以重试或自己选站位。",
        );
      }
      if (!response.ok) throw new Error(value.error ?? "风景分析没有成功。");
      const parsed = sceneResultSchema.safeParse(value);
      if (!parsed.success)
        throw new Error(
          "这次分析结果不完整，照片已保留。可以重试或自己选站位。",
        );
      const result = parsed.data;
      if (controller.signal.aborted || id !== generation.current) return;
      setSceneResult(result);
      setOrigin("ai");
      setInitial(null);
      setTarget(null);
      go("plan");
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && !(e instanceof TypeError)
            ? e.message
            : "暂时连接不上分析服务，照片已保留。请稍后重试或自己选站位。",
        );
    } finally {
      if (id === generation.current) setAnalysis(false);
    }
  }
  function manual() {
    setSceneResult(undefined);
    setOrigin("manual");
    setTarget(null);
    setInitial(null);
    go("plan");
  }
  async function examplePlan() {
    setExample(null);
    reset();
    setPhoto(await exampleScenePhoto());
    setSceneResult(LAKE_EXAMPLE);
    setOrigin("example");
    go("plan");
  }
  function begin(t: NotebookTarget) {
    setTarget(t);
    setInitial(t);
    if (!handed.current) setHandoff(true);
    else go("camera");
  }
  function captured(capture: Capture) {
    if (!target) return;
    const next = [{ capture, target }, ...shots].slice(0, 6);
    if (shots.length === 6) releasePhoto(shots[5].capture.photo);
    setShots(next);
    setSelectedShot(0);
    go("result");
  }
  async function save(
    t: NotebookTarget = target!,
    capture?: Capture,
    captureTarget?: NotebookTarget,
  ) {
    if (!photo || !t) return false;
    setBusy(true);
    setError("");
    try {
      await saveCard(photo, t, reference?.id, capture, captureTarget);
      await refreshCards();
      setSavedPlan(t.id);
      if (capture) setSavedCapture(capture.id);
      setStatus("已保存到「我的拍摄」，刷新也能找回。");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function restore(card: SavedCard) {
    guarded(() => {
      reset();
      const p = restoreCard(card);
      setPhoto(p.reference);
      setReference(referencePool.find((r) => r.id === card.templateId));
      setTarget(p.target);
      setInitial(p.target);
      setOrigin(
        p.target.notebook?.source === "scene"
          ? (p.target.notebook.origin ?? "manual")
          : "reference",
      );
      setSceneResult(p.target.notebook?.sceneResult);
      if (p.capture) {
        setShots([{ capture: p.capture, target: p.captureTarget }]);
        setSelectedShot(0);
      }
      setSavedPlan(p.target.id);
      setSavedCapture(p.capture?.id ?? "");
      go("plan");
    });
  }
  const filtered = referencePool.filter(
    (r) =>
      (referenceScope !== "personal" || !!r.personal) &&
      (page !== "favorites" || favorites.includes(r.id)) &&
      (category === "all" || r.kind === category) &&
      (sceneFilter === "全部场景" || r.scene === sceneFilter) &&
      `${r.title}${r.subtitle}${r.tag}${r.scene}${r.source.label}`.includes(
        query,
      ),
  );
  const fullHelp = `${import.meta.env.BASE_URL}${theme === "editorial" ? "magazine" : "notebook"}-guide.html`;
  function Gallery({ items }: { items: Reference[] }) {
    return (
      <div className="zp-gallery">
        {items.map((r, i) => (
          <article className="zp-note" key={r.id}>
            <button
              className={`zp-note-image aspect-${i % 3}`}
              onClick={() => openDetail(r)}
              aria-label={`查看${r.title}`}
            >
              <Thumbnail reference={r} />
              <span>{r.tag}</span>
            </button>
            <div className="zp-note-body">
              <button onClick={() => openDetail(r)}>
                <h3>{r.title}</h3>
              </button>
              <p>{r.subtitle}</p>
              <div>
                <small>
                  {r.personal
                    ? "我的参考"
                    : r.source.type === "generated"
                      ? "原创示例"
                      : r.kind === "painting"
                        ? "画作原图"
                        : "经典原图"}
                </small>
                {r.personal && (
                  <button
                    className="zp-personal-manage"
                    aria-label={`管理${r.title}`}
                    onClick={() => manageReference(r.personal!)}
                  >
                    管理
                  </button>
                )}
                <button
                  aria-label={`${favorites.includes(r.id) ? "取消收藏" : "收藏"}${r.title}`}
                  aria-pressed={favorites.includes(r.id)}
                  onClick={() => favorite(r)}
                >
                  <Heart
                    size={16}
                    fill={favorites.includes(r.id) ? "currentColor" : "none"}
                  />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }
  return (
    <>
      <div
        className={`v4-phone-shell zp-app zp-${theme} ${page === "camera" ? "zp-camera-active" : ""}`}
      >
        {page !== "camera" && (
          <>
            <header className="zp-header">
              <button
                className="zp-brand"
                onClick={() => guarded(() => go("start"))}
              >
                <span className="zp-logo">
                  <Camera size={20} />
                </span>
                照着拍<small>{theme === "editorial" ? "A" : "B"}</small>
              </button>
              <a href={fullHelp} className="zp-help">
                <BookOpen size={16} /> 怎么用
              </a>
            </header>
            <div className="zp-theme-switch" role="group" aria-label="界面风格">
              <button
                type="button"
                aria-pressed={theme === "editorial"}
                onClick={() => setTheme("editorial")}
              >
                杂志版
              </button>
              <button
                type="button"
                aria-pressed={theme === "notebook"}
                onClick={() => setTheme("notebook")}
              >
                笔记版
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="zp-alert" role="alert">
            {error}
            <button onClick={() => setError("")}>知道了</button>
          </div>
        )}
        {status && (
          <div className="zp-toast" role="status">
            {status}
            <button onClick={() => setStatus("")}>×</button>
          </div>
        )}
        {busy && (
          <div className="zp-loading" role="status">
            <LoaderCircle className="spin" size={16} /> 正在准备…
          </div>
        )}
        {page === "start" && (
          <main className="zp-home page-enter">
            <div className="zp-home-title">
              <span>和喜欢的人，拍喜欢的照片</span>
              <h1>
                好看的这一刻，
                <br />
                我们一起拍。
              </h1>
              <p>
                从一张照片开始。你负责喜欢，
                <br />
                我们把怎么拍说清楚。
              </p>
            </div>
            {intro && (
              <button className="zp-first-guide" onClick={() => setExample(0)}>
                <BookOpen size={14} /> 第一次来？看一个 30 秒示例{" "}
                <ChevronRight size={14} />
              </button>
            )}
            <div className="zp-hero-strip">
              <div>
                <Thumbnail reference={REFERENCES[0]} />
              </div>
              <div>
                <Thumbnail reference={REFERENCES[3]} />
              </div>
              <div>
                <Thumbnail reference={REFERENCES[6]} />
              </div>
              <span>取景 · 光线 · 一点小动作</span>
            </div>
            <section className="zp-entry">
              <h2>现在，想从哪里开始？</h2>
              <button onClick={startScene}>
                <span className="zp-entry-icon">
                  <Camera size={23} />
                </span>
                <span>
                  <b>拍一下眼前的风景</b>
                  <small>不知道人放哪里？从这个场景开始</small>
                </span>
                <ChevronRight size={19} />
              </button>
              <button onClick={() => ownReference()}>
                <span className="zp-entry-icon">
                  <ImagePlus size={23} />
                </span>
                <span>
                  <b>导入想照着拍的照片</b>
                  <small>把你收藏的那张，变成两个人的拍法</small>
                </span>
                <ChevronRight size={19} />
              </button>
            </section>
            {intro ? (
              <section className="zp-onboarding">
                <div>
                  <span className="zp-tag">第一次来，从这里看</span>
                  <button onClick={collapseIntro}>收起</button>
                </div>
                <h2>
                  不知道怎么拍？
                  <br />
                  从一张照片开始。
                </h2>
                <p>
                  拍一张眼前的风景，或者选一张想照着拍的照片。我们告诉拿手机的人怎么取景，也告诉镜头前的人怎么站、怎么动。
                </p>
                <div className="zp-three-steps">
                  <span>
                    <ImagePlus size={19} />
                    <b>01 选照片</b>
                    <small>风景或参考</small>
                  </span>
                  <span>
                    <UserRound size={19} />
                    <b>02 看怎么拍</b>
                    <small>两个人各一句</small>
                  </span>
                  <span>
                    <Camera size={19} />
                    <b>03 拍一张</b>
                    <small>喜欢的留下</small>
                  </span>
                </div>
                <button className="zp-secondary" onClick={() => setExample(0)}>
                  看一个示例 <ArrowRight size={16} />
                </button>
              </section>
            ) : (
              <button
                className="zp-collapsed-guide"
                onClick={() => setExample(0)}
              >
                <BookOpen size={16} /> 30 秒了解怎么拍{" "}
                <ChevronRight size={15} />
              </button>
            )}
            <div className="zp-section-heading">
              <div>
                <span>给今天一点灵感</span>
                <h2>这些拍法，可以现在试</h2>
              </div>
              <button onClick={() => go("discover")}>
                查看全部 <ChevronRight size={15} />
              </button>
            </div>
            <Gallery items={REFERENCES.slice(0, 4)} />
            <p className="zp-footer-note">
              照片不用一模一样。两个人喜欢，就很好。
            </p>
          </main>
        )}
        {(page === "discover" || page === "favorites") && (
          <main className="zp-page page-enter">
            <div className="zp-page-title">
              <span className="zp-step">
                {page === "favorites"
                  ? "留给下一次一起拍"
                  : "20 张精选参考 · 每张都有可用的拍法"}
              </span>
              <h1>
                {page === "favorites"
                  ? "你喜欢的，都在这里"
                  : "今天，想拍什么感觉？"}
              </h1>
              <p>喜欢构图、动作还是光？找到一张，再一起拍。</p>
            </div>
            <label className="zp-search">
              <Search size={18} />
              <input
                placeholder="搜场景、动作或画作"
                aria-label="搜索参考"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && <button onClick={() => setQuery("")}>清除</button>}
            </label>
            <div className="zp-categories">
              {REFERENCE_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  aria-pressed={category === c.id}
                  onClick={() => setCategory(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {page === "discover" && (
              <button
                className="zp-upload-reference"
                disabled={busy}
                onClick={() =>
                  ownReference(
                    category === "painting"
                      ? "painting"
                      : category === "checkin"
                        ? "checkin"
                        : "daily",
                  )
                }
              >
                <ImagePlus size={22} />
                <span>
                  <b>
                    {category === "painting"
                      ? "上传想复刻的画作"
                      : category === "checkin"
                        ? "上传想拍的同款"
                        : "上传我的参考图"}
                  </b>
                  <small>相册选图，直接看拍法；下次还能找到</small>
                </span>
                <ArrowRight size={18} />
              </button>
            )}
            <div className="zp-reference-scope" aria-label="参考来源">
              <button
                aria-pressed={referenceScope === "all"}
                onClick={() => setReferenceScope("all")}
              >
                全部参考
              </button>
              <button
                aria-pressed={referenceScope === "personal"}
                onClick={() => setReferenceScope("personal")}
              >
                我的参考 · {personalReferences.length}
              </button>
            </div>
            <div className="zp-scene-filter">
              <select
                aria-label="筛选拍摄场景"
                value={sceneFilter}
                onChange={(e) => setSceneFilter(e.target.value)}
              >
                {[
                  "全部场景",
                  ...new Set(referencePool.map((r) => r.scene)),
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <span>{filtered.length} 个拍法</span>
            </div>
            {category === "checkin" && (
              <p className="zp-category-note">
                复刻偶像、经典照片或热门拍法。原地点确认后才提供地图；也可以只借动作，在你身边拍。
              </p>
            )}
            {category === "painting" && (
              <p className="zp-category-note">
                把自己拍进画里。先借构图和光线，衣服、道具都可以按自己的条件来。
              </p>
            )}
            {filtered.length ? (
              <Gallery items={filtered} />
            ) : (
              <div className="zp-empty">
                <Heart size={29} />
                <h2>
                  {page === "favorites"
                    ? "把喜欢的拍法留在这里"
                    : referenceScope === "personal"
                      ? "把想拍的照片放进来"
                      : "换个关键词试试"}
                </h2>
                <p>
                  {page === "favorites"
                    ? "参考图右下角点一下爱心，下次就能找到。"
                    : referenceScope === "personal"
                      ? "点上面的上传按钮。个人参考保存在当前浏览器，最多 24 张。"
                      : "你可以清空搜索，或选「全部场景」。"}
                </p>
                <button
                  className="zp-secondary"
                  onClick={() => {
                    setQuery("");
                    setCategory("all");
                    setReferenceScope("all");
                    setSceneFilter("全部场景");
                    go("discover");
                  }}
                >
                  去找参考
                </button>
              </div>
            )}
          </main>
        )}
        {page === "detail" && detail && (
          <main className="zp-page zp-detail page-enter">
            <button className="zp-back" onClick={() => go(listReturn, true)}>
              <ArrowLeft size={17} /> 返回
              {listReturn === "favorites" ? "收藏" : "参考"}
            </button>
            <div
              className="zp-detail-image"
              style={{
                aspectRatio: detail.personal
                  ? detail.personal.photo.metadata.width /
                    detail.personal.photo.metadata.height
                  : detail.crop?.width === 0.25
                    ? 0.75
                    : undefined,
              }}
            >
              <Thumbnail reference={detail} />
            </div>
            <div className="zp-detail-heading">
              <span className="zp-tag">
                {detail.kind === "painting"
                  ? "画作复刻"
                  : detail.kind === "checkin"
                    ? "同款打卡"
                    : detail.scene}
              </span>
              <button
                aria-label="收藏这张参考"
                aria-pressed={favorites.includes(detail.id)}
                onClick={() => favorite(detail)}
              >
                <Heart
                  size={21}
                  fill={favorites.includes(detail.id) ? "currentColor" : "none"}
                />
              </button>
            </div>
            <h1>{detail.title}</h1>
            {detail.personal && (
              <button
                className="zp-text-button"
                onClick={() => manageReference(detail.personal!)}
              >
                管理我的参考：名称与分类
              </button>
            )}
            <p>{detail.story}</p>
            <section className="zp-role-card">
              <div>
                <Camera size={17} />
                <span>拿手机的人</span>
              </div>
              <p>{detail.cameraTip}</p>
              <div>
                <UserRound size={17} />
                <span>镜头前的人</span>
              </div>
              <p>{detail.subjectTip}</p>
            </section>
            <p className="zp-caption">需要准备：{detail.needs}</p>
            {detail.kind === "checkin" && !detail.personal && (
              <div className="zp-location">
                <MapPin size={17} />
                <div>
                  <b>{detail.location?.name ?? "原拍摄地点待确认"}</b>
                  <p>
                    {detail.location
                      ? "在原地点拍，保留相近背景；也可以只借动作。"
                      : "可以先借动作与构图。不会根据一张照片编造打卡地址。"}
                  </p>
                  {detail.location && (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={detail.location.url}
                    >
                      打开地图 ↗
                    </a>
                  )}
                </div>
              </div>
            )}
            <button
              className="zp-primary"
              onClick={() => guarded(() => void choose(detail))}
            >
              照着这张拍 <ArrowRight size={18} />
            </button>
            <div className="zp-source">
              <span>
                {detail.source.type === "generated"
                  ? "原创 AI 生成场景示例，不是实际打卡地点。"
                  : detail.source.label}
              </span>
              {detail.source.url && (
                <a href={detail.source.url} target="_blank" rel="noreferrer">
                  查看图片出处 ↗
                </a>
              )}
            </div>
          </main>
        )}
        {page === "scene" && (
          <main className="zp-page zp-scene page-enter">
            <button
              className="zp-back"
              onClick={() => guarded(() => go("start"))}
            >
              <ArrowLeft size={17} /> 返回开始拍
            </button>
            <div className="zp-page-title">
              <span className="zp-step">先看看你眼前的地方</span>
              <h1>
                风景很好看，
                <br />
                人该站哪里？
              </h1>
              <p>拍一张你想保留的风景，尽量带上地面。先不用让人站进去。</p>
            </div>
            {photo ? (
              <Placement photo={photo} />
            ) : (
              <button
                className="zp-upload-scene"
                onClick={() => sceneUpload.current?.click()}
              >
                <div className="zp-upload-preview">
                  {tutorialPhoto && (
                    <CropImage photo={tutorialPhoto} alt="湖边场景示例" />
                  )}
                  <span>示例场景</span>
                </div>
                <Camera size={25} />
                <b>拍一张或选择风景照片</b>
                <small>手机可以直接拍 · 也支持已有照片</small>
              </button>
            )}
            {photo && (
              <button
                disabled={analysis}
                className="zp-text-button"
                onClick={() => sceneUpload.current?.click()}
              >
                换一张场景照片
              </button>
            )}
            {analysis ? (
              <div className="zp-analysis" role="status">
                <LoaderCircle className="spin" size={25} />
                <h2>正在看这张风景…</h2>
                <p>分析画面里的留白、线条与可见光线。</p>
                <button
                  className="zp-secondary"
                  onClick={() => {
                    generation.current++;
                    request.current?.abort();
                    setAnalysis(false);
                  }}
                >
                  取消分析，保留照片
                </button>
              </div>
            ) : (
              <>
                <button
                  className="zp-primary"
                  disabled={!photo}
                  onClick={() => void openAI()}
                >
                  <Sparkles size={18} /> 让 AI 看看怎么拍
                </button>
                <button
                  className="zp-secondary"
                  disabled={!photo}
                  onClick={manual}
                >
                  我先自己选站位
                </button>
                <button
                  className="zp-text-button"
                  onClick={() => setExample(0)}
                >
                  没带照片？先看湖边示例
                </button>
              </>
            )}
            <div className="zp-scene-explainer">
              <span>
                <UserRound size={18} /> 人站哪里
              </span>
              <span>
                <Images size={18} /> 风景留多少
              </span>
              <span>
                <SunIcon /> 光线怎么用
              </span>
            </div>
            <p className="zp-caption">
              AI
              会给建议人物框和两个人的拍摄提示。人物框只是画面示意，真实地面和光线需要你们现场确认。
            </p>
          </main>
        )}
        {page === "plan" && photo && (
          <>
            <Plan
              key={`${photo.id}-${JSON.stringify(photo.crop)}`}
              photo={photo}
              reference={reference}
              sceneResult={sceneResult}
              origin={origin}
              initial={initial}
              onPhoto={(p) => {
                setPhoto(p);
                setInitial(null);
                setTarget(null);
              }}
              onBack={() =>
                guarded(() => {
                  if (origin === "reference" && reference) setDetail(reference);
                  go(
                    origin === "reference" && reference
                      ? "detail"
                      : origin === "reference"
                        ? "start"
                        : "scene",
                  );
                })
              }
              onStart={begin}
              onSave={(t) => void save(t)}
              onChange={setTarget}
            />
            {currentShot && (
              <button
                className="zp-secondary zp-view-saved"
                onClick={() => go("result")}
              >
                查看已拍下的照片 <Images size={17} />
              </button>
            )}
          </>
        )}
        {page === "camera" && photo && target && (
          <GuidedCamera
            reference={photo}
            target={target}
            onBack={() => {
              setInitial(target);
              go("plan");
            }}
            onCapture={captured}
            onPrevious={currentShot ? () => go("result") : undefined}
          />
        )}
        {page === "result" && photo && currentShot && (
          <>
            <div className="zp-recent" aria-label="本次最近拍摄">
              <span>最近 {shots.length} 张</span>
              {shots.map((s, i) => (
                <button
                  key={s.capture.id}
                  aria-label={`查看第${i + 1}张拍摄`}
                  aria-pressed={selectedShot === i}
                  onClick={() => setSelectedShot(i)}
                >
                  <img src={s.capture.photo.url} alt="本次拍摄缩略图" />
                </button>
              ))}
            </div>
            <PhotoResult
              key={currentShot.capture.id}
              reference={photo}
              capture={currentShot.capture}
              target={currentShot.target}
              onFeedback={(t) => {
                setTarget(t);
                setInitial(t);
                go("camera");
              }}
              onRetry={() => {
                setTarget(currentShot.target);
                go("camera");
              }}
              onEdit={() => {
                setTarget(currentShot.target);
                setInitial(currentShot.target);
                go("plan");
              }}
              onHome={() =>
                guarded(() => {
                  reset();
                  go("start");
                })
              }
            />
            <div className="zp-save-result">
              <button
                className="zp-primary"
                disabled={busy}
                onClick={() =>
                  void save(currentShot.target, currentShot.capture)
                }
              >
                保存这次拍摄 <Check size={18} />
              </button>
              <p>
                参考、拍法和当前这一张保存到「我的拍摄」。重要原片请另外导出。
              </p>
            </div>
          </>
        )}
        {page === "mine" && (
          <main className="zp-page page-enter">
            <div className="zp-page-title">
              <span className="zp-step">把这次拍法，留给下次</span>
              <h1>我的拍摄</h1>
              <p>保存过的参考、怎么拍和那一张照片。</p>
            </div>
            <div className="zp-storage-note">
              <BookOpen size={19} />
              <p>
                保存在这个浏览器，最多 12
                次。换设备或清理网站数据会丢失，重要照片请导出原片。
              </p>
            </div>
            {cards.length ? (
              <div className="zp-saved-list">
                {cards.map((card) => (
                  <article key={card.id}>
                    <button
                      className="zp-saved-open"
                      onClick={() => restore(card)}
                    >
                      <StoredThumbnail
                        blob={card.capture?.photo.blob ?? card.reference.blob}
                      />
                      <span>
                        <b>{card.title}</b>
                        <small>
                          {card.capture
                            ? "参考 + 拍法 + 1 张结果"
                            : "参考 + 拍法"}
                        </small>
                        <small>
                          {new Date(card.updated).toLocaleDateString("zh-CN")}
                        </small>
                      </span>
                      <ChevronRight size={17} />
                    </button>
                    <button
                      aria-label={`删除${card.title}`}
                      onClick={() => setDeleteId(card.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="zp-empty">
                <Camera size={30} />
                <h2>先一起拍第一张吧</h2>
                <p>在拍法页或结果页，点「保存这次拍摄」，就能在这里找到。</p>
                <button className="zp-secondary" onClick={() => go("start")}>
                  去开始拍
                </button>
              </div>
            )}
            <a className="zp-manual-link" href={fullHelp}>
              打开完整产品手册 <BookOpen size={17} />
            </a>
          </main>
        )}
        {tabs.some((t) => t.id === page) && (
          <nav className="zp-tabs" aria-label="主导航">
            {tabs.map((t) => (
              <button
                key={t.id}
                aria-current={page === t.id ? "page" : undefined}
                onClick={() => guarded(() => go(t.id))}
              >
                <t.icon size={21} />
                <span>{t.label}</span>
                {page === t.id && <i />}
              </button>
            ))}
          </nav>
        )}
        <input
          ref={upload}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadFile(f, false);
          }}
        />
        <input
          ref={sceneUpload}
          hidden
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void uploadFile(f, true);
          }}
        />
        {handoff && target && (
          <Modal
            title="这次，两个人各做一件事"
            onClose={() => setHandoff(false)}
          >
            <div className="zp-handoff">
              <Camera size={28} />
              <h3>拿手机的人先取景</h3>
              <p>{target.notebook?.cameraAdvice ?? target.preparation[0]}</p>
              <UserRound size={28} />
              <h3>镜头前的人先站好</h3>
              <p>
                {target.notebook?.subjectAdvice ??
                  "舒服地站好，等同伴框好画面，再试动作。"}
              </p>
              <small>
                手机已经在拍摄者手上？直接开始就好。下一张不再重复这一步。
              </small>
              <button
                className="zp-primary"
                onClick={() => {
                  handed.current = true;
                  setHandoff(false);
                  go("camera");
                }}
              >
                我拿手机，打开相机 <Camera size={17} />
              </button>
            </div>
          </Modal>
        )}
        {consent && (
          <Modal title="让 AI 看看这张风景" onClose={() => setConsent(false)}>
            <div className="zp-consent">
              <p>
                确认后，会把缩小的这张场景图发送给已配置的模型服务，生成构图、光线和两个人的建议。不会发送实时相机画面。
              </p>
              {configured === null ? (
                <p role="status">正在检查服务…</p>
              ) : !configured ? (
                <div className="zp-alert">
                  <b>纯前端版暂未接入 AI 风景分析</b>
                  <p>
                    照片已保留。你可以先自己选站位，或者用示例了解完整流程。
                  </p>
                </div>
              ) : (
                <p>照片仅在你点击下面按钮后发送。</p>
              )}
              <button
                className="zp-primary"
                disabled={!configured}
                onClick={() => void analyze()}
              >
                同意发送，开始分析
              </button>
              <button
                className="zp-secondary"
                onClick={() => {
                  setConsent(false);
                  manual();
                }}
              >
                不发送，我自己选站位
              </button>
            </div>
          </Modal>
        )}
        {example !== null && (
          <Modal
            title="30 秒，一起拍出喜欢的照片"
            onClose={() => setExample(null)}
          >
            <div className="zp-tutorial">
              <span className="zp-tag">示例演示 · 不会启动相机或调用 AI</span>
              <div className="zp-tutorial-dots">
                {[0, 1, 2].map((n) => (
                  <button
                    key={n}
                    aria-label={`查看示例第${n + 1}步`}
                    aria-pressed={example === n}
                    onClick={() => setExample(n)}
                  >
                    {n + 1}
                  </button>
                ))}
              </div>
              {tutorialPhoto && (
                <Placement
                  photo={tutorialPhoto}
                  box={example === 0 ? undefined : LAKE_EXAMPLE.variants[0].box}
                  illustration={example !== 0}
                />
              )}
              <h2>
                {
                  [
                    "先拍一张眼前的风景",
                    "两个人，各看一句提示",
                    "先拍一张，再只改一点",
                  ][example]
                }
              </h2>
              <p>
                {
                  [
                    "尽量把想保留的风景和可站立的地面都拍进去，这时不需要人。",
                    "拿手机的人：把人物放进右侧虚线框，留住湖面。镜头前的人：站在平坦步道上，侧身，再轻轻回头。",
                    "拍完一起看。比如喜欢现在的构图，就保留构图；只把动作变自然一点，再拍一张。原片和辅助线会分开。",
                  ][example]
                }
              </p>
              {example < 2 ? (
                <button
                  className="zp-primary"
                  onClick={() => setExample(example + 1)}
                >
                  下一步 <ArrowRight size={17} />
                </button>
              ) : (
                <>
                  <button
                    className="zp-primary"
                    onClick={() => void examplePlan()}
                  >
                    打开这个示例的拍法
                  </button>
                  <button
                    className="zp-secondary"
                    onClick={() => {
                      setExample(null);
                      startScene();
                    }}
                  >
                    用我的风景开始
                  </button>
                </>
              )}
              <a href={fullHelp}>想了解更多？打开图文手册 ↗</a>
            </div>
          </Modal>
        )}
        {leave && (
          <Modal
            title="离开前，要留下这次拍摄吗？"
            onClose={() => setLeave(null)}
          >
            <div className="zp-leave">
              <p>
                这次的照片或拍法还没有明确保存。保存后，可以从「我的拍摄」继续。
              </p>
              <button
                className="zp-primary"
                disabled={busy || !target}
                onClick={async () => {
                  if (
                    await save(
                      target!,
                      currentShot?.capture,
                      currentShot?.target,
                    )
                  ) {
                    const action = leave;
                    setLeave(null);
                    action();
                  }
                }}
              >
                保存后离开
              </button>
              <button
                className="zp-secondary"
                onClick={() => {
                  const action = leave;
                  setLeave(null);
                  action();
                }}
              >
                直接离开
              </button>
              <button className="zp-text-button" onClick={() => setLeave(null)}>
                继续这次拍摄
              </button>
            </div>
          </Modal>
        )}
        {editingReference && (
          <Modal title="管理我的参考" onClose={() => setEditingReference(null)}>
            <div className="zp-reference-editor">
              <div className="zp-ref-preview">
                <Thumbnail reference={personalAsReference(editingReference)} />
              </div>
              <label>
                参考名称
                <input
                  aria-label="参考名称"
                  value={personalName}
                  maxLength={60}
                  onChange={(e) => setPersonalName(e.target.value)}
                />
              </label>
              <label>
                放在哪个分类
                <select
                  aria-label="参考分类"
                  value={personalKind}
                  onChange={(e) =>
                    setPersonalKind(e.target.value as PersonalCategory)
                  }
                >
                  {Object.entries(PERSONAL_CATEGORY_LABELS).map(
                    ([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <button
                className="zp-primary"
                disabled={busy || !personalName.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const updated = {
                      ...editingReference,
                      name: personalName.trim(),
                      category: personalKind,
                    };
                    await putPersonalReference(updated);
                    await refreshPersonal();
                    if (detail?.id === updated.id)
                      setDetail(personalAsReference(updated));
                    setCategory(personalKind);
                    setReferenceScope("personal");
                    setSceneFilter("全部场景");
                    setQuery("");
                    setEditingReference(null);
                    setStatus("参考名称与分类已保存。");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                保存修改
              </button>
              <button
                className="zp-text-button zp-danger"
                onClick={() => {
                  setDeletingPersonal(editingReference);
                  setEditingReference(null);
                }}
              >
                删除这张参考
              </button>
              <p className="zp-caption">
                个人参考最多 24
                张，只保存在这个浏览器。拍摄结果请到「我的拍摄」保存。
              </p>
            </div>
          </Modal>
        )}
        {deletingPersonal && (
          <Modal
            title="删除这张参考？"
            onClose={() => setDeletingPersonal(null)}
          >
            <div className="zp-leave">
              <p>从「我的参考」删除这张图。已经保存的拍法和照片会继续保留。</p>
              <button
                className="zp-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await deletePersonalReference(deletingPersonal.id);
                    await refreshPersonal();
                    const next = favorites.filter(
                      (id) => id !== deletingPersonal.id,
                    );
                    try {
                      localStorage.setItem(favoriteKey, JSON.stringify(next));
                    } catch {}
                    setFavorites(next);
                    setDeletingPersonal(null);
                    if (page === "detail") go("discover");
                    setStatus("这张个人参考已删除，已保存的拍摄仍保留。");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认删除参考
              </button>
              <button
                className="zp-secondary"
                onClick={() => setDeletingPersonal(null)}
              >
                取消
              </button>
            </div>
          </Modal>
        )}
        {deleteId && (
          <Modal title="删除这次拍摄？" onClose={() => setDeleteId(null)}>
            <div className="zp-leave">
              <p>
                这会删除本浏览器中保存的参考、拍法和结果，无法撤销。已经下载的照片不受影响。
              </p>
              <button
                className="zp-primary"
                onClick={async () => {
                  try {
                    await deleteCard(deleteId);
                    setDeleteId(null);
                    await refreshCards();
                    setStatus("这次拍摄已删除。");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                确认删除
              </button>
              <button
                className="zp-secondary"
                onClick={() => setDeleteId(null)}
              >
                取消
              </button>
            </div>
          </Modal>
        )}
      </div>
    </>
  );
}
function SunIcon() {
  return <Sparkles size={18} />;
}
function StoredThumbnail({
  blob,
  alt = "已保存的拍摄",
}: {
  blob: Blob;
  alt?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const value = URL.createObjectURL(blob);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return <img src={url} alt={alt} />;
}
