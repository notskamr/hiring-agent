// Runs the repo's unmodified Python pipeline in Pyodide. Must be a worker:
// urllib3 on Pyodide makes `requests` work via sync XHR, only allowed off the main thread.
importScripts("https://cdn.jsdelivr.net/pyodide/v0.29.5/full/pyodide.js");

// ponytail: hand-kept list; add new templates/roles here when the repo grows them
const FILES = [
  "config.py", "providers.json", "evaluator.py", "github.py", "llm_utils.py", "models.py",
  "pdf.py", "prompt.py", "pymupdf_rag.py", "roles.py", "score.py", "transform.py",
  "prompts/template_manager.py",
  ...["awards", "basics", "education", "github_project_selection", "projects", "skills",
      "system_message", "work"].map(t => `prompts/templates/${t}.jinja`),
  ...["role.json", "criteria.jinja", "system_message.jinja"].map(f => `roles/software_engineering_intern/${f}`),
];

const log = msg => postMessage({ type: "log", msg });

const ready = (async () => {
  log("Loading Python runtime…");
  const py = await loadPyodide();
  py.setStdout({ batched: log });
  py.setStderr({ batched: log });
  await py.loadPackage("micropip");
  log("Installing PyMuPDF and dependencies (~20 MB, cached after first run)…");
  await py.runPythonAsync(`
import micropip
# PyMuPDF's wasm build targets Pyodide 0.29 (py3.13); 1.26.3 pinned in requirements has none
await micropip.install(["pymupdf==1.28.2", "pydantic", "jinja2", "requests", "python-dotenv"])
await micropip.install("pymupdf4llm==0.0.27", deps=False)
`);
  log("Fetching pipeline code…");
  await Promise.all(FILES.map(async f => {
    const res = await fetch(new URL(`../${f}`, location.href));
    if (!res.ok) throw new Error(`Missing ${f} (${res.status})`);
    py.FS.mkdirTree("/app/" + f.split("/").slice(0, -1).join("/"));
    py.FS.writeFile("/app/" + f, new Uint8Array(await res.arrayBuffer()));
  }));
  py.runPython(`import os, sys; os.chdir("/app"); sys.path.insert(0, "/app")`);
  const models = py.runPython(`import json; json.dumps(json.load(open("providers.json"))["providers"]["gemini"]["models"])`);
  postMessage({ type: "ready", models: Object.keys(JSON.parse(models)) });
  return py;
})().catch(e => postMessage({ type: "error", msg: String(e.message || e) }));

onmessage = async ({ data }) => {
  const py = await ready;
  if (!py) return;
  try {
    py.FS.writeFile("/tmp/resume.pdf", new Uint8Array(data.pdf));
    py.globals.set("job", py.toPy({ key: data.key, model: data.model, role: data.role, github: data.github || "" }));
    const out = py.runPython(`
import json, os, sys
os.environ.update(GEMINI_API_KEY=job["key"], DEFAULT_MODEL=job["model"], GITHUB_TOKEN=job["github"])
# The pipeline binds DEFAULT_MODEL and the API key at import time, so re-import per run.
for m in ["config", "prompt", "models", "llm_utils", "pdf", "github", "evaluator", "transform", "roles", "score"]:
    sys.modules.pop(m, None)
import config
config.DEVELOPMENT_MODE = False  # no filename-keyed caching or CSV in the browser
import score
from roles import load_role
role = load_role(job["role"])
ev = score.main("/tmp/resume.pdf", role)
if ev is None:
    raise RuntimeError("Could not extract anything from the PDF")
json.dumps({
    "evaluation": ev.model_dump(),
    "categories": {c.key: {"label": c.label, "icon": c.icon} for c in role.categories},
    "bonus_max": role.bonus_max,
})
`);
    postMessage({ type: "result", data: JSON.parse(out) });
  } catch (e) {
    const lines = String(e.message || e).trim().split("\n");
    postMessage({ type: "error", msg: lines[lines.length - 1] });
  }
};
