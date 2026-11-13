// 工程状态 + 命令式撤销/重做
import type { Module } from '../geom/caifen';
import { defaultModule } from '../geom/caifen';
import type { DougongParams } from '../geom/dougong';
import { defaultDougongParams } from '../geom/dougong';
import type { FrameParams, Entity } from '../geom/frame';
import { defaultFrameParams, buildFrame } from '../geom/frame';

export interface RenderSettings {
  ssao: boolean;
  shadows: boolean;
  woodGrain: boolean;
  lightDir: [number, number, number];
  exposure: number;
  clipPlane: { enabled: boolean; axis: 'x' | 'y' | 'z'; pos: number; flip: boolean };
}

export interface Project {
  name: string;
  module: Module;             // 材等模数 —— 改它,斗拱/梁架全部联动
  dougong: DougongParams;
  frame: FrameParams;
  entities: Entity[];         // 梁架装配实体(由 frame 参数生成,可拖拽改 offset)
  render: RenderSettings;
}

export const defaultRenderSettings = (): RenderSettings => ({
  ssao: true,
  shadows: true,
  woodGrain: true,
  lightDir: [-0.5, -1, -0.35],
  exposure: 1.0,
  clipPlane: { enabled: false, axis: 'y', pos: 0, flip: false },
});

export function createProject(name = '未命名工程'): Project {
  const frame = defaultFrameParams();
  return {
    name,
    module: defaultModule(),
    dougong: defaultDougongParams(),
    frame,
    entities: buildFrame(frame),
    render: defaultRenderSettings(),
  };
}

/** 命令:do/undo 都是对整个 Project 的局部补丁函数 */
export interface Command {
  label: string;
  apply(p: Project): void;
  revert(p: Project): void;
}

type Listener = () => void;

export class Store {
  project: Project;
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<Listener>();
  /** 选中构件 id(渲染描边用) */
  selectedId: number | null = null;

  constructor() {
    this.project = createProject();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() { this.listeners.forEach((f) => f()); }

  /** 执行命令并入栈 */
  exec(cmd: Command) {
    cmd.apply(this.project);
    this.undoStack.push(cmd);
    this.redoStack.length = 0;
    this.emit();
  }
  undo() {
    const c = this.undoStack.pop();
    if (!c) return;
    c.revert(this.project);
    this.redoStack.push(c);
    this.emit();
  }
  redo() {
    const c = this.redoStack.pop();
    if (!c) return;
    c.apply(this.project);
    this.undoStack.push(c);
    this.emit();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** 直接改状态(不入撤销栈,用于相机等) */
  touch() { this.emit(); }

  /** 修改对象字段的通用命令(深拷贝旧值) */
  mutate<T extends object>(label: string, obj: T, patch: Partial<T>) {
    const old: Partial<T> = {};
    for (const k of Object.keys(patch) as (keyof T)[]) old[k] = structuredClone(obj[k]);
    this.exec({
      label,
      apply: () => Object.assign(obj, structuredClone(patch)),
      revert: () => Object.assign(obj, structuredClone(old)),
    });
  }

  /** 改梁架参数并整体重算实体 */
  updateFrame(patch: Partial<FrameParams>) {
    const oldFrame = structuredClone(this.project.frame);
    const oldEnts = structuredClone(this.project.entities);
    this.exec({
      label: '改梁架参数',
      apply: (p) => {
        Object.assign(p.frame, structuredClone(patch));
        p.frame.dougong = p.dougong; // 铺作参数联动
        p.entities = buildFrame(p.frame);
      },
      revert: (p) => {
        p.frame = oldFrame;
        p.entities = oldEnts;
      },
    });
  }

  /** 改材等模数 → 几何缓存失效,全部联动重算 */
  updateModule(patch: Partial<Module>) {
    this.mutate('改材分模数', this.project.module, patch);
  }

  updateDougong(patch: Partial<DougongParams>) {
    this.mutate('改铺作参数', this.project.dougong, patch);
  }

  updateRender(patch: Partial<RenderSettings>) {
    this.mutate('改渲染设置', this.project.render, patch);
  }

  /** 拖拽构件(吸附后落一条命令) */
  moveEntity(id: number, newPos: [number, number, number]) {
    const ent = this.project.entities.find((e) => e.id === id);
    if (!ent) return;
    const oldPos = structuredClone(ent.pos) as [number, number, number];
    this.exec({
      label: '移动构件',
      apply: (p) => {
        const e = p.entities.find((x) => x.id === id);
        if (e) e.pos = [...newPos];
      },
      revert: (p) => {
        const e = p.entities.find((x) => x.id === id);
        if (e) e.pos = oldPos;
      },
    });
  }

  /** 序列化(保存/版本快照/导出共用) */
  serialize(): string {
    return JSON.stringify(this.project);
  }
  load(json: string) {
    const p = JSON.parse(json) as Project;
    this.exec({
      label: '载入工程',
      apply: (proj) => Object.assign(proj, structuredClone(p)),
      revert: () => {},
    });
  }
}

export const store = new Store();
