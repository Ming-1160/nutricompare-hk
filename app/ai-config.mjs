/**
 * AI assistant settings. The assistant is an EdUHK MaaS "Dialogue Agent" built by the group
 * (system prompt and test cases: docs/maas-assistant.md). It only suggests filter conditions and replies with a
 * NutriCompare link; nutrition values, allergy exclusion and prices are always computed by this site.
 *
 * After publishing the agent in MaaS (Save and Publish -> Create a new link -> Start Using -> copy link),
 * paste the link below, record the expiry date you chose as YYYY-MM-DD (for example '2026-11-30'), then commit and push.
 * After that date the page hides the button and says the link has expired, instead of opening a dead link.
 * Leave url empty to show the "assistant being set up" state instead of a button.
 * Choose an expiry date after the last day your work is marked, not just after the presentation.
 *
 * explainTested: keep false until the assistant's "模式 2" tests (19 to 25 in docs/maas-assistant.md) have passed.
 * Only then set it to true; the comparison table then shows 「叫 AI 解釋」.
 *
 * Keep every quote mark and comma exactly as below. If this file has a typing mistake, the site still works
 * but the AI button stays hidden. After changing it, open the live site and check the button.
 */
export const AI_ASSISTANT = Object.freeze({
  url: '',
  platform: 'EdUHK MaaS',
  linkExpires: '',
  explainTested: false,
});
