"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, LoaderCircle, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { useWebMCP } from "@/hooks/useWebMCP";
import { deleteProject, getProject, listProjects, projectSummary, renameProject, saveProjectSnapshot, createProject, type ProjectSummary } from "@/lib/projects";
import { setProjectRuntime } from "@/lib/projectRuntime";
import { useEditorStore } from "@/lib/store";
import { Editor } from "./Editor";

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** Reflect the open project in the address bar without remounting the app. */
function syncProjectUrl(id: string | null, replace = false) {
  const path = id ? `/project/${encodeURIComponent(id)}` : "/";
  if (window.location.pathname === path) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
}

function projectIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/project\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function Workspace({ initialProjectId }: { initialProjectId?: string }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(initialProjectId ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const bootedRef = useRef(false);
  const webMcpAvailable = useWebMCP();

  const refresh = useCallback(async () => {
    const next = await listProjects();
    setProjects(next);
    return next;
  }, []);

  const persistActive = useCallback(async () => {
    const id = activeProjectIdRef.current;
    if (!id) return null;
    const saved = await saveProjectSnapshot(id, useEditorStore.getState().getProjectSnapshot());
    if (!saved) return null;
    await refresh();
    return projectSummary(saved);
  }, [refresh]);

  const openProject = useCallback(async (id: string) => {
    await persistActive();
    const project = await getProject(id);
    if (!project) throw new Error("That project is no longer available in this browser.");
    activeProjectIdRef.current = project.id;
    useEditorStore.getState().loadProjectSnapshot(project.snapshot);
    setActiveProjectId(project.id);
    syncProjectUrl(project.id);
    return projectSummary(project);
  }, [persistActive]);

  const createAndOpen = useCallback(async (title?: string) => {
    await persistActive();
    const project = await createProject(title);
    activeProjectIdRef.current = project.id;
    useEditorStore.getState().loadProjectSnapshot(project.snapshot);
    setActiveProjectId(project.id);
    syncProjectUrl(project.id);
    await refresh();
    return projectSummary(project);
  }, [persistActive, refresh]);

  const rename = useCallback(async (id: string, title: string) => {
    const project = await renameProject(id, title);
    if (!project) throw new Error("That project is no longer available in this browser.");
    if (activeProjectIdRef.current === id) useEditorStore.getState().createMulticamProject(project.title);
    await refresh();
    return projectSummary(project);
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await deleteProject(id);
    if (activeProjectIdRef.current === id) {
      activeProjectIdRef.current = null;
      setActiveProjectId(null);
      useEditorStore.getState().resetProject();
      syncProjectUrl(null, true);
    }
    await refresh();
  }, [refresh]);

  // Deep link: a hard load of /project/<id> hydrates that project from
  // IndexedDB, or falls back to the library when the id is unknown here.
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    if (!initialProjectId) return;
    // One-time hydration from IndexedDB (an external system); state updates
    // land in async callbacks after the lookup resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void openProject(initialProjectId).catch(() => {
      activeProjectIdRef.current = null;
      setActiveProjectId(null);
      syncProjectUrl(null, true);
      setError("That project is not saved in this browser, so the library is shown instead.");
    });
  }, [initialProjectId, openProject]);

  // Browser back/forward moves between the library and project URLs.
  useEffect(() => {
    const onPopState = () => {
      const id = projectIdFromPath(window.location.pathname);
      if (id && id !== activeProjectIdRef.current) {
        void openProject(id).catch(() => {
          activeProjectIdRef.current = null;
          setActiveProjectId(null);
          syncProjectUrl(null, true);
        });
      } else if (!id && activeProjectIdRef.current) {
        void persistActive();
        activeProjectIdRef.current = null;
        setActiveProjectId(null);
        void refresh();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [openProject, persistActive, refresh]);

  useEffect(() => {
    // IndexedDB is an external browser service. This one-time hydration does
    // not depend on the rendered library state, so it cannot form a render loop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load projects."))
      .finally(() => setLoading(false));
  }, [refresh]);

  useEffect(() => {
    setProjectRuntime({
      list: refresh,
      getActive: () => {
        const id = activeProjectIdRef.current;
        return { id, title: id ? useEditorStore.getState().projectTitle : null };
      },
      create: createAndOpen,
      open: openProject,
      rename,
      delete: remove,
    });
    return () => setProjectRuntime(null);
  }, [createAndOpen, openProject, refresh, remove, rename]);

  useEffect(() => {
    const unsubscribe = useEditorStore.subscribe(() => {
      if (!activeProjectIdRef.current) return;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void persistActive().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not save this project."));
      }, 900);
    });
    return () => {
      unsubscribe();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      void persistActive();
    };
  }, [persistActive]);

  const returnToProjects = async () => {
    try {
      await persistActive();
      activeProjectIdRef.current = null;
      setActiveProjectId(null);
      syncProjectUrl(null);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this project.");
    }
  };

  const signOut = async () => {
    await persistActive().catch(() => undefined);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  };

  if (activeProjectId) return <Editor onOpenProjects={() => void returnToProjects()} onSignOut={() => void signOut()} webMcpAvailable={webMcpAvailable} />;

  return <ProjectLibrary projects={projects} loading={loading} error={error} onCreate={createAndOpen} onOpen={openProject} onRename={rename} onDelete={remove} onSignOut={signOut} />;
}

