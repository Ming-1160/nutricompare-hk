import { assistantState } from './assistant-state.mjs?v=111';

export const MAAS_ORIGIN = 'https://maas.eduhk.hk';
export const RESULT_ORIGIN = 'https://ming-1160.github.io';
export const RESULT_PATH = '/nutricompare-hk/';

/** The existing public share link, shown only after the person asks to load the conversation. */
export function embeddedAssistantUrl(config = {}, now = Date.now()) {
  const state = assistantState(config, now);
  if (state.state !== 'ready') return '';
  const url = new URL(state.url);
  if (url.origin !== MAAS_ORIGIN || url.pathname !== '/chat/share' || url.username || url.password || !url.searchParams.get('shareId')) return '';
  url.searchParams.set('showHead', '0');
  url.searchParams.set('showHistory', '0');
  return url.href;
}

/** A result can only be this project's exact public page. Its conditions are checked by the main app. */
export function validatedResultUrl(value) {
  if (typeof value !== 'string' || value.length > 12000) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.origin !== RESULT_ORIGIN || url.pathname !== RESULT_PATH || url.username || url.password) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

/** FastGPT v4.14.5 posts {type: 'shareChatReady'} and {type: 'shareChatFinish', data: {answer}}. */
export function isTrustedAssistantMessage(event, frameWindow, type) {
  return Boolean(frameWindow && event?.source === frameWindow && event.origin === MAAS_ORIGIN
    && event.data && typeof event.data === 'object' && !Array.isArray(event.data) && event.data.type === type);
}

