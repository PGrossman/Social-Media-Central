type HandleEntry = {
  nickname: string;
  x_handle: string;
  ig_handle: string;
  fb_handle: string;
};

type StoredSettings = {
  apiKey: string;
  handleMap: HandleEntry[];
  totalCost: number;
  costStartDate: string;
  metaAccessToken?: string;
  metaPageId?: string;
  metaIgAccountId?: string;
  modelName?: string;
  aiCommentWeight?: number;
  aiInjectionCount?: number;
  aiMinReach?: number;
  aiDbPath?: string;
};

type GenerateSocialPostsPayload = {
  apiKey: string;
  modelName: string;
  images: string[];
  groundingInfo: string;
  styles: string[];
  tags: string;
  confirmedHandles?: HandleEntry[] | null;
  exif?: Record<string, any>;
};

type GenerateSocialPostsResult = {
  facebook: string;
  x: string;
  instagram: string;
  suggested_tags: string[];
};

// New types introduced by the change
type OutputPayload = GenerateSocialPostsResult; // Assuming OutputPayload is the same as GenerateSocialPostsResult
type MetaAnalyticsResponse = { success: boolean; data?: any; error?: string }; // Assuming this is the type for fetchAnalytics

type LightroomMetadata = {
  title?: string;
  caption?: string;
  description?: string;
  keywords?: string[];
  location?: string;
  camera?: string;
  lens?: string;
  aperture?: string;
  fstop?: string;
  iso?: string;
};

type LightroomFrontendPayload = {
  images: string[]; // Array of Base64 encoded images (converted from file paths by main process)
  metadata: LightroomMetadata;
};

interface Window {
  electronAPI?: {
    getSettings: () => Promise<StoredSettings & { totalCost: number; costStartDate: string }>;
    saveSettings: (settings: Partial<StoredSettings>) => Promise<void>;
    saveApiKey: (apiKey: string) => Promise<void>;
    saveHandleMap: (handleMap: HandleEntry[]) => Promise<void>;
    saveSingleHandle: (handle: HandleEntry) => Promise<HandleEntry[]>;
    getAvailableModels: (apiKey: string) => Promise<{ success: boolean; models: string[]; error?: string }>;
    testConnection: (apiKey: string) => Promise<{ success: boolean; models: string[]; error?: string }>;
    generateSocialPosts: (payload: {
      apiKey: string;
      modelName: string;
      images: string[];
      groundingInfo: string;
      styles: string[];
      tags: string;
      confirmedHandles: HandleEntry[] | null;
      exif: Record<string, any>;
      isPersonal: boolean;
    }) => Promise<OutputPayload>;
    extractExif: (base64Image: string) => Promise<{ success: boolean; exif?: any; error?: string }>;
    resetCost: () => Promise<{ totalCost: number; costStartDate: string }>;
    selectDirectory: () => Promise<string | null>;
    saveMetaCreds: (creds: { accessToken: string; pageId: string; igAccountId: string }) => Promise<boolean>;
    saveAIParams: (params: { aiCommentWeight: number; aiInjectionCount: number; aiMinReach: number; aiDbPath: string }) => Promise<boolean>;
    fetchAnalytics: () => Promise<{ success: boolean; data?: any; error?: string }>;
    publishPost: (payload: { platform: string, message?: string, fbMessage?: string, igMessage?: string, imageBase64?: string }) => Promise<{ success: boolean, id?: string, error?: string }>;
    resolveTags: (payload: { apiKey: string; entities: string[] }) => Promise<{ success: boolean; handles?: HandleEntry[]; error?: string }>;
    syncDatabaseAnalytics: () => Promise<{ success: boolean, updatedCount?: number, error?: string }>;
    onLightroomData: (callback: (data: LightroomFrontendPayload) => void) => void;
  };
}
