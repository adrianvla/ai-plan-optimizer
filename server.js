const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

const rootDirectory = __dirname;
const publicDirectory = path.join(rootDirectory, "public");
const modelsFilePath = path.join(rootDirectory, "models.json");

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
      const modelsData = await readModelsFile();
      sendJson(response, 200, modelsData);
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
  validateUpdatePayload(skillKey, payload);

  const modelsData = await readModelsFile();

  if (!modelsData.skills || !modelsData.skills[skillKey]) {
    throw createHttpError(404, `Unknown skill: ${skillKey}`);
  }

  if (!modelsData.models || !modelsData.models[payload.modelId]) {
    throw createHttpError(404, `Unknown model: ${payload.modelId}`);
  }

  const model = modelsData.models[payload.modelId];
  const nextSkills = {
    ...(model.skills ?? {})
  };

  if (payload.value === null) {
    delete nextSkills[skillKey];
  } else {
    nextSkills[skillKey] = payload.value;
  }

  modelsData.models[payload.modelId] = {
    ...model,
    skills: nextSkills
  };

  await writeModelsFile(modelsData);

  return {
    ok: true,
    modelId: payload.modelId,
    skillKey,
    value: payload.value
  };
}

function validateUpdatePayload(skillKey, payload) {
  if (!skillKey) {
    throw createHttpError(400, "Missing skill key");
  }

  if (!payload || typeof payload !== "object") {
    throw createHttpError(400, "Request body must be a JSON object");
  }

  if (typeof payload.modelId !== "string" || payload.modelId.length === 0) {
    throw createHttpError(400, "modelId must be a non-empty string");
  }

  if (payload.value !== null && !Number.isInteger(payload.value)) {
    throw createHttpError(400, "value must be an integer tier or null");
  }

  if (Number.isInteger(payload.value) && (payload.value < 0 || payload.value > 10)) {
    throw createHttpError(400, "value must be between 0 and 10");
  }
}

async function readModelsFile() {
  const fileContent = await fs.readFile(modelsFilePath, "utf8");
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
