import type { Capture, Feedback, Target } from "../domain/session.ts";
import type { LightStyle } from "../domain/lighting.ts";
import { applyFeedback } from "../domain/collaboration.ts";
import { describeTarget } from "../domain/interpretation.ts";
import type { SceneResult } from "../product/scene.ts";
import type { FieldPlan } from "../domain/fieldwork.ts";

export const MOTIONS = {
  none: {
    title: "自在一点",
    steps: [
      {
        subject: "用舒服的姿势站好，肩膀放松。",
        camera: "先调好取景，等对方准备好再按快门。",
      },
    ],
  },
  turn: {
    title: "看看远处，再回头",
    steps: [
      {
        subject: "先看看窗外或身旁远处，不用找镜头。",
        camera: "把人物和背景框好，手机保持不动。",
      },
      {
        subject: "慢慢转回头，像刚听到朋友叫你。",
        camera: "轻轻叫对方的名字；转回来停住时拍。",
      },
    ],
  },
  hands: {
    title: "给双手找件小事",
    steps: [
      {
        subject: "轻轻整理袖口，或拿起手边的杯子。",
        camera: "留出手部空间，避开杂乱的桌面。",
      },
      {
        subject: "放松手指，停一下，再自然地看向同伴。",
        camera: "眼睛和手都进入画面后，按下快门。",
      },
    ],
  },
  walk: {
    title: "走两步，停一下",
    steps: [
      {
        subject: "在平坦空地慢慢走两步，不用看镜头。",
        camera: "先站稳，给行进方向留白；不要边倒退边拍。",
      },
      {
        subject: "在约好的位置停住，身体轻轻侧过来。",
        camera: "等人物停稳，检查头顶和脚边，再按快门。",
      },
    ],
  },
} as const;
export type Motion = keyof typeof MOTIONS;
export type Scene = {
  light: LightStyle;
  background: "clean" | "busy";
  space: "open" | "tight";
  approach: "here" | "closer";
};
export type NotebookTarget = Target & {
  field?: FieldPlan;
  notebook?: {
    motion: Motion;
    scene?: Scene;
    retryTip?: string;
    keep?: string[];
    source?: "reference" | "scene";
    sceneResult?: SceneResult;
    sceneMode?: "balanced" | "scenery" | "person";
    origin?: "ai" | "manual" | "example";
    cameraAdvice?: string;
    subjectAdvice?: string;
  };
};
export function sceneAdvice(scene: Scene, reference: LightStyle | null) {
  const match = !reference || reference === scene.light;
  const moving = scene.approach === "closer" && !match;
  return {
    setup: moving ? reference! : scene.light,
    moving,
    title: moving
      ? "先换到接近参考的光线，再拍"
      : "保留喜欢的构图，用好眼前的光",
    tradeoff: match
      ? "光线类型相近，仍需现场确认脸部和背景。"
      : moving
        ? "需要找新的位置或等光；找不到时，切回「就地拍」。"
        : "可以现在开始，但阴影方向、轮廓和背景不会与参考完全一样。",
    subject:
      scene.space === "tight"
        ? "原地侧身或整理袖口，不安排走动。"
        : "先选一个站位，再试一个轻松的小动作。",
    camera:
      scene.background === "busy"
        ? "先左右挪动手机，让头部后方避开路人、招牌和杂物；不要只靠放大裁切。"
        : "保留干净背景，检查头顶线条和画面边缘。",
  };
}
export type NextChange = Feedback | "natural" | "dark" | "clutter";
export const NEXT_CHANGES: {
  id: NextChange;
  label: string;
  detail: string;
  conflicts: string[];
}[] = [
  {
    id: "natural",
    label: "动作自然一点",
    detail: "改成一个小动作，取消固定手臂对齐",
    conflicts: ["动作"],
  },
  {
    id: "clutter",
    label: "背景干净一点",
    detail: "优先换取景角度，保留人物大小",
    conflicts: ["背景"],
  },
  {
    id: "dark",
    label: "脸再亮一点",
    detail: "先转向光源，不直接把整张提亮",
    conflicts: ["光线"],
  },
  {
    id: "smaller",
    label: "人物小一点",
    detail: "根据这一张的人物范围调整目标框",
    conflicts: ["构图"],
  },
  {
    id: "larger",
    label: "人物大一点",
    detail: "根据这一张的人物范围调整目标框",
    conflicts: ["构图"],
  },
];
export function nextTarget(
  target: NotebookTarget,
  capture: Capture,
  change: NextChange,
  keep: string[],
): NotebookTarget {
  if (
    NEXT_CHANGES.find((c) => c.id === change)?.conflicts.some((c) =>
      keep.includes(c),
    )
  )
    throw new Error("这项已经选为保留，请先取消保留，或换一个要调整的地方。");
  const notebook = {
    ...target.notebook,
    motion: target.notebook?.motion ?? "none",
    keep,
  };
  if (["smaller", "larger", "background", "free-pose"].includes(change)) {
    const next = applyFeedback(target, capture, change as Feedback);
    return rebaseAfterRetake(
      {
        ...next,
        notebook: { ...notebook, retryTip: next.adjustment?.note },
      },
      change,
    );
  }
  const retryTip =
    change === "natural"
      ? "这次只改动作：先看看远处，再轻轻回头。拿手机的人保持取景，等对方停住再拍。"
      : change === "dark"
        ? "这次只改用光：让脸稍转向窗户或亮处，拍摄者挪到亮侧。先看脸颊，再决定是否换位置。"
        : "这次只改背景：拍摄者左右挪一点，避开头后的杂物；让人物大小尽量保持上一张。";
  const next: NotebookTarget = {
    ...target,
    id: crypto.randomUUID(),
    revision: target.revision + 1,
    adjustment: undefined,
    groups: change === "natural" ? [] : [...target.groups],
    notebook: {
      ...notebook,
      motion: change === "natural" ? "turn" : notebook.motion,
      ...(change === "natural"
        ? {
            subjectAdvice: "先看看远处，再轻轻回头。肩膀放松，等同伴准备好。",
            cameraAdvice: "保留这一张的取景，等对方回头停住时拍。",
          }
        : {}),
      retryTip,
    },
  };
  next.text = `${describeTarget(next)} ${retryTip}`;
  return rebaseAfterRetake(next, change);
}

// The new shot becomes the starting point; later field edits must not revive older instructions.
function rebaseAfterRetake(
  target: NotebookTarget,
  change: NextChange,
): NotebookTarget {
  if (!target.field) return target;
  const next = {
    ...target,
    field: {
      ...target.field,
      obstacle: undefined,
      fallbackLight: undefined,
      action: undefined,
      baseline: {
        ...target.field.baseline,
        camera:
          target.notebook?.cameraAdvice ??
          target.preparation[0] ??
          target.field.baseline.camera,
        subject:
          target.notebook?.subjectAdvice ??
          target.preparation[1] ??
          target.field.baseline.subject,
        motion: target.notebook?.motion ?? "none",
        groups: [...target.groups],
        features: [...target.features],
        lighting: target.lighting,
      },
    },
  };
  if (change === "natural" || change === "free-pose") {
    next.field.baseline.groups = [];
    if (change === "natural")
      next.field.interests = [
        ...new Set([...next.field.interests, "pose" as const]),
      ];
  }
  if (change === "dark") {
    next.field.trial = undefined;
    next.field.baseline.subject =
      "让脸稍转向现场亮处，保留脸颊细节，先拍一张看看。";
    next.notebook = {
      ...next.notebook!,
      subjectAdvice: next.field.baseline.subject,
    };
  }
  return next;
}
