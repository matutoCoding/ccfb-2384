// IndexedDB 持久化:工程列表 + 版本历史(可回滚)
const DB_NAME = 'mugou-parametric';
const DB_VERSION = 1;

export interface ProjectMeta {
  id?: number;
  name: string;
  updatedAt: number;
}

export interface VersionEntry {
  id?: number;
  projectId: number;
  label: string;
  createdAt: number;
  data: string; // 序列化的 Project
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('versions')) {
        const v = db.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
        v.createIndex('byProject', 'projectId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('projects', 'readonly');
    const req = t.objectStore('projects').getAll();
    req.onsuccess = () => resolve(req.result as ProjectMeta[]);
    req.onerror = () => reject(req.error);
  });
}

/** 保存工程(新建或更新),并自动落一个版本快照 */
export async function saveProject(id: number | null, name: string, data: string, label = '保存'): Promise<number> {
  const db = await openDB();
  const now = Date.now();
  let pid: number;
  if (id == null) {
    pid = await tx(db, 'projects', 'readwrite', (s) => s.add({ name, updatedAt: now })) as unknown as number;
  } else {
    pid = id;
    await tx(db, 'projects', 'readwrite', (s) => s.put({ id, name, updatedAt: now }));
  }
  await tx(db, 'versions', 'readwrite', (s) => s.add({ projectId: pid, label, createdAt: now, data }));
  return pid;
}

export async function loadLatest(projectId: number): Promise<string | null> {
  const versions = await listVersions(projectId);
  return versions.length ? versions[versions.length - 1].data : null;
}

export async function listVersions(projectId: number): Promise<VersionEntry[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction('versions', 'readonly');
    const req = t.objectStore('versions').index('byProject').getAll(projectId);
    req.onsuccess = () =>
      resolve((req.result as VersionEntry[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

/** 回滚:返回指定版本的工程数据 */
export async function getVersionData(versionId: number): Promise<string | null> {
  const db = await openDB();
  const v = await tx(db, 'versions', 'readonly', (s) => s.get(versionId)) as VersionEntry | undefined;
  return v?.data ?? null;
}

export async function deleteProject(id: number): Promise<void> {
  const db = await openDB();
  await tx(db, 'projects', 'readwrite', (s) => s.delete(id));
}

// ---------- 导入 / 导出(JSON 文件) ----------

export function exportProjectFile(name: string, data: string) {
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.mugou.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importProjectFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.mugou.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve(await f.text());
    };
    input.click();
  });
}