/** Extract a link, never executable markup or food figures, from the completed answer. */
export function resultLinkFromAnswer(answer) {
  if (typeof answer !== 'string' || answer.length > 100000) return '';
  const links = answer.matchAll(/(?:^|[\s(<])((?:https:\/\/)[^\s<>"`()[\]{}]+)/g);
  for (const match of links) {
    const accepted = validatedResultUrl(match[1].replace(/[。；，！？]+$/, ''));
    if (accepted) return accepted;
  }
  return '';
}

/**
 * Owns the opt-in dialog only. The main app owns condition parsing and allergy exclusions.
 * No external resource is created until the load button is pressed; closing unloads the frame.
 */
export function initEmbeddedAssistant({ getConfig = () => ({}), onResultLink } = {}) {
  const dialog = document.createElement('dialog');
  dialog.id = 'embedded-ai-dialog';
  dialog.className = 'embedded-ai-dialog';
  dialog.setAttribute('aria-labelledby', 'embedded-ai-title');
  dialog.innerHTML = `
    <div class="embedded-ai-heading"><h2 id="embedded-ai-title">用 AI 講需要</h2><button type="button" class="close-button" data-close-embedded-ai aria-label="關閉 AI 對話">×</button></div>
    <div class="embedded-ai-intro" id="embedded-ai-intro">
      <p>AI 對話由教大 MaaS 處理。按「載入 AI 對話」後，呢個視窗先會連線到 MaaS；小組可查閱對話紀錄。請勿輸入姓名、病歷、藥物或其他個人資料。</p>
      <p>AI 幫你整理購物條件；營養數字、價格同過敏排除仍由 NutriCompare 按來源處理。</p>
    </div>
    <p class="embedded-ai-status" id="embedded-ai-status" role="status" aria-live="polite"></p>
    <div class="embedded-ai-actions"><button type="button" class="primary-button" data-load-embedded-ai>載入 AI 對話</button><a class="secondary-button" data-external-ai target="_blank" rel="noopener noreferrer" hidden>另開 AI 助手 ↗</a></div>
    <div class="embedded-ai-frame-wrap" id="embedded-ai-frame-wrap" hidden></div>
    <form class="ai-result-import" id="embedded-ai-result-form">
      <label for="embedded-ai-result-url">貼上 AI 結果連結</label>
      <p>AI 回覆有網站連結後，可以喺呢度核對並套用。收到可辨認嘅連結時會先填入，等你確認。</p>
      <input type="url" id="embedded-ai-result-url" placeholder="https://ming-1160.github.io/nutricompare-hk/?…" autocomplete="off" spellcheck="false" maxlength="12000">
      <button type="submit" class="primary-button">核對並套用條件</button>
      <p id="embedded-ai-result-status" role="status" aria-live="polite"></p>
    </form>`;
  document.body.append(dialog);
  const status = dialog.querySelector('#embedded-ai-status');
  const intro = dialog.querySelector('#embedded-ai-intro');
  const loadButton = dialog.querySelector('[data-load-embedded-ai]');
  const externalLink = dialog.querySelector('[data-external-ai]');
  const frameWrap = dialog.querySelector('#embedded-ai-frame-wrap');
  const resultInput = dialog.querySelector('#embedded-ai-result-url');
  const resultStatus = dialog.querySelector('#embedded-ai-result-status');
  let frame = null;
  let readyTimer;

  const config = () => { try { return getConfig() ?? {}; } catch { return {}; } };
  function unload() {
    clearTimeout(readyTimer);
    readyTimer = undefined;
    if (frame) frame.remove();
    frame = null;
    frameWrap.replaceChildren();
    frameWrap.hidden = true;
  }
  function open() {
    if (dialog.open) return;
    unload();
    const current = config();
    const state = assistantState(current);
    const address = embeddedAssistantUrl(current);
    loadButton.disabled = !address;
    loadButton.hidden = false;
    intro.hidden = false;
    resultInput.value = '';
    resultStatus.textContent = '';
    externalLink.hidden = state.state !== 'ready';
    if (state.state === 'ready') externalLink.href = state.url; else externalLink.removeAttribute('href');
    status.textContent = state.state === 'expired' ? 'AI 分享連結已到期，請通知小組更新。你仍可貼上已有嘅網站結果連結。'
      : !address ? 'AI 對話暫時未能載入。你仍可貼上已有嘅網站結果連結。'
        : '尚未連線到 AI。請先閱讀以上資料，再選擇載入。';
    dialog.showModal();
  }
  function close() { if (dialog.open) dialog.close(); else unload(); }

  loadButton.addEventListener('click', () => {
    if (frame) return;
    const address = embeddedAssistantUrl(config());
    if (!address) { loadButton.disabled = true; status.textContent = 'AI 分享連結未能使用，請改用已有嘅網站結果連結。'; return; }
    frame = document.createElement('iframe');
    frame.className = 'embedded-ai-frame';
    frame.title = 'NutriCompare HK AI 條件助手（EdUHK MaaS）';
    frame.referrerPolicy = 'no-referrer';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
    frame.src = address;
    frameWrap.hidden = false;
    frameWrap.append(frame);
    loadButton.hidden = true;
    intro.hidden = true;
    status.textContent = '正在載入 MaaS 對話頁面…';
    readyTimer = setTimeout(() => {
      status.textContent = '未能確認 AI 對話頁面已準備好。如果下方冇顯示對話，請用「另開 AI 助手」；需要登入時亦可先用網站搜尋。';
    }, 12000);
  });

  const onMessage = event => {
    if (!frame) return;
    if (isTrustedAssistantMessage(event, frame.contentWindow, 'shareChatReady')) {
      clearTimeout(readyTimer);
      readyTimer = undefined;
      status.textContent = 'MaaS 對話頁面已準備好。請在下方輸入購物需要。';
    } else if (isTrustedAssistantMessage(event, frame.contentWindow, 'shareChatFinish')) {
      const link = resultLinkFromAnswer(event.data.data?.answer);
      if (link) {
        resultInput.value = link;
        resultStatus.textContent = '收到網站結果連結；請按「核對並套用條件」確認，現有條件未有改動。';
      }
    }
  };
  const onOpenClick = event => {
    if (!event.target.closest?.('[data-open-ai]')) return;
    event.preventDefault();
    open();
  };
  dialog.querySelector('[data-close-embedded-ai]').addEventListener('click', close);
  dialog.addEventListener('close', unload);
  dialog.querySelector('#embedded-ai-result-form').addEventListener('submit', async event => {
    event.preventDefault();
    const link = validatedResultUrl(resultInput.value);
    if (!link) { resultStatus.textContent = '請貼上 NutriCompare HK 正式網站嘅結果連結；其他網站或頁面唔會套用。'; resultInput.focus(); return; }
    if (typeof onResultLink !== 'function') { resultStatus.textContent = '暫時未能套用連結，請直接開啟網站結果。'; return; }
    try {
      const applied = await onResultLink(link);
      if (applied === false) { resultStatus.textContent = '網站未能套用呢條連結，請核對連結或直接搜尋。'; return; }
      close();
    } catch { resultStatus.textContent = '未能套用連結，請稍後再試或直接搜尋。'; }
  });
  document.addEventListener('click', onOpenClick);
  window.addEventListener('message', onMessage);
  return { open, close, destroy() { unload(); document.removeEventListener('click', onOpenClick); window.removeEventListener('message', onMessage); dialog.remove(); } };
}
