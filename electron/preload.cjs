const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveApiKey: (apiKey) => ipcRenderer.invoke("settings:saveApiKey", apiKey),
  saveHandleMap: (handleMap) => ipcRenderer.invoke("settings:saveHandleMap", handleMap),
  saveSingleHandle: (handleEntry) => ipcRenderer.invoke("settings:saveSingleHandle", handleEntry),
  generateSocialPosts: (payload) => ipcRenderer.invoke("generate-social-posts", payload),
  testConnection: (apiKey) => ipcRenderer.invoke("test-connection", apiKey),
  getAvailableModels: (apiKey) => ipcRenderer.invoke("get-available-models", apiKey),
  extractExif: (base64Image) => ipcRenderer.invoke("extract-exif", base64Image),
  resolveTags: (payload) => ipcRenderer.invoke("resolve-tags", payload),
  resetCost: () => ipcRenderer.invoke("cost:reset"),
  selectDirectory: () => ipcRenderer.invoke("settings:selectDirectory"),
  saveMetaCreds: (creds) => ipcRenderer.invoke("settings:saveMetaCreds", creds),
  saveAIParams: (params) => ipcRenderer.invoke("settings:saveAIParams", params),
  fetchAnalytics: () => ipcRenderer.invoke("meta:fetchAnalytics"),
  publishPost: (payload) => ipcRenderer.invoke("meta:publishPost", payload),
  syncDatabaseAnalytics: () => ipcRenderer.invoke("meta:syncDatabaseAnalytics"),
  clearAiDatabase: () => ipcRenderer.invoke("meta:clearAiDatabase"),
});
