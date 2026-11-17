import type { NotebookTarget, Motion } from "../notebook/experience.ts";
import type { Feature, Group, LiveHint, Person } from "./session.ts";
import type { Rect } from "../lib/types.ts";
import {
  LIGHT_RECIPES,
  type LightChoice,
  type LightStyle,
} from "./lighting.ts";
import { displayBox } from "./collaboration.ts";
import { poseHint } from "./pose.ts";

export const INTERESTS = [
  { id: "composition", label: "构图", detail: "跟随人物位置、大小与留白" },
  { id: "light", label: "光影", detail: "找到适合现场的用光方式" },
  { id: "pose", label: "动作", detail: "借一个姿势或自然的小动作" },
  { id: "mood", label: "氛围", detail: "保留色彩、背景和松弛感" },
] as const;
export type Interest = (typeof INTERESTS)[number]["id"];
export const OBSTACLES = [
  { id: "window", label: "窗边用不了", detail: "换一种现场能用的光，保留构图" },
  { id: "sun", label: "没有这种阳光", detail: "选择实际光线，重新安排用光" },
  {
    id: "space",
    label: "没有地方退",
    detail: "原地取景，随时修改目标人物大小",
  },
  {
    id: "background",
    label: "背景太乱",
    detail: "先换取景角度，保留动作和人物大小",
  },
  {
    id: "pose",
    label: "动作有点别扭",
    detail: "换成整理袖口，取消固定手臂对齐",
  },
] as const;
export type Obstacle = (typeof OBSTACLES)[number]["id"];
export type TrialPose = "front" | "quarter" | "side";
type Baseline = {
  camera: string;
  subject: string;
  motion: Motion;
  groups: Group[];
  features: Feature[];
  lighting?: LightChoice;
};
export type FieldChoices = {
  interests: Interest[];
  obstacle?: Obstacle;
  fallbackLight?: LightStyle;
  action?: "hands" | "turn";
  trial?: { style: LightStyle; pose: TrialPose };
};
export type FieldPlan = FieldChoices & { baseline: Baseline };

export function interestsOf(target: NotebookTarget): Interest[] {
  if (target.field?.interests.length) return [...target.field.interests];
  const choices: Interest[] = [];
  if (target.features.includes("composition")) choices.push("composition");
  if (target.features.includes("light")) choices.push("light");
  if (
    target.groups.length ||
    (target.notebook?.motion !== undefined && target.notebook.motion !== "none")
  )
    choices.push("pose");
  if (!choices.length) choices.push("mood");
  return choices;
}

