/**
 * AI assistant settings. The assistant is an EdUHK MaaS "Dialogue Agent" built by the group
 * (system prompt and test cases: docs/maas-assistant.md). It only suggests filter conditions and replies with a
 * NutriCompare link; nutrition values, allergy exclusion and prices are always computed by this site.
 *
 * After publishing the agent in MaaS (Save and Publish -> Create a new link -> Start Using -> copy link),
 * paste the link below, record the expiry date you chose, then commit and push.
 * Leave url empty to show the "assistant being set up" state instead of a button.
 */
export const AI_ASSISTANT = Object.freeze({
  url: '',
  platform: 'EdUHK MaaS',
  linkExpires: '',
});
