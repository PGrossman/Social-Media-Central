const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("http");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store").default;
const exifr = require("exifr");
const Database = require("better-sqlite3");

// Global window reference for IPC from HTTP bridge
let mainWindowInstance = null;

// RAG Memory DB Initialization
let db;

function initializeDatabase() {
  if (db) {
    try { db.close(); } catch (e) { console.error("Error closing existing DB:", e); }
  }

  const customDbPath = store.get("aiDbPath", "");
  let dbDir = app.getPath('userData');

  if (customDbPath && fs.existsSync(customDbPath)) {
    // Basic verification it's a directory
    const stat = fs.statSync(customDbPath);
    if (stat.isDirectory()) {
      dbDir = customDbPath;
    } else {
      console.warn("Custom DB path is not a directory. Falling back to userData.");
    }
  }

  const dbPath = path.join(dbDir, 'analytics_memory.sqlite');
  console.log(`Initializing SQLite database at: ${dbPath}`);

  db = new Database(dbPath);

  // Initialize Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      platform TEXT,
      message TEXT,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      reach INTEGER DEFAULT 0,
      engagement_score REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Safe migrations for existing DB
  try { db.exec("ALTER TABLE posts ADD COLUMN reach INTEGER DEFAULT 0"); } catch (e) { }
  // Note: SQLite doesn't easily alter column types (engagement_score INTEGER -> REAL), but it has weak typing so REAL values will store fine in an INTEGER column.
}

const store = new Store({
  defaults: {
    apiKey: "",
    handleMap: [],
    totalCost: 0,
    costStartDate: new Date().toLocaleDateString(),
    metaAccessToken: "",
    metaPageId: "",
    metaIgAccountId: "",
    imgurClientId: "",
    aiCommentWeight: 5,
    aiInjectionCount: 3,
    aiMinReach: 50,
    aiDbPath: "",
  },
});

function calculateCost(modelName, usage) {
  if (!usage) return 0;
  const input = usage.promptTokenCount || 0;
  const output = usage.candidatesTokenCount || 0;

  let inputRate = 0;
  let outputRate = 0;

  const model = modelName.toLowerCase();
  if (model.includes("pro")) {
    inputRate = 1.25 / 1_000_000;
    outputRate = 5.00 / 1_000_000;
  } else if (model.includes("flash")) {
    // Both 1.5 and 2.0 Flash have similar low pricing tiers
    inputRate = 0.10 / 1_000_000;
    outputRate = 0.30 / 1_000_000;
  } else {
    // Default fallback
    inputRate = 0.10 / 1_000_000;
    outputRate = 0.30 / 1_000_000;
  }

  return (input * inputRate) + (output * outputRate);
}

function updateStoredCost(amount) {
  const current = store.get("totalCost", 0);
  store.set("totalCost", current + amount);
}

