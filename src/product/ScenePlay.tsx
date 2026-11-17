import { useCallback, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Film,
  RefreshCw,
} from "lucide-react";
import Modal from "../components/Modal";
import {
  createPlay,
  playText,
  PLAY_LEVELS,
  PLAY_PROPS,
  PLAY_SCENES,
  type PlayConfig,
  type PlayScript,
} from "../domain/scene-play";
import PlayRecorder from "./PlayRecorder";

export default function ScenePlay({
  onBack,
  onDirty,
}: {
  onBack: () => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [config, setConfig] = useState<PlayConfig>({
    scene: "dorm",
    participants: 2,
    props: [],
    level: "easy",
    variation: 0,
  });
  const [script, setScript] = useState<PlayScript | null>(null),
    [record, setRecord] = useState(false);
  const [dirty, setDirty] = useState(false),
    [leave, setLeave] = useState(false);
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  function download() {
    if (!script) return;
    const url = URL.createObjectURL(
      new Blob([playText(script)], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `照着拍-${script.title}-剧本.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  function change(patch: Partial<PlayConfig>) {
    setConfig((c) => ({ ...c, ...patch }));
    setScript(null);
  }
  function backToScript() {
    setRecord(false);
    setDirty(false);
    onDirty(false);
    setLeave(false);
  }
  return (
    <main className="zp-page zp-play page-enter">
      {!record && (
        <>
          <button className="zp-text-button" onClick={onBack}>
            <ArrowLeft size={16} /> 返回开始拍
          </button>
          <div className="zp-play-heading">
            <span className="zp-tag">用眼前的条件，演一个小故事</span>
            <h1>
              入戏一下<span>15s</span>
            </h1>
            <p>
              一部手机，几件手边的小物。
              <br />
              今天的主角，就是你们。
            </p>
          </div>
          <section className="zp-play-config">
            <label className="zp-select">
              现在在哪里？
              <select
                aria-label="短剧场景"
                value={config.scene}
                onChange={(e) =>
                  change({ scene: e.target.value as PlayConfig["scene"] })
                }
              >
                {Object.entries(PLAY_SCENES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend>
                几个人一起？<small>包含拿手机的人</small>
              </legend>
              <div className="zp-choice-row">
                {([2, 3] as const).map((n) => (
                  <button
                    key={n}
                    aria-pressed={config.participants === n}
                    onClick={() => change({ participants: n })}
                  >
                    {n} 人<small>{n - 1} 位演员 + 1 位拍摄者</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>
                手边有什么？<small>没有也可以，空手就能演</small>
              </legend>
              <div className="zp-choice-row">
                {Object.entries(PLAY_PROPS).map(([id, name]) => {
                  const prop = id as keyof typeof PLAY_PROPS;
                  return (
                    <button
                      key={id}
                      aria-pressed={config.props.includes(prop)}
                      onClick={() =>
                        change({
                          props: config.props.includes(prop)
                            ? config.props.filter((p) => p !== prop)
                            : [...config.props, prop],
                        })
                      }
                    >
                      {config.props.includes(prop) && <Check size={13} />}
                      {name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset>
              <legend>今天想演到什么程度？</legend>
              <div className="zp-play-levels">
                {PLAY_LEVELS.map((l) => (
                  <button
                    key={l.id}
                    aria-pressed={config.level === l.id}
                    onClick={() => change({ level: l.id })}
                  >
                    <b>{l.label}</b>
                    <small>{l.detail}</small>
                    {config.level === l.id && <Check size={17} />}
                  </button>
                ))}
              </div>
            </fieldset>
            <button
              className="zp-primary"
              onClick={() => setScript(createPlay(config))}
            >
              <Film size={17} /> 给我们一个小剧本 <ArrowRight size={17} />
            </button>
            <p className="zp-caption">
              从精选小剧本出发，按你选的场景、人数和道具安排角色与拍法。
            </p>
          </section>
          {script && (
            <section className="zp-play-script" aria-label="小剧本">
              <span className="zp-step">15 秒 · 一镜到底</span>
              <h2>《{script.title}》</h2>
              <p>{script.tagline}</p>
              <div className="zp-play-cast">
                {script.roles.map((role) => (
                  <p key={role}>{role}</p>
                ))}
                <p>道具：{script.prop}</p>
              </div>
              <div className="zp-field-note">
                <b>拿手机的人</b>
                <p>{script.camera}</p>
              </div>
              <ol className="zp-play-beats">
                {script.beats.map((b) => (
                  <li key={b.start}>
                    <span>
                      {b.start}—{b.end}s
                    </span>
                    <div>
                      <small>{b.actor}</small>
                      <p>{b.action}</p>
                      {b.line && <blockquote>“{b.line}”</blockquote>}
                    </div>
                  </li>
                ))}
              </ol>
              <button className="zp-primary" onClick={() => setRecord(true)}>
                准备好了，去录一段 <ArrowRight size={17} />
              </button>
              <div className="zp-field-actions">
                <button onClick={download}>
                  <Download size={15} /> 保存剧本
                </button>
                <button
                  onClick={() => {
                    const next = { ...config, variation: config.variation + 1 };
                    setConfig(next);
                    setScript(createPlay(next));
                  }}
                >
                  <RefreshCw size={15} /> 换一种演法
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {record && script && (
        <PlayRecorder
          script={script}
          onDirty={reportDirty}
          onBack={() => (dirty ? setLeave(true) : backToScript())}
        />
      )}
      {leave && (
        <Modal title="短片还没下载" onClose={() => setLeave(false)}>
          <div className="zp-field-dialog">
            <p>返回剧本会清除本次录制。可以先留在这里保存短片。</p>
            <button className="zp-primary" onClick={() => setLeave(false)}>
              留下来保存
            </button>
            <button className="zp-secondary" onClick={backToScript}>
              放弃片段，返回剧本
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
