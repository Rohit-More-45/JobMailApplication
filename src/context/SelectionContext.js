import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import * as Clipboard from 'expo-clipboard';

const SelectionContext = createContext({
  selectedPostId: null,
  isSelected: false,
  setSelectedPostId: () => {},
  clearSelection: () => {},
  webViewRef: null,
  registerWebView: () => {},
  capturedContent: null,
  setCapturedContent: () => {},
  clearCapturedContent: () => {},
  pendingPaste: false,
  markPasteDone: () => {},
});

export function SelectionProvider({ children }) {
  const [selectedPostId, setSelectedPostId] = useState(null);
  const [capturedContent, setCapturedContentState] = useState(null);
  const [pendingPaste, setPendingPaste] = useState(false);
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

  const setCapturedContent = useCallback(async (content) => {
    setCapturedContentState(content);
    setPendingPaste(true);

    // Also copy clean text to device system clipboard
    if (content && content.fullContent) {
      try {
        await Clipboard.setStringAsync(content.fullContent);
      } catch (e) {
        console.warn('[SelectionContext] Clipboard copy error:', e);
      }
    }
  }, []);

  const clearCapturedContent = useCallback(() => {
    setCapturedContentState(null);
    setPendingPaste(false);
  }, []);

  const markPasteDone = useCallback(() => {
    setPendingPaste(false);
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
        capturedContent,
        setCapturedContent,
        clearCapturedContent,
        pendingPaste,
        markPasteDone,
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