type ProjectLibraryProps = {
  projects: ProjectSummary[];
  loading: boolean;
  error: string | null;
  onCreate: (title?: string) => Promise<ProjectSummary>;
  onOpen: (id: string) => Promise<ProjectSummary>;
  onRename: (id: string, title: string) => Promise<ProjectSummary>;
  onDelete: (id: string) => Promise<void>;
  onSignOut: () => void;
};

function ProjectLibrary({ projects, loading, error, onCreate, onOpen, onRename, onDelete, onSignOut }: ProjectLibraryProps) {
  const [title, setTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const totalSources = projects.reduce((total, project) => total + project.sourceCount, 0);
  const totalDuration = projects.reduce((total, project) => total + project.duration, 0);
  const editedProjects = projects.filter((project) => project.wordCount > 0).length;

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusyId("new");
    setActionError(null);
    try {
      await onCreate(title);
      setTitle("");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not create a project.");
    } finally {
      setBusyId(null);
    }
  };

  const open = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try { await onOpen(id); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not open this project."); } finally { setBusyId(null); }
  };

  const saveRename = async (id: string) => {
    setBusyId(id);
    setActionError(null);
    try { await onRename(id, editingTitle); setEditingId(null); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not rename this project."); } finally { setBusyId(null); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this saved project? Its media originals will remain in Fly storage.")) return;
    setBusyId(id);
    setActionError(null);
    try { await onDelete(id); } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not delete this project."); } finally { setBusyId(null); }
  };

  return (
    <main className="library-shell">
      <header className="library-topbar"><div className="brand-lockup"><span className="brand-mark">◒</span><span>OpenCast</span></div><div><button className="sign-out" type="button" onClick={onSignOut}><LogOut size={14} /> Sign out</button></div></header>
      <section className="library-card">
        <div className="library-header">
          <div><p className="eyebrow">Workspace</p><h1>Projects</h1></div>
          <form className="new-project" onSubmit={create}><input aria-label="New project title" placeholder="Name a new project" value={title} onChange={(event) => setTitle(event.target.value)} /><button type="submit" disabled={busyId === "new"}>{busyId === "new" ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />} New project</button></form>
        </div>
        {(error || actionError) && <p className="form-error">{actionError || error}</p>}
        <div className="library-strip" aria-label="Workspace summary">
          <span>{loading ? "Syncing…" : `${projects.length} project${projects.length === 1 ? "" : "s"}`}</span>
          <span>{totalSources} source{totalSources === 1 ? "" : "s"}</span>
          <span>{formatDuration(totalDuration)} on deck</span>
          {editedProjects > 0 && <span>{editedProjects} in the edit</span>}
        </div>
        {loading ? <div className="library-loading"><LoaderCircle className="spin" /> Loading your projects…</div> : projects.length ? <div className="project-grid">{projects.map((project) => <article className="project-card" key={project.id}>
          {editingId === project.id ? <div className="project-rename"><input autoFocus value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} /><button type="button" onClick={() => void saveRename(project.id)} disabled={busyId === project.id}>Save</button><button type="button" onClick={() => setEditingId(null)}>Cancel</button></div> : <>
            <div><p>{project.sourceCount ? `${project.sourceCount} source${project.sourceCount === 1 ? "" : "s"}` : "Ready for media"}</p><h2>{project.title}</h2><small>Edited {formatDate(project.updatedAt)} · {project.wordCount.toLocaleString()} words · {formatDuration(project.duration)}</small></div>
            <footer><button className="project-open" type="button" onClick={() => void open(project.id)} disabled={busyId === project.id}>{busyId === project.id ? <LoaderCircle className="spin" size={14} /> : "Open project"}</button><button className="project-icon" type="button" aria-label={`Rename ${project.title}`} onClick={() => { setEditingId(project.id); setEditingTitle(project.title); }}><Pencil size={14} /></button><button className="project-icon danger" type="button" aria-label={`Delete ${project.title}`} onClick={() => void remove(project.id)}><Trash2 size={14} /></button></footer>
          </>}
        </article>)}</div> : <section className="library-empty"><FolderOpen size={24} /><h2>Start with a recording.</h2><p>Create a project, then bring in every angle.</p><button type="button" onClick={() => void onCreate("Untitled podcast")}>Create project <Plus size={14} /></button></section>}
      </section>
    </main>
  );
}