/** Rebuild from the unadapted instructions, so changing/cancelling a constraint is reversible. */
export function applyFieldPlan(
  target: NotebookTarget,
  choices: FieldChoices,
): NotebookTarget {
  const interests = [...new Set(choices.interests)].filter((id) =>
    INTERESTS.some((i) => i.id === id),
  );
  if (!interests.length) throw new Error("至少留一个你想参考的地方。");
  const baseline: Baseline = target.field?.baseline ?? {
    camera:
      target.notebook?.cameraAdvice ?? target.preparation[0] ?? "先确定取景。",
    subject:
      target.notebook?.subjectAdvice ??
      target.preparation[1] ??
      "选一个舒服的姿势。",
    motion: target.notebook?.motion ?? "none",
    groups: [...target.groups],
    features: [...target.features],
    lighting: target.lighting && { ...target.lighting },
  };
  const needsLight =
    choices.obstacle === "window" || choices.obstacle === "sun";
  if (needsLight && !choices.fallbackLight)
    throw new Error("先选一种现场实际能用的光。");
  const lighting = choices.fallbackLight
    ? {
        reference: baseline.lighting?.reference ?? null,
        setup: choices.fallbackLight!,
      }
    : baseline.lighting && { ...baseline.lighting };
  const features: Feature[] = [];
  if (interests.includes("composition")) features.push("composition");
  if (interests.includes("light")) features.push("light", "exposure");
  if (interests.includes("mood"))
    features.push("color", "styling", "expression");
  if (interests.includes("pose")) features.push("moment");
  let camera = interests.includes("composition")
    ? baseline.camera
    : interests.includes("light")
      ? "先找到照到脸的光，人物位置和大小按你喜欢的方式安排。"
      : "保留喜欢的背景和色彩，自由安排人物的位置与大小。";
  let subject = interests.includes("pose")
    ? baseline.subject
    : "用你舒服的姿势站好，轻轻放松肩膀。";
  let motion: Motion = interests.includes("pose") ? baseline.motion : "none";
  let groups = interests.includes("pose") ? [...baseline.groups] : [];
  if (choices.fallbackLight) {
    const recipe = LIGHT_RECIPES[lighting!.setup!];
    camera = `${recipe.camera} ${interests.includes("composition") ? "保留原来的构图目标。" : "人物大小和位置自由安排。"}`;
    subject = recipe.subject;
  }
  if (choices.obstacle === "space") {
    camera =
      "留在原地调整手机朝向，不安排后退。目标人物框不合适时，回拍法里调成现场能拍到的大小。";
    subject = "保持在平稳的位置，原地侧身或轻轻整理袖口。";
    if (motion === "walk") motion = "hands";
  }
  if (choices.obstacle === "background")
    camera =
      "先在原地左右调整取景角度，让头部后方避开路人和杂物；保留人物大小与动作。";
  if (choices.obstacle === "pose") {
    subject = "轻轻整理袖口，停一下，再看向同伴。";
    motion = "hands";
    groups = [];
  }
  const trial =
    choices.trial?.style === lighting?.setup ? choices.trial : undefined;
  if (trial && interests.includes("light")) {
    const cue = lightTrialSteps(trial.style).find(
      (step) => step.id === trial.pose,
    )!;
    subject = `${cue.cue} ${choices.obstacle === "pose" ? "双手轻轻整理袖口。" : "保持刚才喜欢的明暗，再选舒服的动作。"}`;
  }
  if (choices.action) {
    motion = choices.action;
    groups = [];
    subject = `${trial && interests.includes("light") ? lightTrialSteps(trial.style).find((s) => s.id === trial.pose)!.cue + " " : ""}${choices.action === "hands" ? "轻轻整理袖口，放松手指，停一下。" : "看看身旁远处，再慢慢回头，像刚听到朋友叫你。"}`;
  }
  return {
    ...target,
    features,
    groups,
    lighting,
    text: `${camera} ${subject}`,
    preparation: [camera, subject],
    field: { ...choices, interests, trial, baseline },
    notebook: {
      ...target.notebook,
      motion,
      cameraAdvice: camera,
      subjectAdvice: subject,
    },
  };
}

export function reviseFieldPlan(
  target: NotebookTarget,
  patch: Partial<FieldChoices>,
): NotebookTarget {
  return applyFieldPlan(
    { ...target, id: crypto.randomUUID(), revision: target.revision + 1 },
    {
      interests: interestsOf(target),
      ...target.field,
      ...patch,
    },
  );
}

export function lightTrialSteps(style: LightStyle) {
  if (style === "backlight")
    return [
      {
        id: "front" as const,
        label: "亮一些",
        cue: "保持光在身后，脸朝向拍摄者，先看脸上的明暗。",
        detail: "让手机对焦在脸上，先拍一张；不要为了追光盯着太阳。",
      },
      {
        id: "quarter" as const,
        label: "留一点层次",
        cue: "光仍在身后，脸稍微转向身旁反光较亮的一侧。",
        detail: "保持同一画幅，看脸颊能否多接到一点环境光，再拍一张。",
      },
      {
        id: "side" as const,
        label: "多一点光影",
        cue: "再轻轻转一点，留住脸侧和发梢的光。",
        detail: "停在舒服的位置。轮廓光和脸部明暗都由你选，不必追求一致。",
      },
    ];
  const source =
    style === "window"
      ? "窗户"
      : style === "night"
        ? "橱窗亮处"
        : style === "shade"
          ? "阴影外的亮处"
          : style === "side"
            ? "侧面的亮处"
            : style === "hard"
              ? "光照来的方向，视线避开太阳"
              : "明亮的天空";
  return [
    {
      id: "front" as const,
      label: "亮一些",
      cue: `脸朝向${source}，先看两侧脸的亮度。`,
      detail: "拍摄者保持同一画幅；先拍一张明暗比较均匀的。",
    },
    {
      id: "quarter" as const,
      label: "留一点层次",
      cue: `从${source}轻轻转开一点，让一侧脸留一点阴影。`,
      detail: "保持人物大小，观察亮侧脸颊的细节，再拍一张。",
    },
    {
      id: "side" as const,
      label: "多一点光影",
      cue: "再轻轻侧一点，保留自己喜欢的阴影。",
      detail: "停在舒服的位置即可；比较的是偏好，没有固定的最佳答案。",
    },
  ];
}

