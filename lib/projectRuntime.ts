import type { ProjectSummary } from "@/lib/projects";

export type ProjectRuntime = {
  list: () => Promise<ProjectSummary[]>;
  getActive: () => { id: string | null; title: string | null };
  create: (title?: string) => Promise<ProjectSummary>;
  open: (id: string) => Promise<ProjectSummary>;
  rename: (id: string, title: string) => Promise<ProjectSummary>;
  delete: (id: string) => Promise<void>;
};

let runtime: ProjectRuntime | null = null;

export function setProjectRuntime(next: ProjectRuntime | null) {
  runtime = next;
}

export function getProjectRuntime(): ProjectRuntime {
  if (!runtime) throw new Error("The OpenCast project workspace is still loading.");
  return runtime;
}
