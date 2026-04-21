const state = {
  skills: {},
  models: {},
  currentSkill: null,
  saveRevision: 0
};

const TIERS = [
  { value: 10, label: "S+", class: "tier-10" },
  { value: 9, label: "S", class: "tier-9" },
  { value: 8, label: "A", class: "tier-8" },
  { value: 7, label: "B", class: "tier-7" },
  { value: 6, label: "C", class: "tier-6" },
  { value: 5, label: "D", class: "tier-5" },
  { value: 4, label: "E", class: "tier-4" },
  { value: 3, label: "F", class: "tier-3" },
  { value: 2, label: "G", class: "tier-2" },
  { value: 1, label: "H", class: "tier-1" },
  { value: 0, label: "I", class: "tier-0" }
];

document.addEventListener("DOMContentLoaded", initApp);

async function initApp() {
  setupUnratedZone();
  const loaded = await fetchModels();

  if (!loaded) {
    return;
  }

  renderSkillTabs();

  const skillKeys = Object.keys(state.skills);
  if (skillKeys.length > 0) {
    selectSkill(skillKeys[0]);
  }
}

function setupUnratedZone() {
  const zone = document.getElementById("unrated-pool");
  setupDropzoneEvents(zone);
}

function setupDropzoneEvents(zone) {
  zone.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    zone.classList.add("drag-over");
  });
  
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("drag-over");
  });
  
  zone.addEventListener("drop", handleDrop);
}

async function fetchModels() {
  try {
    const response = await fetch("/api/models");

    if (!response.ok) {
      throw new Error("Failed to load models");
    }

    const data = await response.json();
    state.skills = data.skills || {};
    state.models = data.models || {};
    setStatus("SYNCED", "idle");
    return true;
  } catch (error) {
    console.error(error);
    setStatus("LOAD ERROR", "error");
    document.getElementById("current-skill-title").textContent = "Failed to load data";
    document.getElementById("current-skill-desc").textContent = "The editor could not fetch /api/models.";
    return false;
  }
}

function renderSkillTabs() {
  const nav = document.getElementById("skill-tabs");
  nav.innerHTML = "";
  
  Object.keys(state.skills).forEach(skillKey => {
    const btn = document.createElement("button");
    btn.className = "tab-btn";
    btn.textContent = formatSkillLabel(skillKey);
    btn.dataset.skill = skillKey;
    btn.addEventListener("click", () => selectSkill(skillKey));
    nav.appendChild(btn);
  });
}

function selectSkill(skillKey) {
  state.currentSkill = skillKey;
  
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.skill === skillKey);
  });
  
  document.getElementById("current-skill-title").textContent = formatSkillLabel(skillKey);
  document.getElementById("current-skill-desc").textContent = state.skills[skillKey]?.description || "";
  
  renderBoard();
}

function renderBoard() {
  const board = document.getElementById("tier-board");
  const unratedPool = document.getElementById("unrated-pool");
  
  board.innerHTML = "";
  unratedPool.innerHTML = "";
  
  TIERS.forEach(tier => {
    const row = document.createElement("div");
    row.className = `tier-row ${tier.class}`;
    
    const label = document.createElement("div");
    label.className = "tier-label";
    label.textContent = tier.label;
    
    const dropzone = document.createElement("div");
    dropzone.className = "tier-dropzone dropzone";
    dropzone.dataset.tier = tier.value;
    setupDropzoneEvents(dropzone);
    
    row.appendChild(label);
    row.appendChild(dropzone);
    board.appendChild(row);
  });
  
  Object.entries(state.models).forEach(([modelId, modelData]) => {
    const skillScore = modelData.skills?.[state.currentSkill];
    const card = createModelCard(modelId, modelData);
    
    if (skillScore !== undefined && skillScore !== null && !isNaN(skillScore)) {
      const dropzone = document.querySelector(`.tier-dropzone[data-tier="${skillScore}"]`);
      if (dropzone) {
        dropzone.appendChild(card);
      } else {
        unratedPool.appendChild(card);
      }
    } else {
      unratedPool.appendChild(card);
    }
  });
}

