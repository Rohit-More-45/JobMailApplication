import React, { createContext, useContext, useState, useRef, useCallback } from 'react';

const SelectionContext = createContext({
  selectedPostId: null,
  isSelected: false,
  setSelectedPostId: () => {},
  clearSelection: () => {},
  webViewRef: null,
  registerWebView: () => {},
});

export function SelectionProvider({ children }) {
  const [selectedPostId, setSelectedPostId] = useState(null);
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

  return (
    <SelectionContext.Provider
      value={{
        selectedPostId,
        isSelected: selectedPostId !== null,
        setSelectedPostId,
        clearSelection,
        webViewRef,
        registerWebView,
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