export type AlignmentItem = {
  id: "size" | "position" | "headroom";
  label: string;
  matched: boolean;
  current: number;
  target: number;
  error: number;
};
export function alignmentProgress(
  target: Rect,
  current: Rect,
): AlignmentItem[] {
  if (
    ![
      target.x,
      target.y,
      target.width,
      target.height,
      current.x,
      current.y,
      current.width,
      current.height,
    ].every(Number.isFinite) ||
    current.height <= 0 ||
    current.width <= 0
  )
    return [];
  return [
    {
      id: "size",
      label: "人物大小",
      current: current.height,
      target: target.height,
      tolerance: Math.min(0.09, target.height * 0.12),
    },
    {
      id: "position",
      label: "左右位置",
      current: current.x + current.width / 2,
      target: target.x + target.width / 2,
      tolerance: 0.045,
    },
    {
      id: "headroom",
      label: "上方留白",
      current: current.y,
      target: target.y,
      tolerance: 0.045,
    },
  ].map(({ tolerance, ...item }) => ({
    ...item,
    matched: Math.abs(item.current - item.target) <= tolerance,
    error: Math.abs(item.current - item.target) / tolerance,
  })) as AlignmentItem[];
}

export function fieldHint(target: NotebookTarget, people: Person[]): LiveHint {
  if (people.length !== 1 || !target.features.includes("composition"))
    return poseHint(target, people);
  const person = people[0];
  if (!Number.isFinite(person.confidence) || person.confidence < 0.55)
    return {
      key: "low-confidence",
      state: "uncertain",
      actor: "当前状态",
      text: "人物边界还不清楚，先保持自然。",
      detail: "等范围稳定后再比较，仍然可以按快门。",
    };
  const box = displayBox(target);
  const items = alignmentProgress(box, person.box);
  if (!items.length)
    return {
      key: "invalid-frame",
      state: "uncertain",
      actor: "当前状态",
      text: "暂时没有可靠的人物范围。",
      detail: "先对照参考取景。",
    };
  // Size first prevents a changing crop from giving contradictory position cues.
  const item = items.find((i) => !i.matched);
  if (!item)
    return poseHint(
      {
        ...target,
        features: target.features.filter((f) => f !== "composition"),
      },
      people,
    ).state === "reference"
      ? {
          key: "framing-ready",
          state: "hold",
          actor: "当前状态",
          text: "构图接近了，喜欢就拍。",
          detail: "大小、位置和上方留白接近目标；这是构图参考，喜欢由你决定。",
        }
      : poseHint(
          {
            ...target,
            features: target.features.filter((f) => f !== "composition"),
          },
          people,
        );
  const smaller = item.current > item.target;
  const text =
    item.id === "size"
      ? `调整取景，让画面里的人物${smaller ? "小" : "大"}一点。`
      : item.id === "position"
        ? `让人物在画面中靠${smaller ? "左" : "右"}一点。`
        : `人物上方的空间${smaller ? "少留" : "多留"}一点。`;
  return {
    key: `field-${item.id}-${smaller}`,
    state: "adjust",
    actor: "拍摄的人",
    text,
    detail:
      target.field?.obstacle === "space"
        ? "保持原地取景；做不到时回拍法调整目标框，不必后退。"
        : "人物先保持姿势。这里说的是画面中的变化，调整手机时留意周围空间。",
  };
}

export function directorCues(target: NotebookTarget) {
  return [
    {
      actor: "拿手机的人",
      title: "先把画面定下来",
      text:
        target.notebook?.cameraAdvice ??
        target.preparation[0] ??
        "选好背景，保持手机稳定。",
      detail: "先看头顶和画面边缘；给对方指出位置，等取景稳定再继续。",
    },
    {
      actor: "镜头前的人",
      title: "做一个舒服的动作",
      text: target.notebook?.subjectAdvice ?? "放松肩膀，轻轻看向同伴。",
      detail: "幅度小一点就好，不舒服可以点「换个动作」，保持自然呼吸。",
    },
    {
      actor: "一起准备",
      title: "停一下，留下这一刻",
      text: "拿手机的人保持取景，镜头前的人轻轻停住。喜欢现在的表情，就拍一张。",
      detail: "这里没有自动倒计时；准备好后由你按下快门。",
    },
  ];
}