function createModelCard(modelId, modelData) {
  const card = document.createElement("div");
  card.className = "model-card";
  card.draggable = true;
  card.dataset.id = modelId;
  
  const providerText = modelId.split("/")[0] || "Unknown";
  card.style.setProperty("--card-accent", getProviderAccent(providerText));
  
  const providerDiv = document.createElement("div");
  providerDiv.className = "model-provider";
  providerDiv.textContent = providerText;
  
  const nameDiv = document.createElement("div");
  nameDiv.className = "model-name";
  nameDiv.textContent = modelData.display_name || modelId;

  const slugDiv = document.createElement("div");
  slugDiv.className = "model-slug";
  slugDiv.textContent = modelId;
  
  card.appendChild(providerDiv);
  card.appendChild(nameDiv);
  card.appendChild(slugDiv);
  
  card.addEventListener("dragstart", handleDragStart);
  card.addEventListener("dragend", handleDragEnd);
  
  return card;
}

let draggedCard = null;

function handleDragStart(e) {
  draggedCard = this;
  setTimeout(() => this.classList.add("dragging"), 0);
  e.dataTransfer.effectAllowed = "move";
}

function handleDragEnd() {
  this.classList.remove("dragging");
  draggedCard = null;
  document.querySelectorAll(".dropzone").forEach(dz => dz.classList.remove("drag-over"));
}

async function handleDrop(e) {
  e.preventDefault();
  const zone = e.currentTarget;
  zone.classList.remove("drag-over");
  
  if (!draggedCard) return;
  
  const newTier = zone.dataset.tier;
  const modelId = draggedCard.dataset.id;
  const previousSkills = {
    ...(state.models[modelId]?.skills || {})
  };
  
  zone.appendChild(draggedCard);
  
  let newScore = null;
  if (newTier !== "unrated") {
    newScore = parseInt(newTier, 10);
  }
  
  if (!state.models[modelId].skills) {
    state.models[modelId].skills = {};
  }
  
  if (newScore === null) {
    delete state.models[modelId].skills[state.currentSkill];
  } else {
    state.models[modelId].skills[state.currentSkill] = newScore;
  }
  
  const saveSucceeded = await saveModelScore(modelId, state.currentSkill, newScore);

  if (!saveSucceeded) {
    state.models[modelId].skills = previousSkills;
    renderBoard();
  }
}

async function saveModelScore(modelId, skillKey, newScore) {
  const revision = ++state.saveRevision;
  setStatus("SAVING...", "saving");
  
  try {
    const response = await fetch(`/api/skills/${skillKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        modelId,
        value: newScore
      })
    });
    
    if (!response.ok) {
      throw new Error("Save failed");
    }

    if (revision === state.saveRevision) {
      setStatus("SYNCED", "idle");
    }

    return true;
  } catch (error) {
    console.error(error);

    if (revision === state.saveRevision) {
      setStatus("ERROR", "error");
    }

    return false;
  }
}

function setStatus(text, variant) {
  const statusEl = document.getElementById("save-status");
  const statusText = statusEl.querySelector(".status-text");

  statusEl.className = "status-indicator";

  if (variant === "saving") {
    statusEl.classList.add("saving");
  }

  if (variant === "error") {
    statusEl.classList.add("error");
  }

  statusText.textContent = text;
}

function formatSkillLabel(skillKey) {
  return skillKey
    .split("_")
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getProviderAccent(provider) {
  const accents = {
    anthropic: "linear-gradient(135deg, rgba(255, 153, 102, 0.34), rgba(255, 255, 255, 0.03) 58%)",
    openai: "linear-gradient(135deg, rgba(0, 255, 163, 0.28), rgba(255, 255, 255, 0.02) 58%)",
    google: "linear-gradient(135deg, rgba(80, 140, 255, 0.3), rgba(255, 205, 80, 0.16) 58%)",
    moonshot: "linear-gradient(135deg, rgba(232, 63, 111, 0.34), rgba(255, 255, 255, 0.04) 58%)",
    zai: "linear-gradient(135deg, rgba(122, 178, 255, 0.28), rgba(255, 255, 255, 0.04) 58%)",
    minimax: "linear-gradient(135deg, rgba(255, 85, 85, 0.28), rgba(255, 255, 255, 0.04) 58%)",
    mistral: "linear-gradient(135deg, rgba(255, 170, 0, 0.32), rgba(255, 255, 255, 0.04) 58%)"
  };

  return accents[provider] ?? "linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.02) 58%)";
}
