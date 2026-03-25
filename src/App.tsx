import { type ChangeEvent, type DragEvent, useEffect, useMemo, useState } from "react";
import {
  TrendingUp, Users, Target, BarChart3,
  ArrowUpRight, RefreshCw, MessageCircle, Heart, Eye, AlertTriangle
} from 'lucide-react';
import { motion } from 'framer-motion';

type AppView = "generator" | "output" | "analytics" | "settings";
type StyleOption = "Historical" | "Engineering/Science" | "Humorous" | "General";

type OutputPayload = {
  facebook: string;
  x: string;
  instagram: string;
};


type SelectedImage = {
  file: File;
  previewUrl: string;
};

const STYLE_OPTIONS: StyleOption[] = ["Historical", "Engineering/Science", "Humorous", "General"];

const hiddenContextInstruction =
  "The user has provided the following context for these images. Use this as the factual source of truth over your own internal training data if there is a conflict.";

function getStyleDescription(styles: StyleOption[]): string {
  let desc = "You are Philip Grossman's ghostwriter. ";
  if (styles.includes("Engineering/Science")) desc += "Use a technical, engineering-focused tone. ";
  if (styles.includes("Historical")) desc += "Focus on historical context and facts. ";
  if (styles.includes("Humorous")) desc += "Use dry, sarcastic, deadpan wit. ";
  if (styles.includes("General")) desc += "Use a balanced professional tone. ";
  return desc;
}

type ModelOption = { id: string; label: string };

type ApiRequestPayload = {
  systemInstruction: string;
  model: string;
  styleSelection: StyleOption[];
  groundingInfo: string;
  taggingInfo: string;
  imageCount: number;
  confirmedHandle?: HandleEntry;
};

const FALLBACK_MODELS: ModelOption[] = [
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
];

function getInitialHandle(): HandleEntry {
  return {
    nickname: "",
    x_handle: "",
    ig_handle: "",
    fb_handle: "",
  };
}

function normalizeNickname(value: string): string {
  return value.trim().toLowerCase();
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function compressImageAsBase64(file: File, maxWidth = 1440): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(e.target?.result as string);
        ctx.drawImage(img, 0, 0, width, height);
        // Compress heavily for the Meta handoff to prevent timeouts
        resolve(canvas.toDataURL("image/jpeg", 0.75));
      };
      img.onerror = () => resolve(e.target?.result as string);
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getSystemPrompt(styles: StyleOption[]): string {
  let basePrompt =
    "You are Philip Grossman's personal ghostwriter. Generate 3 posts (FB, X, IG) in JSON format with keys: facebook, x, instagram, detected_tags.";

  basePrompt += ` ${hiddenContextInstruction}`;
  basePrompt += `\n${getStyleDescription(styles)}`;

  if (styles.length === 0) {
    basePrompt += " Default to a balanced professional tone.";
  } else if (styles.length > 1) {
    basePrompt += " Blend selected styles naturally.";
  }

  return basePrompt;
}

function buildApiRequestPayload(input: {
  selectedStyles: StyleOption[];
  model: string;
  groundingInfo: string;
  taggingInfo: string;
  imageCount: number;
  confirmedHandle?: HandleEntry;
}): ApiRequestPayload {
  return {
    systemInstruction: getSystemPrompt(input.selectedStyles),
    model: input.model,
    styleSelection: input.selectedStyles,
    groundingInfo: input.groundingInfo.trim(),
    taggingInfo: input.taggingInfo.trim(),
    imageCount: input.imageCount,
    confirmedHandle: input.confirmedHandle,
  };
}

// --- Analytics View ---

