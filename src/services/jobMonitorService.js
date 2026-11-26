import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const LINKEDIN_JOB_MONITOR_TASK = 'JOBMAIL_LINKEDIN_JOB_MONITOR';
export const FOREGROUND_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const CONFIG_KEY = '@JobMail:job_bot_config';
const SEEN_IDS_KEY = '@JobMail:job_bot_seen_ids';
const FOUND_JOBS_KEY = '@JobMail:job_bot_found_jobs';
const STATUS_KEY = '@JobMail:job_bot_status';
const CHANNEL_ID = 'jobmail-linkedin-alerts';

export const DEFAULT_BOT_CONFIG = {
  enabled: false,
  keywords: 'Software Engineer',
  location: 'India',
  timeFilter: 'r86400', // Past 24 hours (r300=5m, r3600=1h, r86400=24h, r604800=7d)
  workType: '', // '' = All, '2' = Remote, '3' = Hybrid, '1' = On-site
  customUrl: '',
};

const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

// Configure foreground notification display
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function setupJobNotifications() {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'LinkedIn Job Alerts',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0a66c2',
        sound: 'default',
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      return status === 'granted';
    }
    return true;
  } catch (err) {
    console.warn('[JobMonitor] Notification setup error:', err);
    return false;
  }
}

export async function loadBotConfig() {
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (raw) {
      return { ...DEFAULT_BOT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (_e) {}
  return { ...DEFAULT_BOT_CONFIG };
}

export async function saveBotConfig(config) {
  const merged = { ...DEFAULT_BOT_CONFIG, ...config };
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  return merged;
}

export async function loadFoundJobs() {
  try {
    const raw = await AsyncStorage.getItem(FOUND_JOBS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (_e) {}
  return [];
}

export async function clearFoundJobs() {
  await AsyncStorage.setItem(FOUND_JOBS_KEY, JSON.stringify([]));
}

export async function loadBotStatus() {
  try {
    const raw = await AsyncStorage.getItem(STATUS_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (_e) {}
  return {
    lastCheckedAt: null,
    lastError: null,
    lastNewCount: 0,
    totalChecks: 0,
  };
}

export function buildLinkedInGuestSearchUrl(config) {
  const params = new URLSearchParams();

  if (config.customUrl && config.customUrl.trim().startsWith('http')) {
    try {
      const parsed = new URL(config.customUrl.trim());
      const allowedParams = ['keywords', 'location', 'f_TPR', 'f_WT', 'f_E', 'geoId'];
      for (const key of allowedParams) {
        const val = parsed.searchParams.get(key);
        if (val) params.set(key, val);
      }
      params.set('sortBy', 'DD');
      params.set('start', '0');
      return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
    } catch (_e) {}
  }

  if (config.keywords && config.keywords.trim()) {
    params.set('keywords', config.keywords.trim());
  }
  if (config.location && config.location.trim()) {
    params.set('location', config.location.trim());
  }
  if (config.timeFilter) {
    params.set('f_TPR', config.timeFilter);
  }
  if (config.workType) {
    params.set('f_WT', config.workType);
  }
  params.set('sortBy', 'DD'); // Most recent first
  params.set('start', '0');

  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLinkedInJobsHtml(html) {
  if (!html || typeof html !== 'string') return [];

  const jobs = [];
  const seenInPage = new Set();
  const cards = html.split(/<li>/);

  for (const card of cards) {
    const idMatch = card.match(/urn:li:jobPosting:(\d+)/);
    if (!idMatch) continue;

    const id = idMatch[1];
    if (seenInPage.has(id)) continue;
    seenInPage.add(id);

    const titleMatch = card.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const companyMatch = card.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
    const locationMatch = card.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const linkMatch = card.match(/<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/i);
    const timeMatch = card.match(/<time[^>]*>([\s\S]*?)<\/time>/i);

    const title = decodeHtmlEntities((titleMatch ? titleMatch[1] : '').replace(/<[^>]+>/g, '')) || 'New LinkedIn Job';
    const company = decodeHtmlEntities((companyMatch ? companyMatch[1] : '').replace(/<[^>]+>/g, '')) || 'Company';
    const location = decodeHtmlEntities((locationMatch ? locationMatch[1] : '').replace(/<[^>]+>/g, '')) || '';
    const timeText = decodeHtmlEntities((timeMatch ? timeMatch[1] : '').replace(/<[^>]+>/g, '')) || 'Recently posted';

    let jobUrl = `https://www.linkedin.com/jobs/view/${id}`;
    if (linkMatch && linkMatch[1]) {
      try {
        const rawHref = decodeHtmlEntities(linkMatch[1]);
        const u = new URL(rawHref);
        jobUrl = `${u.origin}${u.pathname}`;
      } catch (_e) {}
    }

    jobs.push({
      id,
      title,
      company,
      location,
      timeText,
      url: jobUrl,
    });
  }

  return jobs;
}

async function sendNewJobsNotification(newJobs) {
  if (!newJobs || newJobs.length === 0) return;

  try {
    const first = newJobs[0];
    const title =
      newJobs.length === 1
        ? `New Job: ${first.title}`
        : `${newJobs.length} New LinkedIn Jobs Found`;
    const body =
      newJobs.length === 1
        ? `${first.company}${first.location ? ' • ' + first.location : ''}`
        : `Latest: ${first.title} at ${first.company}`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: {
          url: first.url,
          jobId: first.id,
        },
      },
      trigger: null, // Immediate local notification
    });
  } catch (err) {
    console.warn('[JobMonitor] Failed to send notification:', err);
  }
}

export async function runJobCheckNow({ notify = true, forceBaselineNotify = false } = {}) {
  const config = await loadBotConfig();
  const prevStatus = await loadBotStatus();

  if (!config.keywords?.trim() && !config.customUrl?.trim()) {
    const errStatus = {
      ...prevStatus,
      lastCheckedAt: Date.now(),
      lastError: 'Add keywords or a LinkedIn search URL first.',
      lastNewCount: 0,
    };
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(errStatus));
    return { newJobs: [], status: errStatus };
  }

  try {
    const searchUrl = buildLinkedInGuestSearchUrl(config);
    const response = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!response.ok) {
      throw new Error(`LinkedIn returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const fetchedJobs = parseLinkedInJobsHtml(html);

    let seenIds = [];
    try {
      const seenRaw = await AsyncStorage.getItem(SEEN_IDS_KEY);
      if (seenRaw) {
        const parsed = JSON.parse(seenRaw);
        if (Array.isArray(parsed)) seenIds = parsed;
      }
    } catch (_e) {}

    const seenSet = new Set(seenIds);
    const isBaseline = seenIds.length === 0;
    const now = Date.now();
    let newJobs = [];

    if (isBaseline) {
      // First run: seed seen IDs and show latest jobs in the UI without notification spam
      const baselineIds = fetchedJobs.map((j) => j.id);
      await AsyncStorage.setItem(SEEN_IDS_KEY, JSON.stringify(baselineIds.slice(0, 300)));

      const initialDisplay = fetchedJobs.slice(0, 15).map((j) => ({
        ...j,
        foundAt: now,
        isNew: false,
      }));
      await AsyncStorage.setItem(FOUND_JOBS_KEY, JSON.stringify(initialDisplay));

      if (forceBaselineNotify && fetchedJobs.length > 0 && notify) {
        await sendNewJobsNotification([fetchedJobs[0]]);
      }
    } else {
      newJobs = fetchedJobs
        .filter((j) => !seenSet.has(j.id))
        .map((j) => ({
          ...j,
          foundAt: now,
          isNew: true,
        }));

      if (newJobs.length > 0) {
        const updatedSeen = [...newJobs.map((j) => j.id), ...seenIds].slice(0, 300);
        await AsyncStorage.setItem(SEEN_IDS_KEY, JSON.stringify(updatedSeen));

        const existingFound = await loadFoundJobs();
        const combinedFound = [
          ...newJobs,
          ...existingFound.map((j) => ({ ...j, isNew: false })),
        ].slice(0, 50);
        await AsyncStorage.setItem(FOUND_JOBS_KEY, JSON.stringify(combinedFound));

        if (notify) {
          await sendNewJobsNotification(newJobs);
        }
      }
    }

    const nextStatus = {
      lastCheckedAt: now,
      lastError: null,
      lastNewCount: newJobs.length,
      totalChecks: (prevStatus.totalChecks || 0) + 1,
    };
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(nextStatus));

    return {
      newJobs,
      totalFetched: fetchedJobs.length,
      isBaseline,
      status: nextStatus,
    };
  } catch (err) {
    const errStatus = {
      ...prevStatus,
      lastCheckedAt: Date.now(),
      lastError: err?.message || 'Network check failed',
      lastNewCount: 0,
      totalChecks: (prevStatus.totalChecks || 0) + 1,
    };
    await AsyncStorage.setItem(STATUS_KEY, JSON.stringify(errStatus));
    return { newJobs: [], status: errStatus };
  }
}

export async function resetSeenJobsBaseline() {
  await AsyncStorage.removeItem(SEEN_IDS_KEY);
}

// Register background task globally at module scope (required by expo-task-manager)
TaskManager.defineTask(LINKEDIN_JOB_MONITOR_TASK, async () => {
  try {
    const config = await loadBotConfig();
    if (!config.enabled) {
      return BackgroundTask.BackgroundTaskResult.Success;
    }
    await runJobCheckNow({ notify: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (_err) {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function syncBackgroundBotRegistration(enabled) {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(LINKEDIN_JOB_MONITOR_TASK);
    if (enabled) {
      await setupJobNotifications();
      if (!isRegistered) {
        // Android WorkManager enforces a 15-minute minimum periodic background interval;
        // foreground polling runs every 5 minutes when the app is active.
        await BackgroundTask.registerTaskAsync(LINKEDIN_JOB_MONITOR_TASK, {
          minimumInterval: 15,
        });
      }
    } else if (isRegistered) {
      await BackgroundTask.unregisterTaskAsync(LINKEDIN_JOB_MONITOR_TASK);
    }
  } catch (err) {
    console.warn('[JobMonitor] BackgroundTask sync error:', err);
  }
}
