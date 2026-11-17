export const PLAY_LEVELS = [
  { id: "easy", label: "轻松一点", detail: "靠动作和反差，几乎不用演" },
  { id: "story", label: "有点戏感", detail: "两句台词，一个小情节" },
  { id: "bold", label: "放开演", detail: "一本正经地演一点荒诞" },
] as const;
export const PLAY_SCENES = {
  dorm: "宿舍 / 家里",
  cafe: "咖啡馆",
  campus: "校园空地",
} as const;
export const PLAY_PROPS = { cup: "杯子", book: "书本", chair: "椅子" } as const;
export type PlayLevel = (typeof PLAY_LEVELS)[number]["id"];
export type PlayConfig = {
  scene: keyof typeof PLAY_SCENES;
  participants: 2 | 3;
  props: (keyof typeof PLAY_PROPS)[];
  level: PlayLevel;
  variation: number;
};
export type PlayBeat = {
  start: number;
  end: number;
  actor: string;
  action: string;
  line?: string;
};
export type PlayScript = {
  title: string;
  tagline: string;
  camera: string;
  roles: string[];
  prop: string;
  beats: PlayBeat[];
  duration: number;
};

/** Small authored scenes adapted to explicitly selected resources; no invented scene analysis. */
export function createPlay(config: PlayConfig): PlayScript {
  if (
    ![2, 3].includes(config.participants) ||
    !(config.scene in PLAY_SCENES) ||
    !PLAY_LEVELS.some((l) => l.id === config.level)
  )
    throw new Error("请选择场景、人数和表演尺度。");
  const two = config.participants === 3;
  const prop = config.props.includes("cup")
    ? "杯子"
    : config.props.includes("book")
      ? "书本"
      : config.props.includes("chair")
        ? "椅子"
        : "空手";
  const itemAction =
    prop === "杯子"
      ? "轻轻拿起杯子"
      : prop === "书本"
        ? "认真翻开书本"
        : prop === "椅子"
          ? "缓缓坐到椅子上"
          : "低头整理袖口";
  const title =
    config.level === "easy"
      ? { dorm: "我今天休息", cafe: "给自己五秒钟", campus: "路过的主角" }[
          config.scene
        ]
      : config.level === "story"
        ? {
            dorm: "五分钟后出发",
            cafe: "等一个好消息",
            campus: "临时的发布会",
          }[config.scene]
        : {
            dorm: "宿舍董事会",
            cafe: prop === "杯子" ? "一杯水的并购案" : "角落里的大决定",
            campus: "空地上的首映礼",
          }[config.scene];
  const v = config.variation % 2;
  const lines =
    config.level === "easy"
      ? [undefined, undefined]
      : config.level === "story"
        ? v
          ? ["今天有什么安排？", "先把这一刻留下。"]
          : ["准备好了吗？", "等一下，我还在进入状态。"]
        : v
          ? ["这件事，我亲自来。", "好，那先把位置让一下。"]
          : ["从今天起，这里由我负责。", "那今天的卫生也交给你了。"];
  const soloLine =
    config.level === "easy"
      ? undefined
      : config.level === "story"
        ? "等一下，让我进入状态。"
        : "今天的重大决定：先休息五分钟。";
  return {
    title,
    duration: 15,
    prop,
    tagline:
      config.level === "easy"
        ? "一个小动作，也能有故事。"
        : config.level === "story"
          ? "认真说一句，留一点停顿。"
          : "越一本正经，反差越有趣。",
    roles: two
      ? [
          "演员 A：先发起的人",
          "演员 B：给出回应的人",
          "拍摄者：固定机位，负责录制",
        ]
      : ["演员 A：用动作完成小情节", "拍摄者：固定机位，负责录制"],
    camera:
      config.scene === "campus"
        ? "选择不挡路的平坦空地。手机保持人物胸口附近高度，完整留下手部动作，一镜到底。"
        : config.scene === "cafe"
          ? "借窗边或店内现有光线，避开其他客人。手机固定在人物斜前方，完整留下手部动作。"
          : "选一块干净背景，把杂物留在画面外。手机保持人物胸口附近高度，全程固定机位。",
    beats: [
      {
        start: 0,
        end: 5,
        actor: "演员 A",
        action: `${itemAction}。${config.level === "bold" ? "像要宣布一件大事，停两秒再看对方。" : v ? "先看远处，轻轻回头。" : "先看自己的手，再慢慢抬眼。"}`,
      },
      {
        start: 5,
        end: 10,
        actor: "演员 A",
        action:
          config.level === "easy"
            ? "轻轻舒一口气，放松肩膀，露出一点笑意。"
            : "保持认真，慢一点说完这句。",
        line: two ? lines[0] : soloLine,
      },
      {
        start: 10,
        end: 15,
        actor: two ? "演员 B" : "演员 A",
        action: two
          ? config.level === "easy"
            ? "看一眼 A，再看镜头，笑一下。"
            : "等一秒再回应，说完看向镜头，停住。"
          : "看向镜头，轻轻点头，再定格两秒。",
        line: two ? lines[1] : undefined,
      },
    ],
  };
}

export function playText(script: PlayScript) {
  return `照着拍 · 入戏一下\n《${script.title}》\n${script.tagline}\n\n${script.roles.join("\n")}\n道具：${script.prop}\n机位：${script.camera}\n\n${script.beats.map((b) => `${b.start}—${b.end} 秒｜${b.actor}\n${b.action}${b.line ? `\n台词：${b.line}` : ""}`).join("\n\n")}\n\n15 秒，一镜到底。\n`;
}