function AnalyticsView({ settings }: { settings: { apiKey: string, handleMap: HandleEntry[], metaAccessToken: string, metaPageId: string, metaIgAccountId: string } }) {
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePlatform, setActivePlatform] = useState<'instagram' | 'facebook'>('instagram');

  const hasIg = !!settings.metaIgAccountId;
  const hasFb = !!settings.metaPageId;

  // Auto-switch platform if one is missing but the other is present
  useEffect(() => {
    if (activePlatform === 'instagram' && !hasIg && hasFb) {
      setActivePlatform('facebook');
    } else if (activePlatform === 'facebook' && !hasFb && hasIg) {
      setActivePlatform('instagram');
    }
  }, [hasIg, hasFb, activePlatform]);

  const fetchData = async () => {
    if (!window.electronAPI) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.fetchAnalytics();
      if (res.success) {
        setData(res.data);
      } else {
        setError(res.error || "Failed to fetch analytics");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, []);

  const handleSyncMemory = async () => {
    if (!window.electronAPI) return;
    setSyncing(true);
    try {
      const res = await window.electronAPI.syncDatabaseAnalytics();
      if (res.success) {
        alert(`Successfully synced ${res.updatedCount} recent posts into AI Memory.`);
      } else {
        alert(`Failed to sync AI Memory: ${res.error}`);
      }
    } catch (err) {
      alert(`Sync Error: ${String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  if (!settings.metaAccessToken || (!hasIg && !hasFb)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-10 text-center space-y-4">
        <div className="bg-blue-50 p-6 rounded-full">
          <TrendingUp className="w-12 h-12 text-blue-500" />
        </div>
        <h2 className="text-xl font-bold">Analytics Not Configured</h2>
        <p className="text-slate-500 max-w-md">Connect your Instagram Business Account or Facebook Page in the Settings tab to see post performance and audience insights.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
        <span className="ml-3 text-slate-600">Fetching latest insights...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-700 m-6">
        <h3 className="font-bold flex items-center gap-2 mb-2"><TrendingUp /> Error Fetching Analytics</h3>
        <p className="text-sm">{error}</p>
        <button onClick={fetchData} className="mt-4 bg-red-600 text-white px-4 py-2 rounded text-sm font-semibold">Retry</button>
      </div>
    );
  }

  // Process Data
  const currentData = activePlatform === 'instagram' ? data?.instagram : data?.facebook;
  const platformError = data?.errors?.[activePlatform];

  let latestFollowers = 'N/A';
  let growthPercent = '0%';
  let avgReach = '0';
  let avgEngagement = '0';
  let mediaList: any[] = [];

  if (currentData) {
    // 1. Followers
    const followerMetric = activePlatform === 'instagram' ? 'follower_count' : 'page_fans';
    const followerData = currentData.insights?.find((i: any) => i.name === followerMetric)?.values || [];
    if (followerData.length > 0) {
      latestFollowers = followerData[followerData.length - 1]?.value?.toLocaleString() || 'N/A';
    }

    // 2. 3-Day Rolling Growth (Reach-based)
    const reachMetric = activePlatform === 'instagram' ? 'reach' : 'page_impressions_unique';
    const reachData = currentData.insights?.find((i: any) => i.name === reachMetric)?.values || [];

    if (reachData.length >= 4) {
      // Compare the sum of the last 3 days to the sum of the previous 3 days as a proxy for immediate growth trend
      const last3 = reachData.slice(-3).reduce((acc: number, val: any) => acc + (val.value || 0), 0);
      const prev3 = reachData.slice(-6, -3).reduce((acc: number, val: any) => acc + (val.value || 0), 0);

      if (prev3 > 0) {
        const pct = ((last3 - prev3) / prev3) * 100;
        growthPercent = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
      } else if (last3 > 0) {
        growthPercent = '+100%';
      }
    }

    // 3. Media List & Averages
    mediaList = currentData.media?.map((post: any) => {
      let reach = '-';
      let engagement = '0';

      if (activePlatform === 'instagram') {
        reach = post.insights?.data?.find((i: any) => i.name === 'reach')?.values[0]?.value || '-';
        engagement = post.insights?.data?.find((i: any) => i.name === 'engagement' || i.name === 'total_interactions')?.values[0]?.value || '0';
      } else {
        reach = post.insights?.data?.find((i: any) => i.name === 'post_impressions_unique')?.values[0]?.value || '-';
        engagement = post.insights?.data?.find((i: any) => i.name === 'post_engaged_users')?.values[0]?.value || '0';
      }

      return {
        id: post.id,
        caption: activePlatform === 'instagram' ? post.caption : post.message,
        timestamp: activePlatform === 'instagram' ? post.timestamp : post.created_time,
        media_url: activePlatform === 'instagram' ? post.media_url : post.attachments?.data?.[0]?.media?.image?.src || null,
        likes: post.like_count !== undefined ? post.like_count : '-',
        comments: post.comments_count !== undefined ? post.comments_count : '-',
        reach,
        engagement
      };
    }) || [];

    // Calculate Averages
    if (mediaList.length > 0) {
      const validReach = mediaList.filter(m => m.reach !== '-').map(m => Number(m.reach));
      const validEng = mediaList.filter(m => m.engagement !== '-' && m.engagement !== '0').map(m => Number(m.engagement));

      if (validReach.length > 0) {
        avgReach = Math.round(validReach.reduce((a, b) => a + b, 0) / validReach.length).toLocaleString();
      }
      if (validEng.length > 0) {
        avgEngagement = Math.round(validEng.reduce((a, b) => a + b, 0) / validEng.length).toLocaleString();
      }
    }
  }

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Social Analytics</h2>
          <p className="text-slate-500">Performance insights for {activePlatform === 'instagram' ? settings.metaIgAccountId : settings.metaPageId}</p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          {/* Platform Toggle */}
          <div className="bg-slate-100 p-1 rounded-lg flex items-center">
            <button
              disabled={!hasIg}
              onClick={() => setActivePlatform('instagram')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activePlatform === 'instagram'
                ? 'bg-white shadow-sm text-slate-900 border border-slate-200'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
            >
              Instagram
            </button>
            <button
              disabled={!hasFb}
              onClick={() => setActivePlatform('facebook')}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activePlatform === 'facebook'
                ? 'bg-white shadow-sm text-slate-900 border border-slate-200'
                : 'text-slate-500 hover:text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
            >
              Facebook
            </button>
          </div>

          <button
            onClick={fetchData}
            disabled={loading || syncing}
            className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
          <button
            onClick={handleSyncMemory}
            disabled={loading || syncing}
            className="flex items-center gap-2 bg-blue-100 text-blue-700 hover:bg-blue-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Target className={`w-4 h-4 ${syncing ? 'animate-pulse' : ''}`} />
            {syncing ? 'Syncing Memory...' : 'Sync AI Memory'}
          </button>
        </div>
      </div>

      {platformError && (
        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg text-orange-800 text-sm">
          <strong>Notice:</strong> {platformError}
        </div>
      )}

      {/* Grid for Scorecards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: activePlatform === 'facebook' ? 'Total Fans' : 'Total Followers', value: latestFollowers, icon: Users, color: 'blue' },
          { label: '3d Growth (vs 30d)', value: growthPercent, icon: TrendingUp, color: 'emerald' },
          { label: 'Avg Reach per Post', value: avgReach !== '0' ? avgReach : '-', icon: Eye, color: 'purple' },
          { label: 'Avg Eng. per Post', value: avgEngagement !== '0' ? avgEngagement : '-', icon: Target, color: 'orange' },
        ].map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
            className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4"
          >
            <div className={`p-3 rounded-xl bg-${stat.color}-50 text-${stat.color}-600`}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <p className="text-2xl font-bold">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Recent Posts Table */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="text-lg font-bold mb-6 flex items-center gap-2"><BarChart3 className="w-5 h-5 text-blue-500" /> Recent Post Performance</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="border-b border-slate-100 text-slate-500 text-sm">
                <th className="pb-4 font-medium w-1/2">Post Detail</th>
                <th className="pb-4 font-medium text-center">Likes</th>
                <th className="pb-4 font-medium text-center">Comments</th>
                <th className="pb-4 font-medium text-center">Reach</th>
                <th className="pb-4 font-medium text-center">Engagement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {mediaList.slice(0, 10).map((post: any) => (
                <tr key={post.id} className="group hover:bg-slate-50 transition-colors">
                  <td className="py-4 pr-4">
                    <div className="flex items-center gap-4">
                      {post.media_url ? (
                        <div className="relative group/img">
                          <img src={post.media_url} key={post.id} className="w-16 h-16 rounded-lg object-cover bg-slate-100 flex-shrink-0 border border-slate-200 shadow-sm" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-slate-100 flex-shrink-0 flex items-center justify-center text-slate-400 font-bold border border-slate-200 shadow-sm">
                          {activePlatform === 'facebook' ? 'FB' : 'IG'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1 max-w-sm whitespace-normal">
                        <p className="text-sm font-medium text-slate-800 line-clamp-2 leading-relaxed" title={post.caption || ''}>
                          {post.caption || <span className="text-slate-400 italic">No caption provided</span>}
                        </p>
                        <p className="text-[11px] font-semibold tracking-wide text-slate-400 mt-1 uppercase">
                          {post.timestamp ? new Date(post.timestamp).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'Unknown date'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 text-center">
                    <div className="inline-flex items-center justify-center gap-1.5 min-w-[3rem] px-2 py-1 rounded bg-rose-50 text-rose-700 font-semibold text-sm">
                      <Heart className="w-3.5 h-3.5" />
                      {post.likes}
                    </div>
                  </td>
                  <td className="py-4 text-center">
                    <div className="inline-flex items-center justify-center gap-1.5 min-w-[3rem] px-2 py-1 rounded bg-blue-50 text-blue-700 font-semibold text-sm">
                      <MessageCircle className="w-3.5 h-3.5" />
                      {post.comments}
                    </div>
                  </td>
                  <td className="py-4 text-center text-sm font-semibold text-slate-700">{post.reach}</td>
                  <td className="py-4 text-center">
                    <div className="inline-flex items-center justify-center gap-1.5 min-w-[3rem] px-2 py-1 rounded bg-emerald-50 text-emerald-700 font-bold text-sm">
                      <TrendingUp className="w-3.5 h-3.5" />
                      {post.engagement}
                    </div>
                  </td>
                </tr>
              ))}
              {mediaList.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-sm">No recent posts found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [activeView, setActiveView] = useState<AppView>("generator");
  const [activeSettingsTab, setActiveSettingsTab] = useState<'gemini' | 'tags' | 'meta' | 'ai'>('gemini');
  const [isBootstrapped, setIsBootstrapped] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [handleMap, setHandleMap] = useState<HandleEntry[]>([]);
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [groundingInfo, setGroundingInfo] = useState("");
  const [taggingInfo, setTaggingInfo] = useState("");
  const [styleSelection, setStyleSelection] = useState<StyleOption[]>([]);
  const [isPersonal, setIsPersonal] = useState(false);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(FALLBACK_MODELS[0].id);
  const [outputs, setOutputs] = useState<OutputPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [guessHandles, setGuessHandles] = useState<HandleEntry | null>(null);
  const [editableHandles, setEditableHandles] = useState<HandleEntry | null>(null);
  const [statusText, setStatusText] = useState("Ready.");
  const [totalCost, setTotalCost] = useState(0);
  const [costStartDate, setCostStartDate] = useState("");
  const [exifData, setExifData] = useState<Record<string, any>>({});
  const [testStatus, setTestStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  // Meta API state
  const [metaAccessToken, setMetaAccessToken] = useState("");
  const [metaPageId, setMetaPageId] = useState("");
  const [metaIgAccountId, setMetaIgAccountId] = useState("");
  const [metaSaveStatus, setMetaSaveStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPublishing, setIsPublishing] = useState<Record<string, boolean>>({});
  const [publishStatus, setPublishStatus] = useState<Record<string, string>>({});

  // AI Memory Config state
  const [aiCommentWeight, setAiCommentWeight] = useState(5);
  const [aiInjectionCount, setAiInjectionCount] = useState(3);
  const [aiMinReach, setAiMinReach] = useState(50);
  const [aiDbPath, setAiDbPath] = useState("");
  const [aiSaveStatus, setAiSaveStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  const refreshModels = async (apiKeyOverride?: string) => {
    if (!window.electronAPI) return;
    const key = (apiKeyOverride !== undefined ? apiKeyOverride : apiKey).trim();
    const result = await window.electronAPI.getAvailableModels(key || " ");
    if (result.success && result.models.length > 0) {
      const mappedModels = result.models.map((m: any) =>
        typeof m === "string" ? { id: m, label: m } : m
      ) as ModelOption[];
      setAvailableModels(mappedModels);
      setSelectedModel((current) => {
        const exists = mappedModels.some((m) => m.id === current);
        return exists ? current : mappedModels[0].id;
      });
    } else {
      setAvailableModels(FALLBACK_MODELS);
      if (!result.models?.length) {
        setSelectedModel(FALLBACK_MODELS[0].id);
      }
    }
  };

  useEffect(() => {
    const load = async () => {
      if (!window.electronAPI) {
        setStatusText("Running without Electron bridge. Store is disabled.");
        setIsBootstrapped(true);
        return;
      }

      const settings = (await window.electronAPI.getSettings()) as StoredSettings & { totalCost: number; costStartDate: string; };
      setApiKey(settings.apiKey ?? "");
      setHandleMap(settings.handleMap ?? []);
      setTotalCost(settings.totalCost ?? 0);
      setCostStartDate(settings.costStartDate ?? "");
      setMetaAccessToken(settings.metaAccessToken ?? "");
      setMetaPageId(settings.metaPageId ?? "");
      setMetaIgAccountId(settings.metaIgAccountId ?? "");
      setAiCommentWeight(settings.aiCommentWeight ?? 5);
      setAiInjectionCount(settings.aiInjectionCount ?? 3);
      setAiMinReach(settings.aiMinReach ?? 50);
      setAiDbPath(settings.aiDbPath ?? "");
      setIsBootstrapped(true);
      await window.electronAPI.getAvailableModels(settings.apiKey ?? " ").then((result) => {
        if (result.success && result.models.length > 0) {
          const mappedModels = result.models.map((m: any) =>
            typeof m === "string" ? { id: m, label: m } : m
          ) as ModelOption[];
          setAvailableModels(mappedModels);
          if (settings.modelName && mappedModels.some((m) => m.id === settings.modelName)) {
            setSelectedModel(settings.modelName);
          } else {
            setSelectedModel(mappedModels[0].id);
          }
        } else {
          setSelectedModel(FALLBACK_MODELS[0].id);
        }
      });
    };

    void load();
  }, []);

  useEffect(() => {
    return () => {
      for (const image of images) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, [images]);

  const hasEditedGuess = useMemo(() => {
    if (!guessHandles || !editableHandles) {
      return false;
    }

    return (
      guessHandles.nickname !== editableHandles.nickname ||
      guessHandles.x_handle !== editableHandles.x_handle ||
      guessHandles.ig_handle !== editableHandles.ig_handle ||
      guessHandles.fb_handle !== editableHandles.fb_handle
    );
  }, [guessHandles, editableHandles]);

  const addFiles = (incomingFiles: FileList | File[]) => {
    const incoming = Array.from(incomingFiles);
    const jpgOnly = incoming.filter((file) => file.type === "image/jpeg" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg"));
    const nextFiles = [...images.map((image) => image.file), ...jpgOnly].slice(0, 4);

    if (incoming.length !== jpgOnly.length) {
      setStatusText("Only JPG/JPEG files are allowed.");
    }

    if (nextFiles.length < 1 || nextFiles.length > 4) {
      setStatusText("Drop zone accepts exactly 1 to 4 JPG files.");
      return;
    }

    for (const image of images) {
      URL.revokeObjectURL(image.previewUrl);
    }

    const selected = nextFiles.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setImages(selected);
    setStatusText(`${selected.length} image(s) loaded.`);

    // Extract EXIF data for the new images
    for (const img of selected) {
      if (window.electronAPI) {
        readFileAsDataURL(img.file).then(base64 => {
          window.electronAPI!.extractExif(base64).then(res => {
            if (res.success && res.exif) {
              setExifData(prev => ({ ...prev, [img.file.name]: res.exif }));
              console.log(`EXIF for ${img.file.name}:`, res.exif);
            }
          });
        });
      }
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  };

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) {
      addFiles(event.target.files);
    }
  };

  const toggleStyle = (style: StyleOption) => {
    setStyleSelection((current) =>
      current.includes(style) ? current.filter((item) => item !== style) : [...current, style],
    );
  };

  const publishToMeta = async () => {
    if (!window.electronAPI || !outputs) return;

    // Check missing settings
    if (!metaPageId || !metaIgAccountId) {
      setPublishStatus(prev => ({ ...prev, meta: "Error: Both Facebook Page ID and Instagram Account ID are required in Settings." }));
      return;
    }
    if (!images || images.length === 0) {
      setPublishStatus(prev => ({ ...prev, meta: "Error: An image must be uploaded to publish to Instagram." }));
      return;
    }

    setIsPublishing(prev => ({ ...prev, meta: true }));
    setPublishStatus(prev => ({ ...prev, meta: "Publishing to Facebook & Instagram..." }));

    try {
      const imageBase64 = images && images.length > 0 ? await compressImageAsBase64(images[0].file) : undefined;
      const payload = {
        platform: "meta",
        fbMessage: outputs.facebook,
        igMessage: outputs.instagram,
        imageBase64: imageBase64
      };
      const res = await window.electronAPI.publishPost(payload);

      if (res.success) {
        setPublishStatus(prev => ({ ...prev, meta: "Successfully cross-published to Meta (FB & IG)!" }));
      } else {
        setPublishStatus(prev => ({ ...prev, meta: `Error: ${res.error}` }));
      }
    } catch (err: any) {
      setPublishStatus(prev => ({ ...prev, meta: `Error: ${err.message}` }));
    } finally {
      setIsPublishing(prev => ({ ...prev, meta: false }));
    }
  };

  const findLocalHandle = (nickname: string): HandleEntry | undefined => {
    const normalized = normalizeNickname(nickname);
    return handleMap.find((entry) => normalizeNickname(entry.nickname) === normalized);
  };

  const guessHandleFromNickname = (nickname: string): HandleEntry => {
    const key = nickname.replace(/\s+/g, "_");
    return {
      nickname,
      x_handle: `@${key}_Guess`,
      ig_handle: `${key}_guess`,
      fb_handle: key,
    };
  };

  const resetNewPost = () => {
    for (const image of images) {
      URL.revokeObjectURL(image.previewUrl);
    }
    setImages([]);
    setGroundingInfo("");
    setTaggingInfo("");
    setStyleSelection([]);
    setIsPersonal(false);
    setOutputs(null);
    setGuessHandles(null);
    setEditableHandles(null);
    setExifData({});
    setActiveView("generator");
    setStatusText("Cleared. Ready for a new post.");
    setPublishStatus({}); // Clear publish status on new post
  };

  const handleResetCost = async () => {
    if (!window.electronAPI) return;
    const confirmed = window.confirm("Are you sure you want to reset the costing information? This will zero out the costs and start over from today.");
    if (confirmed) {
      const result = await window.electronAPI.resetCost();
      setTotalCost(result.totalCost);
      setCostStartDate(result.costStartDate);
      setStatusText("Costing information reset.");
    }
  };

  const handleGenerate = async () => {
    if (images.length < 1 || images.length > 4) {
      setStatusText("Please load 1-4 JPG images first.");
      return;
    }

    const entities = taggingInfo.split(",").map(e => e.trim()).filter(Boolean);
    if (entities.length > 0 && window.electronAPI && apiKey.trim()) {
      setStatusText("Resolving tags...");
      const res = await window.electronAPI.resolveTags({ apiKey: apiKey.trim(), entities });
      if (res.success && res.handles) {
        setHandleMap(prev => {
          const next = [...prev];
          res.handles!.forEach(h => {
            const idx = next.findIndex(e => normalizeNickname(e.nickname) === normalizeNickname(h.nickname));
            if (idx >= 0) next[idx] = h;
            else next.push(h);
          });
          return next;
        });
        setStatusText("Tags resolved and added to library.");
      }
    }

    const nickname = taggingInfo.split(",")[0]?.trim() ?? "";
    const guessed = nickname ? findLocalHandle(nickname) ?? guessHandleFromNickname(nickname) : null;
    const hasApi = !!window.electronAPI && !!apiKey.trim();

    if (hasApi) {
      setLoading(true);
      setStatusText("Calling Gemini…");
      try {
        const base64Images = await Promise.all(images.map((img) => readFileAsDataURL(img.file)));
        const response = await window.electronAPI!.generateSocialPosts({
          apiKey: apiKey.trim(),
          modelName: selectedModel,
          images: base64Images,
          groundingInfo,
          styles: styleSelection,
          tags: taggingInfo.trim(),
          confirmedHandles: guessed ? [guessed] : null,
          exif: exifData,
          isPersonal: isPersonal,
        });
        setOutputs({
          facebook: response.facebook,
          x: response.x,
          instagram: response.instagram,
        });
        // Refresh cost after generation
        const settings = await window.electronAPI!.getSettings();
        setTotalCost(settings.totalCost);

        setGuessHandles(guessed);
        setEditableHandles(guessed);
        setStatusText("Generated with Gemini.");
        setActiveView("output");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusText(`Generation failed: ${msg}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    const requestPayload = buildApiRequestPayload({
      selectedStyles: styleSelection,
      model: selectedModel,
      groundingInfo,
      taggingInfo,
      imageCount: images.length,
      confirmedHandle: guessed ?? undefined,
    });
    const styles = styleSelection.length > 0 ? styleSelection.join(", ") : "General";
    const tagLine = guessed
      ? `X: ${guessed.x_handle || "n/a"} | IG: ${guessed.ig_handle || "n/a"} | FB: ${guessed.fb_handle || "n/a"}`
      : "No handle guess used.";

    setGuessHandles(guessed);
    setEditableHandles(guessed);
    setOutputs({
      facebook: `[MOCK] Facebook draft in ${styles} tone.\nTags: ${tagLine}\nGrounding used: yes (${requestPayload.groundingInfo.length} chars).`,
      x: `[MOCK] X draft in ${styles} tone.\nUse concise wording and ${guessed?.x_handle ?? "@handle_guess"}.`,
      instagram: `[MOCK] Instagram draft in ${styles} tone.\nUse @${guessed?.ig_handle ?? "handle_guess"} + hashtags at the end.`,
    });
    setStatusText("Mock generation complete. Add an API key in Settings to use Gemini.");
    setActiveView("output");
  };

  const saveApiKey = async () => {
    if (!window.electronAPI) {
      setStatusText("Cannot save API key without Electron.");
      return;
    }

    await window.electronAPI.saveApiKey(apiKey.trim());
    setStatusText("API key saved to local store.");
    await refreshModels(apiKey.trim());
  };

  const saveHandleMap = async () => {
    if (!window.electronAPI) {
      setStatusText("Cannot save handle map without Electron.");
      return;
    }

    await window.electronAPI.saveHandleMap(handleMap);
    setStatusText("Handle manager saved to local store.");
  };

  const saveCorrectedHandle = async () => {
    if (!editableHandles?.nickname.trim()) {
      setStatusText("Add a nickname before saving to Rolodex.");
      return;
    }

    if (!window.electronAPI) {
      setStatusText("Cannot save handles without Electron.");
      return;
    }

    const next = (await window.electronAPI.saveSingleHandle(editableHandles)) as HandleEntry[];
    setHandleMap(next);
    setStatusText(`Saved "${editableHandles.nickname}" to Rolodex.`);
  };

  const saveMetaCreds = async () => {
    if (!window.electronAPI) return;
    setMetaSaveStatus({ msg: "Saving...", ok: true });
    await window.electronAPI.saveMetaCreds({
      accessToken: metaAccessToken.trim(),
      pageId: metaPageId.trim(),
      igAccountId: metaIgAccountId.trim(),
    });
    setMetaSaveStatus({ msg: "Meta credentials saved.", ok: true });
  };

  const saveAIParams = async () => {
    if (!window.electronAPI) return;
    setAiSaveStatus({ msg: "Saving...", ok: true });
    await window.electronAPI.saveAIParams({
      aiCommentWeight: Number(aiCommentWeight),
      aiInjectionCount: Number(aiInjectionCount),
      aiMinReach: Number(aiMinReach),
      aiDbPath: aiDbPath.trim()
    });
    setAiSaveStatus({ msg: "AI Learning Parameters saved.", ok: true });
  };

  const handleSelectDbDirectory = async () => {
    if (!window.electronAPI) return;
    const selectedPath = await window.electronAPI.selectDirectory();
    if (selectedPath) {
      setAiDbPath(selectedPath);
    }
  };

  const copyText = async (value: string, platform: string) => {
    await navigator.clipboard.writeText(value);
    setStatusText(`${platform} copied to clipboard.`);
  };

  const updateHandleRow = (index: number, field: keyof HandleEntry, value: string) => {
    setHandleMap((rows) =>
      rows.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }
        return { ...row, [field]: value };
      }),
    );
  };

  if (!isBootstrapped) {
    return <div className="p-6 text-sm text-slate-700">Loading Social Media Central...</div>;
  }

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col border border-slate-300 bg-white">
        <header className="flex shrink-0 items-center border-b border-slate-300 bg-slate-50 px-4 py-2">
          <h1 className="mr-6 text-lg font-semibold tracking-tight">Social Media Central</h1>
          <nav className="flex flex-1 gap-1">
            <button
              type="button"
              onClick={() => setActiveView("generator")}
              className={`rounded px-3 py-2 text-sm ${activeView === "generator" ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
            >
              Generator
            </button>
            <button
              type="button"
              onClick={() => setActiveView("output")}
              className={`rounded px-3 py-2 text-sm ${activeView === "output" ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
            >
              Output
            </button>
            <button
              type="button"
              onClick={() => setActiveView("analytics")}
              className={`rounded px-3 py-2 text-sm ${activeView === "analytics" ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
            >
              Analytics
            </button>
            <button
              type="button"
              onClick={() => setActiveView("settings")}
              className={`rounded px-3 py-2 text-sm ${activeView === "settings" ? "bg-blue-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
            >
              Settings
            </button>
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <button
              type="button"
              onClick={handleResetCost}
              className="rounded bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700 uppercase tracking-wide"
            >
              Reset
            </button>
            <div className="flex items-center gap-2 whitespace-nowrap text-sm font-medium">
              <span className="text-slate-500">Cost Since ({costStartDate})</span>
              <span className="text-blue-600 font-bold">${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-5">
          {activeView === "generator" && (
            <div className="space-y-5">
              <section className="flex items-start gap-5">
                <div className="flex-1 min-h-[150px] flex items-center gap-2 overflow-x-auto py-2">
                  {images.map((image) => (
                    <div
                      key={image.previewUrl}
                      className="h-[150px] w-[150px] shrink-0 overflow-hidden border border-slate-300 bg-slate-100"
                    >
                      <img src={image.previewUrl} alt={image.file.name} className="h-full w-full object-cover" />
                    </div>
                  ))}
                  {images.length === 0 && (
                    <div className="flex flex-1 items-center justify-center text-slate-400 text-sm italic">
                      No images selected
                    </div>
                  )}
                </div>

                <div className="w-72 shrink-0 border border-slate-300 bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Image Upload</h2>
                  <div
                    onDrop={onDrop}
                    onDragOver={(event) => event.preventDefault()}
                    className="flex min-h-[140px] flex-col items-center justify-center border-2 border-dashed border-slate-400 bg-slate-50 p-4 text-center"
                  >
                    <p className="text-xs text-slate-700">Drop up to 4 images here</p>
                    <label className="mt-3 cursor-pointer border border-slate-400 bg-white px-3 py-1 text-xs">
                      Browse Images
                      <input type="file" accept=".jpg,.jpeg,image/jpeg" multiple className="hidden" onChange={onPickFiles} />
                    </label>
                  </div>
                </div>
              </section>

              <section className="grid gap-5 lg:grid-cols-2">
                <div className="border border-slate-300 bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Prompt Inputs</h2>
                  <label className="mb-2 block text-xs font-medium text-slate-700">Anchor Text Box</label>
                  <textarea
                    className="mb-3 h-28 w-full border border-slate-300 px-3 py-2 text-sm"
                    value={groundingInfo}
                    onChange={(event) => setGroundingInfo(event.target.value)}
                    placeholder="Input baseline context or a story about the photos..."
                  />
                  <label className="mb-2 block text-xs font-medium text-slate-700">Tagging Input</label>
                  <input
                    className="w-full border border-slate-300 px-3 py-2 text-sm"
                    value={taggingInfo}
                    onChange={(event) => setTaggingInfo(event.target.value)}
                    placeholder="Enter entities to tag (e.g. NASA, SpaceX)..."
                  />
                </div>

                <div className="border border-slate-300 bg-white p-4">
                  <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Model & Tone Selectors</h2>
                  <div className="mb-3">
                    <label className="mb-1 block text-xs font-medium text-slate-700">Model Selection</label>
                    <select
                      value={selectedModel}
                      onChange={(e) => setSelectedModel(e.target.value)}
                      className="w-full border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      {(availableModels.length ? availableModels : FALLBACK_MODELS).map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="mb-1 block text-xs font-medium text-slate-700">Tone Selectors</label>
                    <div className="grid grid-cols-2 gap-2">
                      {STYLE_OPTIONS.map((style) => (
                        <label key={style} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={styleSelection.includes(style)}
                            onChange={() => toggleStyle(style)}
                            className="h-4 w-4 border-slate-400"
                          />
                          {style}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 border border-slate-300 bg-white p-3">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={isPersonal}
                        onChange={(e) => setIsPersonal(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Generate for Personal Facebook Profile
                    </label>
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={loading}
                      className="border border-blue-700 bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {loading ? "Generating…" : "Generate"}
                    </button>
                    <button
                      type="button"
                      onClick={resetNewPost}
                      className="border border-slate-400 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      Reset
                    </button>
                  </div>
                </div>
              </section>

              <div className="flex justify-center pt-8 border-t border-slate-200">
                <button
                  type="button"
                  onClick={resetNewPost}
                  className="rounded border border-slate-400 bg-white px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
                >
                  Reset All Fields
                </button>
              </div>
            </div>
          )}

          {activeView === "output" && (
            <div className="space-y-5">
              {!outputs ? (
                <p className="rounded border border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                  No output yet. Create a post on the New Post tab and click Generate to see results here.
                </p>
              ) : (
                <>
                  {editableHandles && (
                    <section className="border border-slate-300 bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h2 className="text-sm font-semibold uppercase text-slate-600">Handle Guess and Correction</h2>
                        <span className="text-xs text-slate-500">Correct and Save workflow</span>
                      </div>
                      <div className="grid gap-3 md:grid-cols-4">
                        {(["nickname", "x_handle", "ig_handle", "fb_handle"] as const).map((field) => (
                          <label key={field} className="text-xs font-medium text-slate-700">
                            <span className="mb-1 block capitalize">{field.replace("_", " ")}</span>
                            <div className="flex items-center gap-2">
                              <input
                                value={editableHandles[field]}
                                onChange={(event) =>
                                  setEditableHandles((current) => (current ? { ...current, [field]: event.target.value } : current))
                                }
                                className="w-full border border-slate-300 px-2 py-2 text-sm"
                              />
                              <button type="button" className="border border-slate-300 px-2 py-2 text-xs text-slate-600" title="Edit handle">
                                ✎
                              </button>
                            </div>
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={saveCorrectedHandle}
                        disabled={!hasEditedGuess}
                        className="mt-4 border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Save to Rolodex
                      </button>
                    </section>
                  )}

                  <section className={`grid gap-4 ${isPersonal ? 'grid-cols-1 max-w-2xl mx-auto' : 'xl:grid-cols-3'}`}>
                    {(isPersonal
                      ? [["Personal Post", outputs.facebook]]
                      : [
                        ["Facebook", outputs.facebook],
                        ["X", outputs.x],
                        ["Instagram", outputs.instagram],
                      ]
                    ).map(([name, value]) => (
                      <article key={name as string} className="flex flex-col border border-slate-300 bg-white p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold uppercase text-slate-600">{name as string}</h3>
                          <button
                            type="button"
                            onClick={() => {
                              void copyText(value as string, name as string);
                            }}
                            className="border border-slate-400 bg-slate-100 px-2 py-1 text-xs"
                          >
                            One-click Copy
                          </button>
                        </div>
                        <pre className="whitespace-pre-wrap text-sm text-slate-800 flex-grow">{value as string}</pre>
                      </article>
                    ))}
                  </section>

                  {!isPersonal && (
                    <section className="mt-5 border border-slate-300 bg-white p-6 rounded shadow-sm text-center max-w-2xl mx-auto">
                      <h2 className="text-lg font-bold text-slate-800 mb-2">Ready to Go Live?</h2>
                      <p className="text-sm text-slate-600 mb-6">Instantly push your tailored posts to Facebook and Instagram simultaneously using Meta's native cross-publishing pipeline.</p>

                      <button
                        onClick={publishToMeta}
                        disabled={isPublishing["meta"]}
                        className="w-full md:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                      >
                        {isPublishing["meta"] ? "Publishing to Meta..." : "Publish Both to Meta"}
                      </button>

                      {publishStatus["meta"] && (
                        <div className={`mt-4 p-3 rounded text-sm font-medium ${publishStatus["meta"].startsWith("Error") ? "bg-red-50 text-red-700 border border-red-200" : "bg-green-50 text-green-700 border border-green-200"}`}>
                          {publishStatus["meta"]}
                        </div>
                      )}
                    </section>
                  )}

                  <div className="flex justify-center pt-8 border-t border-slate-200">
                    <button
                      type="button"
                      onClick={resetNewPost}
                      className="rounded border border-slate-400 bg-white px-8 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
                    >
                      Clear Results & Start New Post
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {activeView === "analytics" && (
            <AnalyticsView
              settings={{
                apiKey,
                handleMap,
                metaAccessToken,
                metaPageId,
                metaIgAccountId
              }}
            />
          )}

          {activeView === "settings" && (
            <div className="space-y-5 flex flex-col h-full">
              <nav className="flex shrink-0 gap-1 border-b border-slate-300 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("gemini")}
                  className={`rounded px-3 py-1.5 text-sm ${activeSettingsTab === "gemini" ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  Gemini API
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("tags")}
                  className={`rounded px-3 py-1.5 text-sm ${activeSettingsTab === "tags" ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  TAG Library
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("meta")}
                  className={`rounded px-3 py-1.5 text-sm ${activeSettingsTab === "meta" ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  Meta Analytics
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSettingsTab("ai")}
                  className={`rounded px-3 py-1.5 text-sm ${activeSettingsTab === "ai" ? "bg-slate-200 font-semibold text-slate-900" : "text-slate-600 hover:bg-slate-100"}`}
                >
                  AI Learning
                </button>
              </nav>

              <div className="flex-1 overflow-auto">
                {activeSettingsTab === "gemini" && (
                  <section className="border border-slate-300 bg-white p-4">
                    <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">API Key</h2>
                    <div className="flex flex-col gap-2">
                      <input
                        type="password"
                        className="w-full border border-slate-300 px-3 py-2 text-sm"
                        value={apiKey}
                        onChange={(event) => {
                          setApiKey(event.target.value);
                          setTestStatus(null);
                        }}
                        placeholder="Google AI API key"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            void saveApiKey();
                          }}
                          className="border border-blue-700 bg-blue-700 px-4 py-2 text-sm text-white"
                        >
                          Save API Key
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!apiKey.trim()) {
                              setTestStatus({ msg: "Enter an API key first.", ok: false });
                              return;
                            }
                            if (!window.electronAPI) {
                              setTestStatus({ msg: "Electron API not available.", ok: false });
                              return;
                            }
                            setTestStatus({ msg: "Testing…", ok: true });
                            const result = await window.electronAPI.testConnection(apiKey.trim());
                            if (result.success) {
                              await refreshModels(apiKey.trim());
                              const allModels = result.models.map((m: any) =>
                                typeof m === "string" ? { id: m, label: m } : m
                              ) as ModelOption[];
                              setAvailableModels(allModels);
                              const preview =
                                allModels.length > 0
                                  ? allModels.slice(0, 5).map(m => m.label).join(", ") + (allModels.length > 5 ? "…" : "")
                                  : "No models returned.";
                              setTestStatus({
                                msg: `Success. Found ${allModels.length} model(s). Examples: ${preview}`,
                                ok: true,
                              });
                            } else {
                              setTestStatus({ msg: `Failed: ${result.error}`, ok: false });
                            }
                          }}
                          className="border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
                        >
                          Test Connection
                        </button>
                      </div>
                      {testStatus && (
                        <p
                          className={`mt-2 text-sm ${testStatus.msg.startsWith("Testing") ? "text-slate-500" : testStatus.ok ? "text-green-600" : "text-red-600"}`}
                        >
                          {testStatus.msg.startsWith("Success") ? "✓ " : ""}
                          {testStatus.msg}
                        </p>
                      )}
                    </div>
                  </section>
                )}

                {activeSettingsTab === "tags" && (
                  <section className="border border-slate-300 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-semibold uppercase text-slate-600">Tag Library</h2>
                      <button
                        type="button"
                        onClick={() => setHandleMap((rows) => [...rows, getInitialHandle()])}
                        className="border border-slate-400 bg-white px-3 py-1 text-xs"
                      >
                        Add Row
                      </button>
                    </div>
                    <div className="overflow-auto">
                      <table className="min-w-full border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-100 text-left">
                            <th className="border border-slate-300 px-2 py-2">Nickname</th>
                            <th className="border border-slate-300 px-2 py-2">X</th>
                            <th className="border border-slate-300 px-2 py-2">IG</th>
                            <th className="border border-slate-300 px-2 py-2">FB</th>
                          </tr>
                        </thead>
                        <tbody>
                          {handleMap.map((entry, index) => (
                            <tr key={`${entry.nickname}-${index}`}>
                              <td className="border border-slate-300 p-1">
                                <input
                                  className="w-full border border-slate-300 px-2 py-1"
                                  value={entry.nickname}
                                  onChange={(event) => updateHandleRow(index, "nickname", event.target.value)}
                                />
                              </td>
                              <td className="border border-slate-300 p-1">
                                <input
                                  className="w-full border border-slate-300 px-2 py-1"
                                  value={entry.x_handle}
                                  onChange={(event) => updateHandleRow(index, "x_handle", event.target.value)}
                                />
                              </td>
                              <td className="border border-slate-300 p-1">
                                <input
                                  className="w-full border border-slate-300 px-2 py-1"
                                  value={entry.ig_handle}
                                  onChange={(event) => updateHandleRow(index, "ig_handle", event.target.value)}
                                />
                              </td>
                              <td className="border border-slate-300 p-1">
                                <input
                                  className="w-full border border-slate-300 px-2 py-1"
                                  value={entry.fb_handle}
                                  onChange={(event) => updateHandleRow(index, "fb_handle", event.target.value)}
                                />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        void saveHandleMap();
                      }}
                      className="mt-3 border border-emerald-700 bg-emerald-700 px-4 py-2 text-sm text-white"
                    >
                      Save Tag Library
                    </button>
                  </section>
                )}

                {activeSettingsTab === "meta" && (
                  <section className="border border-slate-300 bg-white p-4">
                    <div className="mb-4">
                      <h2 className="text-sm font-semibold uppercase text-slate-600 flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" /> Meta Analytics Integration
                      </h2>
                      <p className="text-xs text-slate-500 mt-1">Connect your Facebook Page and Instagram Business account to view insights.</p>
                    </div>

                    <div className="space-y-4 max-w-2xl">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">Long-lived Access Token</label>
                        <input
                          type="password"
                          className="w-full border border-slate-300 px-3 py-2 text-sm font-mono"
                          value={metaAccessToken}
                          onChange={(e) => setMetaAccessToken(e.target.value)}
                          placeholder="EAA..."
                        />
                        <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
                          <ArrowUpRight className="w-2 h-2" /> Get this from Meta Graph API Explorer (with pages_read_engagement, instagram_manage_insights)
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Facebook Page ID</label>
                          <input
                            className="w-full border border-slate-300 px-3 py-2 text-sm"
                            value={metaPageId}
                            onChange={(e) => setMetaPageId(e.target.value)}
                            placeholder="123456789..."
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">Instagram Business Account ID</label>
                          <input
                            className="w-full border border-slate-300 px-3 py-2 text-sm"
                            value={metaIgAccountId}
                            onChange={(e) => setMetaIgAccountId(e.target.value)}
                            placeholder="178414..."
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={saveMetaCreds}
                          className="border border-blue-700 bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-800 transition-colors"
                        >
                          Save Meta Credentials
                        </button>
                        {metaSaveStatus && (
                          <span className={`text-xs ${metaSaveStatus.ok ? 'text-green-600' : 'text-red-600'}`}>
                            {metaSaveStatus.msg}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100 italic text-[11px] text-slate-400 space-y-1">
                      <p>1. Go to Meta for Developers and create a Business App.</p>
                      <p>2. Use Graph API Explorer to generate a token for your Instagram Business/Creator account.</p>
                      <p>3. Ensure your IG account is linked to your FB Page.</p>
                    </div>
                  </section>
                )}

                {activeSettingsTab === "ai" && (
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Left Column: AI Memory Parameters */}
                    <div className="border border-slate-300 bg-white p-5 rounded">
                      <h3 className="text-sm font-semibold uppercase text-slate-600 border-b border-slate-200 pb-2">AI Memory Parameters</h3>

                      <div className="flex flex-col gap-5 pt-2">
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-sm font-semibold text-slate-700">Comment Weight Modifier</label>
                            <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded text-slate-700">{aiCommentWeight}x</span>
                          </div>
                          <p className="text-xs text-slate-500 mb-2">How much more valuable is a comment compared to a like when grading a post's engagement score?</p>
                          <input
                            type="range"
                            min="1" max="10" step="1"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                            value={aiCommentWeight}
                            onChange={(e) => setAiCommentWeight(Number(e.target.value))}
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-sm font-semibold text-slate-700">Minimum Reach Threshold</label>
                            <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded text-slate-700">{aiMinReach}</span>
                          </div>
                          <p className="text-xs text-slate-500 mb-2">Ignore posts with fewer than this many impressions to avoid skewing data with low-sample anomalies.</p>
                          <input
                            type="range"
                            min="10" max="1000" step="10"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                            value={aiMinReach}
                            onChange={(e) => setAiMinReach(Number(e.target.value))}
                          />
                        </div>

                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <label className="text-sm font-semibold text-slate-700">Prompt Injection Count</label>
                            <span className="font-mono text-sm bg-slate-100 px-2 py-0.5 rounded text-slate-700">{aiInjectionCount}</span>
                          </div>
                          <p className="text-xs text-slate-500 mb-2">How many of your absolute highest-scoring historical posts should be injected into Gemini's system prompt during generation?</p>
                          <input
                            type="range"
                            min="1" max="5" step="1"
                            className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                            value={aiInjectionCount}
                            onChange={(e) => setAiInjectionCount(Number(e.target.value))}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Database Management */}
                    <div className="border border-slate-300 bg-white p-5 rounded">
                      <h3 className="text-sm font-semibold uppercase text-slate-600 border-b border-slate-200 pb-2">Database Management</h3>

                      <div className="flex flex-col gap-6 pt-2">
                        {/* DB Location Setting */}
                        <div>
                          <label className="block text-sm font-semibold text-slate-700 mb-1">SQLite Database Location</label>
                          <p className="text-xs text-slate-500 mb-3">Choose where to save the `analytics_memory.sqlite` learning database.</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              readOnly
                              className="flex-1 border border-slate-300 bg-slate-50 text-slate-700 px-3 py-2 text-sm font-mono truncate"
                              value={aiDbPath || "[Default System AppData Directory]"}
                              placeholder="Default directory..."
                            />
                            <button
                              type="button"
                              onClick={handleSelectDbDirectory}
                              className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 text-sm font-medium rounded transition-colors whitespace-nowrap"
                            >
                              Browse...
                            </button>
                          </div>
                        </div>

                        {/* Save Button for everything */}
                        <div className="border-t border-slate-100 pt-5">
                          <button
                            type="button"
                            onClick={saveAIParams}
                            className="w-full border border-blue-700 bg-blue-700 hover:bg-blue-800 transition-colors px-4 py-3 text-sm font-semibold text-white rounded mb-2"
                          >
                            Save AI Settings & Database Path
                          </button>
                          {aiSaveStatus && (
                            <p className={`text-xs text-center font-medium ${aiSaveStatus.ok ? "text-green-600" : "text-red-500"}`}>
                              {aiSaveStatus.msg}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>

              {activeSettingsTab === "ai" && (
                <div className="mt-6 border border-red-200 bg-red-50 p-4 shrink-0 rounded">
                  <h3 className="text-sm font-semibold text-red-800 uppercase flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> Danger Zone
                  </h3>
                  <p className="text-xs text-red-600 mt-1 mb-3">
                    Wiping the database will permanently delete all captured posts and AI context memory.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      if (window.confirm("Are you sure? This will delete all learned AI context.")) {
                        try {
                          if (!window.electronAPI) return;
                          // @ts-ignore
                          const res = await window.electronAPI.clearAiDatabase();
                          if (res.success) {
                            alert("Database wiped successfully!");
                          } else {
                            alert("Failed to wipe database: " + res.error);
                          }
                        } catch (e: any) {
                          alert("Error wiping database: " + e.message);
                        }
                      }
                    }}
                    className="border border-red-700 bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 transition-colors"
                  >
                    Clear AI Database Memory
                  </button>
                </div>
              )}
            </div>
          )}
        </main>

        <footer className="flex shrink-0 items-center border-t border-slate-300 bg-slate-50 px-4 py-1 text-[11px] text-slate-600">
          <div className="flex-1 truncate font-mono">{statusText}</div>
          <div className="ml-4 tabular-nums">v0.0.0-alpha</div>
        </footer>
      </div>
    </div>
  );
}

export default App;
