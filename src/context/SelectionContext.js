import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { router } from 'expo-router';

const SelectionContext = createContext({
  selectedPostId: null,
  isSelected: false,
  setSelectedPostId: () => {},
  clearSelection: () => {},
  webViewRef: null,
  registerWebView: () => {},
  screenshots: [],
  addScreenshot: () => {},
  clearScreenshots: () => {},
  externalJobUrl: null,
  navigateToJobUrl: () => {},
  clearExternalJobUrl: () => {},
  autofillFormUrl: null,
  navigateToAutofillUrl: () => {},
  clearAutofillFormUrl: () => {},
  easyApplyQueue: [],
  activeAutoApplyJob: null,
  enqueueEasyApplyJobs: () => {},
  setActiveAutoApplyJob: () => {},
  popNextAutoApplyJob: () => {},
  searchQueue: [],
  searchRequest: null,
  isSearchingBot: false,
  botDataVersion: 0,
  triggerBotSearch: () => {},
  clearBotSearch: () => {},
  notifyBotDataUpdated: () => {},
});

export function SelectionProvider({ children }) {
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [externalJobUrl, setExternalJobUrl] = useState(null);
  const [autofillFormUrl, setAutofillFormUrl] = useState(null);
  const [easyApplyQueue, setEasyApplyQueue] = useState([]);
  const [activeAutoApplyJob, setActiveAutoApplyJob] = useState(null);
  const [searchQueue, setSearchQueue] = useState([]);
  const [activeSearchRequest, setActiveSearchRequest] = useState(null);
  const [botDataVersion, setBotDataVersion] = useState(0);
  const webViewRef = useRef(null);

  const registerWebView = useCallback((ref) => {
    webViewRef.current = ref;
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPostId(null);
    if (webViewRef.current) {
      try {
        webViewRef.current.injectJavaScript(`
          if (typeof window.__jobmailDeselectAll === 'function') {
            window.__jobmailDeselectAll();
          }
          true;
        `);
      } catch (err) {
        console.warn('[SelectionContext] Failed to clear WebView selection:', err);
      }
    }
  }, []);

  const addScreenshot = useCallback((uri) => {
    setScreenshots((prev) => {
      if (prev.length >= 3) return prev;
      return [...prev, uri];
    });
  }, []);

  const clearScreenshots = useCallback(() => {
    setScreenshots([]);
  }, []);

  const navigateToJobUrl = useCallback((url) => {
    if (!url) return;
    setExternalJobUrl(url);
    try {
      router.navigate('/linkedin');
    } catch (err) {
      console.warn('[SelectionContext] router.navigate error:', err);
    }
  }, []);

  const clearExternalJobUrl = useCallback(() => {
    setExternalJobUrl(null);
  }, []);

  const navigateToAutofillUrl = useCallback((url) => {
    if (!url) return;
    setAutofillFormUrl(url);
    try {
      router.navigate('/pending2');
    } catch (err) {
      console.warn('[SelectionContext] router.navigate autofill error:', err);
    }
  }, []);

  const clearAutofillFormUrl = useCallback(() => {
    setAutofillFormUrl(null);
  }, []);

  const enqueueEasyApplyJobs = useCallback((jobs) => {
    if (!Array.isArray(jobs) || jobs.length === 0) return;
    setEasyApplyQueue((prev) => {
      const existingIds = new Set(prev.map((j) => j.id));
      const fresh = jobs.filter((j) => j && j.id && !existingIds.has(j.id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  const popNextAutoApplyJob = useCallback(() => {
    setEasyApplyQueue((prev) => {
      if (prev.length === 0) {
        setActiveAutoApplyJob(null);
        return prev;
      }
      const [next, ...rest] = prev;
      setActiveAutoApplyJob(next);
      return rest;
    });
  }, []);

  const triggerBotSearch = useCallback(
    (
      urlOrUrls,
      { notify = true, showAlert = false, descriptionKeywords = '', maxExperienceYears = 3 } = {}
    ) => {
      const urls = Array.isArray(urlOrUrls) ? urlOrUrls.filter(Boolean) : [urlOrUrls].filter(Boolean);
      if (urls.length === 0) return;
      const items = urls.map((u, idx) => ({
        id: Date.now() + '_' + idx + '_' + Math.random().toString(36).slice(2, 6),
        url: u,
        notify,
        showAlert: showAlert && idx === urls.length - 1,
        descriptionKeywords,
        maxExperienceYears,
      }));
      setSearchQueue((prev) => [...prev, ...items]);
    },
    []
  );

  const popNextBotSearch = useCallback(() => {
    setSearchQueue((prev) => {
      if (prev.length === 0) {
        setActiveSearchRequest(null);
        return prev;
      }
      const [next, ...rest] = prev;
      setActiveSearchRequest(next);
      return rest;
    });
  }, []);

  const clearBotSearch = useCallback(() => {
    setActiveSearchRequest(null);
  }, []);

  const notifyBotDataUpdated = useCallback(() => {
    setBotDataVersion((v) => v + 1);
  }, []);

  return (
    <SelectionContext.Provider
      value={{
        selectedPostId,
        isSelected: selectedPostId !== null,
        setSelectedPostId,
        clearSelection,
        webViewRef,
        registerWebView,
        screenshots,
        addScreenshot,
        clearScreenshots,
        externalJobUrl,
        navigateToJobUrl,
        clearExternalJobUrl,
        autofillFormUrl,
        navigateToAutofillUrl,
        clearAutofillFormUrl,
        easyApplyQueue,
        activeAutoApplyJob,
        enqueueEasyApplyJobs,
        setActiveAutoApplyJob,
        popNextAutoApplyJob,
        searchQueue,
        searchRequest: activeSearchRequest,
        isSearchingBot: activeSearchRequest !== null || searchQueue.length > 0,
        botDataVersion,
        triggerBotSearch,
        popNextBotSearch,
        clearBotSearch,
        notifyBotDataUpdated,
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

export function useSelection() {
  const context = useContext(SelectionContext);
  if (!context) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}
