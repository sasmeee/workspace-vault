const APP_NAME = "Workspace Vault";
const ROOT_NAME = "Saved Tab Groups";

const COLOR_HEX = {
  grey: "#5f6368",
  blue: "#1a73e8",
  red: "#d93025",
  yellow: "#f9ab00",
  green: "#188038",
  pink: "#d01884",
  purple: "#a142f4",
  cyan: "#007b83",
  orange: "#fa903e",
};

async function getCurrentWindowId() {
  const win = await chrome.windows.getCurrent();
  return win.id;
}

async function getBaseFolder() {
  const tree = await chrome.bookmarks.getTree();

  const topLevel = tree[0].children;

  const other = topLevel.find((c) => /other/i.test(c.title));

  return other || topLevel[0];
}

async function getRootFolder() {
  const base = await getBaseFolder();

  const children = await chrome.bookmarks.getChildren(base.id);

  let root = children.find((c) => c.title === ROOT_NAME && !c.url);

  if (!root) {
    root = await chrome.bookmarks.create({
      parentId: base.id,
      title: ROOT_NAME,
    });
  }

  return root;
}

async function saveGroup(group) {
  const tabs = await chrome.tabs.query({
    groupId: group.id,
  });

  const savable = tabs.filter(
    (t) =>
      t.url && !t.url.startsWith("chrome://") && !t.url.startsWith("edge://"),
  );

  if (savable.length === 0) {
    return null;
  }

  const root = await getRootFolder();

  const folder = await chrome.bookmarks.create({
    parentId: root.id,
    title: group.title || "Untitled Tab Group",
  });

  for (const tab of savable) {
    await chrome.bookmarks.create({
      parentId: folder.id,
      title: tab.title || tab.url,
      url: tab.url,
    });
  }

  await chrome.storage.local.set({
    ["meta_" + folder.id]: {
      color: group.color,
    },
  });

  return folder;
}

async function restoreGroup(folder) {
  const children = await chrome.bookmarks.getChildren(folder.id);

  const urls = children.filter((c) => c.url).map((c) => c.url);

  if (urls.length === 0) {
    return;
  }

  const win = await chrome.windows.create({
    url: urls[0],
    focused: true,
  });

  const tabIds = [win.tabs[0].id];

  for (let i = 1; i < urls.length; i++) {
    const tab = await chrome.tabs.create({
      windowId: win.id,
      url: urls[i],
    });

    tabIds.push(tab.id);
  }

  const groupId = await chrome.tabs.group({
    tabIds,
    createProperties: {
      windowId: win.id,
    },
  });

  const stored = await chrome.storage.local.get("meta_" + folder.id);

  const color = stored["meta_" + folder.id]?.color || "grey";

  await chrome.tabGroups.update(groupId, {
    title: folder.title,
    color,
  });
}

async function deleteGroup(folder) {
  await chrome.bookmarks.removeTree(folder.id);

  await chrome.storage.local.remove("meta_" + folder.id);
}

async function renderCurrentGroups() {
  const windowId = await getCurrentWindowId();

  const groups = await chrome.tabGroups.query({
    windowId,
  });

  const container = document.getElementById("current-groups");

  container.innerHTML = "";

  if (groups.length === 0) {
    container.innerHTML = "<p class='empty'>No tab groups in this window.</p>";

    return;
  }

  for (const group of groups) {
    const row = document.createElement("div");

    row.className = "group-row";

    row.innerHTML = `
      <span class="dot"
        style="background:${COLOR_HEX[group.color] || "#5f6368"}">
      </span>

      <span class="title">
        ${escapeHtml(group.title || "Untitled")}
      </span>

      <button class="save-btn"
        data-id="${group.id}">
        Save
      </button>
    `;

    container.appendChild(row);
  }

  container.querySelectorAll(".save-btn").forEach((button) => {
    button.addEventListener("click", async (e) => {
      const id = parseInt(e.target.dataset.id, 10);

      const group = groups.find((g) => g.id === id);

      e.target.disabled = true;

      e.target.textContent = "Saving...";

      const folder = await saveGroup(group);

      e.target.textContent = folder ? "Saved ✓" : "Empty";

      await renderSavedGroups();
    });
  });
}

async function renderSavedGroups() {
  const root = await getRootFolder();

  const children = await chrome.bookmarks.getChildren(root.id);

  const container = document.getElementById("saved-groups");

  container.innerHTML = "";

  if (children.length === 0) {
    container.innerHTML = "<p class='empty'>No saved tab groups yet.</p>";

    return;
  }

  for (const folder of children) {
    const row = document.createElement("div");

    row.className = "group-row";

    row.innerHTML = `
      <span class="title">
        ${escapeHtml(folder.title)}
      </span>

      <button class="restore-btn">
        Restore
      </button>

      <button class="delete-btn">
        ✕
      </button>
    `;

    row
      .querySelector(".restore-btn")
      .addEventListener("click", () => restoreGroup(folder));

    row.querySelector(".delete-btn").addEventListener("click", async () => {
      await deleteGroup(folder);

      await renderSavedGroups();
    });

    container.appendChild(row);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");

  div.textContent = str;

  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
  renderCurrentGroups();

  renderSavedGroups();
});
