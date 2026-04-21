const state = {
  skills: {},
  models: {},
  roles: [],
  currentSkill: null,
  saveRevision: 0,
  ratingSession: null
};

const RATING_HELPER_DEFAULT = "Rate every skill for this model. Leave a skill marked unrated if you do not want to place it.";

const SCORE_DECIMALS = 4;
const TIER_SPAN = 0.5;

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
  setupRatingMode();
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
    state.roles = Array.isArray(data.roles) ? data.roles : [];
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
    btn.dataset.skill = skillKey;
    btn.textContent = formatSkillLabel(skillKey);
    btn.addEventListener("click", () => selectSkill(skillKey));
    nav.appendChild(btn);
  });

  populateRatingModelSelect();
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
  const skillBuckets = createSkillBuckets(state.currentSkill);
  const thresholdGroups = getThresholdGroupsForSkill(state.currentSkill);
  
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

    const thresholdGuide = createThresholdGuide(tier.value, thresholdGroups.get(tier.value) ?? []);
     
    row.appendChild(label);
    row.appendChild(dropzone);
    if (thresholdGuide) {
      row.appendChild(thresholdGuide);
    }
    board.appendChild(row);
  });

  TIERS.forEach(tier => {
    const dropzone = document.querySelector(`.tier-dropzone[data-tier="${tier.value}"]`);
    const modelsInTier = skillBuckets.get(tier.value) ?? [];

    modelsInTier.forEach(({ modelId, modelData }) => {
      dropzone.appendChild(createModelCard(modelId, modelData));
    });
  });

  const unratedModels = skillBuckets.get("unrated") ?? [];
  unratedModels.forEach(({ modelId, modelData }) => {
    unratedPool.appendChild(createModelCard(modelId, modelData));
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
  const previousSnapshot = captureSkillSnapshot(state.currentSkill);

  insertCardAtDropPosition(zone, draggedCard, e.clientX, e.clientY);

  const updates = collectSkillUpdatesFromBoard(newTier);
  applySkillUpdates(state.currentSkill, updates);

  const saveSucceeded = await saveSkillUpdates(state.currentSkill, updates);

  if (!saveSucceeded) {
    restoreSkillSnapshot(state.currentSkill, previousSnapshot);
    renderBoard();
  }
}

async function saveSkillUpdates(skillKey, updates) {
  const revision = ++state.saveRevision;
  setStatus("SAVING...", "saving");
  
  try {
    const response = await fetch(`/api/skills/${skillKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        updates
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

function setupRatingMode() {
  document.getElementById("open-rating-screen-button").addEventListener("click", openRatingScreenForSelectedModel);
  document.getElementById("close-rating-screen-button").addEventListener("click", closeRatingScreen);
  document.getElementById("begin-rating-placement-button").addEventListener("click", beginRatingPlacement);
  document.getElementById("comparison-better-button").addEventListener("click", () => resolveComparison("better"));
  document.getElementById("comparison-worse-button").addEventListener("click", () => resolveComparison("worse"));
}

function populateRatingModelSelect() {
  const select = document.getElementById("rating-model-select");
  select.innerHTML = "";

  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Select model";
  select.appendChild(option);

  Object.entries(state.models)
    .sort((leftEntry, rightEntry) => compareModelNames(leftEntry[1], rightEntry[1], leftEntry[0], rightEntry[0]))
    .forEach(([modelId, modelData]) => {
      const nextOption = document.createElement("option");
      nextOption.value = modelId;
      nextOption.textContent = modelData.display_name || modelId;
      select.appendChild(nextOption);
    });
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

function createSkillBuckets(skillKey) {
  const buckets = new Map(TIERS.map(tier => [tier.value, []]));
  buckets.set("unrated", []);

  Object.entries(state.models).forEach(([modelId, modelData]) => {
    const score = modelData.skills?.[skillKey];
    const bucketKey = Number.isFinite(score) ? getTierValueForScore(score) : "unrated";

    buckets.get(bucketKey).push({
      modelId,
      modelData,
      score
    });
  });

  TIERS.forEach(tier => {
    buckets.get(tier.value).sort(compareTierEntries);
  });

  buckets.get("unrated").sort(compareUnratedEntries);

  return buckets;
}

function getTierValueForScore(score) {
  const normalizedScore = Math.max(0, Math.min(10, score));
  return Math.floor(normalizedScore + TIER_SPAN);
}

function compareTierEntries(leftEntry, rightEntry) {
  const leftScore = Number.isFinite(leftEntry.score) ? leftEntry.score : -1;
  const rightScore = Number.isFinite(rightEntry.score) ? rightEntry.score : -1;

  if (rightScore !== leftScore) {
    return rightScore - leftScore;
  }

  return compareModelNames(leftEntry.modelData, rightEntry.modelData, leftEntry.modelId, rightEntry.modelId);
}

function compareUnratedEntries(leftEntry, rightEntry) {
  return compareModelNames(leftEntry.modelData, rightEntry.modelData, leftEntry.modelId, rightEntry.modelId);
}

function compareModelNames(leftModelData, rightModelData, leftModelId, rightModelId) {
  const leftName = leftModelData.display_name || leftModelId;
  const rightName = rightModelData.display_name || rightModelId;
  return leftName.localeCompare(rightName);
}

function insertCardAtDropPosition(zone, card, clientX, clientY) {
  const insertBeforeCard = getDropInsertReference(zone, clientX, clientY);

  if (insertBeforeCard) {
    zone.insertBefore(card, insertBeforeCard);
    return;
  }

  zone.appendChild(card);
}

function getDropInsertReference(zone, clientX, clientY) {
  const cards = Array.from(zone.querySelectorAll(".model-card:not(.dragging)"));

  return cards.find(card => {
    const rect = card.getBoundingClientRect();
    const isAboveCardMidpoint = clientY < rect.top + rect.height / 2;
    const isWithinCardRow = clientY <= rect.bottom;
    const isLeftOfCardMidpoint = clientX < rect.left + rect.width / 2;

    return isAboveCardMidpoint || (isWithinCardRow && isLeftOfCardMidpoint);
  }) ?? null;
}

function collectSkillUpdatesFromBoard() {
  const updates = [];

  TIERS.forEach(tier => {
    const zone = document.querySelector(`.tier-dropzone[data-tier="${tier.value}"]`);
    const modelIds = Array.from(zone.children).map(card => card.dataset.id);
    const interpolatedValues = interpolateTierScores(tier.value, modelIds.length);

    modelIds.forEach((modelId, index) => {
      updates.push({
        modelId,
        value: interpolatedValues[index]
      });
    });
  });

  const unratedIds = Array.from(document.getElementById("unrated-pool").children).map(card => card.dataset.id);
  unratedIds.forEach(modelId => {
    updates.push({
      modelId,
      value: null
    });
  });

  return updates;
}

function openRatingScreenForSelectedModel() {
  const modelId = document.getElementById("rating-model-select").value;

  if (!modelId) {
    setRatingHelperText("Pick a model to place.");
    return;
  }

  openRatingScreen(modelId);
}

function openRatingScreen(modelId) {
  state.ratingSession = {
    modelId,
    pendingSkills: [],
    updates: []
  };

  document.getElementById("tierlist-screen").classList.remove("screen-active");
  document.getElementById("tierlist-screen").classList.add("hidden");
  document.getElementById("rating-screen").classList.remove("hidden");
  document.getElementById("rating-screen").classList.add("screen-active");

  document.getElementById("rating-screen-title").textContent = getModelDisplayName(modelId);
  renderRatingSpotlight(modelId);
  renderRatingSkillForm(modelId);
  showRatingStage("form");
  resetRatingHelperText();
}

function closeRatingScreen() {
  state.ratingSession = null;
  document.getElementById("rating-screen").classList.add("hidden");
  document.getElementById("rating-screen").classList.remove("screen-active");
  document.getElementById("tierlist-screen").classList.remove("hidden");
  document.getElementById("tierlist-screen").classList.add("screen-active");
  showRatingStage("form");
}

function renderRatingSpotlight(modelId) {
  const spotlight = document.getElementById("rating-model-spotlight");
  spotlight.innerHTML = "";
  spotlight.appendChild(createModelCard(modelId, state.models[modelId]));
}

function renderRatingSkillForm(modelId) {
  const container = document.getElementById("rating-skill-form");
  container.innerHTML = "";

  Object.entries(state.skills).forEach(([skillKey, skillData]) => {
    const row = document.createElement("div");
    row.className = "rating-skill-row";

    const meta = document.createElement("div");
    meta.className = "rating-skill-meta";

    const title = document.createElement("strong");
    title.textContent = formatSkillLabel(skillKey);

    const description = document.createElement("p");
    description.className = "rating-skill-description";
    description.textContent = skillData.description || "";

    meta.appendChild(title);
    meta.appendChild(description);

    const controls = document.createElement("div");
    controls.className = "rating-skill-controls";

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "10";
    input.step = "0.1";
    input.className = "rating-input";
    input.dataset.skill = skillKey;
    const existingValue = state.models[modelId]?.skills?.[skillKey];
    if (Number.isFinite(existingValue)) {
      input.value = existingValue;
    }

    const unratedLabel = document.createElement("label");
    unratedLabel.className = "rating-unrated-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.skillUnrated = skillKey;
    checkbox.checked = !Number.isFinite(existingValue);
    checkbox.addEventListener("change", () => {
      input.disabled = checkbox.checked;
      if (checkbox.checked) {
        input.value = "";
      }
    });

    input.disabled = checkbox.checked;

    unratedLabel.appendChild(checkbox);
    unratedLabel.appendChild(document.createTextNode("Leave unrated"));

    controls.appendChild(input);
    controls.appendChild(unratedLabel);

    row.appendChild(meta);
    row.appendChild(controls);
    container.appendChild(row);
  });
}

async function beginRatingPlacement() {
  if (!state.ratingSession) {
    return;
  }

  const pendingSkills = [];
  const explicitUpdates = [];

  for (const skillKey of Object.keys(state.skills)) {
    const unratedCheckbox = document.querySelector(`[data-skill-unrated="${skillKey}"]`);
    const input = document.querySelector(`[data-skill="${skillKey}"]`);

    if (unratedCheckbox.checked) {
      explicitUpdates.push({ skillKey, value: null, insertIndex: null, targetTier: null });
      continue;
    }

    const inputValue = Number.parseFloat(input.value);
    if (!Number.isFinite(inputValue) || inputValue < 0 || inputValue > 10) {
      setRatingHelperText(`Enter a valid score between 0 and 10 for ${formatSkillLabel(skillKey)}.`);
      return;
    }

    const targetTier = getTierValueForScore(inputValue);
    const skillBuckets = createSkillBuckets(skillKey);
    const candidateIds = (skillBuckets.get(targetTier) ?? [])
      .map(entry => entry.modelId)
      .filter(existingModelId => existingModelId !== state.ratingSession.modelId);

    pendingSkills.push({
      skillKey,
      inputScore: inputValue,
      targetTier,
      candidateIds,
      low: 0,
      high: candidateIds.length - 1,
      insertIndex: candidateIds.length
    });
  }

  state.ratingSession.pendingSkills = pendingSkills;
  state.ratingSession.updates = explicitUpdates;

  showRatingStage("compare");
  advanceRatingPlacement();
}

async function advanceRatingPlacement() {
  if (!state.ratingSession) {
    return;
  }

  while (state.ratingSession.pendingSkills.length > 0) {
    const placement = state.ratingSession.pendingSkills[0];

    if (placement.candidateIds.length === 0) {
      placement.insertIndex = 0;
      state.ratingSession.updates.push(placement);
      state.ratingSession.pendingSkills.shift();
      continue;
    }

    if (placement.low > placement.high) {
      placement.insertIndex = placement.low;
      state.ratingSession.updates.push(placement);
      state.ratingSession.pendingSkills.shift();
      continue;
    }

    placement.mid = Math.floor((placement.low + placement.high) / 2);
    const referenceModelId = placement.candidateIds[placement.mid];

    document.getElementById("comparison-title").textContent = `${formatSkillLabel(placement.skillKey)} · ${getTierLabel(placement.targetTier)}`;
    document.getElementById("comparison-body").textContent = `Is ${getModelDisplayName(state.ratingSession.modelId)} better or worse than ${getModelDisplayName(referenceModelId)} for ${formatSkillLabel(placement.skillKey)}?`;
    document.getElementById("comparison-candidate-name").textContent = getModelDisplayName(state.ratingSession.modelId);
    document.getElementById("comparison-reference-name").textContent = getModelDisplayName(referenceModelId);
    return;
  }

  await commitRatingSession();
}

function resolveComparison(direction) {
  if (!state.ratingSession || state.ratingSession.pendingSkills.length === 0) {
    return;
  }

  const placement = state.ratingSession.pendingSkills[0];

  if (direction === "better") {
    placement.high = placement.mid - 1;
  }

  if (direction === "worse") {
    placement.low = placement.mid + 1;
  }

  advanceRatingPlacement();
}

async function commitRatingSession() {
  if (!state.ratingSession) {
    return;
  }

  const modelId = state.ratingSession.modelId;
  const previousSnapshot = captureModelSnapshot(modelId);

  try {
    for (const placement of state.ratingSession.updates) {
      await placeModelAtTierIndex(modelId, placement.skillKey, placement.targetTier, placement.insertIndex, placement.inputScore, false);
    }

    closeRatingScreen();
    renderBoard();
  } catch (error) {
    restoreModelSnapshot(modelId, previousSnapshot);
    renderBoard();
    setRatingHelperText(`Failed to save ${getModelDisplayName(modelId)} across all skills.`);
    showRatingStage("form");
  }
}

async function placeModelAtTierIndex(modelId, skillKey, targetTier, insertIndex, inputScore, rerender = true) {
  const previousSnapshot = captureSkillSnapshot(skillKey);
  const updates = buildSkillUpdatesForPlacement(skillKey, modelId, targetTier, insertIndex);
  applySkillUpdates(skillKey, updates);

  const saveSucceeded = await saveSkillUpdates(skillKey, updates);

  if (!saveSucceeded) {
    restoreSkillSnapshot(skillKey, previousSnapshot);
    if (rerender) {
      renderBoard();
    }
    throw new Error(`Failed to place ${getModelDisplayName(modelId)} for ${skillKey} from a ${formatScore(inputScore)} rating.`);
  }

  if (rerender && skillKey === state.currentSkill) {
    renderBoard();
  }

  return true;
}

function setRatingHelperText(text) {
  document.getElementById("rating-helper-text").textContent = text;
}

function resetRatingHelperText() {
  setRatingHelperText(RATING_HELPER_DEFAULT);
}

function getTierLabel(tierValue) {
  return TIERS.find(tier => tier.value === tierValue)?.label ?? "Unknown";
}

function getModelDisplayName(modelId) {
  return state.models[modelId]?.display_name || modelId;
}

function formatScore(value) {
  return `${Number(value.toFixed(2))}/10`;
}

function interpolateTierScores(tierValue, itemCount) {
  if (itemCount === 0) {
    return [];
  }

  if (itemCount === 1) {
    return [tierValue];
  }

  const lowerBound = Math.max(tierValue - TIER_SPAN, 0);
  const step = (tierValue - lowerBound) / (itemCount - 1);

  return Array.from({ length: itemCount }, (_, index) => roundScore(tierValue - step * index));
}

function roundScore(value) {
  return Number(value.toFixed(SCORE_DECIMALS));
}

function applySkillUpdates(skillKey, updates) {
  updates.forEach(({ modelId, value }) => {
    const existingModel = state.models[modelId];
    const nextSkills = {
      ...(existingModel.skills || {})
    };

    if (value === null) {
      delete nextSkills[skillKey];
    } else {
      nextSkills[skillKey] = value;
    }

    existingModel.skills = nextSkills;
  });
}

function captureSkillSnapshot(skillKey) {
  return Object.fromEntries(
    Object.entries(state.models).map(([modelId, modelData]) => [modelId, modelData.skills?.[skillKey]])
  );
}

function captureModelSnapshot(modelId) {
  return {
    ...state.models[modelId],
    skills: {
      ...(state.models[modelId]?.skills || {})
    }
  };
}

function restoreModelSnapshot(modelId, snapshot) {
  state.models[modelId] = {
    ...snapshot,
    skills: {
      ...(snapshot.skills || {})
    }
  };
}

function showRatingStage(stage) {
  document.getElementById("rating-form-stage").classList.toggle("hidden", stage !== "form");
  document.getElementById("rating-compare-stage").classList.toggle("hidden", stage !== "compare");
}

function getThresholdGroupsForSkill(skillKey) {
  const groups = new Map();

  state.roles.forEach(role => {
    const requiredValue = role.required_skills?.[skillKey];
    if (!Number.isFinite(requiredValue)) {
      return;
    }

    const tierValue = Math.max(0, Math.min(10, Math.round(requiredValue)));
    const existingGroup = groups.get(tierValue) ?? [];
    existingGroup.push({
      roleName: role.name,
      requiredValue
    });
    groups.set(tierValue, existingGroup);
  });

  return groups;
}

function createThresholdGuide(tierValue, entries) {
  if (entries.length === 0) {
    return null;
  }

  const guide = document.createElement("div");
  guide.className = "tier-threshold-guide";

  const line = document.createElement("div");
  line.className = "tier-threshold-line";

  const labels = document.createElement("div");
  labels.className = "tier-threshold-labels";

  entries
    .sort((leftEntry, rightEntry) => leftEntry.roleName.localeCompare(rightEntry.roleName))
    .forEach(entry => {
      const badge = document.createElement("span");
      badge.className = "tier-threshold-badge";
      badge.textContent = `${entry.roleName} ≥ ${entry.requiredValue}`;
      labels.appendChild(badge);
    });

  guide.appendChild(line);
  guide.appendChild(labels);
  guide.title = `Required threshold at ${getTierLabel(tierValue)}`;
  return guide;
}

function buildSkillUpdatesForPlacement(skillKey, modelId, targetTier, insertIndex) {
  const skillBuckets = createSkillBuckets(skillKey);

  TIERS.forEach(tier => {
    const entries = skillBuckets.get(tier.value) ?? [];
    skillBuckets.set(tier.value, entries.filter(entry => entry.modelId !== modelId));
  });

  const unratedEntries = skillBuckets.get("unrated") ?? [];
  skillBuckets.set("unrated", unratedEntries.filter(entry => entry.modelId !== modelId));

  if (targetTier === null) {
    skillBuckets.get("unrated").push({
      modelId,
      modelData: state.models[modelId],
      score: null
    });
  } else {
    const targetEntries = [...(skillBuckets.get(targetTier) ?? [])];
    const boundedIndex = Math.max(0, Math.min(insertIndex, targetEntries.length));

    targetEntries.splice(boundedIndex, 0, {
      modelId,
      modelData: state.models[modelId],
      score: targetTier
    });

    skillBuckets.set(targetTier, targetEntries);
  }

  return buildSkillUpdatesFromBuckets(skillBuckets);
}

function buildSkillUpdatesFromBuckets(skillBuckets) {
  const updates = [];

  TIERS.forEach(tier => {
    const tierEntries = skillBuckets.get(tier.value) ?? [];
    const interpolatedValues = interpolateTierScores(tier.value, tierEntries.length);

    tierEntries.forEach((entry, index) => {
      updates.push({
        modelId: entry.modelId,
        value: interpolatedValues[index]
      });
    });
  });

  (skillBuckets.get("unrated") ?? []).forEach(entry => {
    updates.push({
      modelId: entry.modelId,
      value: null
    });
  });

  return updates;
}

function restoreSkillSnapshot(skillKey, snapshot) {
  Object.entries(state.models).forEach(([modelId, modelData]) => {
    const nextSkills = {
      ...(modelData.skills || {})
    };
    const savedValue = snapshot[modelId];

    if (savedValue === undefined) {
      delete nextSkills[skillKey];
    } else {
      nextSkills[skillKey] = savedValue;
    }

    modelData.skills = nextSkills;
  });
}