function createWindow() {
  const savedBounds = store.get("windowBounds", null);
  const opts = {
    width: 1340,
    height: 860,
    minWidth: 1060,
    minHeight: 680,
    title: "Social Media Central",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (savedBounds) {
    opts.x = savedBounds.x;
    opts.y = savedBounds.y;
    opts.width = savedBounds.width;
    opts.height = savedBounds.height;
  }

  const mainWindow = new BrowserWindow(opts);
  mainWindowInstance = mainWindow;

  mainWindow.on("close", () => {
    store.set("windowBounds", mainWindow.getBounds());
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function startLightroomBridgeServer() {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/lightroom-export") {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", async () => {
        try {
          const body = Buffer.concat(chunks).toString("utf-8");
          const payload = JSON.parse(body);

          const base64Images = (payload.imagePaths || []).map((filePath) => {
            const fileBuffer = fs.readFileSync(filePath);
            return `data:image/jpeg;base64,${fileBuffer.toString("base64")}`;
          });

          let lrMetadata = payload.metadata || {};

          // If Lua failed to get metadata (catalog locks), rip it from the JPG's EXIF/IPTC/XMP
          if (payload.imagePaths && payload.imagePaths.length > 0) {
            try {
              const firstImagePath = payload.imagePaths[0];
              const fileBuffer = fs.readFileSync(firstImagePath);

              const parsedExif = await exifr.parse(fileBuffer, { iptc: true, xmp: true, exif: true });

              if (parsedExif) {
                const title = parsedExif.ObjectName || parsedExif.Title || parsedExif.headline || "";
                const caption = parsedExif.Caption || parsedExif.ImageDescription || parsedExif.description || "";
                let keywords = parsedExif.Keywords || parsedExif.subject || [];

                if (typeof keywords === 'string') keywords = keywords.split(',').map(s => s.trim());

                // Overwrite Lua's empty placeholders with the real file data
                if (!lrMetadata.title || lrMetadata.title === "") lrMetadata.title = title;
                if (!lrMetadata.caption || lrMetadata.caption === "") lrMetadata.caption = caption;
                if (!lrMetadata.keywords || lrMetadata.keywords.length === 0) lrMetadata.keywords = keywords;
              }
            } catch (e) {
              console.error("Failed to parse EXIF from JPG:", e);
            }
          }

          const frontendPayload = {
            images: base64Images,
            metadata: lrMetadata,
          };

          if (mainWindowInstance && !mainWindowInstance.isDestroyed()) {
            mainWindowInstance.webContents.send("lightroom-data", frontendPayload);
            if (mainWindowInstance.isMinimized()) {
              mainWindowInstance.restore();
            }
            mainWindowInstance.focus();
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: "Payload received." }));
        } catch (err) {
          console.error("Lightroom bridge error:", err);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.on('error', (err) => {
    dialog.showErrorBox(
      'Bridge Server Error',
      `Social Media Central failed to start the local Lightroom bridge.\n\nError: ${err.message}`
    );
  });

  server.listen(49152, () => {
    console.log("Lightroom bridge server listening on port 49152");
  });
}

ipcMain.handle("settings:get", () => {
  return {
    apiKey: store.get("apiKey", ""),
    handleMap: store.get("handleMap", []),
    totalCost: store.get("totalCost", 0),
    costStartDate: store.get("costStartDate", new Date().toLocaleDateString()),
    metaAccessToken: store.get("metaAccessToken", ""),
    metaPageId: store.get("metaPageId", ""),
    metaIgAccountId: store.get("metaIgAccountId", ""),
    aiCommentWeight: store.get("aiCommentWeight", 5),
    aiInjectionCount: store.get("aiInjectionCount", 3),
    aiMinReach: store.get("aiMinReach", 50),
    aiDbPath: store.get("aiDbPath", ""),
  };
});

ipcMain.handle("cost:reset", () => {
  const now = new Date().toLocaleDateString();
  store.set("totalCost", 0);
  store.set("costStartDate", now);
  return { totalCost: 0, costStartDate: now };
});

ipcMain.handle("settings:saveApiKey", (_event, apiKey) => {
  store.set("apiKey", apiKey);
  return true;
});

ipcMain.handle("settings:saveHandleMap", (_event, handleMap) => {
  store.set("handleMap", handleMap);
  return true;
});

ipcMain.handle("settings:saveMetaCreds", (_event, { accessToken, pageId, igAccountId }) => {
  store.set("metaAccessToken", accessToken);
  store.set("metaPageId", pageId);
  store.set("metaIgAccountId", igAccountId);
  return true;
});

ipcMain.handle("settings:saveAIParams", (_event, { aiCommentWeight, aiInjectionCount, aiMinReach, aiDbPath }) => {
  store.set("aiCommentWeight", aiCommentWeight);
  store.set("aiInjectionCount", aiInjectionCount);
  store.set("aiMinReach", aiMinReach);
  if (aiDbPath !== undefined) {
    store.set("aiDbPath", aiDbPath);
    // Re-initialize DB on the new path
    initializeDatabase();
  }
  return true;
});

ipcMain.handle("settings:selectDirectory", async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select Database Folder'
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle("meta:fetchAnalytics", async () => {
  const accessToken = store.get("metaAccessToken", "");
  const pageId = store.get("metaPageId", "");
  const igAccountId = store.get("metaIgAccountId", "");

  if (!accessToken || (!igAccountId && !pageId)) {
    return { success: false, error: "Meta credentials missing (Access Token and at least one Account/Page ID required)." };
  }

  let igData = { insights: [], demographics: [], media: [] };
  let fbData = { insights: [], demographics: [], media: [] };
  let igError = null;
  let fbError = null;

  if (igAccountId) {
    try {
      // 1. Fetch Instagram Account Insights (Reach, Views) and User fields (Followers)
      const igUserUrl = `https://graph.facebook.com/v19.0/${igAccountId}?fields=followers_count&access_token=${accessToken}`;
      const igBasicUrl = `https://graph.facebook.com/v19.0/${igAccountId}/insights?metric=reach&period=day&access_token=${accessToken}`;
      const igViewsUrl = `https://graph.facebook.com/v19.0/${igAccountId}/insights?metric=views&metric_type=total_value&period=day&access_token=${accessToken}`;
      const igDemoAgeUrl = `https://graph.facebook.com/v19.0/${igAccountId}/insights?metric=follower_demographics&metric_type=total_value&breakdown=age&period=lifetime&access_token=${accessToken}`;
      const igDemoGenderUrl = `https://graph.facebook.com/v19.0/${igAccountId}/insights?metric=follower_demographics&metric_type=total_value&breakdown=gender&period=lifetime&access_token=${accessToken}`;

      const mediaFields = "id,caption,media_type,media_url,timestamp,like_count,comments_count,insights.metric(reach,total_interactions)";
      const mediaUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media?fields=${mediaFields}&limit=10&access_token=${accessToken}`;

      const [userRes, basicRes, viewsRes, demoAgeRes, demoGenderRes, mediaRes] = await Promise.all([
        fetch(igUserUrl).then(r => r.json()),
        fetch(igBasicUrl).then(r => r.json()),
        fetch(igViewsUrl).then(r => r.json()),
        fetch(igDemoAgeUrl).then(r => r.json()),
        fetch(igDemoGenderUrl).then(r => r.json()),
        fetch(mediaUrl).then(r => r.json())
      ]);

      if (basicRes.error) throw new Error(basicRes.error.message);
      if (viewsRes.error) throw new Error(viewsRes.error.message);
      // Demographics might fail safely, just log it.

      const combinedInsights = [...(basicRes.data || []), ...(viewsRes.data || [])];

      if (userRes.followers_count !== undefined) {
        combinedInsights.push({
          name: 'follower_count',
          period: 'lifetime',
          values: [{ value: userRes.followers_count, end_time: new Date().toISOString() }]
        });
      }

      // Combine age and gender into a structure similar to audience_gender_age for the frontend
      const constructedGenderAge = {};
      const ageResults = demoAgeRes?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      const genderResults = demoGenderRes?.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];

      ageResults.forEach(r => { constructedGenderAge[`U.${r.dimension_values[0]}`] = r.value; });
      genderResults.forEach(r => { constructedGenderAge[`${r.dimension_values[0]}.Unknown`] = r.value; });

      igData = {
        insights: combinedInsights,
        demographics: [{ name: 'follower_demographics', values: [{ value: { gender_age: constructedGenderAge } }] }],
        media: mediaRes.data || []
      };
    } catch (err) {
      igError = err.message;
    }
  } else {
    igError = "Instagram Account ID not configured.";
  }

  if (pageId) {
    try {
      // Facebook Insights require a Page Access Token, not the User Access Token
      const pageTokenUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${accessToken}`;
      const pageTokenRes = await fetch(pageTokenUrl).then(r => r.json());

      if (pageTokenRes.error) {
        throw new Error(`Page Token Error: ${pageTokenRes.error.message}`);
      }

      const pageAccessToken = pageTokenRes.access_token || accessToken;

      // Facebook metrics
      // 1. Fans/Followers (Fields API)
      const fbFansUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=followers_count,fan_count&access_token=${pageAccessToken}`;

      // 2. Insights (page_impressions_unique is valid, others deprecated)
      const fbInsightsUrl = `https://graph.facebook.com/v19.0/${pageId}/insights?metric=page_impressions_unique&period=day&access_token=${pageAccessToken}`;

      // 3. Posts
      const fbPostsUrl = `https://graph.facebook.com/v19.0/${pageId}/published_posts?fields=id,message,created_time,attachments&limit=10&access_token=${pageAccessToken}`;

      const [fbFansRes, fbInsightsRes, fbPostsRes] = await Promise.all([
        fetch(fbFansUrl).then(r => r.json()),
        fetch(fbInsightsUrl).then(r => r.json()),
        fetch(fbPostsUrl).then(r => r.json())
      ]);

      if (fbFansRes.error) throw new Error(`FB Fans Error: ${fbFansRes.error.message}`);
      if (fbInsightsRes.error) throw new Error(`FB Insights Error: ${fbInsightsRes.error.message}`);

      // Map FB fields into insight structure to match frontend expectations
      let fbInsightsList = fbInsightsRes.data || [];
      if (fbFansRes.followers_count !== undefined) {
        fbInsightsList.push({
          name: 'page_fans',
          period: 'lifetime',
          values: [{ value: fbFansRes.followers_count, end_time: new Date().toISOString() }]
        });
      }

      fbData = {
        insights: fbInsightsList,
        demographics: [], // Currently disabled due to deprecation
        media: fbPostsRes.data || []
      };
    } catch (err) {
      fbError = err.message;
    }
  } else {
    fbError = "Facebook Page ID not configured.";
  }

  if (igError && fbError) {
    return { success: false, error: `IG Error: ${igError} | FB Error: ${fbError}` };
  }

  return {
    success: true,
    data: {
      instagram: igData,
      facebook: fbData,
      errors: { instagram: igError, facebook: fbError }
    }
  };
});

ipcMain.handle("meta:publishPost", async (_event, payload) => {
  const accessToken = store.get("metaAccessToken", "");
  const pageId = store.get("metaPageId", "");
  const igAccountId = store.get("metaIgAccountId", "");

  if (!accessToken) {
    return { success: false, error: "Meta Access Token is missing." };
  }

  try {
    if (payload.platform === "meta") {
      const { fbMessage, igMessage, imageBase64 } = payload;
      if (!pageId || !igAccountId) return { success: false, error: "Both FB Page ID and IG Account ID are required for Meta posting." };
      if (!imageBase64) return { success: false, error: "An image is required to post to Instagram." };

      const pageTokenUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${accessToken}`;
      const pageTokenRes = await fetch(pageTokenUrl).then(r => r.json());
      if (pageTokenRes.error) throw new Error(`Page Token Error: ${pageTokenRes.error.message}`);
      const pageAccessToken = pageTokenRes.access_token || accessToken;

      // STEP 1: Upload to Facebook
      const formData = new FormData();
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      formData.append("source", new Blob([buffer], { type: "image/jpeg" }), "upload.jpg");
      if (fbMessage) formData.append("message", fbMessage);
      formData.append("access_token", pageAccessToken);
      formData.append("published", "true");

      const fbUrl = `https://graph.facebook.com/v19.0/${pageId}/photos`;
      const fbRes = await fetch(fbUrl, { method: "POST", body: formData }).then(r => r.json());
      if (fbRes.error) throw new Error(`FB Upload Error: ${fbRes.error.message}`);

      const photoId = fbRes.id;
      const postId = fbRes.post_id || fbRes.id;
      try {
        const insert = db.prepare('INSERT INTO posts (id, platform, message) VALUES (?, ?, ?)');
        insert.run(postId, 'facebook', fbMessage || '');
      } catch (e) { console.error("Failed to insert FB post into DB:", e); }

      // STEP 2: Fetch FB CDN URL
      const cdnUrlReq = `https://graph.facebook.com/v19.0/${photoId}?fields=images&access_token=${pageAccessToken}`;
      const cdnRes = await fetch(cdnUrlReq).then(r => r.json());
      if (cdnRes.error) throw new Error(`CDN Fetch Error: ${cdnRes.error.message}`);

      const images = cdnRes.images || [];
      if (images.length === 0) throw new Error("Could not find CDN URL for the uploaded Facebook photo.");
      const cdnUrl = images[0].source; // High-res image

      // STEP 3: Create IG Media Container using FB CDN URL
      const igContainerUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media`;
      const containerParams = new URLSearchParams({
        image_url: cdnUrl,
        caption: igMessage || "",
        access_token: accessToken
      });
      const containerRes = await fetch(igContainerUrl, { method: "POST", body: containerParams }).then(r => r.json());
      if (containerRes.error) throw new Error(`IG Container Error: ${containerRes.error.message}`);

      const creationId = containerRes.id;

      // STEP 4: Publish IG Container
      const igPublishUrl = `https://graph.facebook.com/v19.0/${igAccountId}/media_publish`;
      const publishParams = new URLSearchParams({
        creation_id: creationId,
        access_token: accessToken
      });

      // Poll up to 5 times (10 seconds total) for container to finish processing
      let publishRes;
      for (let i = 0; i < 5; i++) {
        // Wait 2 seconds before each attempt
        await new Promise(resolve => setTimeout(resolve, 2000));
        publishRes = await fetch(igPublishUrl, { method: "POST", body: publishParams }).then(r => r.json());

        if (!publishRes.error) break; // Success!

        // If it's still being processed (Error 9007), keep looping
        if (publishRes.error.code === 9007) {
          console.log(`IG Container ${creationId} still processing... attempt ${i + 1}/5`);
          continue;
        } else {
          // If it's a completely different error, stop immediately
          break;
        }
      }

      if (publishRes.error) {
        const errorDetails = publishRes.error.error_user_msg || publishRes.error.message;
        throw new Error(`IG Publish Error (${publishRes.error.code}): ${errorDetails}`);
      }

      const igFinalId = publishRes.id;
      try {
        const insert = db.prepare('INSERT INTO posts (id, platform, message) VALUES (?, ?, ?)');
        insert.run(igFinalId, 'instagram', igMessage || '');
      } catch (e) { console.error("Failed to insert IG post into DB:", e); }

      return { success: true, id: `${photoId},${igFinalId}` };

    } else if (payload.platform === "facebook") {
      const { message, imageBase64 } = payload;
      if (!pageId) return { success: false, error: "Facebook Page ID is missing." };

      const pageTokenUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${accessToken}`;
      const pageTokenRes = await fetch(pageTokenUrl).then(r => r.json());
      if (pageTokenRes.error) throw new Error(`Page Token Error: ${pageTokenRes.error.message}`);
      const pageAccessToken = pageTokenRes.access_token || accessToken;

      if (imageBase64) {
        // Facebook Photo Upload
        const formData = new FormData();
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        formData.append("source", new Blob([buffer], { type: "image/jpeg" }), "upload.jpg");
        if (message) formData.append("message", message);
        formData.append("access_token", pageAccessToken);
        formData.append("published", "true");

        const fbUrl = `https://graph.facebook.com/v19.0/${pageId}/photos`;
        const res = await fetch(fbUrl, { method: "POST", body: formData }).then(r => r.json());
        if (res.error) throw new Error(res.error.message);

        const finalId = res.post_id || res.id;
        try {
          const insert = db.prepare('INSERT INTO posts (id, platform, message) VALUES (?, ?, ?)');
          insert.run(finalId, 'facebook', message || '');
        } catch (e) { console.error("Failed to insert FB photo post into DB:", e); }

        return { success: true, id: finalId };
      } else {
        // Facebook Text-Only Feed Post
        const fbUrl = `https://graph.facebook.com/v19.0/${pageId}/feed`;
        const params = new URLSearchParams({ message, access_token: pageAccessToken });
        const res = await fetch(fbUrl, { method: "POST", body: params }).then(r => r.json());
        if (res.error) throw new Error(res.error.message);

        const finalId = res.id;
        try {
          const insert = db.prepare('INSERT INTO posts (id, platform, message) VALUES (?, ?, ?)');
          insert.run(finalId, 'facebook', message || '');
        } catch (e) { console.error("Failed to insert FB feed post into DB:", e); }

        return { success: true, id: finalId };
      }
    } else if (payload.platform === "instagram") {
      return { success: false, error: "Standalone Instagram posting is deprecated. Use the Meta cross-publish workflow instead." };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("meta:syncDatabaseAnalytics", async () => {
  const metaAccessToken = store.get("metaAccessToken", "");
  const pageId = store.get("metaPageId", "");

  if (!metaAccessToken) return { success: false, error: "Missing Meta Access Token" };

  try {
    const aiCommentWeight = Number(store.get("aiCommentWeight", 5));

    // 1. Fetch Page Access Token for FB posts
    let pageAccessToken = metaAccessToken;
    if (pageId) {
      const pageTokenUrl = `https://graph.facebook.com/v19.0/${pageId}?fields=access_token&access_token=${metaAccessToken}`;
      const pageTokenRes = await fetch(pageTokenUrl).then(r => r.json());
      if (pageTokenRes.access_token) {
        pageAccessToken = pageTokenRes.access_token;
      }
    }

    // 2. Fetch all posts from DB from the last 60 days
    const recentPosts = db.prepare("SELECT * FROM posts WHERE datetime(created_at) >= datetime('now', '-60 days')").all();

    let updatedCount = 0;

    for (const post of recentPosts) {
      try {
        let likes = 0;
        let comments = 0;
        let reach = 0;

        if (post.platform === 'instagram') {
          const igUrl = `https://graph.facebook.com/v19.0/${post.id}?fields=like_count,comments_count,insights.metric(reach)&access_token=${metaAccessToken}`;
          const igRes = await fetch(igUrl).then(r => r.json());
          if (igRes.error) {
            console.error(`IG Sync Error for post ${post.id}:`, igRes.error.message);
            continue;
          }
          likes = igRes.like_count || 0;
          comments = igRes.comments_count || 0;
          reach = igRes.insights?.data?.[0]?.values?.[0]?.value || 0;
        } else if (post.platform === 'facebook') {
          const fbUrl = `https://graph.facebook.com/v19.0/${post.id}?fields=likes.summary(total_count).limit(0),comments.summary(total_count).limit(0),insights.metric(post_impressions_unique)&access_token=${pageAccessToken}`;
          const fbRes = await fetch(fbUrl).then(r => r.json());
          if (fbRes.error) {
            console.error(`FB Sync Error for post ${post.id}:`, fbRes.error.message);
            continue;
          }
          likes = fbRes.likes?.summary?.total_count || 0;
          comments = fbRes.comments?.summary?.total_count || 0;
          reach = fbRes.insights?.data?.[0]?.values?.[0]?.value || 0;
        }

        let engagementScore = 0;
        if (reach > 0) {
          engagementScore = ((likes + (comments * aiCommentWeight)) / reach) * 1000;
        }

        const updateStmt = db.prepare('UPDATE posts SET likes = ?, comments = ?, reach = ?, engagement_score = ? WHERE id = ?');
        updateStmt.run(likes, comments, reach, engagementScore, post.id);
        updatedCount++;
      } catch (err) {
        console.error(`Failed to sync post ${post.id}`, err);
      }
    }

    return { success: true, updatedCount };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("meta:clearAiDatabase", async () => {
  try {
    const stmt = db.prepare('DELETE FROM posts');
    stmt.run();
    return { success: true };
  } catch (err) {
    console.error("Failed to clear AI Database:", err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("test-connection", async (_event, apiKey) => {
  try {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return { success: false, error: "API key is empty." };
    }
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: apiKey.trim(), apiVersion: "v1beta" });
    const pager = await ai.models.list();
    const modelNames = [];
    for await (const model of pager) {
      if (model.name) {
        modelNames.push(model.name);
      }
    }
    return { success: true, models: modelNames };
  } catch (err) {
    const message = err?.message || err?.toString?.() || "Invalid API key or network error.";
    return { success: false, error: message };
  }
});

ipcMain.handle("get-available-models", async (_event, apiKey) => {
  const FALLBACK = [
    { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
    { id: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
    { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
  ];
  try {
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return { success: true, models: FALLBACK };
    }
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: apiKey.trim(), apiVersion: "v1beta" });
    const pager = await ai.models.list();
    const list = [];
    for await (const m of pager) {
      if (!m.name) continue;
      const name = m.name;
      const isGemini = name.includes("gemini-3") || name.includes("gemini-2.5");
      const supportsGenerate =
        !m.supportedActions ||
        !m.supportedActions.length ||
        m.supportedActions.some((a) => a.toLowerCase().includes("generatecontent") || a === "generateContent");
      if (isGemini && supportsGenerate) {
        const id = name.replace(/^models\//, "");
        list.push({
          id,
          label: m.displayName || id,
        });
      }
    }
    list.sort((a, b) => a.label.localeCompare(b.label));
    return { success: true, models: list.length > 0 ? list : FALLBACK };
  } catch (err) {
    return {
      success: true,
      models: FALLBACK,
      error: err?.message || err?.toString?.(),
    };
  }
});

ipcMain.handle("extract-exif", async (_event, base64Image) => {
  try {
    const raw = base64Image.includes(",") ? base64Image.split(",")[1] : base64Image;
    const buffer = Buffer.from(raw, "base64");
    const output = await exifr.parse(buffer, true);
    return { success: true, exif: output };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("resolve-tags", async (_event, { apiKey, entities }) => {
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });

    const prompt = `Find the official social media handles(X / Twitter, Instagram, Facebook) for the following entities: ${entities.join(", ")}. 
    Return a JSON array of objects with keys: nickname, x_handle, ig_handle, fb_handle. 
    If you can't find one, leave it as an empty string. Output ONLY valid JSON.`;

    const result = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        tools: [{ googleSearch: {} }]
      }
    });

    const text = result.text || "";
    if (result.usageMetadata) {
      updateStoredCost(calculateCost("gemini-1.5-flash", result.usageMetadata));
    }
    const cleaned = text.replace(/```json|```/g, "").trim();
    return { success: true, handles: JSON.parse(cleaned) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle("settings:saveSingleHandle", (_event, handleEntry) => {
  const current = store.get("handleMap", []);
  const normalizedNickname = String(handleEntry.nickname || "").trim().toLowerCase();
  const next = [...current];
  const idx = next.findIndex(
    (entry) => String(entry.nickname || "").trim().toLowerCase() === normalizedNickname,
  );

  if (idx >= 0) {
    next[idx] = handleEntry;
  } else {
    next.push(handleEntry);
  }

  store.set("handleMap", next);
  return next;
});

function constructSystemPrompt(styles, tags, confirmedHandles) {
  const roleIdentity = `You are the personal ghostwriter for Philip Grossman. You are an expert adventure cinematographer, photographer, pilot, urban explorer, and a senior media technology consultant with over two decades of experience in high-end broadcast infrastructure. 
Your goal is to write posts, articles, and captions that perfectly mimic Philip's voice. You are humble but highly authoritative. You are deeply knowledgeable, obsessed with gear/tech, deeply respectful of history, and you always prioritize practical, real-world applications. Above all, you believe that technology (whether it's AI, the cloud, or a 600mm lens) is merely a tool designed to serve the human soul and the creative story.`;

  const coreMechanics = `
* **The Hype Slayer & Demystifier:** You actively cut through industry marketing BS. You call out "AI-washing" and "shiny object syndrome." You frequently pause to explain complex concepts or buzzwords simply before diving into the weeds.
* **Real-World Physics & Economics:** Never just list a specification; translate it into a real-world application or cost. Acknowledge the physical and financial realities of media (e.g., "data gravity," "egress fees").
* **The Tech Philosopher:** Historically contextualize new technology. AI is a "copilot" to automate the mundane, not a replacement for human creativity.
* **Humility & Network:** Frequently shout out and tag the people who help you, your guides, industry peers, or your clients. 
* **Emoticons:** Use old-school text emoticons like :-) or ;-) occasionally. Do not use standard emojis unless specifically requested.
* **The Gear Flex:** Seamlessly integrate the exact camera, lens, software, or IT infrastructure used, tagging the brands appropriately (e.g., @reddigitalcinema, @blueshape_global, OpenZFS).
* **The CTA:** For social media posts, almost always end with: "Photographic prints are available at https://bit.ly/pgp-store with all proceeds going to support several Ukrainian Charities that I am involved in assisting."`;

  let styleInstructions = "";
  if (styles.includes("Engineering")) {
    styleInstructions += `
* **Style: Engineer / Tech Consultant:** Lean heavily into your engineering background and decades of M&E consulting. Talk about throughput, bandwidth, codecs, hybrid workflows, network interfaces, thrust, payload, and avionics. Emphasize pragmatism over hype.`;
  }
  if (styles.includes("Historical")) {
    styleInstructions += `
* **Style: Historical / Documentary:** Act as a seasoned historian and documentarian. Provide exact dates, original names, and deep historical context. Focus on the scale of engineering clean-up or historical significance.`;
  }
  if (styles.includes("Thought Leader")) {
    styleInstructions += `
* **Style: Industry Thought Leader / Editorial:** Write like the Editor-in-Chief or a keynote speaker. Focus on the intersection of creative arts and technology. Remind the audience that the human element remains irreplaceable.`;
  }
  if (styles.includes("Humorous")) {
    styleInstructions += `
* **Style: Funny / Sarcastic / Personal:** Use dry, observational wit and self-deprecating humor. Pop culture references and dry wit are encouraged.`;
  }

  const constraints = `
* NEVER use corporate marketing jargon.
* Do not over-dramatize. Present incredible or dangerous things as a matter of fact.
* Keep sentences varied—mix short, punchy statements with longer, fact-dense explanations.`;

  let handleLine = "";
  if (confirmedHandles && confirmedHandles.length > 0) {
    handleLine = "\nUse these EXACT handles from the Rolodex: " +
      confirmedHandles.map(h => `"${h.nickname}" → X: ${h.x_handle || "n/a"}, IG: ${h.ig_handle || "n/a"}, FB: ${h.fb_handle || "n/a"}`).join("; ") + ".";
  }

  return `${roleIdentity}

# Core Mechanics (Always Apply)${coreMechanics}

# Selected Styles${styleInstructions || "\n* Default: Blend the core mechanics naturally."}

# Constraints${constraints}
${handleLine}

Analyze the provided images and grounding info. Create 3 posts. Use these tags: ${tags || "none"}.

Platform rules:
- X (Twitter): 1–2 highly relevant hashtags.
- Facebook: 0–1 hashtags. Focus on narrative.
- Instagram: 5–10 hashtags at the very bottom, separated by dots/line breaks.

Return ONLY a valid JSON object with keys: facebook, x, instagram, and suggested_tags (array). No markdown, no code fence.`;
}

ipcMain.handle(
  "generate-social-posts",
  async (
    _event,
    {
      apiKey,
      modelName,
      images,
      groundingInfo,
      styles,
      tags,
      confirmedHandles,
      exif,
      isPersonal,
    }
  ) => {
    const desktopPath = app.getPath("desktop");
    const logFile = path.join(desktopPath, "SMC_AI_Log.txt");

    function writeLog(header, data) {
      try {
        const timestamp = new Date().toISOString();
        const logContent = `\n\n[${timestamp}] === ${header} ===\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
        fs.appendFileSync(logFile, logContent);
      } catch (err) {
        console.error("Failed to write to log file", err);
      }
    }

    writeLog("1. NEW GENERATION REQUEST", { modelName, isPersonal, styles, tags });

    const skillPath = path.join(app.getAppPath(), "my_social_voice_skill.md");
    let voiceSkill = "";
    try {
      voiceSkill = fs.readFileSync(skillPath, "utf-8");
      if (isPersonal) {
        voiceSkill += "\n\n[CRITICAL OVERRIDE FOR PERSONAL POST]: This is for Philip's personal Facebook profile, not a public professional page. DO NOT include the store CTA or the bit.ly link at the end. Keep the tone slightly more casual for friends, family, and peers.";
      }
    } catch (e) {
      writeLog("ERROR READING SKILL FILE", e.message);
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey, apiVersion: "v1beta" });

    const imageParts = (images || []).map((base64Str) => {
      const raw = typeof base64Str === "string" && base64Str.includes(",") ? base64Str.split(",")[1] : base64Str;
      return {
        inlineData: {
          data: raw,
          mimeType: "image/jpeg",
        },
      };
    });

    const userParts = [
      { text: `Anchor Text / Context:\n${groundingInfo || "(none)"}\n\nSelected Tones: ${styles.join(", ")}\n\nTags to include: ${tags}\n\nExtracted EXIF Data:\n${JSON.stringify(exif || {}, null, 2)}` },
      ...imageParts,
    ];

    let ragInjection = "";
    try {
      const aiMinReach = Number(store.get("aiMinReach", 50));
      const aiInjectionCount = Number(store.get("aiInjectionCount", 3));

      const topPosts = db.prepare('SELECT message FROM posts WHERE reach >= ? ORDER BY engagement_score DESC LIMIT ?').all(aiMinReach, aiInjectionCount);
      if (topPosts && topPosts.length > 0) {
        ragInjection = "\n\n### AI MEMORY: PAST SUCCESSFUL POSTS\nTo help you match the preferred style and format, here are the top-performing posts previously published to this audience. Use their structure, length, and tone as a guide:\n" +
          topPosts.map((p, i) => `[Post ${i + 1}]\n${p.message}`).join("\n\n");
      }
    } catch (err) {
      writeLog("ERROR LOADING RAG MEMORY", err.message);
    }

    const taskInstruction = isPersonal
      ? `TASK: Analyze the provided images and grounding info. Create 1 personal Facebook post (do NOT include X or Instagram). Suggest relevant tags.${ragInjection}`
      : `TASK: Analyze the provided images and grounding info. Create 3 social media posts (Facebook, X/Twitter, Instagram) and suggest relevant tags.${ragInjection}`;

    const combinedInstruction = `${voiceSkill}\n\n${taskInstruction}
    \nOUTPUT FORMAT: You MUST return a valid JSON object with the following keys:
    - "facebook": string (the post for Facebook)
    - "x": string (the post for X/Twitter - leave empty if personal post)
    - "instagram": string (the post for Instagram - leave empty if personal post)
    - "suggested_tags": array of strings
    \nDo not include any markdown code fences or extra text. Return ONLY the JSON object.`;

    writeLog("2. SYSTEM INSTRUCTION (Persona + RAG)", combinedInstruction);
    writeLog("3. USER PROMPT (Extracted Data)", userParts.filter(p => p.text).map(p => p.text).join("\n"));

    try {
      const result = await ai.models.generateContent({
        model: modelName,
        contents: [{ role: "user", parts: userParts }],
        config: {
          systemInstruction: combinedInstruction
        }
      });

      const text = result.text || "";
      writeLog("4. RAW GEMINI API RESPONSE", text);

      if (result.usageMetadata) {
        updateStoredCost(calculateCost(modelName, result.usageMetadata));
      }

      if (!text || !text.trim()) {
        throw new Error("Gemini returned no text.");
      }

      try {
        const parsed = JSON.parse(text.trim().replace(/```json|```/g, ""));
        return {
          facebook: parsed.facebook ?? "",
          x: parsed.x ?? "",
          instagram: parsed.instagram ?? "",
          suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : [],
        };
      } catch (e) {
        throw new Error(`Gemini response was not valid JSON: ${text.slice(0, 200)}...`);
      }

    } catch (apiError) {
      writeLog("5. FATAL API ERROR", apiError.message || apiError.toString());
      throw apiError;
    }
  }
);

app.whenReady().then(() => {
  initializeDatabase();
  createWindow();
  startLightroomBridgeServer();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
