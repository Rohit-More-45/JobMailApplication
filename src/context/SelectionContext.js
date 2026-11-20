import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

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
});

export function SelectionProvider({ children }) {
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
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
