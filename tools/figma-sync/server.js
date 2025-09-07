import express from "express";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";

// ==== ENV (все читаем из Railway Variables) ====
const {
  FIGMA_TOKEN,        // PAT Фигмы
  FIGMA_FILE_ID,      // ID файла Фигмы
  GH_TOKEN,           // GitHub PAT (scope: repo)
  GH_OWNER,           // владелец/организация
  GH_REPO,            // имя репозитория с фронтом
  CODEGEN_TARGET = "." // куда класть файлы внутри репозитория (например: ".", "apps/tma")
} = process.env;

function requireEnv(name, val) {
  if (!val || String(val).trim() === "") {
    console.error(`[env] Missing required env var: ${name}`);
    process.exit(1);
  }
}
["FIGMA_TOKEN","FIGMA_FILE_ID","GH_TOKEN","GH_OWNER","GH_REPO"].forEach(n => requireEnv(n, process.env[n]));

// ==== App ====
const app = express();
// фигма присылает application/json
app.use(express.json({ type: "*/*" }));

// ==== 1) Забрать данные из Figma ====
async function fetchFigmaDoc() {
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_ID}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": FIGMA_TOKEN } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Figma API error: ${res.status} ${text}`);
  }
  return res.json();
}

// ==== 2) Примитивный codegen (заглушка, чтобы конвейер поехал) ====
// Здесь тебе потом нужно будет описать реальные правила генерации
// (разбор нод, variables, изображения и т.п.)
function generateCode(figmaJson) {
  // Возьмём имена фреймов верхнего уровня как "экраны"
  const topFrames =
    (figmaJson.document?.children?.[0]?.children || [])
      .filter(n => n.type === "FRAME")
      .map(n => n.name);

  const files = {};

  // Пример: токены (в реальном проекте вытащить из variables API)
  files[`${CODEGEN_TARGET}/src/tokens.json`] = JSON.stringify(
    {
      color: { primary: "#0EA5E9" },
      spacing: { m: 16 }
    },
    null,
    2
  );

  // Карта экранов
  files[`${CODEGEN_TARGET}/src/generated/screens.map.ts`] =
`export const screens = ${JSON.stringify(topFrames, null, 2)} as const;`;

  // Пример простого экрана
  files[`${CODEGEN_TARGET}/src/generated/Home.tsx`] =
`export default function Home(){
  return (
    <div style={{ padding: 16 }}>
      <h1>GRITHER</h1>
      <p>Этот экран сгенерирован из Figma build.</p>
    </div>
  );
}`;

  // Индекс генерации
  files[`${CODEGEN_TARGET}/src/generated/index.ts`] =
`export { default as Home } from "./Home";
export { screens } from "./screens.map";`;

  return files;
}

// ==== 3) Создать PR в GitHub ====
async function openPR(files) {
  const octo = new Octokit({ auth: GH_TOKEN });

  // Определяем default branch (main/master/и т.д.)
  const repoInfo = await octo.repos.get({ owner: GH_OWNER, repo: GH_REPO });
  const baseBranch = repoInfo.data.default_branch || "main";

  // SHA последнего коммита в базовой ветке
  const baseRef = await octo.git.getRef({
    owner: GH_OWNER,
    repo: GH_REPO,
    ref: `heads/${baseBranch}`
  });
  const baseSha = baseRef.data.object.sha;

  // Новая ветка
  const branch = `figma-sync/${Date.now()}`;

  // Создаём blobs -> tree
  const treeItems = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await octo.git.createBlob({
      owner: GH_OWNER,
      repo: GH_REPO,
      content,
      encoding: "utf-8"
    });
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.data.sha });
  }

  const tree = await octo.git.createTree({
    owner: GH_OWNER,
    repo: GH_REPO,
    base_tree: baseSha,
    tree: treeItems
  });

  // Коммит -> ветка -> PR
  const commit = await octo.git.createCommit({
    owner: GH_OWNER,
    repo: GH_REPO,
    message: "chore(figma): auto-sync",
    tree: tree.data.sha,
    parents: [baseSha]
  });

  await octo.git.createRef({
    owner: GH_OWNER,
    repo: GH_REPO,
    ref: `refs/heads/${branch}`,
    sha: commit.data.sha
  });

  const pr = await octo.pulls.create({
    owner: GH_OWNER,
    repo: GH_REPO,
    head: branch,
    base: baseBranch,
    title: "Figma → GitHub auto-sync",
    body: "Этот PR автоматически создан из изменений в Figma."
  });

  return pr.data.html_url;
}

// ==== 4) Вебхук: слушаем события от Figma ====
app.post("/figma-webhook", async (req, res) => {
  try {
    const eventType = req.body?.event_type || req.headers["x-figma-event-type"] || "unknown";
    const fileId = req.body?.file_key || req.body?.file_id;

    console.log(`[webhook] type=${eventType} file=${fileId}`);

    // Если вебхук пришёл по другому файлу — просто игнорим
    if (fileId && fileId !== FIGMA_FILE_ID) {
      console.log(`[webhook] skip: different file (${fileId})`);
      return res.sendStatus(200);
    }

    const figmaJson = await fetchFigmaDoc();
    const files = generateCode(figmaJson);
    const prUrl = await openPR(files);

    console.log(`[webhook] PR created: ${prUrl}`);
    res.status(200).send("OK");
  } catch (e) {
    console.error("[webhook] error:", e);
    res.status(500).send(String(e));
  }
});

// Health checks
app.get("/", (_, res) => res.send("OK"));
app.get("/health", async (_, res) => {
  res.json({
    ok: true,
    repo: `${GH_OWNER}/${GH_REPO}`,
    target: CODEGEN_TARGET,
    figmaFile: FIGMA_FILE_ID
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`[server] listening on ${port}`));
