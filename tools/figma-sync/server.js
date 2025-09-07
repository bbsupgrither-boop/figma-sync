import express from "express";
import fetch from "node-fetch";
import { Octokit } from "@octokit/rest";

// ==== ENV ====
const {
  FIGMA_TOKEN,       // PAT Фигмы
  FIGMA_FILE_ID,     // ID файла Фигмы
  GH_TOKEN,          // GitHub PAT (scope: repo)
  GH_OWNER,          // владелец/организация
  GH_REPO,           // имя репо
  CODEGEN_TARGET= "apps/tma", // где лежит фронт мини-аппа
} = process.env;

if (!FIGMA_TOKEN || !FIGMA_FILE_ID || !GH_TOKEN || !GH_OWNER || !GH_REPO) {
  console.error("Missing required env vars");
  process.exit(1);
}

const app = express();
app.use(express.json({ type: "*/*" }));

// === 1) Забрать данные из Figma ===
async function fetchFigmaDoc() {
  const url = `https://api.figma.com/v1/files/${FIGMA_FILE_ID}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": FIGMA_TOKEN }});
  if (!res.ok) throw new Error(`Figma API error: ${res.status}`);
  return res.json();
}

// === 2) Примитивный codegen (заглушка, чтобы конвейер заработал) ===
// Здесь ты опишешь правила: как ноды/варианты → компоненты/экраны.
// Пока просто кладём токены и один экран, чтобы проверить цепочку.
function generateCode(figmaJson) {
  // Пример: возьмём имена топ-фреймов верхнего уровня как "экраны"
  const topFrames = (figmaJson.document?.children?.[0]?.children || [])
    .filter(n => n.type === "FRAME")
    .map(n => n.name);

  const files = {};

  // Токены — как заглушка (в реале собирай из variables API)
  files[`${CODEGEN_TARGET}/src/tokens.json`] = JSON.stringify({
    color: { primary: "#0EA5E9" },
    spacing: { m: 16 }
  }, null, 2);

  // Сгенерим карту экранов
  files[`${CODEGEN_TARGET}/src/generated/screens.map.ts`] =
`export const screens = ${JSON.stringify(topFrames, null, 2)} as const;`;

  // Пример экрана (в реале рендеришь layout из нод)
  files[`${CODEGEN_TARGET}/src/generated/Home.tsx`] =
`export default function Home(){
  return (<div style={{padding:16}}>
    <h1>GRITHER</h1>
    <p>Этот экран сгенерирован из Figma build.</p>
  </div>);
}`;

  // Индекс, чтобы можно было быстро подключить
  files[`${CODEGEN_TARGET}/src/generated/index.ts`] =
`export { default as Home } from "./Home";
export { screens } from "./screens.map";`;

  return files;
}

// === 3) Создать PR в GitHub ===
async function openPR(files) {
  const octo = new Octokit({ auth: GH_TOKEN });
  const baseRef = await octo.git.getRef({ owner: GH_OWNER, repo: GH_REPO, ref: "heads/main" });
  const baseSha = baseRef.data.object.sha;

  // Создаём ветку
  const branch = `figma-sync/${Date.now()}`;

  // Создаём блобы
  const treeItems = [];
  for (const [path, content] of Object.entries(files)) {
    const blob = await octo.git.createBlob({
      owner: GH_OWNER, repo: GH_REPO,
      content, encoding: "utf-8"
    });
    treeItems.push({ path, mode: "100644", type: "blob", sha: blob.data.sha });
  }

  // Дерево и коммит
  const tree = await octo.git.createTree({
    owner: GH_OWNER, repo: GH_REPO,
    base_tree: baseSha, tree: treeItems
  });
  const commit = await octo.git.createCommit({
    owner: GH_OWNER, repo: GH_REPO,
    message: "chore(figma): auto-sync",
    tree: tree.data.sha,
    parents: [baseSha]
  });

  await octo.git.createRef({
    owner: GH_OWNER, repo: GH_REPO,
    ref: `refs/heads/${branch}`,
    sha: commit.data.sha
  });

  await octo.pulls.create({
    owner: GH_OWNER, repo: GH_REPO,
    head: branch, base: "main",
    title: "Figma → GitHub auto-sync",
    body: "Этот PR автоматически создан из изменений в Figma."
  });
}

// === 4) Вебхук: на любое событие тянем файл и делаем PR ===
app.post("/figma-webhook", async (req, res) => {
  try {
    // Можно фильтровать req.body по типам событий, если нужно.
    const figmaJson = await fetchFigmaDoc();
    const files = generateCode(figmaJson);
    await openPR(files);
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e));
  }
});

app.get("/", (_, res) => res.send("OK"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on", port));
