// Runs inside a sandboxed, opaque-origin iframe. Google's grounding terms require showing
// searchEntryPoint.renderedContent unmodified; it carries inline styles, so it lives here
// under its own CSP instead of loosening the main page's.
addEventListener('message', (e) => {
  if (e.source !== parent || typeof e.data?.searchWidget !== 'string') return;
  document.body.innerHTML = e.data.searchWidget;
  parent.postMessage({ widgetHeight: document.documentElement.scrollHeight }, '*');
});
parent.postMessage({ widgetReady: true }, '*');
