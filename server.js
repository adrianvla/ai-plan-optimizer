const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const rootDirectory = __dirname;
const publicDirectory = path.join(rootDirectory, "public");
const modelsFilePath = path.join(rootDirectory, "models.json");
const configFilePath = path.join(rootDirectory, "config.json");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png"
};

let writeQueue = Promise.resolve();

const server = http.createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing request URL" });
      return;
    }

    const host = request.headers.host ?? `${HOST}:${PORT}`;
    const url = new URL(request.url, `http://${host}`);

    if (request.method === "GET" && url.pathname === "/api/models") {
      const [modelsData, configData] = await Promise.all([readModelsFile(), readConfigFile()]);
      sendJson(response, 200, {
        ...modelsData,
        roles: configData.roles ?? [],
        config: {
          budget_usd: configData.budget_usd,
          max_plans_in_combo: configData.max_plans_in_combo,
          top_n: configData.top_n
        }
      });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/skills/")) {
      const skillKey = decodeURIComponent(url.pathname.replace("/api/skills/", ""));
      const requestBody = await readJsonBody(request);
      const saveResult = await enqueueSkillUpdate(skillKey, requestBody);
      sendJson(response, 200, saveResult);
      return;
    }

    if (request.method === "GET") {
      await serveStaticFile(url.pathname, response);
      return;
    }

    sendJson(response, 405, { error: "Method not allowed" });
  } catch (error) {
    const statusCode = error.statusCode ?? 500;
    sendJson(response, statusCode, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Tier list editor running at http://${HOST}:${PORT}`);
});

function enqueueSkillUpdate(skillKey, payload) {
  writeQueue = writeQueue.then(() => updateSkillValue(skillKey, payload));
  return writeQueue;
}

async function updateSkillValue(skillKey, payload) {
  const updates = normalizeUpdatesPayload(skillKey, payload);

  const modelsData = await readModelsFile();

  if (!modelsData.skills || !modelsData.skills[skillKey]) {
    throw createHttpError(404, `Unknown skill: ${skillKey}`);
  }

  updates.forEach(update => {
    if (!modelsData.models || !modelsData.models[update.modelId]) {
      throw createHttpError(404, `Unknown model: ${update.modelId}`);
    }

    const model = modelsData.models[update.modelId];
    const nextSkills = {
      ...(model.skills ?? {})
    };

    if (update.value === null) {
      delete nextSkills[skillKey];
    } else {
      nextSkills[skillKey] = update.value;
    }

    modelsData.models[update.modelId] = {
      ...model,
      skills: nextSkills
    };
  });

  await writeModelsFile(modelsData);

  return {
    ok: true,
    skillKey,
    updated: updates.length
  };
}

function normalizeUpdatesPayload(skillKey, payload) {
  if (!skillKey) {
    throw createHttpError(400, "Missing skill key");
  }

  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object");
  }

  const updates = Array.isArray(payload.updates)
    ? payload.updates
    : [{ modelId: payload.modelId, value: payload.value }];

  if (updates.length === 0) {
    throw createHttpError(400, "At least one update is required");
  }

  updates.forEach(update => validateSingleUpdate(update));

  return updates;
}

function validateSingleUpdate(update) {
  if (!update || typeof update !== "object") {
    throw createHttpError(400, "Each update must be an object");
  }

  if (typeof update.modelId !== "string" || update.modelId.length === 0) {
    throw createHttpError(400, "modelId must be a non-empty string");
  }

  if (update.value !== null && (typeof update.value !== "number" || !Number.isFinite(update.value))) {
    throw createHttpError(400, "value must be a number or null");
  }

  if (typeof update.value === "number" && (update.value < 0 || update.value > 10)) {
    throw createHttpError(400, "value must be between 0 and 10");
  }
}

async function readModelsFile() {
  const fileContent = await fs.readFile(modelsFilePath, "utf8");
  return JSON.parse(fileContent);
}

async function readConfigFile() {
  const fileContent = await fs.readFile(configFilePath, "utf8");
  return JSON.parse(fileContent);
}

async function writeModelsFile(modelsData) {
  const nextFileContent = `${JSON.stringify(modelsData, null, 2)}\n`;
  const tempFilePath = `${modelsFilePath}.tmp`;

  await fs.writeFile(tempFilePath, nextFileContent, "utf8");
  await fs.rename(tempFilePath, modelsFilePath);
}

async function serveStaticFile(requestPath, response) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^([.][.][/\\])+/, "");
  const filePath = path.join(publicDirectory, safePath);
  const relativePath = path.relative(publicDirectory, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw createHttpError(403, "Forbidden");
  }

  try {
    const fileContent = await fs.readFile(filePath);
    const extension = path.extname(filePath);

    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] ?? "application/octet-stream"
    });
    response.end(fileContent);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw createHttpError(404, "Not found");
    }

    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString("utf8");

  if (!rawBody) {
    throw createHttpError(400, "Request body is required");
  }

  try {
    return JSON.parse(rawBody);
  } catch {
    throw createHttpError(400, "Request body must be valid JSON");
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
