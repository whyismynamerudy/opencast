import { useEditorStore } from "@/lib/store";
import { buildWebMCPTools, type WebMCPTool } from "./tools";

type ModelContext = {
  registerTool?: (tool: WebMCPTool, options?: { signal?: AbortSignal }) => Promise<void>;
  provideContext?: (context: { tools: WebMCPTool[] }) => void | Promise<void>;
  clearContext?: () => void | Promise<void>;
};

export function registerWebMCP(): { available: boolean; dispose: () => void } {
  const documentContext = (globalThis.document as Document & { modelContext?: ModelContext } | undefined)?.modelContext;
  const navigatorContext = (globalThis.navigator as Navigator & { modelContext?: ModelContext } | undefined)?.modelContext;
  const context = documentContext ?? navigatorContext;
  if (!context) return { available: false, dispose: () => undefined };

  const tools = buildWebMCPTools(useEditorStore);
  if (context.registerTool) {
    const controller = new AbortController();
    void Promise.all(tools.map((tool) => context.registerTool!(tool, { signal: controller.signal })))
      .then(() => useEditorStore.getState().addActivity("WebMCP", `Registered ${tools.length} OpenCast tools.`, "success"))
      .catch(() => useEditorStore.getState().addActivity("WebMCP", "The browser rejected the tool registration.", "error"));
    return { available: true, dispose: () => controller.abort() };
  }

  if (!context.provideContext) return { available: false, dispose: () => undefined };

  // Compatibility for pre-standard WebMCP previews that used navigator.modelContext.
  const registration = context.provideContext({ tools });
  void Promise.resolve(registration).catch(() => {
    useEditorStore.getState().addActivity("WebMCP", "The browser rejected the tool registration.", "error");
  });
  useEditorStore.getState().addActivity("WebMCP", "Registered the OpenCast editing tool surface.", "success");
  return {
    available: true,
    dispose: () => { void context.clearContext?.(); },
  };
}
